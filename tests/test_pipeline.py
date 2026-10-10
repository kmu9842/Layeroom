import io
import json
from pathlib import Path
import numpy as np
import pytest
from PIL import Image
from fastapi.testclient import TestClient
from backend import pipeline
from backend.app import app

client=TestClient(app)

def require_samples(*names):
    if any(not (pipeline.CARDS/name/'manifest.json').is_file() for name in names):
        pytest.skip('Optional local artwork checks; user images are not stored in Git.')

@pytest.mark.parametrize('name',['sample-01','sample-02','sample-03','sample-04'])
def test_delivered_layers_reconstruct_exact_source_foreground(name):
    require_samples(name)
    folder=pipeline.CARDS/name
    info=json.loads((folder/'manifest.json').read_text(encoding='utf-8'))
    source=np.array(Image.open(folder/'source.png').convert('RGB'))
    cutout=np.array(Image.open(folder/'cutout.png').convert('RGBA'))
    reconstructed=np.zeros(cutout.shape[:2],np.uint16)
    for layer in info['layers']:
        rgba=np.array(Image.open(folder/layer['file']).convert('RGBA'))
        reconstructed += rgba[:,:,3].astype(np.uint16)
        assert np.array_equal(rgba[:,:,:3][rgba[:,:,3]>0],source[rgba[:,:,3]>0])
    assert np.array_equal(reconstructed,cutout[:,:,3])
    assert np.array_equal(cutout[:,:,:3],source)
    assert len(info['layers'])>=6
    assert cutout[:,:,3].min()==0
    assert cutout[:,:,3].max()==255

@pytest.mark.parametrize('name,xy',[('sample-01',(460,180)),('sample-02',(710,190)),('sample-03',(425,330)),('sample-04',(280,170))])
def test_light_hair_and_face_are_not_white_keyed(name,xy):
    require_samples(name)
    alpha=np.array(Image.open(pipeline.CARDS/name/'alpha.png'))
    assert alpha[xy[1],xy[0]]>=245
    assert alpha[0,0]==0

def test_cut_off_artwork_is_retained():
    require_samples('sample-03','sample-04')
    for name in ['sample-03','sample-04']:
        alpha=np.array(Image.open(pipeline.CARDS/name/'alpha.png'))
        assert (alpha[-1]>127).sum()>100

def test_existing_alpha_bypasses_extraction(tmp_path,monkeypatch):
    monkeypatch.setattr(pipeline,'CARDS',tmp_path/'cards')
    def forbidden(_):
        raise AssertionError('existing alpha must not be replaced')
    monkeypatch.setattr(pipeline,'predict_alpha',forbidden)
    monkeypatch.setattr(pipeline,'predict_depth',lambda r,a:np.ones(a.shape,np.float32)*.5)
    rgba=np.zeros((100,90,4),np.uint8);rgba[10:90,10:80]=[240,240,240,180]
    path=tmp_path/'input.png';Image.fromarray(rgba).save(path)
    monkeypatch.setattr(pipeline,'auto_parts',lambda r,a,d: ((a>0).astype(np.uint8),[{'name':'subject','depth':.5,'color':'#777777'}],'semantic-sam'))
    pipeline.process_image(path,'test','test')
    result=np.array(Image.open(tmp_path/'cards/test/alpha.png'))
    assert np.array_equal(result,rgba[:,:,3])

def test_api_serves_ui_assets_and_valid_exports():
    require_samples('sample-01','sample-02','sample-03','sample-04')
    if not (pipeline.ROOT/'dist/index.html').is_file():
        pytest.skip('Run npm run build before the UI asset integration check.')
    assert client.get('/api/health').json()['status']=='ok'
    assert len(client.get('/api/cards').json())>=4
    assert client.get('/').status_code==200
    assert client.get('/assets/sample-01/cutout.png').headers['content-type']=='image/png'
    import zipfile
    response=client.get('/api/cards/sample-01/export')
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        assert {'source.png','cutout.png','depth.png','labels.png','manifest.json'} <= set(archive.namelist())

def test_invalid_input_and_external_origin():
    assert client.post('/api/upload',files={'file':('bad.png',b'not image','image/png')}).status_code==422
    assert client.post('/api/upload',headers={'Origin':'https://untrusted.example'},files={'file':('x',b'x')}).status_code==403
    assert client.get('/api/cards/does-not-exist').status_code==404
    assert client.patch('/api/cards/sample-01/settings',json={'depth':-1,'tilt':True,'frame':'silver','background':'sage'}).status_code==422

def test_edit_conflict_preserves_card():
    require_samples('sample-01')
    before=client.get('/api/cards/sample-01').json()
    response=client.post('/api/cards/sample-01/masks',json={'alpha':'x','labels':'x','revision':0})
    assert response.status_code==409
    assert client.get('/api/cards/sample-01').json()==before
