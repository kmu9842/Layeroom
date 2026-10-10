"""Reuse verified local runtimes in the isolated capture app, without copying artwork."""
import os
from pathlib import Path
import argparse

ROOT = Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser()
parser.add_argument('--source',type=Path,default=ROOT/'release/Layeroom/_internal')
parser.add_argument('--target',type=Path,default=ROOT/'test-results/character-capture/Layeroom/_internal')
args=parser.parse_args()
source,target=args.source,args.target
assert target.resolve().is_relative_to((ROOT/'test-results').resolve())
for name in ['runtime', 'models', 'data/components', 'data/widget-runtime']:
    for file in (source/name).rglob('*'):
        if file.is_file():
            output = target/name/file.relative_to(source/name)
            output.parent.mkdir(parents=True, exist_ok=True)
            if not output.exists():
                os.link(file, output)
print('Reused verified runtime, models and widget components for capture only')
