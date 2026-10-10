"""Resolve immutable public wheels and model revisions for the first-run installer."""
import concurrent.futures
import hashlib
from html.parser import HTMLParser
import importlib.metadata as metadata
import json
from pathlib import Path
import urllib.parse
import urllib.request
from packaging.requirements import Requirement
from packaging.tags import sys_tags
from packaging.utils import canonicalize_name, parse_wheel_filename

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / 'data/build-cache'
TAGS = {tag: index for index, tag in enumerate(sys_tags())}
CORE = ['fastapi', 'uvicorn', 'python-multipart', 'numpy', 'Pillow', 'opencv-python-headless',
        'scipy', 'scikit-image', 'httpx', 'psd-tools[composite]']
AI = ['onnxruntime', 'transformers', 'torch', 'torchvision', 'accelerate', 'einops', 'PyYAML', 'psutil']

def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'Layeroom-build/1'}), timeout=60) as response:
        return response.read()

def remote_size(url):
    request=urllib.request.Request(url,headers={'User-Agent':'Layeroom/1','Range':'bytes=0-0'})
    with urllib.request.urlopen(request,timeout=60) as response:
        return int(response.headers.get('Content-Range','/').rsplit('/',1)[-1]) if response.status==206 else int(response.headers['Content-Length'])

def closure(requirements):
    selected, extras_seen = {}, {}
    pending = list(requirements)
    while pending:
        req = Requirement(pending.pop())
        name = canonicalize_name(req.name)
        extras = set(req.extras) | {''}
        if name in extras_seen and extras <= extras_seen[name]: continue
        dist = metadata.distribution(req.name)
        assert not req.specifier or dist.version in req.specifier, str(req)
        selected[name] = dist.version
        extras_seen.setdefault(name, set()).update(extras)
        for text in dist.requires or []:
            child = Requirement(text)
            if not child.marker or any(child.marker.evaluate({'extra': e}) for e in extras_seen[name]): pending.append(text)
    return selected

def rank(filename):
    try:
        tags = parse_wheel_filename(filename)[3]
        return min((TAGS[t] for t in tags if t in TAGS), default=10**8)
    except ValueError: return 10**8

def pypi(item):
    name, version = item
    data = json.loads(get(f'https://pypi.org/pypi/{name}/{version}/json'))
    choices = [f for f in data['urls'] if f['filename'].endswith('.whl') and not f.get('yanked')]
    wheel = min(choices, key=lambda f: rank(f['filename']))
    assert rank(wheel['filename']) < 10**8, f'No compatible Windows wheel: {name}'
    return {'kind': 'wheel', 'package': name, 'version': version, 'filename': wheel['filename'],
        'url': wheel['url'], 'sha256': wheel['digests']['sha256'], 'bytes': wheel['size']}

def torch_wheel(name, version, channel):
    class Links(HTMLParser):
        urls = []
        def handle_starttag(self, tag, attrs):
            if tag == 'a': self.urls.append(dict(attrs).get('href', ''))
    parser = Links(); parser.urls = []
    parser.feed(get(f'https://download.pytorch.org/whl/{channel}/{name}/').decode())
    choices = []
    for link in parser.urls:
        parsed = urllib.parse.urlsplit(link)
        filename = urllib.parse.unquote(parsed.path.rsplit('/', 1)[-1])
        if filename.startswith(f'{name}-{version}%') or filename.startswith(f'{name}-{version}+{channel}-'):
            choices.append((rank(filename), filename, link))
    _, filename, url = min(choices)
    assert rank(filename) < 10**8
    parsed = urllib.parse.urlsplit(url)
    digest = urllib.parse.parse_qs(parsed.fragment)['sha256'][0]
    url = urllib.parse.urlunsplit(parsed._replace(fragment=''))
    size = remote_size(url)
    return {'kind': 'wheel', 'package': name, 'version': version+'+'+channel, 'filename': filename,
        'url': url, 'sha256': digest, 'bytes': size}

def models():
    result = []
    for target, repo, revision, source in [
        ('anime-seg.onnx', 'skytnt/anime-seg', '493cb60893f47441b26ec4fb9a306bce9e342982', 'isnetis.onnx'),
        ('semantic-sam.pt', '24yearsold/l2d_sam_iter2', '0b0608310fb7a89e32ecd7397147a249540cf1e7', 'checkpoint-18000.pt'),
        *[(f'depth-anything-v2-small/{name}', 'depth-anything/Depth-Anything-V2-Small-hf', '5426e4f0f36572d16453bbda7a8389317b1bef99', name)
          for name in ['config.json', 'preprocessor_config.json', 'model.safetensors']]]:
        file = ROOT / 'models' / target
        with file.open('rb') as stream: digest = hashlib.file_digest(stream, 'sha256').hexdigest()
        result.append({'kind': 'model', 'filename': source, 'target': 'models/'+target,
            'url': f'https://huggingface.co/{repo}/resolve/{revision}/{source}', 'sha256': digest, 'bytes': file.stat().st_size})
    return result

def main():
    core = closure(CORE); ai = {k: v for k, v in closure(AI).items() if k not in core and k not in {'torch','torchvision'}}
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        wheels = list(pool.map(pypi, sorted({**core, **ai}.items())))
    cpu = [torch_wheel('torch', '2.8.0', 'cpu'), torch_wheel('torchvision', '0.23.0', 'cpu')]
    cuda = [torch_wheel('torch', '2.8.0', 'cu128'), torch_wheel('torchvision', '0.23.0', 'cu128')]
    python_zip = CACHE / 'python-3.13.13-embed-amd64.zip'
    data = {'format': 1, 'python': {'filename': python_zip.name, 'bytes': python_zip.stat().st_size,
        'url': 'https://www.python.org/ftp/python/3.13.13/'+python_zip.name,
        'sha256': '8766a8775746235e23cf5aee5027ab1060bb981d93110577adcf3508aa0cbd55'},
        'crt': json.loads((CACHE / 'vclibs-source.json').read_text()), 'components': {}}
    data['crt']['filename'] = 'Microsoft.VCLibs.x64.14.00.Desktop.appx'
    common = [w for w in wheels if w['package'] in ai] + models()
    electron_version = json.loads((ROOT / 'node_modules/electron/package.json').read_text())['version']
    filename = f'electron-v{electron_version}-win32-x64.zip'
    lines = get(f'https://github.com/electron/electron/releases/download/v{electron_version}/SHASUMS256.txt').decode().splitlines()
    digest = next(line.split()[0] for line in lines if line.split()[-1].lstrip('*') == filename)
    url = f'https://github.com/electron/electron/releases/download/v{electron_version}/{filename}'
    size = remote_size(url)
    groups = {'core': ('기본 실행 환경', [w for w in wheels if w['package'] in core]),
        'ai_cpu': ('자동 분절 · CPU', common+cpu), 'ai_cuda': ('자동 분절 · NVIDIA GPU', common+cuda),
        'widget': ('위젯 출력', [{'kind':'widget','url':url,'sha256':digest,'bytes':size,'filename':filename}])}
    for key, (title, files) in groups.items():
        fingerprint = hashlib.sha256(json.dumps(files, sort_keys=True).encode()).hexdigest()
        data['components'][key] = {'title': title, 'files': files, 'fingerprint': fingerprint,
            'bytes': sum(f['bytes'] for f in files)+(data['python']['bytes']+data['crt']['bytes'] if key == 'core' else 0)}
    (ROOT / 'portable/components.json').write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({k: {'files':len(v['files']),'download_MB':round(v['bytes']/1e6,1)} for k,v in data['components'].items()}, ensure_ascii=False), flush=True)

if __name__ == '__main__': main()
