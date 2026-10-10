"""Internal child entry point, bound to the supervising server's process lifetime."""
import json
import os
from pathlib import Path
import sys
import threading
import time
import traceback

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

def parent_watch(parent):
    # Waiting on a process handle avoids a blocking stdin reader interfering with
    # file operations on Windows. Native inference cannot outlive its owner.
    try: parent.wait()
    finally: os._exit(1)

def emit(event):
    print('LAYEROOM_WORKER:' + json.dumps(event, ensure_ascii=False), flush=True)

def main():
    import psutil
    parent = psutil.Process(os.getppid())
    threading.Thread(target=parent_watch, args=(parent,), daemon=True).start()
    started = time.perf_counter()
    try:
        request = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
        from backend import pipeline
        pipeline.CARDS = Path(request['cards'])
        pipeline.process_image(request['path'], request['card_id'], request['title'],
            progress=lambda value,message: emit({'type':'progress','value':value,'message':message}))
        import psutil
        memory = psutil.Process().memory_info()
        torch = sys.modules.get('torch')
        gpu = bool(torch and torch.cuda.is_initialized())
        metrics = {'seconds':round(time.perf_counter()-started,2),
            'peak_ram_mib':round(getattr(memory,'peak_wset',memory.rss)/1048576,1),
            'device':'cuda' if gpu else 'cpu',
            'peak_vram_mib':round(torch.cuda.max_memory_allocated()/1048576,1) if gpu else 0}
        emit({'type':'completed','metrics':metrics})
        return 0
    except Exception as error:
        traceback.print_exc()
        emit({'type':'failed','message':str(error)[:400]})
        return 1

if __name__=='__main__':
    raise SystemExit(main())
