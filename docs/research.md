# 캐릭터 원화의 분절과 입체 카드 렌더링 조사

조사 기준일: **2026-10-11**. 저자 논문, 공식 저장소, 저자가 배포한 모델 카드, 라이브러리 공식 문서만 근거로 사용했다. 공개 날짜, 문서상 요구량, 이 프로젝트에서 실제 검증한 결과를 구분한다. 이 문서의 설계 제안이 모두 구현되었다는 뜻은 아니며 실행 기능과 설치 상태는 프로젝트 README 및 실제 결과 파일이 기준이다.

## 권장 결론

이 작업에는 **원화의 전경 알파 → 의미 부위와 선화 경계를 따르는 마스크 → 부위별 앞뒤 순서 → 얕은 시차의 다층 카드**가 적합하다. 단일 깊이맵으로 전체 그림을 심하게 뒤틀거나 원화를 새로 그리는 방법은 기본 경로로 삼지 않는다. 얼굴, 눈 모양, 장식, 작가의 선을 유지하면서 액자 안에 겹쳐 놓은 종이 작품처럼 보이는 것이 목표이기 때문이다.

권장 우선순위는 다음과 같다.

1. **지금 로컬에서 안정적으로 돌릴 기준선:** AnimeSeg ONNX 전경 추출과 경계 기반 분절, 검수 가능한 seed 보정, 원본 RGB 복사, 깊이 순서, 제한된 시차. CPU에서도 실행 가능한 구성을 유지한다.
2. **의미 분절의 우선 확장:** See-through의 비생성 SemanticSam 19부위 모델을 사용한다. 모든 원화 픽셀을 다시 그릴 필요 없이 부위 마스크만 얻는다. 실제 실행 경로는 [semantic-inference-notes.md](semantic-inference-notes.md)에 기록했다.
3. **가림 뒤까지 복원하는 별도 연구 모드:** See-through 전체 모델을 검토한다. 생성 결과는 원본과 미세하게 달라질 수 있으므로 원화 보존 모드와 구분한다. 사용자의 Forge 정책을 적용하는 생성 요청은 문서화된 private 설정을 검증한 연결에서만 수행한다.

어떤 모델도 모든 구도와 화풍에서 무오류 분절을 보장하지 않는다. 특히 단일 이미지에서 보이지 않는 머리 뒤·팔 뒤의 정확한 원화를 알아내는 것은 관측 정보만으로 결정할 수 없다. 따라서 이 프로젝트의 정확성은 **원본 보존, 잘못된 부위를 고칠 수 있는 마스크, 가림 구멍이 드러나지 않는 시차 범위, 다양한 구도의 검수**로 확보해야 한다.

## 1. 서로 다른 네 문제를 구분해야 한다

| 문제 | 결과 | 해결하지 못하는 것 |
| --- | --- | --- |
| 전경 분리 | 캐릭터 전체의 foreground mask / alpha | 머리·얼굴·옷의 의미 구분 |
| 의미 부위 분절 | 보이는 픽셀의 부위 label | 가려진 부위의 원래 모양 |
| alpha matting | 경계 픽셀의 연속 투명도와 전경색 | 의미상 어느 부위가 앞인지 |
| 깊이·가림 추정 | 앞뒤 관계 또는 연속 깊이 | 원본에 없는 뒷면/숨은 색상 |

흰 바탕과 흰 머리를 같은 색으로 처리하면 첫 번째 문제부터 실패한다. 전체 실루엣이 정확하더라도 머리 전체를 하나의 레이어로 놓으면 앞머리와 뒷머리가 얼굴의 앞뒤를 감싸는 관계를 표현할 수 없다. 또 얼굴의 그림자와 눈 하이라이트를 깊이 차이로 해석하면 얼굴이 부풀거나 녹는 것처럼 보인다. 이 네 문제의 출력을 독립적으로 확인할 수 있어야 오류 원인을 찾을 수 있다.

## 2. 최신 연구와 실용성 비교

### 2.1 See-through: Single-image Layer Decomposition for Anime Characters

2026-02-03 공개된 논문이며 공식 저장소는 SIGGRAPH 2026 Conference Paper로 안내한다. 논문의 19개 부위 설정과 현재 저장소의 V3 23개 부위 설정을 혼동하지 않아야 한다. 핵심은 의미 부위 RGBA 생성과 부위 사이 일관성 학습, 그리기 순서를 학습한 pseudo-depth다. 자연 사진의 실제 거리 대신 원화의 가림 순서를 모델링한다. 저자 평가에서도 얇은 머리 끝·장식, 레이어 바깥 중복, 안정적 sublayer 분리의 한계가 보고되므로 완전 자동 무오류 도구로 해석하면 안 된다. [논문](https://arxiv.org/abs/2602.03749), [본문과 한계](https://arxiv.org/html/2602.03749v1)

공식 저장소는 1280 해상도 bf16 추론에 약 12–16 GB VRAM, group offload로 약 10 GB, NF4 경로로 약 8 GB를 안내한다. 생성과 depth, PSD 저장을 포함하며 기존 버전보다 head/body를 나누어 처리하는 현재 파이프라인은 시간이 더 걸릴 수 있다. 코드 저장소는 Apache-2.0다. 이는 구성 요소별 모델 사용 조건까지 하나로 대체한다는 뜻은 아니다. GPU 요구량은 저자 문서의 값이며 이 PC 실측치가 아니다. [공식 실행 문서](https://github.com/shitagaki-lab/see-through)

이 프로젝트에서 특히 유용한 것은 **별도 공개된 SemanticSam 마스크 모델**이다. 모델 카드의 1.29 GB 체크포인트는 Apache-2.0로 표시된다. 전체 diffusion 파이프라인을 설치할 필요 없이 19개 부위 logits를 얻는다. 다만 이 모델의 `hair`는 하나의 클래스이므로 앞·뒷머리를 추가 분리해야 한다. [공식 모델 파일](https://huggingface.co/24yearsold/l2d_sam_iter2/tree/main), [공식 마스크 추론 예](https://github.com/shitagaki-lab/see-through/blob/main/inference/demo/bodypartseg_sam.ipynb)

**판단:** 이 요청에 가장 직접적으로 맞는 최신 계열이다. 원화 보존에는 semantic-only 경로를 먼저 검증하고, 가림 뒤 생성은 별도 기능으로 다룬다.

### 2.2 Qwen-Image-Layered와 2026년의 관련 업데이트

Qwen-Image-Layered는 2025-12-17 공개되었고, 하나의 RGB 이미지를 가변 개수의 RGBA 레이어로 분해하는 diffusion 모델이다. RGBA-VAE, 레이어 수를 바꿀 수 있는 구조, PSD 기반 학습을 제안한다. 일반 디자인 오브젝트 분리는 목적에 잘 맞지만, 부위 하나가 다른 부위의 앞뒤에 교차하는 캐릭터 구조는 별도 검증이 필요하다. [논문](https://arxiv.org/abs/2512.15603)

공식 라이선스는 Apache-2.0이며, 배포된 transformer 파일만 40.9 GB다. 전체 pipeline은 다른 구성 요소도 필요하므로 파일 크기를 곧바로 VRAM 요구량으로 읽으면 안 된다. 양자화와 CPU offload는 별도 구현/성능 검증 항목이다. [공식 저장소](https://github.com/QwenLM/Qwen-Image-Layered), [공식 transformer 파일 목록](https://huggingface.co/Qwen/Qwen-Image-Layered/tree/main/transformer)

2026-09-20 공개된 Qwen-Image-2.1은 7B visual generation component와 native RGBA, subject extraction을 안내하며, 2026-10-09 Turbo를 공개했다. 최신 생성 후보라는 의미가 있으며, 정밀 캐릭터 부위 정답을 보장하는 근거는 아니다. 이 버전은 Qwen Research License이고 비상업 연구/평가 목적 조건이 명시되어 있어 이전 Layered의 Apache-2.0와 구분한다. 이 프로젝트의 기본 분절 엔진으로 채택하지 않는다. [공식 업데이트](https://github.com/QwenLM/Qwen-Image-2.1), [해당 버전 라이선스](https://github.com/QwenLM/Qwen-Image-2.1/blob/main/LICENSE)

### 2.3 Workflow-Aware Structured Layer Decomposition, 2026

2026-03-16 공개된 연구는 일러스트를 선화·밑색·그림자·하이라이트 같은 제작 과정의 레이어로 나눈다. 이는 얼굴·머리·옷처럼 공간적으로 다른 부위를 나누는 문제와 다르다. 색 수정이나 조명 효과에는 도움이 될 수 있지만, 입체 카드의 앞뒤 부위를 얻기 위한 대체 모델로 간주하지 않는다. [논문](https://arxiv.org/abs/2603.14925)

### 2.4 AnimeSeg / ISNet

SkyTNT의 AnimeSeg는 anime character foreground를 위한 공개 구현이며 ISNet, U2Net, MODNet, InSPyReNet 계열을 지원한다. 공식 `isnetis.onnx`는 176 MB, 모델 카드 및 저장소는 Apache-2.0다. ONNX 경로를 사용하면 기본 앱이 큰 PyTorch 학습 환경에 의존하지 않으면서 CPU 추론을 제공할 수 있다. 결과는 전체 캐릭터 실루엣이지 19개 의미 부위가 아니다. [공식 구현](https://github.com/SkyTNT/anime-segmentation), [공식 가중치와 라이선스](https://huggingface.co/skytnt/anime-seg/tree/main)

**판단:** 기본 foreground 엔진으로 실용적이다. 흰색 캐릭터와 흰 배경의 분리를 색 임계값보다 잘 처리할 가능성이 있지만, 얇은 선과 배경 연결 부분을 검수해야 한다. 기존 alpha가 유효한 PNG에는 다시 전경 추론을 강제하지 않는다.

### 2.5 BiRefNet

BiRefNet은 고해상도 dichotomous image segmentation을 위한 2024년 연구이며 일반 전경·matting 등 여러 체크포인트를 배포한다. 양방향 참조로 세밀한 구조를 다루는 것이 목적이다. 일반 이미지, 복잡한 배경, 긴 머리의 전경 마스크 비교 후보가 된다. [논문](https://arxiv.org/abs/2401.03407), [공식 저장소](https://github.com/ZhengPeng7/BiRefNet)

현재 공식 Hugging Face 일반 모델은 `model.safetensors` 444 MB, lite는 178 MB이고 두 페이지 모두 MIT를 표시한다. 과거 변형이나 다른 배포자의 라이선스를 대신 적용하지 않는다. CPU 실행시간과 메모리는 실제 해상도로 측정해야 한다. [일반 모델](https://huggingface.co/ZhengPeng7/BiRefNet/tree/main), [lite 모델](https://huggingface.co/ZhengPeng7/BiRefNet_lite/tree/main)

**판단:** AnimeSeg와 결과를 비교할 두 번째 foreground 후보이다. 모든 모델 마스크의 단순 합집합은 배경까지 늘리고, 교집합은 머리 끝을 잃으므로 모델 간 차이는 불확실 영역으로 표시하는 편이 좋다.

### 2.6 SAM 2.1, SAM 3 / 3.1

SAM 2.1은 2024-09-29 공개되었으며 tiny 38.9M, small 46M, base+ 80.8M, large 224.4M 파라미터다. 점·박스 prompt로 부위를 고치는 도구에 적합하며 코드와 가중치는 Apache-2.0다. 자동 mask proposal에도 쓸 수 있지만 마스크에 `앞머리`, `왼쪽 소매`라는 의미가 자동으로 붙지는 않는다. [공식 모델 설명](https://github.com/facebookresearch/sam2)

SAM 3는 848M 파라미터이며 text/exemplar 개념 prompt를 지원한다. 2026-03-27 SAM 3.1 업데이트는 주로 multi-object tracking 효율을 개선한다. 공식 설치는 Python 3.12+, PyTorch 2.7+, CUDA 12.6+ GPU를 요구하며 모델 접근 승인이 필요하다. SAM License를 사용하므로 SAM 2의 Apache-2.0로 소개하면 안 된다. [공식 SAM 3 저장소](https://github.com/facebookresearch/sam3)

**판단:** 사용자가 수정할 부위를 찍는 상호작용 도구로 유용하다. 정적 일러스트 4장의 로컬 기본 처리를 위해 video tracking 모델까지 필수로 설치할 필요는 없다. 자동 후보의 `predicted IoU`와 안정성 점수는 해당 캐릭터의 의미 라벨 정확도를 보장하지 않는다.

### 2.7 Anime instance segmentation

Instance-guided Cartoon Editing 연구는 캐릭터/객체 인스턴스 분리와 그 위의 3D Ken Burns, 스타일 편집을 다룬다. 하나의 캐릭터 내부 부위를 나누는 것과 여러 캐릭터를 나누는 것을 구분해야 한다. 공식 구현은 mmcv/mmdet, CUDA 계열, 일부 Windows용 PatchMatch 라이브러리 구성을 안내한다. 복잡한 다인 이미지 확장에는 검토 가치가 있지만 이 요청의 네 장은 단일 캐릭터여서 설치 복잡성 대비 우선순위가 낮다. [논문](https://arxiv.org/abs/2312.01943), [공식 구현](https://github.com/CartoonSegmentation/CartoonSegmentation)

## 3. Alpha matting과 원화 경계 보존

이미지 경계는 이진 마스크만으로 완성되지 않는다. 안티앨리어싱 픽셀은 배경색이 이미 섞여 있다. 합성 모델은 다음과 같다.

```text
I = alpha * F + (1 - alpha) * B
```

`I`는 관측 RGB, `F`는 전경 RGB, `B`는 배경 RGB다. 흰 배경에서 잘라낸 경계의 `I`를 그대로 새로운 검은 배경에 얹으면 흰 테두리가 생길 수 있다. 배경색이 신뢰 가능하면 경계의 `F`를 추정할 수 있으나 alpha가 0에 가까우면 수치적으로 불안정해진다. 따라서 내부 불투명 픽셀은 원본 그대로 보존하고, 실제 반투명 경계의 좁은 띠에서만 전경색 보정을 검토한다.

ViTMatte는 trimap을 사용하는 matting 모델로 2023년 공개, 2024년 Information Fusion 게재이며 공식 구현은 MIT다. MAM은 SAM 특징과 별도의 mask-to-matte 모듈을 결합한다. MAM의 2.7M은 추가 학습 모듈 크기이며 전체 SAM까지 포함한 모델 크기가 아니다. [ViTMatte 공식 구현](https://github.com/hustvl/ViTMatte), [Matting Anything 공식 구현](https://github.com/SHI-Labs/Matting-Anything)

CPU 기준선에는 PyMatting의 closed-form / KNN alpha 추정도 선택지가 된다. foreground·background·unknown trimap을 입력받으며 MIT다. 사진의 부드러운 머리털뿐 아니라 일러스트의 굵은 선도 있으므로 무조건 matting을 적용해 선을 반투명하게 만드는 것은 피한다. [PyMatting 공식 문서](https://github.com/pymatting/pymatting)

권장 trimap 생성 방식은 확실한 전경 내부를 침식해서 foreground seed로, 확실한 배경을 background seed로, 둘 사이 2–6 px 정도를 unknown으로 잡는 것이다. 이 폭은 제안 초기값이며 원본 크기와 선 두께에 맞춰 조절한다. 너무 넓으면 계산량과 색 번짐이 커지고, 너무 좁으면 모델이 놓친 머리 끝을 복원할 공간이 없다.

## 4. 단일 깊이만으로 카드가 해결되지 않는 이유

### 4.1 Depth Anything V2 / 3

Depth Anything V2의 Small은 24.8M 파라미터, Apache-2.0이며 Base/Large/Giant는 CC BY-NC 4.0다. 공식 예제는 CPU/CUDA/MPS를 선택한다. 원화의 대략적인 상대 깊이를 추가 힌트로 쓰기에는 작은 모델이 실용적이다. [공식 V2 모델 설명](https://github.com/DepthAnything/Depth-Anything-V2)

Depth Anything 3는 2025-11-14 공개되었으며 단일·다중 시점의 depth와 camera geometry를 다룬다. 현재 공식 표의 Small 0.08B와 Base 0.12B는 Apache-2.0, Large 0.35B와 Giant 1.15B / Nested 1.40B는 CC BY-NC 4.0다. 모델별 기능과 라이선스가 다르며, 1.1 교정 체크포인트가 있는 모델은 이전 가중치와 구분한다. [공식 DA3 저장소](https://github.com/ByteDance-Seed/Depth-Anything-3), [논문](https://arxiv.org/abs/2511.10647)

이들 모델의 강점이 일러스트의 정답 3D 구조를 의미하지는 않는다. 얼굴의 큰 눈, 극단적인 머리 비율, 검은 목깃, 반사 장식은 자연 사진의 깊이 단서와 다르다. 다중 시점이 없는 단일 원화에서 대형 모델을 쓰더라도 숨은 원화가 관측되는 것은 아니다.

### 4.2 표현의 한계

깊이 하나를 가진 표면은 각 화면 픽셀에 앞면 하나만 표현한다. 카메라를 이동해서 앞머리가 옆으로 이동하면 그 뒤 얼굴이 필요하지만 원본 깊이맵에는 그 색상이 없다. 임의 방향에서 큰 시차를 주면 구멍, 늘어나는 가장자리, 중복 실루엣이 나타난다.

3D Photography using Context-aware Layered Depth Inpainting은 이 문제를 layered depth image와 숨은 color/depth 복원으로 다룬 고전적 연구다. 코드 MIT, 공식 테스트 환경은 오래된 Linux/Python/PyTorch 조합이므로 그대로 현재 Windows 앱의 의존성으로 넣기보다 표현 방식과 가림 처리 원리를 참고하는 편이 좋다. [공식 구현](https://github.com/vt-vl-lab/3d-photo-inpainting), [CVPR 2020 논문](https://openaccess.thecvf.com/content_CVPR_2020/papers/Shih_3D_Photography_Using_Context-Aware_Layered_Depth_Inpainting_CVPR_2020_paper.pdf)

**이 프로젝트의 설계 판단:** 깊이는 부위별 정렬과 약한 입체감의 보조 신호로 쓰고, 얼굴·눈·옷 무늬 안에서는 거의 일정하게 유지한다. 모든 픽셀을 색 농도에 따라 앞뒤로 흔드는 방식은 피한다.

## 5. 실용적인 비생성 기준선의 상세 설계

아래는 연구 근거를 바탕으로 한 이 프로젝트용 설계 제안이다. 범용 의미 추론과 각 예제의 검수된 seed는 별도로 기록해야 한다.

### 5.1 입력 보존과 좌표

- EXIF 방향을 적용하고 RGB / alpha를 분리한다. 신뢰할 수 있는 원래 alpha는 유지한다.
- 원본은 변경하지 않고 별도 작업 해상도에서 분석한다. 원본 크기, resize scale, padding offset을 저장하여 마스크를 정확히 원좌표로 돌린다.
- API 입력 크기에는 상한을 두고 처리 작업은 큐로 관리한다. 여러 요청이 동시에 큰 모델을 여러 번 로드하지 않도록 한다.
- 처리 결과에는 입력 해시, 알고리즘 버전, 모델 버전, seed, 파라미터를 저장한다. 같은 입력/설정의 결과는 재사용한다.

### 5.2 전경 alpha

우선 순위는 유효한 입력 alpha, AnimeSeg 추론, 필요시 보조 foreground 모델 비교다. 단색 배경에서는 이미지 가장자리와 연결된 평탄 영역을 **배경 후보**로만 사용한다. 밝기만으로 흰 머리 내부를 삭제하지 않는다. 예제 3처럼 캐릭터가 화면 가장자리까지 닿으면 가장자리 전체를 배경 seed로 지정해서는 안 된다.

색상 분포와 경계 에너지를 이용하는 GrabCut은 foreground/background scribble 보정에 적합하다. 하나의 사각형만 넣는 초기화가 모든 일러스트에서 충분한 것은 아니며, 확실한 전경·배경 표시를 함께 이용해야 한다. [OpenCV GrabCut 문서](https://docs.opencv.org/4.x/d8/d83/tutorial_py_grabcut.html)

### 5.3 의미 후보와 경계 추적

가능하면 SemanticSam logits를 의미 후보로 쓴다. 모델 없는 기준선에서는 얼굴·머리·목깃·몸통·소매 등 몇 개 부위에 공간 seed와 색 분포를 지정하고 선화 경계를 따라 영역을 확장한다. 색 이름을 의미와 동치로 두지 않는다. 흰 머리와 흰 소매는 서로 다른 위치/연결/가림 조건을 갖는다.

추천 에너지의 개념 형태는 다음과 같다.

```text
E(L) = sum_p U(p, Lp)
     + lambda * sum_(p,q) w(p,q) * [Lp != Lq]

U = semantic score cost + seed distance cost + local color cost
w = exp(-beta * color_difference^2) * edge_continuity_weight
```

강한 선화 경계에서는 다른 라벨을 허용하고, 같은 영역의 내부에서는 작은 조각이 남발되지 않게 한다. 특정 그래프 최적화가 구현되지 않았더라도 seed 기반 watershed / geodesic 분할로 유사한 경계 제약을 적용할 수 있다. Watershed 자체는 의미를 이해하지 않으므로 marker 품질이 핵심이다. [OpenCV marker-based watershed](https://docs.opencv.org/4.x/d3/db4/tutorial_py_watershed.html)

눈, 코, 입, 얼굴 그림자처럼 얼굴 내부의 장식은 얼굴 그룹으로 묶는 것이 카드 목적에 적합하다. 목깃의 둥근 무늬와 검은 천을 서로 다른 깊이로 나누는 것도 피한다. 연결 성분이 작다는 이유로 모두 지우면 분리된 머리 가닥·리본 끝이 사라질 수 있으므로 주변 부위, 선 연결, confidence를 함께 본다.

### 5.4 픽셀 소유권과 정면 재구성

foreground의 모든 픽셀에 정확히 하나의 label을 배정하면 누락/중복을 통제하기 쉽다. 부위 `k`의 alpha를 `alpha_k = alpha_foreground * [L == k]`로 정의하고 RGB는 입력에서 복사한다. 정면에서는 label별 픽셀이 원본 위치에 정확히 놓이므로 원본 전경을 재구성할 수 있다.

단, 마스크를 각각 blur한 뒤 단순히 alpha 합이 1이라고 검사하는 것은 충분하지 않다. 일반 over 합성의 최종 alpha는 `1 - product(1 - alpha_k)`이므로 경계가 중첩되면 알파 합과 다르다. 가장 간단한 기준선은 내부 경계를 배타적으로 유지하고, 최외곽만 원래 alpha를 사용하는 것이다. 부드러운 내부 경계가 필요하면 합성 순서를 고려한 alpha 또는 premultiplied contribution을 사용한 뒤 실제 합성 결과를 검사한다.

뒤 레이어를 가림 부분 아래로 조금 확장하더라도 정면에서 보이는 소유권은 유지해야 한다. 원본 전체 캐릭터를 그대로 뒤에 놓고 여러 컷아웃을 크게 움직이면 빈틈은 줄어도 눈·머리카락이 이중으로 보인다. 이를 숨은 영역 복원이라고 소개해서는 안 된다.

### 5.5 앞뒤 순서

뒤 머리 → 몸통/옷 → 얼굴 → 앞머리/목깃 → 앞 소매·소품 같은 순서는 가능한 초기값이다. 이것을 모든 캐릭터에 고정하면 누운 구도와 교차된 팔에서 실패한다. 부위 사이 가림 관계를 기록하고, 한 `hair` 부위가 얼굴 앞과 뒤에 모두 있으면 앞머리/뒷머리 sublayer로 나눈다. 전체 의미 클래스가 아니라 실제 가림 fragment가 깊이 순서의 단위다.

깊이모델 값은 마스크 내부 median 등으로 안정화하고, 원화에서 명백한 앞뒤 관계와 충돌하면 모델의 값을 그대로 믿지 않는다. 무늬를 따라 깊이가 요동하지 않도록 단일 부위 안의 고주파 깊이 변화는 줄인다.

### 5.6 시차와 숨은 영역

카드 좌우 움직임에 따른 레이어 변위를 대략 `shift_k = view_direction * strength * z_k`로 생각할 수 있다. 인접 레이어의 차이는 `relative_shift = strength * abs(z_i - z_j)`다. 숨은 부분을 단순 확장으로 감추려면 확장 폭이 최대 상대 이동보다 커야 한다. 이 조건을 넘는 시차는 원본에 없던 영역을 드러낸다.

실용적으로는 카드 폭의 약 0.5–2% 수준을 시작점으로 두고 얼굴 근처는 더 작게 검수한다. 이는 제안값이며 해상도/부위/출력 크기에 따라 조정한다. 큰 카메라 회전처럼 보이는 효과는 액자 전체 회전과 조명 반사를 통해 만들고, 원화 내부 부위 이동은 얕게 유지할 수 있다.

생성 없이 가능한 가림 처리는 좁은 경계색 확장, texture bleeding, 작은 반경의 비생성 inpainting 등이다. 이것은 주변 색을 이어붙이는 근사이므로 큰 숨은 눈·얼굴·팔을 정확하게 복구하지 못한다. 깊이 큰 연출이 필요하면 원 작가의 layered PSD 또는 검수한 amodal 생성 결과가 필요하다.

### 5.7 보기 좋은 액자 구성

카드의 깊이감은 부위 이동만으로 결정되지 않는다. 후면 판, 얇은 마운트, 각 layer의 부드러운 접촉 그림자, 프레임 안쪽 두께, 조용한 배경색, 얇은 반사광이 함께 작동한다. 그림자를 과장하면 원화가 더러워지고 두꺼운 검은 외곽이 생기므로 원화 팔레트에 맞춰 opacity를 낮춘다.

렌더러에서는 동일한 이미지 좌표와 crop 기준을 모든 레이어에 사용한다. 레이어마다 자동 center crop을 적용하면 얼굴·머리·소매의 정렬이 깨진다. transparent texture와 depth sorting을 확인하고, 정면 원본 비교와 분리된 레이어 검사를 제공한다. 사용자가 줄일 수 있는 시차 강도와 움직임 정지 상태도 필요하다.

## 6. 제공된 네 이미지에서 검수할 구체 항목

아래는 제공된 원화를 관찰해 정한 사례별 체크리스트다. 네 장만 통과해도 모든 스타일에서 검증되었다고 말할 수는 없다.

| 이미지 | 주요 난점 | 권장 검수/분절 |
| --- | --- | --- |
| 1: 흰 머리 전신 SD | 흰 머리와 흰 배경, 검은 목깃, 붕대와 옷의 교차 | 머리 끝 유지, 뒷머리와 앞머리 분리, 얼굴 내부 고정, 양 소매·부츠 경계 확인 |
| 2: 누운 SD | 회전한 몸, 크게 겹친 다리, 얼굴을 감싸는 목깃 | 상하 위치 기반 몸통 규칙 금지, 다리·목깃·얼굴의 실제 가림 순서 사용 |
| 3: 분홍 머리 반신 | 좌우/아래 프레임에 닿는 머리, 파란 안쪽 머리, 넓은 소매 | 가장자리 foreground 보존, 분홍/파랑을 무조건 별도 물체로 취급하지 않기, 팔 앞뒤 검수 |
| 4: 은발 초상 | 회색 사각 배경, 옆머리와 얼굴 유사색, 리본, 하단 서명 | 사각 배경 제거 확인, 리본 실루엣 보존, 잘린 반신 경계 유지, 작가 서명 보존 정책 확인 |

서명처럼 캐릭터 바깥 텍스트는 캐릭터 body part와 다르다. 보존하거나 별도 배경/overlay로 다루려면 그 정책을 명시하고, 모델이 캐릭터로 분류했는지와 관계없이 원본 확인 경로를 남긴다.

## 7. 정확성을 검증하는 방법

### 필수 자동 검증

1. **파일 무결성:** 이미지가 실제로 열리는지, 크기·채널·alpha 범위·레이어 파일 존재 여부를 확인한다.
2. **foreground coverage:** 전경 픽셀 중 어떤 부위에도 속하지 않는 비율과 중복 소유권 비율을 기록한다. 배타적 분절에서는 둘 다 0이어야 한다.
3. **정면 재합성:** 조명/그림자/3D 이동을 끈 상태에서 레이어를 원좌표로 합성하여 원본 전경과 비교한다. RGB 평균/최대 오차, alpha 오차, boundary band 오차를 각각 기록한다.
4. **입력 변화 안정성:** 작은 resize, JPEG 재인코딩, 여백 추가에 따라 핵심 부위가 급격히 바뀌지 않는지 본다. seed는 픽셀 위치 대신 정규화 좌표로 저장한다.
5. **실행 측정:** cold start, warm inference, 전체 처리 시간, peak RAM/VRAM, 출력 용량을 실제 장비에서 측정한다.

정면 재합성 오차가 0이라도 모든 픽셀을 임의 줄무늬로 나누면 같은 값이 나올 수 있다. 따라서 이것은 **원본 보존 검증**이며 의미 분절 정확도 지표가 아니다. 의미 정확도를 말하려면 검수 마스크를 별도 정답으로 만들어 class IoU, boundary F-score, 작은 부위 누락을 측정해야 한다.

### 필수 시각 검수

정면, 좌우 최대 시차, 상하 최대 시차를 같은 배율로 캡처한다. 흰색·검은색·중간 회색 배경에서 외곽 halo를 확인한다. 얼굴/눈/머리 끝/손끝/리본 확대에서 이중 선, 틈, 잘못된 순서, 지나친 반투명도를 확인한다. 카드와 함께 펼친 레이어를 보아 마스크가 수평 띠나 사각형으로 임의 분할되지 않았는지 확인한다.

범용 평가 세트는 정면 전신, 누운 자세, 얼굴 클로즈업, 극단적 비율의 SD, 긴 머리, 짧은 머리, 복잡한 의상, 투명 장식, 배경 있는 이미지, 다인 이미지, 프레임 경계에 닿는 이미지로 나누는 것이 좋다. 제공된 네 장은 유용한 회귀 테스트지만 이 범주 전체를 대표하지 않는다.

## 8. 로컬 운영과 모델 선택표

| 경로 | 다운로드/규모 | CPU/Windows 관점 | 이 프로젝트에서의 역할 |
| --- | --- | --- | --- |
| AnimeSeg ISNet ONNX | 176 MB | ONNX Runtime로 간단한 기본 환경 가능 | foreground 기준선 |
| BiRefNet lite / 일반 | 178 / 444 MB safetensors | 별도 torch 또는 검증된 ONNX 경로 필요 | 복잡한 전경 비교 후보 |
| See-through SemanticSam | 1.29 GB checkpoint | ViT-H라 CPU보다 NVIDIA 권장; CUDA 실측 필요 | 비생성 의미 부위 마스크 |
| SAM 2.1 tiny | 38.9M params | prompt 보정 UI와 함께 평가 | 클릭으로 마스크 수정 |
| SAM 3 | 848M params | 공식 CUDA 요구, 모델 접근 승인 필요 | text 기반 마스크 후보 |
| Depth Anything V2 Small | 24.8M params | CPU 가능, 선택적인 배치 전처리 | 부위 깊이 보조 |
| Depth Anything 3 Small | 0.08B params | 설치/성능 별도 확인 | 최신 geometry 비교 후보 |
| See-through 전체 | 저자 안내 8–16 GB VRAM 범위 | 생성·depth·의존성 증가 | 숨은 영역 복원 연구 옵션 |
| Qwen-Image-Layered | transformer만 40.9 GB | 양자화/offload 없이 기본 설치로 무거움 | 일반 RGBA 분해 비교용 |

MB와 GB는 배포 페이지의 파일 크기, M/B params는 파라미터 수, VRAM은 실행 중 장치 메모리다. 이 값들은 서로 대체할 수 없다. 위 모델은 모두 기본 앱에 반드시 설치해야 하는 목록이 아니다.

일상 사용 경로는 로컬 API와 로컬 파일 저장으로 끝나도록 만든다. 최초 공개 모델 다운로드와 사용자 원화 업로드를 구분한다. 모델 다운로드가 허용되어도 원화를 외부 demo로 보내는 동작이 자동으로 허용되는 것은 아니다. 공개 Gradio 링크 생성 옵션은 기본 로컬 실행에서 사용하지 않는다.

생성 도구를 통합할 때는 사용자의 Forge 정책에 따라 actual schema의 `visibility='private'`, nested request와 continuation 설정, 결과 asset visibility를 확인해야 한다. 이 문서는 외부 이미지 생성 요청을 수행하지 않았으며 원화를 모델 demo에 업로드하지 않았다.

## 9. 채택·보류 결정의 기준

기본 엔진은 설치 가능한 크기, GPU 없는 환경에서의 실행, 원화 보존, 마스크 수정 가능성을 우선한다. 가장 최신이거나 가장 큰 모델이라는 이유만으로 기본 엔진을 교체하지 않는다. 새 모델은 네 예제의 정면 재구성, 의미 경계, 최대 시차 검사를 통과하고 실제 지연시간이 기록되었을 때 채택한다.

완전한 layered PSD가 없는 원화에서 보이지 않는 부분까지 정확한 원본으로 복원했다는 주장은 하지 않는다. 보이는 픽셀을 충실히 분리하고, 필요한 수정 지점을 투명하게 보여주며, 복원 범위에 맞는 시차를 제공하는 것이 이 카드 뷰어의 검증 가능한 품질 기준이다.
