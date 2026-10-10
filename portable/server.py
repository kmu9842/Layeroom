"""Entry point for the isolated, bundled Python runtime."""
import argparse
import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
os.chdir(ROOT)
for name, folder in {
    'HF_HOME': 'huggingface', 'TORCH_HOME': 'torch', 'XDG_CACHE_HOME': 'cache',
    'MPLCONFIGDIR': 'matplotlib', 'TEMP': 'tmp', 'TMP': 'tmp',
}.items():
    path = ROOT / 'data/cache' / folder
    path.mkdir(parents=True, exist_ok=True)
    os.environ[name] = str(path)
os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['TRANSFORMERS_OFFLINE'] = '1'
os.environ['HF_HUB_DISABLE_TELEMETRY'] = '1'
os.environ['DO_NOT_TRACK'] = '1'
os.environ['LAYEROOM_PORTABLE'] = '1'

if __name__ == '__main__':
    import uvicorn
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, required=True)
    args = parser.parse_args()
    uvicorn.run('backend.app:app', host='127.0.0.1', port=args.port, access_log=False)
