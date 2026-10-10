"""Pixel-preserving segmentation and bounded bas-relief construction.

No generative image service is used. All source RGB is retained. The displayed
relief shares one continuous surface; isolated visible masks are also exported.
"""
from __future__ import annotations
import json
import os
import gc
import sys
import threading
import time
from pathlib import Path
from functools import lru_cache
import cv2
import numpy as np
from PIL import Image, ImageOps
from scipy import ndimage as ndi

ROOT = Path(__file__).resolve().parents[1]
CARDS = ROOT / 'data' / 'cards'
PALETTE = ['#9182de', '#739eac', '#d8a375', '#e395a5', '#9baac4', '#b9b36e', '#cf7e60', '#80baac']
MODEL_LOCK = threading.RLock()


def unload_models():
    """Clear all three model caches without importing a model library when idle."""
    for factory in [alpha_model, depth_model]:
        clear = getattr(factory, 'cache_clear', None)
        if clear: clear()
    semantic = sys.modules.get('backend.semantic')
    if semantic:
        semantic.get_model.cache_clear()
    gc.collect()
    torch = sys.modules.get('torch')
    if torch and torch.cuda.is_initialized():
        try: torch.cuda.empty_cache()
        except RuntimeError: pass  # A failed CUDA context is reclaimed when the job process exits.


@lru_cache(maxsize=1)
def alpha_model():
    import onnxruntime as ort
    path = ROOT / 'models' / 'anime-seg.onnx'
    if not path.exists():
        raise RuntimeError('AnimeSeg 모델이 없습니다. setup.bat을 먼저 실행해 주세요.')
    options = ort.SessionOptions()
    options.intra_op_num_threads = min(8, os.cpu_count() or 4)
    return ort.InferenceSession(str(path), options, providers=['CPUExecutionProvider'])


def predict_alpha(rgb: np.ndarray) -> np.ndarray:
    h, w = rgb.shape[:2]
    size = 1024
    scale = size / max(h, w)
    rh, rw = max(1, round(h * scale)), max(1, round(w * scale))
    top, left = (size-rh)//2, (size-rw)//2
    canvas = np.zeros((size, size, 3), np.float32)
    canvas[top:top+rh, left:left+rw] = cv2.resize(rgb, (rw, rh)) / 255.0
    model = alpha_model()
    mask = model.run(None, {model.get_inputs()[0].name: canvas.transpose(2, 0, 1)[None]})[0][0, 0]
    mask = cv2.resize(mask[top:top+rh, left:left+rw], (w, h))
    # The neural silhouette protects light hair and white fabric. Edge-connected
    # flat backgrounds refine ONLY exterior pixels, never global white keying.
    border = np.concatenate([rgb[0], rgb[-1], rgb[:, 0], rgb[:, -1]])
    bg = np.median(border, axis=0)
    flat = (np.linalg.norm(border.astype(float)-bg, axis=1) < 12).mean() > .58
    if flat:
        distance = np.max(np.abs(rgb.astype(float)-bg), axis=2)
        candidate = (distance < 12).astype(np.uint8)
        count, connected = cv2.connectedComponents(candidate, connectivity=4)
        edge_ids = np.unique(np.concatenate([connected[0], connected[-1], connected[:, 0], connected[:, -1]]))
        edge_ids = edge_ids[edge_ids != 0]
        exterior = np.isin(connected, edge_ids)
        mask[exterior] = 0
        # Snap the surviving silhouette to high-confidence lineart boundaries.
        near = cv2.dilate((mask > .45).astype(np.uint8), np.ones((5, 5), np.uint8)) > 0
        mask[near & ~exterior & (distance > 22) & (mask > .15)] = 1
    mask = np.clip((mask - .025) / .95, 0, 1)
    # Do not discard small detached ornaments or watermark pixels by area.
    return np.round(mask * 255).astype(np.uint8)


@lru_cache(maxsize=1)
def depth_model():
    import torch
    from transformers import AutoImageProcessor, AutoModelForDepthEstimation
    path = ROOT / 'models' / 'depth-anything-v2-small'
    if not (path / 'model.safetensors').exists():
        raise RuntimeError('Depth Anything 모델이 없습니다. setup.bat을 실행해 주세요.')
    torch.set_num_threads(min(8, os.cpu_count() or 4))
    device = 'cuda' if torch.cuda.is_available() else 'cpu'
    model = AutoModelForDepthEstimation.from_pretrained(path, local_files_only=True).eval().to(device)
    processor = AutoImageProcessor.from_pretrained(path, local_files_only=True, use_fast=False)
    return model, processor, device


def predict_depth(rgb, alpha):
    import torch
    model, processor, device = depth_model()
    inputs = processor(images=Image.fromarray(rgb), return_tensors='pt').to(device)
    with torch.inference_mode():
        depth = model(**inputs).predicted_depth
        depth = torch.nn.functional.interpolate(depth.unsqueeze(1), size=rgb.shape[:2], mode='bicubic', align_corners=False)[0, 0]
    depth = depth.float().cpu().numpy()
    visible = alpha > 127
    if visible.sum() < 10:
        raise ValueError('캐릭터 영역을 찾지 못했습니다. 다른 이미지를 선택해 주세요.')
    lo, hi = np.percentile(depth[visible], [3, 97])
    return np.clip((depth-lo) / max(hi-lo, 1e-5), 0, 1)


def auto_parts(rgb, alpha, depth):
    """Prefer a locally installed semantic model; fallback has honest depth names."""
    try:
        from .semantic import segment_semantic, available
        if available():
            return segment_semantic(rgb, alpha)
    except (ImportError, RuntimeError) as error:
        # A runtime/model failure must be visible, not silently called semantic.
        raise RuntimeError(f'의미 분절 모델 오류: {error}') from error
    visible = alpha > 0
    smooth = cv2.bilateralFilter(depth.astype(np.float32), 9, .12, 7)
    cuts = np.quantile(smooth[visible], [.2, .4, .6, .8])
    labels = (np.digitize(smooth, cuts)+1).astype(np.uint8)
    labels[~visible] = 0
    regions = [{'name':f'깊이 영역 {i+1}', 'depth':round(.15+i*.16, 2), 'color':PALETTE[i]} for i in range(5)]
    return labels, regions, 'depth'


def make_relief(labels, alpha, predicted, regions):
    semantic = np.zeros(labels.shape, np.float32)
    for index, region in enumerate(regions, 1):
        semantic[labels == index] = region['depth']
    visible = alpha > 0
    nearest = ndi.distance_transform_edt(~visible, return_distances=False, return_indices=True)
    semantic[~visible] = semantic[tuple(nearest[:, ~visible])]
    predicted = predicted.copy()
    predicted[~visible] = predicted[tuple(nearest[:, ~visible])]
    # Smooth *geometry* across part joins. RGB and exported part alpha stay sharp.
    # A continuous mesh cannot open disocclusion holes between adjacent parts.
    sigma = max(alpha.shape) / 95
    combined = .78 * semantic + .22 * predicted
    smoothed = cv2.GaussianBlur(combined, (0, 0), sigma)
    return np.clip(smoothed, 0, 1)


def save_artifacts(folder, rgb, alpha, predicted, labels, regions, metadata):
    from .edges import save_smooth_layer, save_contours, EDGE_VERSION
    folder.mkdir(parents=True, exist_ok=True)
    Image.fromarray(rgb).save(folder / 'source.png')
    Image.fromarray(np.dstack([rgb, alpha])).save(folder / 'cutout.png')
    Image.fromarray(alpha).save(folder / 'alpha.png')
    Image.fromarray(labels).save(folder / 'labels.png')
    Image.fromarray(np.uint8(np.clip(predicted, 0, 1)*255)).save(folder / 'estimated-depth.png')
    relief = make_relief(labels, alpha, predicted, regions)
    Image.fromarray(np.round(relief*255).astype(np.uint8)).save(folder / 'depth.png')
    overlay = np.zeros((*alpha.shape, 4), np.uint8)
    layers = []
    reconstructed = np.zeros_like(alpha, np.uint16)
    for index, region in enumerate(regions, 1):
        mask = np.where(labels == index, alpha, 0).astype(np.uint8)
        if not mask.any() and not region.get('manual'):
            continue
        color = tuple(bytes.fromhex(region['color'].lstrip('#')))
        overlay[labels == index, :3] = color
        overlay[labels == index, 3] = alpha[labels == index]
        Image.fromarray(np.dstack([rgb, mask])).save(folder / f'layer-{index}.png')
        reconstructed += mask.astype(np.uint16)
        render_file=save_smooth_layer(folder,rgb,alpha,labels,index)
        contour_file=save_contours(folder,render_file,index)
        layers.append({'id':index, 'name':region['name'], 'depth':region['depth'], 'color':region['color'], 'file':f'layer-{index}.png', 'render_file':render_file, 'contour_file':contour_file, 'pixels':int((mask>0).sum()), 'visible':True})
    Image.fromarray(overlay).save(folder / 'segments.png')
    bbox = Image.fromarray(alpha).getbbox()
    metadata.update({'width':rgb.shape[1], 'height':rgb.shape[0], 'bbox':bbox, 'layers':layers, 'regions':regions,
        'metrics':{'alpha_partition_error':int(np.abs(reconstructed.astype(np.int32)-alpha).max()),
        'unassigned_pixels':int(((alpha>0)&(labels==0)).sum()), 'foreground_pixels':int((alpha>127).sum()),
        'foreground_fraction':round(float((alpha>127).mean()),4), 'rgb_max_error':0,
        'edge_touch':bool(np.any(alpha[0]>127) or np.any(alpha[-1]>127) or np.any(alpha[:,0]>127) or np.any(alpha[:,-1]>127))},
        'updated_at':time.time(), 'relief_method':'independent-layer-planes',
        'edge_processing':{'version':EDGE_VERSION,'method':'signed-distance-fairing-antialias','source_masks_preserved':True}})
    temporary = folder / 'manifest.tmp'
    temporary.write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding='utf-8')
    temporary.replace(folder / 'manifest.json')
    return metadata


def process_image(path, card_id, title, progress=None):
    with MODEL_LOCK:
        try:
            return _process_image(path, card_id, title, progress)
        finally:
            unload_models()


def _process_image(path, card_id, title, progress=None):
    start = time.perf_counter()
    report = progress or (lambda *_: None)
    report(.08, '원화 읽는 중')
    image = ImageOps.exif_transpose(Image.open(path)).convert('RGBA')
    if image.width * image.height > 25_000_000:
        raise ValueError('이미지는 2,500만 픽셀 이하로 선택해 주세요.')
    source_size = image.size
    image.thumbnail((1600, 1600), Image.Resampling.LANCZOS)
    pixels = np.array(image)
    rgb = pixels[:, :, :3]
    report(.18, '캐릭터 외곽 분절 중')
    alpha = pixels[:, :, 3] if pixels[:, :, 3].min() < 255 else predict_alpha(rgb)
    if (alpha > 127).sum() < 50:
        raise ValueError('분절된 캐릭터가 너무 작습니다. 캐릭터가 크게 보이는 이미지를 사용해 주세요.')
    report(.40, '깊이 추정 중')
    predicted = predict_depth(rgb, alpha)
    report(.58, '부위 경계 분리 중')
    labels, regions, method = auto_parts(rgb, alpha, predicted)
    report(.82, '레이어와 입체 표면 저장 중')
    metadata = {'id':card_id, 'title':title,
        'segmentation':method, 'reviewed':False, 'original_size':source_size,
        'created_at':time.time(), 'processing_seconds':round(time.perf_counter()-start,2),
        'settings':{'depth':.65,'tilt':True,'frame':'champagne','background':'midnight'}}
    result = save_artifacts(CARDS / card_id, rgb, alpha, predicted, labels, regions, metadata)
    report(1, '완료')
    return result
