"""Process the explicitly supplied guide artwork in an isolated capture workspace."""
import argparse
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from backend.inference_job import process_in_worker

parser = argparse.ArgumentParser()
parser.add_argument('--image', type=Path, required=True)
parser.add_argument('--cards', type=Path, required=True)
args = parser.parse_args()
args.cards.mkdir(parents=True, exist_ok=True)
target = args.cards / 'guide-character'
if target.exists():
    raise SystemExit('Guide character already exists; reuse the processed result.')
metrics = process_in_worker(args.image, 'guide-character', 'Character', args.cards,
    progress=lambda value, message: print(f'{value}: {message}', flush=True))
print(json.dumps({'card': str(target), 'metrics': metrics}), flush=True)
