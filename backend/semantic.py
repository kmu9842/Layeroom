"""See-through's non-generative 19-class semantic SAM adapter.

Only class logits are inferred; pixels are always sampled from the user's image.
"""
from functools import lru_cache
from pathlib import Path
import sys
import numpy as np
from scipy import ndimage as ndi

ROOT = Path(__file__).resolve().parents[1]
NAMES = ['머리카락','머리 장식','얼굴','눈','안경','귀','귀 장식','코','입','목','목 장식','상의','손·소매','하의','다리','신발','꼬리','날개','소품']
DEPTHS = [.48,.78,.6,.63,.68,.52,.65,.65,.63,.45,.7,.4,.58,.34,.33,.44,.2,.2,.65]
COLORS = ['#a898dc','#d7b86e','#e5b39b','#ba6caa','#a388c4','#cc8a8a','#d0b469','#d29e8b','#bb718a','#a296a6','#c7865c','#719eab','#d9a4b7','#858bb7','#91b2ab','#b7af74','#bb8888','#8fa0ce','#dba36e']

def available():
    return (ROOT/'models/semantic-sam.pt').exists() and (ROOT/'third_party/see-through/common/modules/semanticsam.py').exists()

@lru_cache(maxsize=1)
def get_model():
    import torch
    from accelerate import init_empty_weights
    common = str(ROOT/'third_party/see-through/common')
    if common not in sys.path:
        sys.path.insert(0, common)
    from modules.semanticsam import SemanticSam
    device = 'cuda' if torch.cuda.is_available() else 'cpu'
    state = torch.load(ROOT/'models/semantic-sam.pt', map_location='cpu', weights_only=True)
    if 'state_dict' in state:
        state = state['state_dict']
    with init_empty_weights(include_buffers=False):
        model = SemanticSam(class_num=19)
    model.load_state_dict(state, strict=True, assign=True)
    model = model.eval().to(device=device, dtype=torch.float32)
    return model, device

def segment_semantic(rgb, alpha):
    import torch
    model, device = get_model()
    with torch.inference_mode(), torch.autocast(device_type=device, dtype=torch.bfloat16, enabled=device=='cuda'):
        logits = model.inference(rgb)[0]
    raw = logits.float().argmax(dim=0).cpu().numpy().astype(np.uint8)
    visible = alpha > 0
    # Fold tiny face details into the face to avoid floating eyes/nose/mouth.
    for idx in [3, 7, 8]:
        raw[raw == idx] = 2
    # Keep only classes actually present; do not pretend absent anatomy exists.
    present = [i for i in range(19) if np.sum((raw == i)&visible) > max(50, visible.sum()*.001)]
    if not present:
        raise RuntimeError('유효한 부위 마스크가 없습니다.')
    labels = np.zeros(alpha.shape, np.uint8)
    regions = []
    for idx, cls in enumerate(present, 1):
        labels[(raw == cls)&visible] = idx
        regions.append({'name':NAMES[cls],'depth':DEPTHS[cls],'color':COLORS[cls]})
    missing = visible & (labels == 0)
    if missing.any():
        nearest = ndi.distance_transform_edt(labels == 0, return_distances=False, return_indices=True)
        labels[missing] = labels[tuple(nearest[:, missing])]
    return labels, regions, 'semantic-sam'
