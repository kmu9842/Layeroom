"""Freeze the current artwork and append its local bundle to the portable launcher."""
import copy
import io
import json
import re
import shutil
import struct
import uuid
import zipfile
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
MAGIC=b'LAYEROOMWIDGET1'
LAUNCHER=ROOT/'data/widget-runtime/launcher.exe'
WEB=ROOT/'widget/dist'
EXPORTS=ROOT/'data/.widget-exports'

def available():
    return LAUNCHER.is_file() and (WEB/'index.html').is_file()

def snapshot_payload(folder,metadata,settings,theme,auto_rotate,zoom):
    card=copy.deepcopy(metadata)
    card['settings']=copy.deepcopy(settings)
    snapshot={'version':1,'card':card,'theme':theme,'autoRotate':auto_rotate,'zoom':zoom}
    files={'source.png','depth.png','cutout.png','segments.png'}
    for layer in card['layers']:
        files.update(layer[key] for key in ['file','render_file','contour_file'] if layer.get(key))
    background=settings.get('custom_background_image')
    if background:files.add(background)
    output=io.BytesIO()
    with zipfile.ZipFile(output,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as archive:
        archive.writestr('package.json',json.dumps({'name':'layeroom-widget','version':'1.0.0','main':'main.cjs'}))
        archive.writestr('snapshot.json',json.dumps(snapshot,ensure_ascii=False,separators=(',',':')))
        for filename in ['main.cjs','preload.cjs','options.cjs']:
            archive.write(ROOT/'widget'/filename,filename)
        for file in WEB.rglob('*'):
            if file.is_file():archive.write(file,'web/'+file.relative_to(WEB).as_posix())
        for name in sorted(files):
            if Path(name).name!=name or Path(name).suffix not in ['.png','.json']:
                raise ValueError('잘못된 액자 파일 경로입니다.')
            file=(folder/name).resolve()
            if file.parent!=folder.resolve() or not file.is_file():
                raise ValueError('액자 파일이 없습니다. 이미지를 다시 열어 주세요.')
            archive.write(file,f'assets/{card["id"]}/{name}')
    return output.getvalue()

def executable(payload):
    if len(payload)>512*1024*1024:raise ValueError('위젯 이미지 데이터가 너무 큽니다.')
    EXPORTS.mkdir(parents=True,exist_ok=True)
    target=EXPORTS/(uuid.uuid4().hex+'.exe')
    try:
        with LAUNCHER.open('rb') as source,target.open('wb') as destination:
            shutil.copyfileobj(source,destination,1024*1024)
            destination.write(payload)
            destination.write(struct.pack('<Q',len(payload))+MAGIC)
        return target
    except Exception:
        target.unlink(missing_ok=True)
        raise

def download_name(title):
    name=re.sub(r'[<>:"/\\|?*\x00-\x1f]','_',title).strip(' .')[:70] or 'Layeroom'
    return name+'-widget.exe'
