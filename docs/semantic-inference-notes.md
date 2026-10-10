# See-through 비생성 부위 마스크 실행 조사

조사일: 2026-10-11. 아래 내용은 공식 소스의 정적 분석 결과다. 이 문서 자체는 모델 추론 성공이나 이 저장소에 설치되었다는 의미가 아니다.

## 바로 적용할 경로

See-through의 전체 RGBA 생성 파이프라인과 별도로 **19개 의미 부위의 보이는 픽셀만 분류하는 SemanticSam**이 공개되어 있다. 이것으로 마스크를 얻고 원본 RGB를 그대로 복사하면 이미지 생성 없이 부위 레이어를 만들 수 있다. 단, 19-class 모델은 앞머리/뒷머리를 하나의 `hair` 클래스로 분류한다. 두 영역의 추가 분리는 여전히 필요하다.

- 공식 실행 예: [bodypartseg_sam.ipynb](https://github.com/shitagaki-lab/see-through/blob/main/inference/demo/bodypartseg_sam.ipynb)
- 모델: [common/modules/semanticsam.py](https://github.com/shitagaki-lab/see-through/blob/main/common/modules/semanticsam.py)
- 전처리/추론: [common/modules/extend_sam.py](https://github.com/shitagaki-lab/see-through/blob/main/common/modules/extend_sam.py)
- 기본 SAM-HQ: [common/modules/sam/build_sam.py](https://github.com/shitagaki-lab/see-through/blob/main/common/modules/sam/build_sam.py)
- 가중치 로더: [common/utils/torch_utils.py](https://github.com/shitagaki-lab/see-through/blob/main/common/utils/torch_utils.py)
- 클래스 순서: [common/live2d/scrap_model.py](https://github.com/shitagaki-lab/see-through/blob/main/common/live2d/scrap_model.py)
- 체크포인트: [24yearsold/l2d_sam_iter2](https://huggingface.co/24yearsold/l2d_sam_iter2/tree/main), `checkpoint-18000.pt`, **1.29 GB**, 모델 페이지 Apache-2.0 표시.
- 공개 다운로드: `https://huggingface.co/24yearsold/l2d_sam_iter2/resolve/main/checkpoint-18000.pt`

모델의 기본 설정은 `SemanticSam(class_num=19, model_type='h_hq', mask_decoder='mlp_variant')`다. 고정된 19개의 의미별 출력을 갖도록 수정된 SAM-HQ ViT-H다. 원본 SAM 체크포인트를 추가로 다운로드할 필요 없이 공개된 전체 SemanticSam 체크포인트를 로드한다.

## 최소 의존성

정적 import 추적 기준: `torch`, `torchvision`, `numpy`, `pillow`, `einops`, `accelerate`, `huggingface-hub`, `safetensors`, `requests`, `packaging`, `pyyaml`, `opencv-python`.

전체 연구 저장소의 `requirements.txt`는 생성·학습·GUI 의존성을 함께 설치한다. 마스크 추론만 사용한다면 `diffusers`, `detectron2`, `mmdet`, `PyQt6`, `deepspeed`를 설치할 이유가 없다. `scrap_model.py`를 클래스 이름 때문에 import하면 추가 모듈을 불러오므로 클래스 목록은 아래와 같이 직접 정의할 수 있다. 시각화용 모듈도 추론에 필요하지 않다.

현재 저장소 구조에서 `common` 디렉터리를 Python 검색 경로에 넣는다. 공식 노트북에 보이는 `modules`, `utils`, `live2d`는 모두 이 디렉터리 아래 있다. 공식 전체 환경은 Python 3.12와 PyTorch 2.8.0 / CUDA 12.8 조합을 문서화한다. 이미 정상 작동하는 호환 torch/torchvision 조합이 있으면 기존 환경을 유지하고 별도 프로세스에서 확인한다. [공식 requirements](https://github.com/shitagaki-lab/see-through/blob/main/requirements.txt)

필요한 소스 범위는 `common/modules/sam/` 패키지, `common/modules/semanticsam.py`, `common/modules/extend_sam.py`, `common/utils/torch_utils.py`, `common/utils/io_utils.py`다. 원본 라이선스와 NOTICE를 함께 보관한다. 저장소를 받아 `common` 경로를 사용하는 편이 수동 복사보다 업데이트를 추적하기 쉽다.

## 추론 코드의 최소 형태

아래는 공식 예제를 현재 디렉터리 구조에 맞춘 형태이며, 저장소/체크포인트 경로는 설치한 위치로 지정한다.

```python
import sys
from pathlib import Path
import numpy as np
from PIL import Image
import torch

repo = Path("vendor/see-through").resolve()
sys.path.insert(0, str(repo / "common"))

from modules.semanticsam import SemanticSam
from utils.torch_utils import init_model_from_pretrained

model = init_model_from_pretrained(
    pretrained_model_name_or_path="models/checkpoint-18000.pt",
    module_cls=SemanticSam,
    download_from_hf=False,
    model_args={"class_num": 19},
).eval().to("cuda")

rgb = np.asarray(Image.open("input.png").convert("RGB"))
with torch.inference_mode():
    logits = model.inference(rgb)[0].float().cpu().numpy()

# logits.shape == (19, original_height, original_width)
labels = np.argmax(logits, axis=0)
# labels는 전체 foreground alpha와 결합한다. 배경에는 별도 label=-1 할당.
```

`init_model_from_pretrained`는 `accelerate.init_empty_weights`와 `load_state_dict(assign=True)`를 사용하므로 거대한 ViT-H 파라미터를 처음부터 무작위 초기화하는 비용을 줄인다. 단순히 `SemanticSam(...)`을 먼저 만들어 체크포인트를 다시 올리는 방식은 시작 시간과 메모리가 더 필요할 수 있다. 같은 로더는 누락 키를 임의 초기화할 수 있으므로 실제 통합에서는 누락/예상 외 키가 없는지 확인하고 로그에 기록하는 편이 좋다.

`inference`는 RGB의 0–255 범위 입력을 모델 해상도에 맞춰 긴 변 기준 리사이즈하고 가운데 패딩한 뒤, SAM 평균/표준편차로 정규화한다. 결과는 패딩을 제거하여 원본 해상도의 logits로 돌려준다. 입력을 미리 0–1로 정규화하면 전처리가 어긋난다.

체크포인트는 BF16 텐서를 포함한다. 공식 CUDA 예제를 먼저 따른다. CPU에서 실행하려면 float32 변환이 필요할 수 있으며 메모리와 실행 시간이 늘어난다. RTX 5060 Ti 16 GB에서는 배치 1 추론을 시도할 만하지만 **이 문서에는 실측 VRAM 또는 실행시간이 없다**. 설치 검증은 별도 기록해야 한다.

## 클래스 순서와 카드 레이어 매핑

```python
PARTS = [
    "hair", "headwear", "face", "eyes", "eyewear", "ears", "earwear",
    "nose", "mouth", "neck", "neckwear", "topwear", "handwear",
    "bottomwear", "legwear", "footwear", "tail", "wings", "objects",
]
```

권장 카드 매핑:

| 카드 그룹 | 입력 클래스 | 추가 처리 |
| --- | --- | --- |
| 얼굴 | face, eyes, eyewear, ears, earwear, nose, mouth | 얼굴 무늬/눈을 별도 시차로 찢지 않고 함께 유지 |
| 머리카락 | hair | 얼굴 위 앞머리와 뒤로 내려오는 머리는 추가 seed/가림 관계로 분리 |
| 몸통 | neck, topwear, bottomwear | 겉옷과 소매를 독립 분리하려면 추가 마스크 필요 |
| 앞 장식 | neckwear, headwear, objects | 실제 위치별 가림 검수 필요 |
| 손·다리 | handwear, legwear, footwear | 왼쪽/오른쪽은 연결 성분과 seed로 구분 |
| 후면 부속 | tail, wings | 항상 뒤에 있다는 규칙은 금지; 원화의 가림 순서 확인 |

공식 예제는 `logits > 0`으로 클래스별 이진 마스크를 만든다. 이 방법은 픽셀마다 여러 클래스가 겹치거나 어느 클래스에도 속하지 않을 수 있다. 원화 재합성 보존이 중요한 카드에서는 전체 foreground 영역 안에서 가장 높은 점수의 라벨에 우선 배정하고, 점수 차이가 작은 경계만 seed 보정 후보로 표시한다. 단, logits를 잘 보정된 확률이라고 부르면 안 된다.

이 모델은 이미지를 새로 그리지 않으며 가려진 몸/머리 뒤를 복원하지도 않는다. 머리카락 뒤 얼굴, 겹친 팔 안쪽 등 관측되지 않은 픽셀은 작은 시차 또는 별도 숨은 영역 복원 정책으로 처리해야 한다.
