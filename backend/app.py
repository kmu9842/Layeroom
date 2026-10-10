from __future__ import annotations
import base64
import hashlib
import io
import json
import os
import threading
import uuid
import importlib.util
import subprocess
import zipfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import urlsplit
import numpy as np
from PIL import Image, UnidentifiedImageError
from fastapi import FastAPI, UploadFile, File, HTTPException, Request
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from starlette.background import BackgroundTask
from pydantic import BaseModel, Field
from .pipeline import ROOT, CARDS, save_artifacts
from .presentation import normalize_card
from .psd_import import import_psd
from . import widget_export
from .inference_job import process_in_worker

CARDS.mkdir(parents=True, exist_ok=True)
STAGING = ROOT/'data/.staging'
STAGING.mkdir(parents=True, exist_ok=True)
LAUNCHER = Path(os.environ.get('LAYEROOM_LAUNCHER', str(ROOT/'Layeroom.exe')))
app = FastAPI(title='Layeroom Local Studio')
pool = ThreadPoolExecutor(max_workers=1)
jobs = {}
lock = threading.Lock()

@app.middleware('http')
async def local_only(request: Request, call_next):
    origin = request.headers.get('origin')
    if request.method not in ['GET','HEAD','OPTIONS'] and origin:
        if urlsplit(origin).hostname not in ['127.0.0.1','localhost','::1']:
            return Response('Only the local studio may modify this library.',status_code=403)
    return await call_next(request)

def get_folder(card_id):
    if not card_id or any(c not in 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_' for c in card_id):
        raise HTTPException(404, '카드를 찾을 수 없습니다.')
    folder = CARDS/card_id
    if not (folder/'manifest.json').exists():
        raise HTTPException(404, '카드를 찾을 수 없습니다.')
    return folder

def read_card(card_id):
    return normalize_card(json.loads((get_folder(card_id)/'manifest.json').read_text(encoding='utf-8')))

@app.get('/api/health')
def health():
    from .semantic import available
    return {'status':'ok','application':'layeroom','instance':os.environ.get('LAYEROOM_INSTANCE',''),'local':True,'busy':any(j['status'] in ['queued','running'] for j in jobs.values()),'models':{'alpha':(ROOT/'models/anime-seg.onnx').exists(),
        'depth':(ROOT/'models/depth-anything-v2-small/model.safetensors').exists(),'semantic':available()}}

@app.get('/api/capabilities')
def capabilities():
    models=health()['models']
    return {'ai':all(models.values()) and all(importlib.util.find_spec(name) is not None for name in ['torch','torchvision','onnxruntime','transformers','accelerate']),
        'widget':widget_export.available(), 'setup':LAUNCHER.is_file() and (ROOT/'portable/components.json').is_file()}

@app.post('/api/setup')
def setup_components():
    if not capabilities()['setup']: raise HTTPException(404,'이 실행 방식에서는 구성요소 설치를 열 수 없습니다.')
    if health()['busy']: raise HTTPException(409,'이미지 처리가 끝난 뒤 설치해 주세요.')
    subprocess.Popen([str(LAUNCHER),'--setup'],cwd=LAUNCHER.parent,creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)
    return {'opened':True}

@app.get('/api/cards')
def cards():
    return sorted([normalize_card(json.loads(p.read_text(encoding='utf-8'))) for p in CARDS.glob('*/manifest.json')], key=lambda c: c['id'])

@app.get('/api/cards/{card_id}')
def card(card_id: str):
    return read_card(card_id)

@app.post('/api/upload',status_code=202)
async def upload(file: UploadFile = File(...)):
    with lock:
        if sum(j['status'] in ['queued','running'] for j in jobs.values()) >= 4:
            raise HTTPException(429,'처리 대기열이 가득 찼습니다. 잠시 후 다시 시도해 주세요.')
    is_psd = (file.filename or '').lower().endswith('.psd')
    if not is_psd and os.environ.get('LAYEROOM_PORTABLE')=='1' and not capabilities()['ai']:
        raise HTTPException(503,'자동 분절 기능을 먼저 설치해 주세요. 트레이 메뉴 → 구성요소 설치에서 선택할 수 있습니다. PSD는 바로 가져올 수 있습니다.')
    limit = (100 if is_psd else 20)*1024*1024
    blob = await file.read(limit+1)
    if len(blob)>limit:
        raise HTTPException(413,'PSD는 100MB, 이미지는 20MB 이하로 선택해 주세요.')
    if is_psd and (len(blob)<26 or blob[:6] != b'8BPS\x00\x01'):
        raise HTTPException(422,'올바른 PSD 파일이 아닙니다.')
    try:
        if not is_psd:
            with Image.open(io.BytesIO(blob)) as image:
                if image.format not in ['PNG','JPEG','WEBP']:
                    raise HTTPException(415,'PNG, JPG, WebP 이미지를 사용해 주세요.')
                if image.width*image.height > 25_000_000 or min(image.size)<32:
                    raise HTTPException(422,'이미지 크기는 최소 32px, 최대 2,500만 픽셀입니다.')
                image.verify()
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError):
        raise HTTPException(422,'읽을 수 없는 이미지입니다.')
    card_id = f'card-{uuid.uuid4().hex[:12]}'
    job_id = uuid.uuid4().hex
    path = STAGING/f'{job_id}.img'
    path.write_bytes(blob)
    jobs[job_id] = {'id':job_id,'status':'queued','progress':0,'message':'차례를 기다리는 중','card_id':card_id}
    def progress(value,message):
        jobs[job_id].update(progress=value,message=message)
    def work():
        jobs[job_id]['status']='running'
        try:
            title = Path(file.filename or 'Untitled').stem[:80]
            if is_psd:
                import_psd(path,card_id,title,CARDS,progress)
            else:
                def worker_changed(pid):
                    if pid: jobs[job_id]['worker_pid'] = pid
                    else: jobs[job_id].pop('worker_pid',None)
                jobs[job_id]['metrics'] = process_in_worker(path,card_id,title,CARDS,progress,worker_changed)
            jobs[job_id]['status']='completed'
        except Exception as error:
            import traceback
            traceback.print_exc()
            jobs[job_id].update(status='failed',message=str(error)[:400])
        finally:
            path.unlink(missing_ok=True)
    pool.submit(work)
    return jobs[job_id]

@app.get('/api/jobs/{job_id}')
def get_job(job_id: str):
    if job_id not in jobs:
        raise HTTPException(404,'작업을 찾을 수 없습니다.')
    return jobs[job_id]

class Settings(BaseModel):
    depth: float = Field(default=.65,ge=0,le=1.5)
    tilt: bool = True
    frame: str = Field(default='champagne',pattern='^(champagne|silver|carbon)$')
    background: str = Field(default='system',pattern='^(system|midnight|sage|rose)$')
    frame_theme: str | None = Field(default=None,pattern='^(champagne|silver|carbon|walnut|oak|ivory|navy|rose|gold|lavender|custom)$')
    custom_frame_color: str = Field(default='#b5a489',pattern='^#[0-9a-fA-F]{6}$')
    custom_background_color: str = Field(default='#d7d4cc',pattern='^#[0-9a-fA-F]{6}$')
    custom_background_secondary: str = Field(default='#f0eee5',pattern='^#[0-9a-fA-F]{6}$')
    custom_background_style: str = Field(default='gradient',pattern='^(solid|gradient|linen|grid|image)$')
    custom_background_image: str = Field(default='',pattern=r'^(background-[0-9a-f]{16}\.png)?$')
    layer_gap: float = Field(default=.025,ge=0,le=.1,multiple_of=.005)
    angle_limit: float = Field(default=40,ge=15,le=65)
    breathing: bool = False
    support_layers: bool = True
    edge_smoothing: bool = True
    motion_amount: float = Field(default=1,ge=.1,le=2)
    motion_duration: float = Field(default=6,ge=3,le=12)
    layer_order: list[int] | None = None
    layer_motion: dict[str,bool] | None = None
    hidden_layers: list[int] | None = None

def validate_settings(metadata,changes,folder):
    if changes.get('custom_background_image') and not (folder/changes['custom_background_image']).is_file():
        raise HTTPException(422,'배경 이미지를 다시 선택해 주세요.')
    ids = {l['id'] for l in metadata['layers']}
    if 'layer_order' in changes and (set(changes['layer_order']) != ids or len(changes['layer_order']) != len(ids)):
        raise HTTPException(422,'레이어 순서는 모든 레이어를 한 번씩 포함해야 합니다.')
    if not set(changes.get('hidden_layers',[])) <= ids or not set(changes.get('layer_motion',{})) <= {str(i) for i in ids}:
        raise HTTPException(422,'존재하지 않는 레이어입니다.')
    if 'layer_motion' in changes:
        changes['layer_motion'] = {**metadata['settings']['layer_motion'],**changes['layer_motion']}

@app.patch('/api/cards/{card_id}/settings')
def settings(card_id: str, body: Settings):
    with lock:
        folder = get_folder(card_id)
        metadata = read_card(card_id)
        changes = body.model_dump(exclude_unset=True,exclude_none=True)
        validate_settings(metadata,changes,folder)
        metadata['settings'].update(changes)
        target = folder/'manifest.tmp'
        target.write_text(json.dumps(metadata,ensure_ascii=False,indent=2),encoding='utf-8')
        target.replace(folder/'manifest.json')
    return metadata

class WidgetExport(BaseModel):
    settings: Settings
    revision: float
    theme: str = Field(default='light',pattern='^(light|dark)$')
    auto_rotate: bool = False
    zoom: float = Field(default=1,ge=.7,le=1.3)

@app.post('/api/cards/{card_id}/widget')
def export_widget(card_id: str, body: WidgetExport):
    if not widget_export.available():
        raise HTTPException(503,'위젯 출력 기능을 먼저 설치해 주세요. 액자 설정을 저장한 뒤 트레이 메뉴 → 구성요소 설치에서 위젯을 선택하세요.')
    try:
        with lock:
            folder=get_folder(card_id)
            metadata=read_card(card_id)
            if body.revision!=metadata['updated_at']:
                raise HTTPException(409,'이미지가 변경되었습니다. 다시 열고 위젯을 내려받아 주세요.')
            changes=body.settings.model_dump(exclude_unset=True,exclude_none=True)
            validate_settings(metadata,changes,folder)
            snapshot_settings={**metadata['settings'],**changes}
            payload=widget_export.snapshot_payload(folder,metadata,snapshot_settings,body.theme,body.auto_rotate,body.zoom)
        target=widget_export.executable(payload)
    except ValueError as error:
        raise HTTPException(422,str(error))
    return FileResponse(target,media_type='application/vnd.microsoft.portable-executable',filename=widget_export.download_name(metadata['title']),background=BackgroundTask(target.unlink,missing_ok=True))

@app.post('/api/cards/{card_id}/background')
async def background_image(card_id: str, file: UploadFile = File(...)):
    folder = get_folder(card_id)
    blob = await file.read(10*1024*1024+1)
    if len(blob)>10*1024*1024:
        raise HTTPException(413,'배경 이미지는 10MB 이하로 선택해 주세요.')
    try:
        with Image.open(io.BytesIO(blob)) as source:
            if source.format not in ['PNG','JPEG','WEBP'] or source.width*source.height>25_000_000:
                raise HTTPException(422,'PNG, JPG, WebP 이미지를 선택해 주세요. 최대 2,500만 픽셀입니다.')
            image = source.convert('RGB')
            image.thumbnail((1600,1600),Image.Resampling.LANCZOS)
        output = io.BytesIO()
        image.save(output,format='PNG')
        data = output.getvalue()
    except (UnidentifiedImageError,OSError,Image.DecompressionBombError):
        raise HTTPException(422,'읽을 수 없는 배경 이미지입니다.')
    filename = f'background-{hashlib.sha256(data).hexdigest()[:16]}.png'
    with lock:
        (folder/filename).write_bytes(data)
    return {'file':filename}

class Rename(BaseModel):
    title: str = Field(min_length=1,max_length=80)

@app.patch('/api/cards/{card_id}')
def rename(card_id: str, body: Rename):
    title = body.title.strip()
    if not title:
        raise HTTPException(422,'액자 이름을 입력해 주세요.')
    with lock:
        folder = get_folder(card_id)
        metadata = read_card(card_id)
        metadata['title'] = title
        target = folder/'manifest.tmp'
        target.write_text(json.dumps(metadata,ensure_ascii=False,indent=2),encoding='utf-8')
        target.replace(folder/'manifest.json')
    return metadata

class AddedRegion(BaseModel):
    name: str = Field(min_length=1,max_length=80)
    color: str = Field(pattern='^#[0-9a-fA-F]{6}$')
    depth: float = Field(default=.5,ge=0,le=1)


class MaskEdit(BaseModel):
    alpha: str = Field(max_length=10_000_000)
    labels: str = Field(max_length=10_000_000)
    revision: float
    depths: dict[int,float] = Field(default_factory=dict)
    added_regions: list[AddedRegion] = Field(default_factory=list,max_length=255)

def decode_mask(data, size):
    try:
        if not data.startswith('data:image/png;base64,'):
            raise ValueError('PNG required')
        im = Image.open(io.BytesIO(base64.b64decode(data.split(',',1)[1],validate=True)))
        if im.size != size:
            raise ValueError('size mismatch')
        return np.array(im.convert('RGB'))[:,:,0]
    except Exception:
        raise HTTPException(422,'마스크 크기 또는 형식이 올바르지 않습니다.')

@app.post('/api/cards/{card_id}/masks')
def edit_masks(card_id: str, body: MaskEdit):
    with lock:
        folder = get_folder(card_id)
        metadata = read_card(card_id)
        if metadata.get('segmentation') == 'psd':
            raise HTTPException(422,'PSD 원본 레이어는 분절 경계 수정의 대상이 아닙니다.')
        if body.revision != metadata['updated_at']:
            raise HTTPException(409,'다른 창에서 수정되었습니다. 카드를 다시 열어 주세요.')
        if len(metadata['regions']) + len(body.added_regions) > 255:
            raise HTTPException(422,'레이어는 최대 255개까지 추가할 수 있습니다.')
        for region in body.added_regions:
            if not region.name.strip():
                raise HTTPException(422,'레이어 이름을 입력해 주세요.')
            metadata['regions'].append({**region.model_dump(), 'name':region.name.strip(), 'manual':True})
        size = metadata['width'],metadata['height']
        alpha = decode_mask(body.alpha,size)
        labels = decode_mask(body.labels,size)
        if ((alpha>0)&((labels<1)|(labels>len(metadata['regions'])))).any() or (alpha>127).sum()<50:
            raise HTTPException(422,'전경에는 유효한 부위를 지정해야 합니다.')
        labels[alpha==0]=0
        for idx,depth in body.depths.items():
            if not 1<=idx<=len(metadata['regions']) or not 0<=depth<=1:
                raise HTTPException(422,'깊이는 0~1 범위여야 합니다.')
            metadata['regions'][idx-1]['depth']=depth
        rgb=np.array(Image.open(folder/'source.png').convert('RGB'))
        predicted=np.array(Image.open(folder/'estimated-depth.png').convert('L'))/255.0
        metadata['reviewed']=True
        metadata['edited']=True
        # Keep the existing order and place newly created layers at the front.
        added_ids = list(range(len(metadata['regions'])-len(body.added_regions)+1,len(metadata['regions'])+1))
        metadata['settings']['layer_order'] = list(reversed(added_ids)) + metadata['settings']['layer_order']
        result = save_artifacts(folder,rgb,alpha,predicted,labels,metadata['regions'],metadata)
        return normalize_card(result)

@app.get('/api/cards/{card_id}/export')
def export(card_id: str):
    folder=get_folder(card_id)
    output=io.BytesIO()
    with zipfile.ZipFile(output,'w',zipfile.ZIP_DEFLATED) as archive:
        for path in folder.iterdir():
            if path.suffix in ['.png','.json','.psd'] and '-test' not in path.stem:
                archive.write(path,path.name)
    return Response(output.getvalue(),media_type='application/zip',headers={'Content-Disposition':f'attachment; filename="{card_id}-layers.zip"'})

@app.get('/api/research')
def research():
    if os.environ.get('LAYEROOM_PORTABLE') == '1':
        raise HTTPException(404)
    path=ROOT/'docs/research.md'
    return {'text':path.read_text(encoding='utf-8') if path.exists() else '연구 문서를 준비 중입니다.'}

app.mount('/assets',StaticFiles(directory=CARDS),name='assets')

@app.get('/{path:path}')
def frontend(path: str):
    root=(ROOT/'dist').resolve()
    target=(root/path).resolve()
    if root not in target.parents and target != root:
        raise HTTPException(404)
    if target.is_file():
        return FileResponse(target)
    if path and '.' in path:
        raise HTTPException(404)
    if (root/'index.html').exists():
        return FileResponse(root/'index.html')
    return Response('Frontend build missing. Run npm.cmd run build.',status_code=503)
