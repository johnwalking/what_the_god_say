"""測試用替身。"""
from __future__ import annotations

from typing import List


class FakeLLM:
    """依序回傳預先給定的回應；回應若是 Exception 就拋出。"""

    def __init__(self, *responses):
        self.responses: List = list(responses)
        self.calls: List = []

    def generate_json(self, system, user, schema, temperature=0.7):
        self.calls.append((system, user))
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return response
