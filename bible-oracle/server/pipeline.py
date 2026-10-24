"""六階段流程：安全閘 → 檢索 → rerank → 取字 → 補刀 → 驗證，每層失敗都降級。"""
from __future__ import annotations

import time
from dataclasses import dataclass
from typing import List, Tuple

from server.cache import Cache
from server.corpus import Corpus, Verse
from server.llm import LLMError
from server.quip import QuipError, generate_quip
from server.rerank import RerankError, rerank
from server.retrieve import Retriever
from server.safety import CARE_MESSAGE, is_crisis
from server.textutil import fnv1a, normalize

DEFAULT_WRAPPER = '主已經回答了，是你還沒讀懂。'


@dataclass
class Answer:
    kind: str
    ref: str
    verse_id: str
    text: str
    quip: str
    stage: str
    pool_size: int
    latency_ms: int


class Pipeline:
    def __init__(self, corpus: Corpus, retriever: Retriever, llm, examples, wrappers: List[str], cache: Cache, k: int = 20, rerank_fn=None, cache_ns: str = ''):
        self.corpus = corpus
        self.retriever = retriever
        self.llm = llm
        self.examples = examples
        self.wrappers = wrappers
        self.cache = cache
        self.k = k
        self.rerank_fn = rerank_fn or rerank
        # 快取命名空間：rerank 設定或語料版本改變時換一個，舊快取就不會被誤用。空字串 = 舊格式的 key。
        self._ns = f'{cache_ns}:' if cache_ns else ''

    def rank(self, question: str) -> Tuple[List[str], bool]:
        """候選經文 id，rerank 選中者排第一，其餘維持檢索順序。回傳 (排序, rerank 是否成功)。"""
        key = f'rank:{self._ns}{normalize(question)}'
        cached = self.cache.get(key)
        if cached:
            return cached['order'], True

        hits = self.retriever.search(question, self.k)
        order = [hit.verse.id for hit in hits]
        if self.llm is None:
            return order, False
        try:
            chosen = self.rerank_fn(self.llm, question, hits)
        except (LLMError, RerankError):
            return order, False
        order = [order[chosen]] + order[:chosen] + order[chosen + 1:]
        self.cache.set(key, {'order': order})
        return order, True

    def _quip(self, question: str, verse: Verse) -> Tuple[str, bool]:
        key = f'quip:{self._ns}{normalize(question)}:{verse.id}'
        cached = self.cache.get(key)
        if cached:
            return cached, True
        if self.llm is not None:
            try:
                quip = generate_quip(self.llm, question, verse, self.examples)
                self.cache.set(key, quip)
                return quip, True
            except (LLMError, QuipError):
                pass
        pool = self.wrappers or [DEFAULT_WRAPPER]
        return pool[fnv1a(normalize(question)) % len(pool)], False

    def ask(self, question: str, n: int = 0) -> Answer:
        started = time.perf_counter()

        def elapsed() -> int:
            return int((time.perf_counter() - started) * 1000)

        if is_crisis(question):
            return Answer('crisis', '', '', CARE_MESSAGE, '', 'safety', 0, elapsed())

        order, rerank_ok = self.rank(question)
        verse = self.corpus.get(order[n % len(order)])
        quip, quip_ok = self._quip(question, verse)
        stage = f"{'rerank' if rerank_ok else 'top1'}+{'llm' if quip_ok else 'template'}"
        return Answer('oracle', verse.ref, verse.id, verse.text, quip, stage, len(order), elapsed())
