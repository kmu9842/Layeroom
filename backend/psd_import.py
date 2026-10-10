"""PSD import never calls segmentation or depth inference."""
import json
import shutil
import time
from pathlib import Path
import numpy as np
from PIL import Image
from psd_tools import PSDImage
from psd_tools.constants import BlendMode
from psd_tools.composite import composite_pil
from .presentation import normalize_card
from .edges import save_contours

COLORS = ['#b98aaf', '#b5a279', '#dc9985', '#8eabc6', '#9ba978', '#aa91bf', '#7dacac']


def import_psd(path, card_id, title, cards, progress=lambda *_: None):
    progress(.06, 'PSD 원본 레이어 읽는 중 · AI 분절 생략')
    psd = PSDImage.open(path)
    if psd.width * psd.height > 25_000_000 or min(psd.size) < 32:
        raise ValueError('PSD 크기는 최소 32px, 최대 2,500만 픽셀입니다.')
    units, warnings = [], []

    def visit(container, ancestors=()):
        for layer in container:  # PSD API iterates from bottom to top.
            if layer.clipping:
                continue  # Bound to the base layer; baked there by psd-tools.
            grouped = layer.is_group() and (layer.opacity != 255 or layer.has_mask() or layer.has_vector_mask() or layer.has_clip_layers() or layer.blend_mode not in (BlendMode.NORMAL, BlendMode.PASS_THROUGH) or any(c.kind == 'adjustment' for c in layer))
            if layer.is_group() and not grouped:
                visit(layer, (*ancestors, layer.name))
            else:
                if layer.kind == 'adjustment':
                    warnings.append(f'{layer.name}: 문서 전체 조정 레이어는 원본 보기에서 확인하세요.')
                    continue
                units.append((layer, ancestors))
                if grouped or layer.has_clip_layers():
                    warnings.append(f'{layer.name}: 그룹 효과·클리핑을 보존하기 위해 연결된 레이어를 한 평면으로 가져왔습니다.')
                if layer.blend_mode not in (BlendMode.NORMAL, BlendMode.PASS_THROUGH):
                    warnings.append(f'{layer.name}: {layer.blend_mode.name} 혼합 효과는 분리된 3D 평면에서 원본과 다를 수 있습니다.')

    visit(psd)
    if not units:
        raise ValueError('표시할 수 있는 PSD 레이어가 없습니다.')
    if len(units) > 80:
        raise ValueError('PSD는 최대 80개의 독립 레이어를 지원합니다. 그룹으로 묶어 다시 가져오세요.')
    folder = Path(cards) / card_id
    folder.mkdir(parents=True, exist_ok=False)
    try:
        size = psd.size
        # Bound GPU texture memory for large multi-layer documents.
        scale = min(1, 1600/max(size), (24_000_000/(size[0]*size[1]*len(units)))**.5)
        out_size = tuple(max(1, round(n*scale)) for n in size)
        viewport = (0, 0, *size)
        composite = psd.composite(ignore_preview=True)
        if composite is None:
            composite = Image.new('RGBA', size)
        composite = composite.convert('RGBA').resize(out_size, Image.Resampling.LANCZOS)
        original = psd.topil() if psd.has_preview() else composite
        (original or composite).convert('RGBA').resize(out_size,Image.Resampling.LANCZOS).save(folder/'source.png')
        composite.save(folder/'cutout.png')
        composite.getchannel('A').save(folder/'alpha.png')
        labels = np.zeros(out_size[::-1], np.uint8)
        overlay = np.zeros((*out_size[::-1], 4), np.uint8)
        depth = np.zeros(out_size[::-1], np.uint8)
        layers = []
        for index, (layer, ancestors) in enumerate(units, 1):
            progress(.1 + .8*index/len(units), f'PSD 레이어 가져오는 중 · {index}/{len(units)}')
            # Force inclusion of a hidden root, retaining hidden children of groups.
            def include(candidate):
                if candidate is layer:
                    return True
                current = candidate
                while current is not layer and current is not psd:
                    if not current.visible:
                        return False
                    current = current.parent
                return True
            rgba = composite_pil(layer, color=1., alpha=0., viewport=viewport, layer_filter=include, force=False, as_layer=True)
            if rgba is None:
                rgba = Image.new('RGBA', size)
            rgba = rgba.convert('RGBA').resize(out_size, Image.Resampling.LANCZOS)
            rgba.save(folder/f'layer-{index}.png')
            a = np.asarray(rgba.getchannel('A'))
            color = COLORS[(index-1) % len(COLORS)]
            visible = layer.is_visible()
            if visible:
                labels[a > 0] = index
                overlay[a > 0, :3] = tuple(bytes.fromhex(color[1:]))
                overlay[a > 0, 3] = a[a > 0]
                depth[a > 0] = round(index / len(units)*255)
            layers.append({'id': index, 'name': layer.name, 'file': f'layer-{index}.png',
                'contour_file':save_contours(folder,f'layer-{index}.png',index),
                'visible': visible, 'opacity': layer.opacity, 'blend_mode': layer.blend_mode.name,
                'group_path': list(ancestors), 'bbox': list(layer.bbox), 'depth': index/len(units),
                'color': color, 'pixels': int((a > 0).sum()),
                'source_layers': [c.name for c in layer.descendants()] if layer.is_group() else [layer.name] + [c.name for c in layer.clip_layers]})
        Image.fromarray(labels).save(folder/'labels.png')
        Image.fromarray(overlay).save(folder/'segments.png')
        Image.fromarray(depth).save(folder/'depth.png')
        Image.fromarray(depth).save(folder/'estimated-depth.png')
        shutil.copyfile(path, folder/'original.psd')
        metadata = normalize_card({'id': card_id, 'title': title, 'width': out_size[0], 'height': out_size[1],
            'original_size': list(size), 'layers': layers, 'segmentation': 'psd', 'warnings': warnings,
            'settings': {}, 'regions': [], 'updated_at': time.time(),
            'metrics': {'source_layers': len(list(psd.descendants())), 'render_layers': len(layers), 'overlapping_layers': True},
            'relief_method': 'independent-psd-planes'})
        (folder/'manifest.json').write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding='utf-8')
        progress(1, 'PSD 등록 완료')
        return metadata
    except Exception:
        # Only remove the newly-created import directory, never an existing card.
        if folder.resolve().parent == Path(cards).resolve():
            shutil.rmtree(folder)
        raise
