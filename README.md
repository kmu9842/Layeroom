# Layeroom

캐릭터 이미지를 분절하고 종이 보조층이 있는 3D 액자로 표시하는 로컬 앱입니다. PSD는 AI 분절 없이 원본 레이어 순서로 가져옵니다.

## Windows 배포판

`release/Layeroom-Windows-x64.zip`에는 **Layeroom.exe와 guide 폴더의 PNG 10장**만 들어 있습니다. 앱 코드와 필수 라이선스 고지는 EXE에 포함합니다. 개발 도구, 테스트 자료, 리서치 문서, 모델, 기존 작품은 배포하지 않습니다. 가이드는 사용자가 지정한 캐릭터를 실제 앱에서 처리하고 캡처한 이미지입니다. 배포판의 컬렉션은 비어 있습니다.

1. ZIP을 풀고 `Layeroom.exe`를 실행합니다.
2. **찾아보기**를 누르면 Windows 탐색기 형태의 폴더 선택 창이 열립니다. 설치할 폴더를 고릅니다. 기본값은 EXE가 있는 폴더입니다.
3. 필요한 기능을 선택하고 **설치하고 실행**을 누릅니다.

기본 환경은 약 134 MB입니다. 자동 분절은 CPU 약 2.23 GB 또는 NVIDIA GPU 약 5.08 GB를 추가로 받습니다. 위젯 출력은 약 158 MB를 추가로 받습니다. 고정 버전의 공개 파일을 SHA-256으로 검증하며, 선택한 기능은 설치 후 오프라인으로 사용할 수 있습니다.

선택한 위치의 `_internal`에 앱 코드·실행 환경·모델·작품을 보관합니다. 실행 파일 옆에 생성되는 `Layeroom.settings.json`이 선택한 설치 위치를 기억합니다. 기본 위치는 상대 경로로 기록하여 폴더 전체를 옮길 수 있습니다. 별도 위치를 골랐다면 그 설치 폴더도 백업하세요. 위치를 옮긴 경우 트레이 → 구성요소 설치 → 찾아보기에서 새 위치를 지정합니다. 기존 위치의 작품은 자동 삭제하지 않습니다.

| 선택한 설치 폴더 기준 경로 | 내용 |
| --- | --- |
| `_internal/runtime/python` | 기본 실행 환경과 AI 라이브러리 |
| `_internal/models` | 선택 설치한 AI 모델 |
| `_internal/data/cards` | 작품·레이어·액자 설정 |
| `_internal/data/components` | 설치 상태·검증 기록 |
| `_internal/data/downloads` | 중단 후 이어받기용 임시 파일 |
| `_internal/data/logs/server.log` | 실행 로그 |

트레이에서 사용 가이드, 설치 폴더, 작품 폴더를 열 수 있습니다. **트레이 → 종료**로 앱을 완전히 종료합니다. 시스템 Python·Node.js·CUDA Toolkit 설치와 관리자 권한은 필요하지 않습니다.

[설치 가이드 PNG](docs/guide/images/00-setup.png) · [사양 안내 PNG](docs/guide/images/09-specifications.png) · 가이드 묶음: `release/Layeroom-Guides.zip`

## 동작

일반 이미지는 전경·깊이·의미 부위를 추정합니다. 한 이미지마다 별도 프로세스에 모델을 로드하고, 완료·실패 후 프로세스를 종료하여 모델 RAM·VRAM을 해제합니다. 컬렉션, 뷰어, 경계 편집, PSD 가져오기는 AI 모델을 로드하지 않습니다.

레이어 드래그 정렬, 경계 페인팅과 레이어 추가, 고정/움직임, 깊이·회전 제한, 종이 보조층, 액자 테마·사용자 배경, PNG·레이어 ZIP 출력과 독립 위젯 EXE를 지원합니다. Z축 간격은 0–0.1, 기본 0.025, 변경 단위 0.005입니다. 회전·전환에 관성을 적용하지 않으며 새 작품의 레이어 움직임은 기본으로 꺼져 있습니다. 경계 수정의 레이어 추가에서 이름·표시 색상을 정하고 브러시로 영역을 칠한 뒤 수정 적용으로 저장합니다. 빈 수동 레이어도 유지합니다. 위젯은 내려받을 때의 작품·설정을 보관하며 자동 회전·커서 추적·크기만 위젯에서 바꿉니다.

완전 자동·무오류 분절이나 가려진 부분의 복원은 보장하지 않습니다. 필요한 부분은 경계 수정으로 보정합니다. 실제 360° 모델이나 Live2D 리깅 파일을 만드는 도구는 아닙니다.

각 레이어 행의 **Z** 버튼을 누르면 슬라이더와 숫자 입력으로 위치를 지정합니다. 앞면은 0%, 뒷면은 100%입니다. 조절을 마치면 목록도 앞뒤 위치에 맞춰 정렬됩니다. 전체 Z축 간격을 바꾸면 개별 위치 비율을 유지하면서 깊이가 바뀝니다. 드래그는 현재 깊이 자리를 새 순서에 배정하고, **Z 위치 균등 배치**는 현재 순서대로 간격을 맞춥니다. **원본 순서 복원**은 개별 Z 위치도 초기화합니다. 지정한 위치는 설정 저장과 위젯 출력에 함께 반영됩니다.

## 개발 환경

프로젝트 폴더는 `E:\project\Layeroom`입니다. 기존 작품은 `data/cards`에 유지합니다. `start.bat`으로 실행하고 `stop.bat`으로 종료합니다. 주소는 `http://127.0.0.1:8765`입니다. 새 개발 환경은 Python 3.11~3.13과 Node.js 22.12 이상에서 `setup.bat`으로 준비합니다.

```powershell
.venv/Scripts/python.exe -m pytest -q
npm.cmd run build
npm.cmd run test:paint
npm.cmd run test:depth
npm.cmd run test:browser
npm.cmd run test:widget
.venv/Scripts/python.exe -X utf8 scripts/build_portable.py
```

배포 빌드는 `build/Layeroom`에서 만들고 ZIP만 `release`에 기록합니다. 첫 실행 설치 파일 목록은 `portable/components.json`입니다. 외부 모델 코드는 실제 추론에 연결되는 import 의존성만 유지합니다. 외부 코드 출처는 `third_party/see-through/UPSTREAM.txt`, 라이선스는 같은 폴더의 `LICENSE`에 있습니다. 소스에 있는 리서치·검증 문서는 배포하지 않습니다.

Git에는 사용자 작품·모델·설치된 실행 환경을 저장하지 않습니다. 원본 4장에 대한 픽셀 검사는 해당 로컬 작품이 있을 때만 실행합니다. 브라우저 검사는 로컬 서버와 해당 작품을 사용합니다. 임시 PSD·편집 검사는 테스트마다 생성하고 제거합니다.

가이드 재제작은 사용자가 승인한 그림을 `scripts/prepare_character_guide.py`로 별도 작업 폴더에 처리한 뒤, `scripts/capture_guide.mjs`로 실제 앱·위젯을 캡처합니다. `scripts/build_guide.mjs`와 `scripts/capture_specifications.mjs`가 최종 PNG를 만듭니다. 안내용 캐릭터나 테스트 산출물을 배포 컬렉션에 복사하지 않습니다.
