import hashlib
import importlib.util
import io
from pathlib import Path
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import zipfile
import pytest

spec=importlib.util.spec_from_file_location('component_installer',Path(__file__).resolve().parents[1]/'portable/install.py')
installer=importlib.util.module_from_spec(spec);spec.loader.exec_module(installer)

@pytest.fixture
def upstream():
    payload=b'public-package-fixture'*5000
    ranges=[]
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            offset=int(self.headers.get('Range','bytes=0-').split('=')[1].split('-')[0]);ranges.append(offset)
            self.send_response(206);self.send_header('Content-Range',f'bytes {offset}-{len(payload)-1}/{len(payload)}');self.send_header('Content-Length',str(len(payload)-offset));self.end_headers();self.wfile.write(payload[offset:])
        def log_message(self,*args):pass
    server=ThreadingHTTPServer(('127.0.0.1',0),Handler);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    yield payload,{'url':f'http://127.0.0.1:{server.server_port}/fixture','sha256':hashlib.sha256(payload).hexdigest(),'bytes':len(payload)},ranges
    server.shutdown();server.server_close();thread.join()

def test_download_resumes_and_checks_digest(tmp_path,monkeypatch,upstream):
    payload,item,ranges=upstream;monkeypatch.setattr(installer,'CACHE',tmp_path)
    (tmp_path/(item['sha256']+'.part')).write_bytes(payload[:8192])
    result=installer.download(item,lambda *args,**kwargs:None)
    assert result.read_bytes()==payload and ranges==[8192]
    assert installer.download(item,lambda *args,**kwargs:None)==result
    assert ranges==[8192]

def test_corrupt_download_is_not_accepted(tmp_path,monkeypatch,upstream):
    _,item,_=upstream;item['sha256']='0'*64;monkeypatch.setattr(installer,'CACHE',tmp_path)
    with pytest.raises(ValueError,match='검증'):installer.download(item,lambda *args,**kwargs:None)
    assert list(tmp_path.iterdir())==[]

@pytest.mark.parametrize('name',['../outside','/outside','C:/outside','folder\\outside'])
def test_reject_outside_paths(tmp_path,name):
    with pytest.raises(ValueError):installer.checked_path(tmp_path,name)

def test_wheel_excludes_development_files_and_preserves_licenses(tmp_path,monkeypatch):
    monkeypatch.setattr(installer,'SITE',tmp_path)
    buffer=io.BytesIO()
    with zipfile.ZipFile(buffer,'w') as z:
        for name in ['torch/lib/torch_cpu.dll','torch/include/header.h','torch/lib/unneeded.lib','torch/tests/test_model.py','torch-1.dist-info/licenses/LICENSE','pillow.libs/runtime.dll']:
            z.writestr(name,b'x')
    with zipfile.ZipFile(buffer) as z:names=[name for _,name in installer.wheel_members(z)]
    assert names==['torch/lib/torch_cpu.dll','torch-1.dist-info/licenses/LICENSE','pillow.libs/runtime.dll']
