import importlib
import io
import json
import time
import zipfile
import numpy as np
import pytest
from PIL import Image
from psd_tools import PSDImage
from psd_tools.api.layers import PixelLayer, Group
from fastapi.testclient import TestClient
from backend.presentation import normalize_card
from backend.psd_import import import_psd

api = importlib.import_module('backend.app')


def fixture_psd(path):
    psd = PSDImage.new('RGB', (128, 128))
    PixelLayer.frompil(Image.new('RGBA', (100,100), '#cc4422'), psd, 'Face at bottom', top=10, left=10)
    group = Group.new(psd, 'Nested group')
    PixelLayer.frompil(Image.new('RGBA', (50,60), '#44cc22'), group, 'Hair below sleeve', top=20, left=25)
    upper = PixelLayer.frompil(Image.new('RGBA', (60,30), '#2244cc'), group, 'Sleeve at top', top=40, left=30)
    upper.opacity = 128
    hidden = PixelLayer.frompil(Image.new('RGBA', (20,20), '#ffffff'), psd, 'Hidden accessory', top=5, left=5)
    hidden.visible = False
    psd.save(path)
    return PSDImage.open(path)


def test_psd_keeps_exact_stack_including_hidden_and_nested_layers(tmp_path):
    path=tmp_path/'layers.psd'
    psd=fixture_psd(path)
    metadata=import_psd(path,'psd-test','PSD test',tmp_path/'cards')
    assert [l['name'] for l in metadata['layers']] == ['Face at bottom','Hair below sleeve','Sleeve at top','Hidden accessory']
    assert metadata['settings']['layer_order'] == [4,3,2,1]  # Hair must NOT be promoted.
    assert metadata['settings']['hidden_layers'] == [4]
    assert metadata['layers'][1]['group_path'] == ['Nested group']
    folder=tmp_path/'cards/psd-test'
    hidden=np.asarray(Image.open(folder/'layer-4.png'))
    assert hidden[8,8,3] == 255  # Hidden layers remain available to turn on.
    sleeve=np.asarray(Image.open(folder/'layer-3.png'))
    assert abs(int(sleeve[45,35,3])-128)<=1
    assert sleeve[5,5,3] == 0
    merged=Image.new('RGBA',(128,128))
    for layer in metadata['layers']:
        if layer['visible']:
            merged=Image.alpha_composite(merged,Image.open(folder/layer['file']))
    expected=np.asarray(psd.composite(ignore_preview=True).convert('RGBA'))
    actual=np.asarray(merged)
    assert np.max(np.abs(actual[:,:,3].astype(int)-expected[:,:,3].astype(int))) <= 1
    visible=expected[:,:,3]>0
    assert np.max(np.abs(actual[visible].astype(int)-expected[visible].astype(int))) <= 2
    assert (folder/'original.psd').read_bytes() == path.read_bytes()


def test_psd_effect_group_opacity_and_order(tmp_path):
    psd=PSDImage.new('RGB',(64,64))
    PixelLayer.frompil(Image.new('RGBA',(64,64),'red'),psd,'Bottom')
    group=Group.new(psd,'Translucent group');group.opacity=128
    PixelLayer.frompil(Image.new('RGBA',(32,32),'blue'),group,'Group child',top=8,left=8)
    PixelLayer.frompil(Image.new('RGBA',(8,8),'green'),psd,'Top',top=12,left=12)
    path=tmp_path/'group.psd';psd.save(path)
    metadata=import_psd(path,'group-test','Group',tmp_path/'cards')
    assert [l['name'] for l in metadata['layers']] == ['Bottom','Translucent group','Top']
    assert metadata['settings']['layer_order']==[3,2,1]
    rgba=np.asarray(Image.open(tmp_path/'cards/group-test/layer-2.png'))
    assert abs(int(rgba[9,9,3])-128)<=1


def test_raster_keeps_original_order_without_hair_priority():
    card=normalize_card({'layers':[{'id':1,'name':'뒷머리','depth':.1},{'id':2,'name':'소매','depth':.9},{'id':3,'name':'얼굴','depth':.5},{'id':4,'name':'앞머리','depth':.7}]})
    assert card['settings']['layer_order']==[4,3,2,1]
    assert card['settings']['layer_motion']=={'1':False,'2':False,'3':False,'4':False}
    assert card['settings']['breathing'] is False
    assert card['settings']['layer_gap'] == .025
    reordered=normalize_card({'layers':[{'id':1,'name':'Hair'},{'id':2,'name':'Face'},{'id':3,'name':'Sleeve'}]})
    assert reordered['settings']['layer_order']==[3,2,1]


def test_edge_fairing_reduces_jagged_cuts_and_keeps_thin_details():
    from backend.edges import smooth_cutout
    labels=np.ones((100,100),np.uint8)*2
    for y in range(100):labels[y,:40+(2 if y%2 else -2)]=1
    alpha=np.full((100,100),255,np.uint8)
    rgb=np.zeros((100,100,3),np.uint8);rgb[:]=[22,45,76]
    cleaned=smooth_cutout(rgb,alpha,labels,1)
    before=np.sum(labels==1,axis=1)[10:-10]
    after=np.sum(cleaned[:,:,3]/255,axis=1)[10:-10]
    assert after.std()<before.std()*.25
    assert ((cleaned[:,:,3]>0)&(cleaned[:,:,3]<255)).any()
    assert np.all(cleaned[:,:,:3][cleaned[:,:,3]>0]==[22,45,76])
    strands=np.zeros((100,100),np.uint8);strands[10:90,50]=1
    result=smooth_cutout(rgb,alpha,strands,1)
    assert np.all(result[12:88,50,3]>=180)


def test_edge_padding_preserves_canvas_cut_and_transparent_rgb_bleed():
    from backend.edges import smooth_cutout
    labels=np.ones((64,64),np.uint8);labels[:,32:]=0
    alpha=np.where(labels>0,255,0).astype(np.uint8)
    rgb=np.full((64,64,3),255,np.uint8);rgb[:,:32]=[12,22,32]
    cleaned=smooth_cutout(rgb,alpha,labels,1)
    assert cleaned[-1,10,3]==255
    assert not cleaned[:,32:,3].any()
    assert np.all(cleaned[:,:31,:3]==[12,22,32])
    assert np.all(cleaned[:,32:,:3]==[12,22,32])


def test_psd_upload_bypasses_ai_and_settings_rename_persist(tmp_path,monkeypatch):
    cards=tmp_path/'cards';cards.mkdir();staging=tmp_path/'staging';staging.mkdir()
    monkeypatch.setattr(api,'CARDS',cards);monkeypatch.setattr(api,'STAGING',staging)
    def forbidden(*args,**kwargs):
        raise AssertionError('PSD must never run segmentation')
    monkeypatch.setattr(api,'process_in_worker',forbidden)
    path=tmp_path/'test.psd';fixture_psd(path)
    with TestClient(api.app) as client:
        response=client.post('/api/upload',files={'file':('test.psd',path.read_bytes(),'image/vnd.adobe.photoshop')})
        assert response.status_code==202
        job=response.json()
        for _ in range(100):
            job=client.get('/api/jobs/'+job['id']).json()
            if job['status'] in ['completed','failed']:break
            time.sleep(.03)
        assert job['status']=='completed',job
        url='/api/cards/'+job['card_id']
        card=client.get(url).json()
        assert card['segmentation']=='psd' and card['settings']['layer_order']==[4,3,2,1]
        response=client.patch(url+'/settings',json={'layer_gap':.035,'angle_limit':58,'layer_order':[2,4,3,1],'hidden_layers':[1],'layer_motion':{'2':False}})
        assert response.status_code==200
        assert client.patch(url,json={'title':' 이름 변경 '}).json()['title']=='이름 변경'
        saved=client.get(url).json()
        assert saved['settings']['layer_order']==[2,4,3,1]
        assert saved['settings']['layer_gap']==.035 and saved['settings']['angle_limit']==58
        assert saved['settings']['hidden_layers']==[1]
        assert not saved['settings']['layer_motion']['2']
        assert client.patch(url+'/settings',json={'layer_order':[1,1,2,3]}).status_code==422
        assert client.patch(url+'/settings',json={'angle_limit':100}).status_code==422
        # Custom appearance and local background files survive settings reload/export.
        background=io.BytesIO();Image.new('RGB',(1900,1200),'#234567').save(background,format='PNG')
        result=client.post(url+'/background',files={'file':('background.png',background.getvalue(),'image/png')})
        assert result.status_code==200
        filename=result.json()['file']
        assert Image.open(cards/job['card_id']/filename).size==(1600,1011)
        custom={'frame_theme':'custom','custom_frame_color':'#abc123','custom_background_color':'#123456','custom_background_secondary':'#fedcba','custom_background_style':'image','custom_background_image':filename}
        assert client.patch(url+'/settings',json=custom).status_code==200
        assert all(client.get(url).json()['settings'][k]==v for k,v in custom.items())
        for invalid in [{'frame_theme':'invalid'},{'custom_frame_color':'javascript:x'},{'custom_background_style':'invalid'},{'custom_background_image':'../source.png'},{'custom_background_image':'background-0000000000000000.png'}]:
            assert client.patch(url+'/settings',json=invalid).status_code==422
        assert client.post(url+'/background',files={'file':('bad.png',b'not an image','image/png')}).status_code==422
        assert client.patch(url,json={'title':'  '}).status_code==422
        assert client.post(url+'/masks',json={'alpha':'x','labels':'x','revision':card['updated_at']}).status_code==422
        with zipfile.ZipFile(io.BytesIO(client.get(url+'/export').content)) as archive:
            assert archive.read('original.psd')==path.read_bytes()
            assert filename in archive.namelist()
