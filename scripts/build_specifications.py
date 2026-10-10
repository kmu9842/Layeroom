"""Create the attached hardware guide from measured portable-job results."""
import json
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
report=json.loads((ROOT/'docs/guide/performance.json').read_text(encoding='utf-8'))
jobs=report['jobs']
components=json.loads((ROOT/'portable/components.json').read_text(encoding='utf-8'))['components']
downloads=''.join(f'<tr><th>{c["title"]}</th><td>약 {c["bytes"]/1e6:,.0f} MB</td><td>{"필수" if key=="core" else "선택"}</td></tr>' for key,c in components.items())
rows=[]
for key,title in [('cuda','NVIDIA GPU'),('cpu','CPU')]:
    m=jobs[key]
    rows.append(f'<tr><th>{title}</th><td>{m["seconds"]:.1f}초</td><td>{m["peak_ram_mib"]/1024:.2f} GiB</td><td>{m["peak_vram_mib"]/1024:.2f} GiB</td></tr>')
text=fr'''<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Layeroom 사양 가이드</title><style>
*{{box-sizing:border-box}}body{{margin:0;background:#f3f5ee;color:#263c30;font:17px/1.75 'Malgun Gothic','Segoe UI',sans-serif}}main{{max-width:1120px;margin:auto;padding:42px 52px}}header{{border-bottom:2px solid #b9caba;padding-bottom:22px;margin-bottom:26px}}.brand{{font-size:25px;font-weight:750}}.eyebrow{{font-size:13px;letter-spacing:2px;color:#6c7f6c}}h1{{font-size:38px;line-height:1.3;margin:18px 0 12px;letter-spacing:-1px}}h2{{font-size:23px;margin:29px 0 12px}}p{{margin:10px 0;color:#4f644f}}.lead{{font-size:19px}}.box{{border:1px solid #c9d7c7;border-radius:10px;background:#fff;padding:18px 22px;margin:18px 0}}table{{border-collapse:collapse;width:100%;background:#fff;border:1px solid #d4dfd0;font-size:16px}}th,td{{padding:11px 15px;border-bottom:1px solid #d4dfd0;vertical-align:top;text-align:left}}th{{background:#e8eee2;font-weight:600;white-space:nowrap}}.small{{font-size:14px;color:#61765d}}code{{font:15px Consolas,monospace;background:#e5eddc;padding:2px 6px;border-radius:3px}}a{{color:#3f7650}}ul{{margin:10px 0;padding-left:24px}}footer{{font-size:13px;color:#768771;border-top:1px solid #cbd5c4;margin-top:28px;padding-top:15px}}.chips{{display:flex;gap:12px;margin:16px 0}}.chips span{{padding:7px 12px;background:#e2ebdb;border-radius:6px;font-size:15px}}@media(max-width:700px){{main{{padding:24px 17px}}table{{font-size:13px}}th,td{{padding:9px}}.chips{{flex-wrap:wrap}}}}@media print{{body{{background:white}}main{{padding:0}}}}
</style></head><body><main><header><span class="brand">Layeroom</span><p class="eyebrow">WINDOWS · HARDWARE GUIDE</p><h1>사양·설치 가이드</h1><p class="lead">앱 ZIP은 가볍게 받고, 필요한 기능만 첫 실행에 설치합니다.</p><div class="chips"><span>폴더 안에 설치</span><span>CPU / NVIDIA GPU 선택</span><span>처리 후 모델 해제</span></div></header>
<h2>첫 실행 다운로드</h2><p>ZIP에는 앱·가이드만 포함됩니다. 실행 환경·모델·CUDA·Electron은 들어 있지 않습니다. <code>Layeroom.exe</code>를 실행하고 필요한 항목을 선택하세요.</p><table><tr><th>구성요소</th><th>다운로드 용량</th><th>선택</th></tr>{downloads}</table><p class="small">자동 분절은 CPU와 NVIDIA GPU 중 하나를 선택합니다. 용량은 기본 실행 환경에 선택한 항목을 더한 값입니다. 이미 설치한 항목은 재사용합니다. 개발 도구·시스템 Python·Node.js 설치는 필요하지 않습니다.</p><p>공식 배포처에서 고정 버전을 받고 SHA-256을 검사합니다. 다운로드를 취소해도 다음 설치 때 이어받습니다. 나중에 추가하려면 트레이 → 구성요소 설치 에서 추가합니다. 설치 위치는 찾아보기에서 Windows 폴더 선택 창으로 고릅니다.</p>
<h2>실행 환경</h2><table><tr><th>항목</th><th>조건·권장 구성</th></tr>
<tr><th>운영체제</th><td>Windows 10 / 11, x64 · Windows 11에서 실행 검증</td></tr>
<tr><th>브라우저</th><td>WebGL을 지원하는 Edge 또는 Chrome · 하드웨어 가속 사용 권장</td></tr>
<tr><th>CPU</th><td>x64 CPU · 4코어 이상 권장. NVIDIA GPU가 없어도 CPU로 자동 분절 가능</td></tr>
<tr><th>메모리</th><td>GPU 처리: RAM 16 GB 이상 권장 · CPU 처리 또는 큰 이미지·PSD 편집: RAM 32 GB 권장</td></tr>
<tr><th>그래픽카드</th><td>액자 표시에는 WebGL 지원 GPU 사용. AI 가속은 CUDA 12.8을 지원하는 NVIDIA GPU 사용 · VRAM 8 GB 이상 권장</td></tr>
<tr><th>드라이버</th><td>NVIDIA GPU를 사용하면 해당 GPU를 지원하는 최신 정식 드라이버 권장. CUDA Toolkit 별도 설치 불필요</td></tr>
<tr><th>저장 공간</th><td>기본 기능: 여유 공간 2 GB · CPU 자동 분절: 6 GB · NVIDIA GPU 자동 분절: 15 GB 이상 권장. 다운로드·압축 해제 임시 공간을 포함한 값이며 SSD 권장</td></tr>
<tr><th>설치 방식</th><td>첫 실행 안내에서 구성요소를 앱 폴더에 설치합니다. 관리자 권한과 시스템 PATH 변경 없이 Windows 기본 .NET Framework 4.x 사용</td></tr>
<tr><th>네트워크</th><td>최초 설치·기능 추가 시 필요. 설치한 기능의 실행·분절·편집·위젯 내보내기는 오프라인 사용 가능</td></tr></table>
<p class="small">권장 구성은 사용 여유를 고려한 안내입니다. 모든 조합을 시험한 최소 보장 사양을 뜻하지 않습니다. AMD·Intel 그래픽은 액자를 표시하며, 이 배포판의 AI 분절은 CPU로 처리합니다.</p>
<h2>동일 이미지 처리 측정</h2><p>Windows 11 Pro · Ryzen 5 5600G · RAM 약 48 GB · RTX 5060 Ti 16 GB<br>NVIDIA 드라이버 610.47 · {report['image_size'][0]} × {report['image_size'][1]} PNG 한 장 · AI 모델 3개로 자동 분절<br>CPU: 포터블 실행 환경 · NVIDIA GPU: 로컬 개발 실행 환경</p>
<table><tr><th>처리 장치</th><th>처리 시간</th><th>최대 RAM</th><th>최대 GPU 텐서 메모리</th></tr>{''.join(rows)}</table>
<p class="small">처리 시간은 각 작업 프로세스의 초기화·모델 로딩·분절·레이어 저장·모델 해제를 포함합니다. RAM은 해당 처리 프로세스의 최대 작업 집합, GPU 값은 PyTorch의 최대 텐서 할당량입니다. 브라우저·운영체제·그래픽 드라이버 메모리는 별도입니다. 파일 크기, 복잡도, 다른 프로그램의 사용량에 따라 달라집니다.</p>
<h2>모델이 메모리에 남지 않는 방식</h2><div class="box"><strong>이미지 처리 시작 → 모델 로드 → 분절·저장 → 모델 해제 → 처리 프로세스 종료</strong><p>일반 이미지마다 별도 처리 프로세스를 사용합니다. 완료하거나 실패하면 프로세스가 끝나 RAM·VRAM과 CUDA 컨텍스트를 반환합니다. 다음 이미지는 모델을 다시 로드합니다.</p><p>컬렉션·액자 보기, 경계 수정, PSD 가져오기에서는 AI 모델을 로드하지 않습니다. 이미지 작업은 한 번에 하나씩 처리합니다.</p></div>
<h2>입력 파일과 위젯</h2><ul><li>PNG·JPG·WebP: 최대 20 MB, 2,500만 픽셀. 자동 처리 시 긴 변 최대 1600px.</li><li>PSD: 최대 100 MB. AI 분절을 생략하고 원본 레이어 순서를 유지합니다. 표시 레이어 최대 80개이며 전체 텍스처 픽셀 수도 제한됩니다.</li><li>위젯 EXE: 샘플 기준 약 157 MiB. AI 모델을 포함하거나 실행하지 않습니다.</li><li>위젯은 실행 시 <code>%LOCALAPPDATA%\LayeroomWidgets</code>에 런타임과 위치·옵션을 보관합니다. 첫 실행에 약 400 MB의 여유 공간을 권장합니다.</li></ul>
<h2>실행·이동·종료</h2><p>ZIP 전체를 풀고 <code>Layeroom.exe</code>를 실행합니다. 쓰기 가능한 폴더를 사용하세요. 선택한 설치 폴더의 <code>_internal/data/cards</code>에 작품을 저장합니다. 실행 환경은 <code>_internal/runtime</code>, 모델은 <code>_internal/models</code>에 설치합니다. 선택 위치는 실행 파일 옆 <code>Layeroom.settings.json</code>에 기록합니다.</p><p>브라우저를 닫아도 서버는 유지됩니다. 트레이 → 종료로 끝낸 뒤 설치 폴더 전체를 복사하세요. 기본 위치는 실행 파일이 있는 폴더입니다. 별도 위치를 선택했다면 해당 설치 폴더도 함께 백업하고, 위치가 바뀌면 구성요소 설치의 찾아보기에서 옮긴 폴더를 지정하세요.</p>
<footer>성능 수치는 가이드에 사용한 캐릭터로 측정한 참고값입니다. CPU는 EXE에 포함된 앱과 다운로드한 실행 환경에서 측정했습니다. 첫 다운로드 시간은 포함하지 않습니다.<br>공개 실행 환경: <a href="https://docs.python.org/3.13/using/windows.html#the-embeddable-package">Python</a> · <a href="https://pytorch.org/get-started/previous-versions/">PyTorch</a> · <a href="https://www.electronjs.org/docs/latest/tutorial/installation">Electron</a><br>CUDA 드라이버 호환: <a href="https://docs.nvidia.com/cuda/archive/12.8.0/cuda-toolkit-release-notes/index.html">NVIDIA CUDA 12.8 릴리스 정보</a></footer></main></body></html>'''
guide=ROOT/'docs/guide';guide.mkdir(parents=True,exist_ok=True)
(guide/'specifications.html').write_text(text,encoding='utf-8')
print('Specifications updated for application-only distribution and first-run downloads',flush=True)
