"""Build the reusable offline EXE runtime once; artwork packaging needs no compiler."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import zipfile

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'data/widget-runtime'

def build():
    OUT.mkdir(parents=True,exist_ok=True)
    runtime=ROOT/'node_modules/electron/dist'
    if not (runtime/'electron.exe').is_file():
        raise SystemExit('Electron runtime missing. Run npm.cmd ci first.')
    compiler=Path(os.environ.get('WINDIR','C:/Windows'))/'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
    if not compiler.is_file():
        raise SystemExit('Windows .NET Framework compiler is required to build the widget launcher.')
    version=json.loads((ROOT/'node_modules/electron/package.json').read_text())['version']
    archive=OUT/'runtime.zip'
    stamp=OUT/'runtime-version.txt'
    if not archive.exists() or not stamp.exists() or stamp.read_text()!=version:
        print('Compressing Electron '+version,flush=True)
        with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
            for file in sorted(runtime.rglob('*')):
                if file.is_file():z.write(file,file.relative_to(runtime).as_posix())
        stamp.write_text(version)
    with archive.open('rb') as file:
        digest=hashlib.file_digest(file,'sha256').hexdigest()
    (OUT/'runtime.sha256').write_text(digest,encoding='ascii')
    source=ROOT/'widget/Launcher.cs'
    signature=hashlib.sha256((source.read_bytes()+digest.encode())).hexdigest()
    exe=OUT/'launcher.exe'
    fingerprint=OUT/'launcher.sha256'
    if not exe.exists() or not fingerprint.exists() or fingerprint.read_text()!=signature:
        print('Building portable launcher',flush=True)
        subprocess.run([str(compiler),'/nologo','/target:winexe','/platform:x64','/optimize+',
            '/reference:System.Windows.Forms.dll','/reference:System.Drawing.dll','/reference:System.IO.Compression.dll',
            '/out:'+str(exe),'/resource:'+str(archive)+',runtime.zip','/resource:'+str(OUT/'runtime.sha256')+',runtime.sha256',str(source)],cwd=ROOT,check=True)
        fingerprint.write_text(signature)
    print(f'Widget runtime ready: {exe.stat().st_size/1024/1024:.1f} MB',flush=True)

if __name__=='__main__':build()
