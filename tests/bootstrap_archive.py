"""Verify the final downloadable archive, including exact bytes and image files."""
import hashlib
import io
import json
import os
from pathlib import Path
import zipfile
from PIL import Image

ROOT=Path(__file__).resolve().parents[1]
archive=ROOT/'release/Layeroom-Windows-x64.zip'
target=Path(os.environ.get('LAYEROOM_ARCHIVE_CHECK',str(ROOT/'test-results/current-archive'))).resolve()
assert target.is_relative_to((ROOT/'test-results').resolve())
assert not target.exists(),'Do not overwrite an extracted verification copy'
manifest=json.loads((ROOT/'build/release-manifest.json').read_text(encoding='utf-8'))
with zipfile.ZipFile(archive) as z:
    expected={'Layeroom/'+file['path']:file for file in manifest['files']}
    assert len(z.namelist())==len(set(z.namelist()))==len(expected)==11
    for name in z.namelist():
        assert name.isascii() and name in expected
        content=z.read(name);assert hashlib.sha256(content).hexdigest()==expected[name]['sha256']
        if name.endswith('.png'):Image.open(io.BytesIO(content)).verify()
        else:assert name=='Layeroom/Layeroom.exe' and content[:2]==b'MZ'
        output=target/name;assert output.resolve().is_relative_to(target.resolve())
        output.parent.mkdir(parents=True,exist_ok=True);output.write_bytes(content)
print(json.dumps({'files':11,'guides':10,'ascii_filenames':True,'hashes_verified':True}))
