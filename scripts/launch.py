import json
import os
from pathlib import Path
import subprocess
import sys
import time
import urllib.request
import webbrowser

ROOT=Path(__file__).resolve().parents[1]
URL='http://127.0.0.1:8765'

def healthy():
    try:
        with urllib.request.urlopen(URL+'/api/health',timeout=2) as response:
            return json.load(response).get('application')=='layeroom'
    except Exception:
        return False

if __name__=='__main__':
    if '--stop' in sys.argv:
        import psutil
        pidfile=ROOT/'data/server.pid'
        if pidfile.exists():
            try:
                process=psutil.Process(int(pidfile.read_text()))
                args=' '.join(process.cmdline())
                if 'uvicorn' in args and str(ROOT).lower() in args.lower():
                    process.terminate()
                    print('Layeroom stopped.')
                else:
                    raise SystemExit('PID no longer belongs to this Layeroom server; not stopped.')
            except psutil.NoSuchProcess:
                pass
            pidfile.unlink(missing_ok=True)
        raise SystemExit(0)
    if not (ROOT/'dist/index.html').exists():
        raise SystemExit('Run setup.bat first (frontend build is missing).')
    if not healthy():
        python=ROOT/'.venv/Scripts/python.exe'
        if not python.exists():
            raise SystemExit('Run setup.bat first (Python environment is missing).')
        (ROOT/'data').mkdir(exist_ok=True)
        with (ROOT/'data/server.log').open('a',encoding='utf-8') as log:
            flags=subprocess.CREATE_NO_WINDOW|subprocess.CREATE_NEW_PROCESS_GROUP if os.name=='nt' else 0
            env=os.environ.copy();env['PYTHONUTF8']='1';env['HF_HUB_OFFLINE']='1';env['TRANSFORMERS_OFFLINE']='1'
            proc=subprocess.Popen([str(python),'-m','uvicorn','backend.app:app','--app-dir',str(ROOT),'--host','127.0.0.1','--port','8765'],cwd=ROOT,stdout=log,stderr=log,stdin=subprocess.DEVNULL,creationflags=flags,env=env)
            (ROOT/'data/server.pid').write_text(str(proc.pid))
        for _ in range(60):
            if healthy():break
            if proc.poll() is not None:raise SystemExit('Server could not start. See data/server.log (port 8765 may be in use).')
            time.sleep(.5)
        else:raise SystemExit('Server startup timed out. See data/server.log.')
    print('Layeroom: '+URL,flush=True)
    if '--no-browser' not in sys.argv:
        webbrowser.open(URL)
