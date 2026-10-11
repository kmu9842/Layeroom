import base64
import importlib
import io
import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image
from backend.pipeline import save_artifacts
from backend.presentation import normalize_card

api = importlib.import_module('backend.app')


def png(array):
    stream = io.BytesIO()
    Image.fromarray(array).save(stream, format='PNG')
    return 'data:image/png;base64,' + base64.b64encode(stream.getvalue()).decode()


@pytest.fixture
def raster(tmp_path, monkeypatch):
    cards = tmp_path / 'cards'
    monkeypatch.setattr(api, 'CARDS', cards)
    alpha = np.full((32, 32), 255, np.uint8)
    labels = np.ones((32, 32), np.uint8)
    labels[:, 16:] = 2
    regions = [{'name':'Base', 'color':'#335577', 'depth':.2},
               {'name':'Front', 'color':'#ffcc55', 'depth':.8}]
    meta = {'id':'edit-test', 'title':'Edit', 'segmentation':'semantic',
            'settings':{'layer_order':[1, 2]}}
    save_artifacts(cards/'edit-test', np.full((32,32,3),120,np.uint8), alpha,
                   np.full((32,32),.5), labels, regions, meta)
    with TestClient(api.app) as client:
        yield client, '/api/cards/edit-test', alpha, labels, cards/'edit-test'


def test_add_paint_save_reopen_empty_layer_and_revision(raster):
    client, url, alpha, labels, folder = raster
    card = client.get(url).json()
    labels[8:16, 8:16] = 3
    body = {'revision':card['updated_at'], 'alpha':png(alpha), 'labels':png(labels),
            'added_regions':[{'name':' Detail ', 'color':'#45b6c4'},
                             {'name':'Empty', 'color':'#9955aa'}], 'depths':{'3':.7}}
    response = client.post(url+'/masks', json=body)
    assert response.status_code == 200, response.text
    card = response.json()
    assert card['settings']['layer_order'] == [4, 3, 1, 2]
    assert card['layers'][2]['name'] == 'Detail'
    assert card['layers'][2]['depth'] == .7
    assert card['layers'][2]['pixels'] == 64
    assert card['layers'][3]['pixels'] == 0
    assert card['settings']['layer_motion']['3'] is False
    assert client.post(url+'/masks', json=body).status_code == 409
    assert client.get(url).json() == card
    assert np.array_equal(np.asarray(Image.open(folder/'labels.png')), labels)
    assert sum(np.asarray(Image.open(folder/l['file']))[:,:,3].astype(int) for l in card['layers']).tolist() == alpha.tolist()
    # Paint into the empty layer after reopening; no second addition is needed.
    labels[20:24,20:24] = 4
    body.update(revision=card['updated_at'], labels=png(labels), added_regions=[])
    response = client.post(url+'/masks', json=body)
    assert response.status_code == 200
    assert response.json()['layers'][3]['pixels'] == 16
    assert response.json()['settings']['layer_order'] == [4,3,1,2]


@pytest.mark.parametrize('changes', [
    {'added_regions':[{'name':' ', 'color':'#445566'}]},
    {'added_regions':[{'name':'Bad', 'color':'red'}]},
    {'added_regions':[{'name':'Bad', 'color':'#445566', 'depth':1.1}]},
    {'added_regions':[{'name':'Overflow', 'color':'#445566'}]*254},
    {'depths':{'3':.7}}, {'depths':{'1':float('inf')}},
])
def test_invalid_layers_cannot_change_saved_artwork(raster, changes):
    client,url,alpha,labels,folder = raster
    card = client.get(url).json()
    before = (folder/'manifest.json').read_bytes()
    body = {'revision':card['updated_at'], 'alpha':png(alpha), 'labels':png(labels), **changes}
    # Infinity is supplied as JSON text to exercise the API's finite range check.
    import json
    response = client.post(url+'/masks', content=json.dumps(body), headers={'Content-Type':'application/json'})
    assert response.status_code == 422
    assert (folder/'manifest.json').read_bytes() == before


def test_unregistered_label_is_rejected(raster):
    client,url,alpha,labels,_ = raster
    labels[10,10] = 3
    result = client.post(url+'/masks', json={'revision':client.get(url).json()['updated_at'],
                                          'alpha':png(alpha),'labels':png(labels)})
    assert result.status_code == 422


def test_gap_limits_step_defaults_and_legacy_migration(raster):
    client,url,*_ = raster
    card = client.get(url).json()
    assert card['settings']['layer_gap'] == .025
    assert card['settings']['breathing'] is False
    for gap in [0, .005, .025, .035, .1]:
        result = client.patch(url+'/settings', json={'layer_gap':gap})
        assert result.status_code == 200
        assert result.json()['settings']['layer_gap'] == gap
    for gap in [-.005, .105, .45, .026]:
        assert client.patch(url+'/settings', json={'layer_gap':gap}).status_code == 422
    card['settings'].update(layer_gap=.45, physics=True)
    settings = normalize_card(card)['settings']
    assert settings['layer_gap'] == .1 and 'physics' not in settings


def test_layer_z_save_reopen_order_reset_and_validation(raster):
    client,url,*_ = raster
    assert client.get(url).json()['settings']['layer_z'] == {}
    result = client.patch(url+'/settings',json={'layer_z':{'1':.8,'2':.2}})
    assert result.status_code == 200
    settings = result.json()['settings']
    assert settings['layer_order'] == [2,1]
    assert settings['layer_z'] == {'1':.8,'2':.2}
    assert client.get(url).json()['settings'] == settings
    partial = client.patch(url+'/settings',json={'layer_z':{'1':.6}}).json()['settings']
    assert partial['layer_z'] == {'1':.6,'2':.2}
    settings = partial
    # Global spacing scales the cavity; relative positions stay unchanged.
    assert client.patch(url+'/settings',json={'layer_gap':0}).json()['settings']['layer_z'] == settings['layer_z']
    assert client.patch(url+'/settings',json={'layer_gap':.1}).json()['settings']['layer_z'] == settings['layer_z']
    for invalid in [{'1':-.1},{'1':1.1},{'99':.5},{'1':'bad'}]:
        assert client.patch(url+'/settings',json={'layer_z':invalid}).status_code == 422
    before = client.get(url).json()['settings']
    assert before['layer_z'] == settings['layer_z']
    cleared = client.patch(url+'/settings',json={'layer_z':{}}).json()['settings']
    assert cleared['layer_z'] == {} and cleared['layer_order'] == [2,1]
    reset = client.patch(url+'/settings',json={'layer_z':{},'layer_order':[1,2]}).json()['settings']
    assert reset['layer_order'] == [1,2]


def test_sparse_depth_update_freezes_other_positions_before_sorting():
    card = {'layers':[{'id':i,'name':str(i)} for i in range(1,5)],
            'settings':{'layer_order':[4,3,2,1], 'layer_z':{'4':.9,'99':.2}}}
    settings = normalize_card(card)['settings']
    assert settings['layer_order'] == [3,2,4,1]
    assert settings['layer_z'] == {'4':.9,'3':1/3,'2':2/3,'1':1}
    assert normalize_card(card)['settings'] == settings
