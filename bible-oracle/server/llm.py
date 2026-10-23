"""Ollama 客戶端。所有失敗統一成 LLMError，讓上層只需處理一種例外。"""
from __future__ import annotations

import json
import os
from typing import Optional

import httpx


class LLMError(Exception):
    pass


class OllamaLLM:
    def __init__(self, model: Optional[str] = None, host: Optional[str] = None,
                 timeout: float = 60.0, client: Optional[httpx.Client] = None):
        self.model = model or os.environ.get('OLLAMA_MODEL', 'qwen3:4b')
        self.host = (host or os.environ.get('OLLAMA_HOST', 'http://127.0.0.1:11434')).rstrip('/')
        self._client = client or httpx.Client(timeout=timeout)

    def generate_json(self, system: str, user: str, schema: dict, temperature: float = 0.7) -> dict:
        payload = {
            'model': self.model,
            'stream': False,
            'think': False,
            'format': schema,
            'messages': [{'role': 'system', 'content': system}, {'role': 'user', 'content': user}],
            'options': {'temperature': temperature, 'num_ctx': 4096, 'num_predict': 300},
        }
        try:
            response = self._client.post(f'{self.host}/api/chat', json=payload)
            response.raise_for_status()
            return json.loads(response.json()['message']['content'])
        except (httpx.HTTPError, KeyError, ValueError) as error:
            raise LLMError(str(error)) from error
