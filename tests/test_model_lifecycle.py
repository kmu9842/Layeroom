import gc
from functools import lru_cache
import weakref
import pytest
from backend import pipeline, semantic
from backend.app import app
from fastapi.testclient import TestClient

@pytest.mark.parametrize('failure',[False,True])
def test_every_model_is_released_after_each_success_or_failure(monkeypatch,failure):
    references=[]
    class Model: pass
    def factory():
        model=Model();references.append(weakref.ref(model));return model
    caches=[lru_cache(maxsize=1)(factory) for _ in range(3)]
    monkeypatch.setattr(pipeline,'alpha_model',caches[0])
    monkeypatch.setattr(pipeline,'depth_model',caches[1])
    monkeypatch.setattr(semantic,'get_model',caches[2])
    def process(*args):
        for model in caches: model()
        assert all(c.cache_info().currsize==1 for c in caches)
        if failure: raise RuntimeError('inference failed')
        return {'done':True}
    monkeypatch.setattr(pipeline,'_process_image',process)
    for _ in range(2):
        if failure:
            with pytest.raises(RuntimeError,match='inference failed'): pipeline.process_image(None,'test','test')
        else:
            assert pipeline.process_image(None,'test','test')=={'done':True}
        assert all(c.cache_info().currsize==0 for c in caches)
        gc.collect()
        assert all(ref() is None for ref in references)
    assert len(references)==6, 'The next job must load fresh models'

def test_research_is_unavailable_in_distribution(monkeypatch):
    monkeypatch.setenv('LAYEROOM_PORTABLE','1')
    assert TestClient(app).get('/api/research').status_code==404
