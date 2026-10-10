from pathlib import Path
import json
import urllib.request
import hashlib

root = Path(__file__).resolve().parents[1] / 'models' / 'depth-anything-v2-small'
root.mkdir(parents=True, exist_ok=True)
repo = 'depth-anything/Depth-Anything-V2-Small-hf'
revision = '5426e4f0f36572d16453bbda7a8389317b1bef99'
checksums = {'config.json':'c56698d3643dde1f83ea2212759e6b31a22b8f827246a36dd007ee8a22b3ff75','model.safetensors':'3152477ce0d8d6978d76b995120de97cb5b928701fd0f817769f59e249a16b70','preprocessor_config.json':'d41175c0d889477ca8fc67191e540faef14baf6275157b3fdecf78469e6bbf84'}
for name in ['config.json', 'preprocessor_config.json', 'model.safetensors']:
    target = root / name
    if not target.exists():
        print(f'Downloading {name}', flush=True)
        urllib.request.urlretrieve(f"https://huggingface.co/{repo}/resolve/{revision}/{name}", target.with_suffix('.download'))
        target.with_suffix('.download').replace(target)
    if hashlib.sha256(target.read_bytes()).hexdigest() != checksums[name]:
        raise RuntimeError(f'Checksum mismatch: {name}')
(root / 'source.json').write_text(json.dumps({'repo':repo, 'revision':revision, 'license':'Apache-2.0','sha256':checksums}), encoding='utf-8')
print('Depth model ready', flush=True)
