from __future__ import annotations

import json

import httpx
import pytest

from server.llm import LLMError, OllamaLLM


def _llm(handler):
    return OllamaLLM(model='m', host='http://x', client=httpx.Client(transport=httpx.MockTransport(handler)))


def test_generate_json_parses_message_content():
    seen = {}

    def handler(request):
        seen.update(json.loads(request.content))
        return httpx.Response(200, json={'message': {'content': '{"choice": 3}'}})

    out = _llm(handler).generate_json('sys', 'usr', {'type': 'object'}, temperature=0.1)
    assert out == {'choice': 3}
    assert seen['model'] == 'm' and seen['stream'] is False and seen['think'] is False
    assert seen['format'] == {'type': 'object'}
    assert seen['options']['temperature'] == 0.1
    assert seen['keep_alive'] == '30m'


def test_http_error_becomes_llm_error():
    with pytest.raises(LLMError):
        _llm(lambda r: httpx.Response(500)).generate_json('s', 'u', {})


def test_non_json_content_becomes_llm_error():
    with pytest.raises(LLMError):
        _llm(lambda r: httpx.Response(200, json={'message': {'content': 'not json'}})).generate_json('s', 'u', {})


def test_connection_failure_becomes_llm_error():
    def handler(request):
        raise httpx.ConnectError('down')

    with pytest.raises(LLMError):
        _llm(handler).generate_json('s', 'u', {})


@pytest.mark.parametrize('body', [
    {},
    {'message': {}},
    {'message': {'content': None}},
    {'message': {'content': '[1]'}},
    {'message': {'content': '3'}},
    {'message': {'content': 'null'}},
    {'message': 'oops'},
    {'message': None},
    [1, 2],
    'str',
])
def test_malformed_bodies_become_llm_error(body):
    with pytest.raises(LLMError):
        _llm(lambda r: httpx.Response(200, json=body)).generate_json('s', 'u', {})


def test_timeout_becomes_llm_error():
    def handler(request):
        raise httpx.ReadTimeout('slow')

    with pytest.raises(LLMError):
        _llm(handler).generate_json('s', 'u', {})
