"""Build a portable EXE containing executable app code and required notices."""
import ast
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'build/Layeroom'
RELEASE = ROOT / 'release'


def local_imports(folder, seeds, search=None):
    """Trace local static imports, including package initializers and lazy imports."""
    modules = {}
    for file in (search or folder).rglob('*.py'):
        name = '.'.join(file.relative_to(folder).with_suffix('').parts)
        modules[name.removesuffix('.__init__')] = file
    pending, seen = list(seeds), set()
    while pending:
        name = pending.pop()
        if name in seen or name not in modules:
            continue
        seen.add(name)
        file = modules[name]
        package = name if file.name == '__init__.py' else name.rpartition('.')[0]
        parts = name.split('.')
        pending.extend('.'.join(parts[:i]) for i in range(1, len(parts)))
        for node in ast.walk(ast.parse(file.read_text(encoding='utf-8-sig'))):
            if isinstance(node, ast.Import):
                pending.extend(item.name for item in node.names)
            elif isinstance(node, ast.ImportFrom):
                try:
                    base = importlib.util.resolve_name('.' * node.level + (node.module or ''), package) if node.level else node.module or ''
                except (ImportError, ValueError):
                    # Some upstream modules include a fallback for a different import root.
                    continue
                pending.append(base)
                pending.extend(base + '.' + item.name for item in node.names)
    return sorted(modules[name] for name in seen)


def copy(source, target):
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, target)


def publish_guides():
    images = sorted((ROOT / 'docs/guide/images').glob('*.png'))
    if len(images) != 10:
        raise RuntimeError('Render all ten PNG guides before packaging.')
    for file in images:
        copy(file, OUT / 'guide' / file.name)


def build():
    OUT.mkdir(parents=True, exist_ok=True)
    if (OUT / '_internal').exists():
        raise RuntimeError('Build output was used as an installed app. Use a fresh staging folder.')
    compiler = str(Path(os.environ['WINDIR']) / 'Microsoft.NET/Framework64/v4.0.30319/csc.exe')
    csharp = [compiler, '/nologo', '/target:winexe', '/platform:x64', '/optimize+',
              '/r:System.Windows.Forms.dll', '/r:System.Drawing.dll', '/r:System.IO.Compression.dll']
    with tempfile.TemporaryDirectory(prefix='application-', dir=ROOT / 'build') as temporary:
        stage = Path(temporary).resolve()
        assert stage.is_relative_to((ROOT / 'build').resolve())
        subprocess.run(['node', str(ROOT/'node_modules/vite/bin/vite.js'), 'build', '--mode', 'portable', '--outDir', str(stage/'dist')], cwd=ROOT, check=True)
        subprocess.run(['node', str(ROOT/'node_modules/vite/bin/vite.js'), 'build', '--config', str(ROOT/'widget/vite.config.js'), '--outDir', str(stage/'widget/dist')], cwd=ROOT, check=True)
        for file in local_imports(ROOT, ['backend.app', 'backend.inference_worker'], search=ROOT/'backend'):
            copy(file, stage/file.relative_to(ROOT))
        common = ROOT/'third_party/see-through/common'
        for file in local_imports(common, ['modules.semanticsam']):
            copy(file, stage/file.relative_to(ROOT))
        for name in ['main.cjs', 'preload.cjs', 'options.cjs']:
            copy(ROOT/'widget'/name, stage/'widget'/name)
        for name in ['server.py', 'install.py', 'components.json']:
            copy(ROOT/'portable'/name, stage/'portable'/name)
        subprocess.run(csharp+['/out:'+str(stage/'portable/widget-stub.exe'), str(ROOT/'widget/Launcher.cs')], check=True)
        notices = [(ROOT/'portable/DOWNLOAD-NOTICES.txt').read_text(encoding='utf-8')]
        for package in ['react', 'react-dom', 'scheduler', 'three', 'lucide-react', '@dnd-kit/core', '@dnd-kit/sortable', '@dnd-kit/utilities', '@dnd-kit/accessibility']:
            for file in sorted((ROOT/'node_modules'/package).glob('*')):
                if file.is_file() and file.name.lower().startswith(('license', 'notice')):
                    notices.append('\n'+package+'\n'+file.read_text(encoding='utf-8'))
        notices.append('\nSee-through semantic adapter\n'+(ROOT/'third_party/see-through/LICENSE').read_text(encoding='utf-8'))
        (stage/'licenses').mkdir()
        (stage/'licenses/THIRD-PARTY.txt').write_text('\n'.join(notices), encoding='utf-8')
        files = sorted(file for file in stage.rglob('*') if file.is_file())
        audit = []
        payload = ROOT/'build/application.zip'
        with zipfile.ZipFile(payload, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
            for file in files:
                relative = file.relative_to(stage).as_posix()
                assert relative.isascii()
                assert file.suffix not in {'.md', '.cs', '.pyc', '.map', '.whl', '.pt', '.onnx'}
                archive.write(file, relative)
                audit.append({'path': relative, 'bytes': file.stat().st_size, 'sha256': hashlib.sha256(file.read_bytes()).hexdigest()})
        subprocess.run(csharp+['/r:System.Web.Extensions.dll', '/resource:'+str(payload)+',Layeroom.Application',
            '/out:'+str(OUT/'Layeroom.exe'), str(ROOT/'portable/Launcher.cs'), str(ROOT/'portable/Setup.cs'), str(ROOT/'portable/Bundle.cs'), str(ROOT/'portable/InstallLocation.cs')], check=True)
        (ROOT/'build/application-audit.json').write_text(json.dumps(audit, indent=2), encoding='utf-8')
        print('Embedded executable application files:', len(audit), flush=True)
    publish_guides()


def package():
    publish_guides()
    RELEASE.mkdir(exist_ok=True)
    files = [OUT/'Layeroom.exe'] + sorted((OUT/'guide').glob('*.png'))
    assert len(files) == 11
    archive = RELEASE/'Layeroom-Windows-x64.zip'
    manifest = {'application': 'Layeroom', 'version': json.loads((ROOT/'package.json').read_text(encoding='utf-8'))['version'], 'distribution': 'embedded-app-with-first-run-setup',
        'empty_collection': True, 'user_artwork_included': False, 'guide_artwork_included': True,
        'research_notes_included': False, 'bundled_components': False, 'files': []}
    with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for file in files:
            name = file.relative_to(OUT).as_posix()
            assert name.isascii()
            data = file.read_bytes()
            manifest['files'].append({'path':name,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()})
            z.writestr('Layeroom/'+name, data)
    with zipfile.ZipFile(archive) as z:
        assert z.testzip() is None
    sha = hashlib.sha256(archive.read_bytes()).hexdigest()
    archive.with_suffix('.zip.sha256').write_text(sha+'  '+archive.name+'\n')
    (ROOT/'build/release-manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    with zipfile.ZipFile(RELEASE/'Layeroom-Guides.zip', 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for file in files[1:]:
            z.write(file, 'Layeroom-Guide/'+file.name)
    result = {'zip':archive.name,'bytes':archive.stat().st_size,'sha256':sha,'files':len(files),
              'components_included':False,'crc_verified':True}
    (ROOT/'build/package-result.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps(result),flush=True)


if __name__ == '__main__':
    import sys
    if '--package-only' not in sys.argv: build()
    if '--build-only' not in sys.argv: package()
