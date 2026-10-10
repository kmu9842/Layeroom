"""Artwork, installed components and developer artifacts must never enter the app ZIP."""
import importlib.util
from pathlib import Path
import zipfile
import pytest

spec=importlib.util.spec_from_file_location('build_bootstrap',Path(__file__).resolve().parents[1]/'scripts/build_bootstrap.py')
packaging=importlib.util.module_from_spec(spec);spec.loader.exec_module(packaging)

@pytest.mark.parametrize('relative',[
    'data/cards/private/source.png','_internal/data/cards/private/source.png',
    '_internal/models/semantic-sam.pt','_internal/runtime/python/python.exe',
    'tests/dummy.png','research.md','README.md','release-manifest.json',
    'guide/index.html','guide/screenshots/private.png'])
def test_only_exe_and_final_guide_pages_are_distributed(tmp_path,monkeypatch,relative):
    output=tmp_path/'build/Layeroom';output.mkdir(parents=True)
    (output/'Layeroom.exe').write_bytes(b'MZ-executable')
    (output/'guide').mkdir()
    for i in range(10):(output/'guide'/f'{i:02d}.png').write_bytes(b'guide-png')
    private=output/relative;private.parent.mkdir(parents=True,exist_ok=True);private.write_bytes(b'private-do-not-publish')
    monkeypatch.setattr(packaging,'ROOT',tmp_path);monkeypatch.setattr(packaging,'OUT',output);monkeypatch.setattr(packaging,'RELEASE',tmp_path/'release');monkeypatch.setattr(packaging,'publish_guides',lambda:None)
    packaging.package()
    with zipfile.ZipFile(tmp_path/'release/Layeroom-Windows-x64.zip') as archive:
        assert len(archive.namelist())==11
        assert all(name.isascii() for name in archive.namelist())
        assert 'Layeroom/'+relative not in archive.namelist()
        assert all(b'private-do-not-publish' not in archive.read(name) for name in archive.namelist())
