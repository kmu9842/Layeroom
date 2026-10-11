"""Persistent presentation defaults; order is always front to back."""
import math

def normalize_card(card):
    layers = card['layers']
    ids = [l['id'] for l in layers]
    defaults = list(reversed(ids))
    saved = {k: v for k, v in card.get('settings', {}).items() if k != 'physics'}
    order = [i for i in saved.get('layer_order', defaults) if i in ids]
    order += [i for i in defaults if i not in order]
    positions = {str(i): value for i in ids
                 if isinstance(value := saved.get('layer_z', {}).get(str(i)), (int, float))
                 and math.isfinite(value) and 0 <= value <= 1}
    if positions:
        # Freeze automatic slots before sorting, so changing one depth cannot move others.
        positions = {str(i): positions.get(str(i), index/max(1,len(order)-1)) for index,i in enumerate(order)}
        order.sort(key=lambda i: positions[str(i)])
    card['settings'] = {
        'depth': .65, 'tilt': True, 'frame': 'champagne', 'background': 'system',
        'layer_gap': .025, 'angle_limit': 40, 'breathing': False,
        'motion_amount': 1, 'motion_duration': 6,
        'edge_smoothing': card.get('segmentation') != 'psd',
        'support_layers': True,
        **saved, 'layer_order': order, 'layer_z': positions,
        'layer_gap': round(round(max(0, min(.1, saved.get('layer_gap', .025))) / .005) * .005, 3),
        'hidden_layers': [i for i in saved.get('hidden_layers', [l['id'] for l in layers if not l.get('visible', True)]) if i in ids],
        'layer_motion': {str(l['id']): saved.get('layer_motion', {}).get(str(l['id']), False) for l in layers},
    }
    # Older cards did not have a system background option.
    if 'layer_gap' not in saved:
        card['settings']['background'] = 'system'
    return card
