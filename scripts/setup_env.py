"""Reproducible Windows setup. No images leave this PC."""
import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
def run(args):
    print('> '+ ' '.join(map(str,args)),flush=True)
    subprocess.run(list(map(str,args)),cwd=ROOT,check=True)

if __name__=='__main__':
    if not (3,11)<=sys.version_info[:2]<=(3,13):
        raise SystemExit('Use Python 3.11, 3.12, or 3.13 for these pinned model dependencies.')
    if not shutil.which('node') or not shutil.which('npm.cmd'):
        raise SystemExit('Install Node.js 22.12+ before setup.')
    python=ROOT/'.venv/Scripts/python.exe'
    if not python.exists():
        run([sys.executable,'-m','venv',ROOT/'.venv'])
    use_cuda=bool(shutil.which('nvidia-smi')) and '--cpu' not in sys.argv
    channel='cu128' if use_cuda else 'cpu'
    suffix='+cu128' if use_cuda else '+cpu'
    run([python,'-m','pip','install',f'torch==2.8.0{suffix}',f'torchvision==0.23.0{suffix}','--index-url',f'https://download.pytorch.org/whl/{channel}'])
    run([python,'-m','pip','install','-r','requirements.txt'])
    run([python,'scripts/download_models.py'])
    run([python,'scripts/download_depth.py'])
    run([python,'scripts/download_semantic.py'])
    run(['npm.cmd','ci'])
    run(['npm.cmd','run','build'])
    run(['npm.cmd','run','build:widget'])
    print('\nReady. Double-click start.bat to open Layeroom.',flush=True)
