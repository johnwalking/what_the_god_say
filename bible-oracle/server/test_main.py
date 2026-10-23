from __future__ import annotations

import time

from fastapi.testclient import TestClient

from server.fakes import FakeLLM, make_pipeline
from server.main import create_app

GOOD = '弟兄，欠債是僕人的身分，你只是提早進入服事。'


def _client(llm=None, rate_limit=(100, 60.0)):
    llm = llm or FakeLLM({'choice': 1}, {'quip': GOOD})
    return TestClient(create_app(make_pipeline(llm), rate_limit=rate_limit))


def test_health():
    assert _client().get('/api/health').json() == {'ok': True}


def test_oracle_returns_answer_fields():
    body = _client().post('/api/oracle', json={'q': '我欠債好多', 'n': 0}).json()
    assert body['kind'] == 'oracle' and body['quip'] == GOOD
    assert set(body) == {'kind', 'ref', 'verse_id', 'text', 'quip', 'stage', 'pool_size', 'latency_ms'}


def test_crisis_is_returned_as_crisis():
    body = _client().post('/api/oracle', json={'q': '我不想活了'}).json()
    assert body['kind'] == 'crisis' and '1925' in body['text']


def test_validation_rejects_empty_and_long_questions():
    client = _client()
    assert client.post('/api/oracle', json={'q': ''}).status_code == 422
    assert client.post('/api/oracle', json={'q': 'x' * 101}).status_code == 422
    assert client.post('/api/oracle', json={'q': '好', 'n': -1}).status_code == 422


def test_control_characters_only_question_is_rejected():
    assert _client().post('/api/oracle', json={'q': '\u0000\u0007'}).status_code == 422


def test_rate_limit_returns_429():
    client = _client(FakeLLM(*([{'choice': 1}, {'quip': GOOD}] * 5)), rate_limit=(2, 60.0))
    codes = [client.post('/api/oracle', json={'q': f'我欠債{i}'}).status_code for i in range(3)]
    assert codes == [200, 200, 429]


def test_pipeline_exception_becomes_503():
    class Boom:
        def ask(self, *_):
            raise RuntimeError('index missing')

    client = TestClient(create_app(Boom()))
    assert client.post('/api/oracle', json={'q': '我欠債'}).status_code == 503


class _SpyEmbedder:
    def __init__(self, error=None):
        self.calls, self.error = [], error

    def encode(self, texts):
        self.calls.append(texts)
        if self.error:
            raise self.error


class _SpyLLM:
    def __init__(self, error=None):
        self.calls, self.error = 0, error

    def generate_json(self, system, user, schema, temperature=0.7):
        self.calls += 1
        if self.error:
            raise self.error
        return {'ok': True}


def _spy_pipeline(embedder, llm):
    from types import SimpleNamespace
    return SimpleNamespace(retriever=SimpleNamespace(embedder=embedder), llm=llm)


def test_warm_up_calls_embedder_and_llm_once():
    from server.main import warm_up
    embedder, llm = _SpyEmbedder(), _SpyLLM()
    warm_up(_spy_pipeline(embedder, llm))
    assert embedder.calls == [['暖機']] and llm.calls == 1


def test_warm_up_swallows_exceptions():
    from server.main import warm_up
    embedder, llm = _SpyEmbedder(RuntimeError('x')), _SpyLLM(RuntimeError('y'))
    warm_up(_spy_pipeline(embedder, llm))
    assert embedder.calls and llm.calls == 1


def test_warm_up_skips_missing_llm():
    from server.main import warm_up
    warm_up(_spy_pipeline(_SpyEmbedder(), None))


def test_injected_pipeline_is_not_warmed(monkeypatch):
    import server.main as main
    called = []
    monkeypatch.setattr(main, 'warm_up', lambda p: called.append(p))
    with TestClient(create_app(make_pipeline(FakeLLM()))):
        pass
    assert called == []


def test_default_pipeline_is_warmed_after_build(monkeypatch):
    import server.main as main
    built, called = object(), []
    monkeypatch.setattr(main, 'build_default_pipeline', lambda: built)
    monkeypatch.setattr(main, 'warm_up', lambda p: called.append(p))
    with TestClient(create_app()):
        pass
    assert called == [built]


def test_rate_limiter_drops_empty_keys():
    from server.main import RateLimiter
    limiter = RateLimiter(1, 0.01)
    assert limiter.allow('a')
    time.sleep(0.03)
    assert limiter.allow('b')
    assert 'a' not in limiter._hits
