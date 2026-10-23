"""測試用替身。"""
from __future__ import annotations

from typing import List

from server.cache import Cache
from server.corpus import Corpus, Verse
from server.embedder import HashEmbedder
from server.pipeline import Pipeline
from server.retrieve import Retriever


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


def small_corpus() -> Corpus:
    return Corpus([
        Verse('Eph5v22', '以弗所書 5:22', '你們作妻子的、當順服自己的丈夫、如同順服主．'),
        Verse('Prov22v7', '箴言 22:7', '富戶管轄窮人．欠債的是債主的僕人。'),
        Verse('Prov17v22', '箴言 17:22', '喜樂的心、乃是良藥．憂傷的靈、使骨枯乾。'),
        Verse('Matt6v34', '馬太福音 6:34', '所以不要為明天憂慮．因為明天自有明天的憂慮．一天的難處一天當就夠了。'),
    ])


def make_pipeline(llm, k: int = 3, cache=None) -> Pipeline:
    corpus, embedder = small_corpus(), HashEmbedder()
    matrix = embedder.encode([v.text for v in corpus.verses])
    return Pipeline(
        corpus, Retriever(corpus, matrix, embedder), llm,
        examples=[('範例經文', '範例補刀')], wrappers=['主已經回答了，是你還沒讀懂。'],
        cache=cache or Cache(), k=k,
    )
