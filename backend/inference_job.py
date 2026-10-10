"""One short-lived process per image: no model or CUDA context stays in the server."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
PREFIX = 'LAYEROOM_WORKER:'

def process_in_worker(path, card_id, title, cards, progress, on_process=None):
    staging = ROOT / 'data/.staging'
    staging.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile('w', suffix='.json', prefix='job-', dir=staging,
                                     encoding='utf-8', delete=False) as stream:
        json.dump({'path':str(path.resolve()), 'card_id':card_id, 'title':title,
                   'cards':str(Path(cards).resolve())}, stream, ensure_ascii=False)
        request = Path(stream.name)
    child = None
    result, error = None, None
    try:
        env = os.environ.copy()
        env['HF_HUB_OFFLINE'] = env['TRANSFORMERS_OFFLINE'] = '1'
        env['HF_HUB_DISABLE_TELEMETRY'] = '1'
        child = subprocess.Popen([sys.executable, '-X', 'utf8', '-B', '-u',
            str(ROOT / 'backend/inference_worker.py'), str(request)], cwd=ROOT,
            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, encoding='utf-8', errors='replace', env=env,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)
        if on_process: on_process(child.pid)
        for line in child.stdout:
            if not line.startswith(PREFIX):
                print(line.rstrip(), flush=True)
                continue
            event = json.loads(line[len(PREFIX):])
            if event['type']=='progress': progress(event['value'], event['message'])
            elif event['type']=='completed': result = event.get('metrics', {})
            elif event['type']=='failed': error = event['message']
        code = child.wait()
        if code != 0 or result is None:
            raise RuntimeError(error or f'이미지 처리 프로세스가 종료되었습니다. (코드 {code})')
        return result
    finally:
        # Completion is not reported until the worker has exited and its allocations
        # (including ONNX arenas / CUDA context) have been reclaimed by Windows.
        if child:
            if child.poll() is None:
                child.terminate()
                try: child.wait(timeout=10)
                except subprocess.TimeoutExpired: child.kill(); child.wait()
            child.stdout.close()
        if on_process: on_process(None)
        request.unlink(missing_ok=True)
