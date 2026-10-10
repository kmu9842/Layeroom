"""Describe the captured native installer without modifying the guide renderer."""
import json
from pathlib import Path
from PIL import Image

ROOT=Path(__file__).resolve().parents[1]
path=ROOT/'docs/guide/scenes.json'
scenes=[s for s in json.loads(path.read_text(encoding='utf-8')) if s['id']!='00-setup']
size=Image.open(ROOT/'docs/guide/screenshots/00-setup.png').size
scenes.insert(0,{'id':'00-setup','native':True,'title':'설치 위치·기능 선택',
    'subtitle':'Layeroom.exe를 실행하고 찾아보기에서 설치할 폴더를 선택합니다.',
    'width':size[0],'height':size[1],'boxes':[],'notes':[
        ['탐색기로 위치 선택','찾아보기를 누르면 Windows 탐색기 형태의 폴더 선택 창이 열립니다. 선택한 절대 경로를 확인하세요. 기본값은 실행 파일이 있는 폴더입니다.'],
        ['기본·선택 기능','기본 환경은 약 134 MB입니다. 자동 분절은 CPU 또는 NVIDIA GPU 중 하나, 위젯 출력은 별도 체크로 선택합니다.'],
        ['설치 파일 보관','선택한 위치의 _internal 안에 실행 환경·모델·작품을 저장합니다. 설치 위치는 실행 파일 옆 Layeroom.settings.json에 기억합니다.'],
        ['실행·추가 설치','설치하고 실행을 누릅니다. 이후 트레이 → 구성요소 설치에서 기능을 추가하거나 위치를 바꿀 수 있습니다. 기존 위치의 작품은 자동 삭제하지 않습니다.']
    ]})
path.write_text(json.dumps(scenes,ensure_ascii=False,indent=2),encoding='utf-8')
print('Added actual native installer and Explorer-folder instructions')
