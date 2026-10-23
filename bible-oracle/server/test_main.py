from __future__ import annotations

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
