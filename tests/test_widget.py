import copy
import importlib
import io
import json
import struct
import zipfile

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from backend import widget_export

api=importlib.import_module('backend.app')

@pytest.fixture
def widget_card(tmp_path,monkeypatch):
    cards=tmp_path/'cards';folder=cards/'fixture';folder.mkdir(parents=True)
    for name in ['source.png','cutout.png','depth.png','segments.png','layer-1.png','layer-2.png','layer-2-smooth.png','background-0123456789abcdef.png']:
        Image.new('RGBA',(32,32),'#c5a89b').save(folder/name)
    (folder/'layer-2-contours.json').write_text('{"loops":[]}')
    card={'id':'fixture','title':'A / 카드','width':32,'height':32,'updated_at':123.0,'segmentation':'psd','settings':{'layer_gap':.06,'frame':'carbon'},'layers':[{'id':1,'name':'Hair','file':'layer-1.png','depth':.2},{'id':2,'name':'Sleeve','file':'layer-2.png','render_file':'layer-2-smooth.png','contour_file':'layer-2-contours.json','depth':.8}]}
    (folder/'manifest.json').write_text(json.dumps(card),encoding='utf8')
    launcher=tmp_path/'launcher.exe';launcher.write_bytes(b'MZ-test-runtime')
    web=tmp_path/'web';web.mkdir();(web/'index.html').write_text('<html></html>')
    monkeypatch.setattr(api,'CARDS',cards);monkeypatch.setattr(widget_export,'LAUNCHER',launcher);monkeypatch.setattr(widget_export,'WEB',web);monkeypatch.setattr(widget_export,'EXPORTS',tmp_path/'exports')
    return folder,card

def unpack(content):
    assert content.startswith(b'MZ') and content.endswith(widget_export.MAGIC)
    tail=8+len(widget_export.MAGIC);length=struct.unpack('<Q',content[-tail:-len(widget_export.MAGIC)])[0]
    return zipfile.ZipFile(io.BytesIO(content[-tail-length:-tail]))

def test_widget_captures_unsaved_settings_and_all_assets_without_mutating_library(widget_card):
    folder,original=widget_card
    settings={'layer_order':[1,2],'hidden_layers':[2],'layer_motion':{'1':False,'2':True},'layer_gap':.075,'frame_theme':'custom','custom_frame_color':'#aabbcc','custom_background_style':'image','custom_background_image':'background-0123456789abcdef.png','support_layers':False}
    settings['layer_z']={'1':.15,'2':.85}
    with TestClient(api.app) as client:
        before=client.get('/api/cards/fixture').json()
        response=client.post('/api/cards/fixture/widget',json={'settings':settings,'revision':123,'theme':'dark','auto_rotate':True,'zoom':1.2})
        assert response.status_code==200
        assert response.headers['content-type']=='application/vnd.microsoft.portable-executable'
        with unpack(response.content) as archive:
            snapshot=json.loads(archive.read('snapshot.json'))
            assert snapshot['card']['settings']=={**before['settings'],**settings}
            assert snapshot['theme']=='dark' and snapshot['autoRotate'] is True and snapshot['zoom']==1.2
            for name in ['main.cjs','preload.cjs','options.cjs','web/index.html','assets/fixture/layer-2-smooth.png','assets/fixture/layer-2-contours.json','assets/fixture/background-0123456789abcdef.png']:
                assert name in archive.namelist()
            assert archive.read('assets/fixture/source.png')==(folder/'source.png').read_bytes()
        assert client.get('/api/cards/fixture').json()==before
        assert not list(widget_export.EXPORTS.glob('*.exe'))
        assert widget_export.download_name('A / 카드')=='A _ 카드-widget.exe'

def test_widget_keeps_original_psd_order_and_rejects_invalid_settings_or_stale_image(widget_card):
    with TestClient(api.app) as client:
        body={'settings':{},'revision':123}
        response=client.post('/api/cards/fixture/widget',json=body)
        with unpack(response.content) as archive:
            assert json.loads(archive.read('snapshot.json'))['card']['settings']['layer_order']==[2,1]
        for changes in [{'revision':122},{'settings':{'layer_order':[1,1]}},{'settings':{'hidden_layers':[55]}},{'settings':{'layer_motion':{'55':True}}},{'settings':{'custom_background_image':'../source.png'}},{'theme':'invalid'},{'zoom':4}]:
            response=client.post('/api/cards/fixture/widget',json={**body,**changes});assert response.status_code in [409,422]

def test_widget_packaging_rejects_external_asset_path(widget_card):
    folder,card=widget_card;bad=copy.deepcopy(card);bad['layers'][0]['file']='../source.png'
    with pytest.raises(ValueError):widget_export.snapshot_payload(folder,bad,{},'light',False,1)
