"""Application-local component installer. Standard library only; never uses system pip."""
from __future__ import annotations
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import struct
import subprocess
import sys
import time
import urllib.error
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / 'portable/components.json'
STATE = ROOT / 'data/components'
CACHE = ROOT / 'data/downloads'
SITE = ROOT / 'runtime/python/Lib/site-packages'

def emit(message, percent=0, **extra):
    print('LAYEROOM_INSTALL:'+json.dumps({'message':message, 'percent':percent, **extra}, ensure_ascii=True), flush=True)

def digest(path):
    with path.open('rb') as stream: return hashlib.file_digest(stream, 'sha256').hexdigest()

def checked_path(root, relative):
    raw = PurePosixPath(relative)
    if raw.is_absolute() or '..' in raw.parts or '\\' in relative or ':' in relative:
        raise ValueError('잘못된 설치 파일 경로입니다.')
    target = root.joinpath(*raw.parts).resolve()
    if not target.is_relative_to(root.resolve()): raise ValueError('설치 폴더를 벗어난 경로입니다.')
    return target

def download(item, progress=emit):
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / (item['sha256']+'.download')
    part = path.with_suffix('.part')
    if path.is_file():
        if path.stat().st_size == item['bytes'] and digest(path) == item['sha256']: return path
        path.unlink()
    offset = part.stat().st_size if part.exists() else 0
    if offset > item['bytes']: part.unlink(); offset=0
    if offset < item['bytes']:
        headers = {'User-Agent':'Layeroom/1', 'Accept-Encoding':'identity','Range':f'bytes={offset}-'}
        request = urllib.request.Request(item['url'], headers=headers)
        with urllib.request.urlopen(request, timeout=45) as response:
            if response.status == 206:
                content_range = response.headers.get('Content-Range','')
                if not content_range.startswith(f'bytes {offset}-') or not content_range.endswith('/'+str(item['bytes'])):
                    raise ValueError('이어받기 응답이 올바르지 않습니다. 다시 시도해 주세요.')
            else: offset=0
            last_report=0
            with part.open('ab' if offset else 'wb') as output:
                while chunk := response.read(1024*1024):
                    output.write(chunk);offset+=len(chunk)
                    if offset > item['bytes']: raise ValueError('다운로드 크기가 예상과 다릅니다.')
                    if time.monotonic()-last_report > .15:
                        progress('다운로드 중', int(offset/item['bytes']*100), received=offset, total=item['bytes'])
                        last_report=time.monotonic()
    if part.stat().st_size != item['bytes']:
        raise ValueError('다운로드가 중단되었습니다. 다시 설치하면 이어받습니다.')
    progress('파일 무결성 확인 중', 100)
    if digest(part) != item['sha256']:
        part.unlink()
        raise ValueError('파일 검증에 실패했습니다. 다시 다운로드해 주세요.')
    part.replace(path)
    return path

def wheel_members(archive):
    for info in archive.infolist():
        raw = PurePosixPath(info.filename)
        checked_path(SITE, info.filename)
        parts = raw.parts
        if not parts or info.is_dir(): continue
        if (info.external_attr >> 16) & 0o170000 == 0o120000: raise ValueError('설치 파일의 심볼릭 링크는 허용되지 않습니다.')
        if any(p in {'tests','test','__pycache__','include','headeronly'} for p in parts): continue
        if raw.suffix in {'.pyc','.pdb','.lib','.h','.hpp','.cuh'}: continue
        if parts[0].endswith('.data'):
            if len(parts)<3 or parts[1] not in {'purelib','platlib'}: continue
            parts=parts[2:]
        yield info, '/'.join(parts)

def install_wheel(path, item):
    # Wheels contain precompiled runtime files. No build tools or code execution
    # from package install hooks; licenses and .dist-info are preserved.
    with zipfile.ZipFile(path) as archive:
        for info, name in wheel_members(archive):
            target=checked_path(SITE,name);target.parent.mkdir(parents=True,exist_ok=True)
            temporary=target.with_name(target.name+'.installing')
            with archive.open(info) as source, temporary.open('wb') as output: shutil.copyfileobj(source,output,1024*1024)
            temporary.replace(target)
    if item['package'] in {'torch','torchvision'}:
        # Only old metadata is removed when switching CPU/GPU wheels. Their
        # package contents are overwritten, and stale binary files are cleared
        # from the previous RECORD before installation in reset_torch().
        for info in SITE.glob(item['package']+'-*.dist-info'):
            if info.name != item['filename'].split('-')[0]+'-'+item['version']+'.dist-info':
                if info.resolve().is_relative_to(SITE.resolve()): shutil.rmtree(info)

def reset_torch():
    # Setup only runs while the owned application is stopped. Never touch the
    # developer environment or other Python installations.
    for pattern in ['torch','torchgen','functorch','torchvision','torchvision.libs','torch-*.dist-info','torchvision-*.dist-info']:
        for target in SITE.glob(pattern):
            if not target.resolve().is_relative_to((ROOT/'runtime/python').resolve()): raise ValueError('잘못된 실행 환경 경로')
            if target.is_dir(): shutil.rmtree(target)
            elif target.exists(): target.unlink()

def widget_runtime(path, item):
    folder=ROOT/'data/widget-runtime';folder.mkdir(parents=True,exist_ok=True)
    target=folder/'launcher.exe';temporary=folder/'launcher.installing'
    with temporary.open('wb') as output:
        with (ROOT/'portable/widget-stub.exe').open('rb') as source: shutil.copyfileobj(source,output)
        with path.open('rb') as source: shutil.copyfileobj(source,output,1024*1024)
        output.write(bytes.fromhex(item['sha256']))
        output.write(struct.pack('<Q',item['bytes']))
        output.write(b'LAYEROOMRUNTIME1')
    temporary.replace(target)

def installed(key, component):
    path=STATE/(key+'.json')
    try: return json.loads(path.read_text())['fingerprint']==component['fingerprint']
    except (OSError,ValueError,KeyError): return False

def probe(key):
    imports = ['fastapi','uvicorn','cv2','scipy','skimage','psd_tools'] if key=='core' else ['torch','torchvision','onnxruntime','transformers','accelerate']
    command=';'.join('import '+name for name in imports)
    if key=='ai_cpu': command+=';assert not torch.version.cuda'
    if key=='ai_cuda': command+=';assert torch.version.cuda'
    subprocess.run([sys.executable,'-X','utf8','-B','-c',command],check=True,creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)

def install(selection, keep_cache=False, repair=False):
    manifest=json.loads(MANIFEST.read_text(encoding='utf-8'))
    STATE.mkdir(parents=True,exist_ok=True);SITE.mkdir(parents=True,exist_ok=True)
    receipts=STATE/'files';receipts.mkdir(exist_ok=True)
    remaining=[(key,manifest['components'][key]) for key in selection if repair or not installed(key,manifest['components'][key])]
    count=sum(len(c['files']) for _,c in remaining);index=0
    for key,component in remaining:
        other = 'ai_cuda' if key=='ai_cpu' else 'ai_cpu' if key=='ai_cuda' else None
        if other:
            reset_torch();(STATE/(other+'.json')).unlink(missing_ok=True)
            for variant in ['ai_cpu','ai_cuda']:
                for entry in manifest['components'][variant]['files']:
                    if entry.get('package') in {'torch','torchvision'}: (receipts/(entry['sha256']+'.json')).unlink(missing_ok=True)
        (STATE/(key+'.json')).unlink(missing_ok=True)
        for item in component['files']:
            index+=1
            name=item.get('package') or item['filename']
            def progress(message,percent=0,**extra):
                emit(f'{component["title"]} · {index}/{count} · {name}\n{message}',round(((index-1)+percent/100)/max(count,1)*95),**extra)
            receipt=receipts/(item['sha256']+'.json')
            if receipt.exists() and not repair:
                if item['kind']=='wheel':
                    package=item['package'].replace('-','_')
                    valid=bool(list(SITE.glob(package+'-'+item['version']+'.dist-info/METADATA')))
                elif item['kind']=='model':
                    target=checked_path(ROOT,item['target']);valid=target.is_file() and target.stat().st_size==item['bytes']
                else: valid=(ROOT/'data/widget-runtime/launcher.exe').is_file()
                if valid: progress('설치된 파일 사용',100);continue
            path=download(item,progress)
            progress('설치 중',100)
            if item['kind']=='wheel': install_wheel(path,item)
            elif item['kind']=='model':
                target=checked_path(ROOT,item['target']);target.parent.mkdir(parents=True,exist_ok=True)
                temp=target.with_name(target.name+'.installing');shutil.copyfile(path,temp);temp.replace(target)
            elif item['kind']=='widget': widget_runtime(path,item)
            else: raise ValueError('알 수 없는 구성요소')
            receipt.write_text(json.dumps({'sha256':item['sha256']}),encoding='utf-8')
            if not keep_cache: path.unlink(missing_ok=True)
        if key!='widget':
            emit(component['title']+' 실행 확인 중',96)
            probe(key)
        marker=STATE/(key+'.json');temp=marker.with_suffix('.tmp')
        temp.write_text(json.dumps({'fingerprint':component['fingerprint'],'installed_at':time.time()}),encoding='utf-8');temp.replace(marker)
    emit('설치가 완료되었습니다.',100,complete=True)

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--ai',choices=['none','cpu','cuda'],default='none');parser.add_argument('--widget',action='store_true');parser.add_argument('--keep-cache',action='store_true');parser.add_argument('--repair',action='store_true')
    args=parser.parse_args()
    try: install(['core']+(['ai_'+args.ai] if args.ai!='none' else [])+(['widget'] if args.widget else []),args.keep_cache,args.repair)
    except Exception as error:
        emit('설치하지 못했습니다. '+str(error),error=True)
        raise SystemExit(1)
