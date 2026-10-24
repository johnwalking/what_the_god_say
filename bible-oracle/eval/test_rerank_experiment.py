from __future__ import annotations

from eval.rerank_experiment import run_config
from server.corpus import Verse
from server.fakes import FakeLLM
from server.llm import LLMError
from server.rerank import RerankError
from server.retrieve import Hit


class _Retriever:
    def search(self, question, k=20):
        return [Hit(Verse(f'V{i}', f'書 {i}:1', f'經文{i}'), 1.0 - i / 10) for i in range(1, 4)]


DATASET = [
    {'q': 'a', 'kind': 'topic', 'topic_id': 't1'},
    {'q': 'b', 'kind': 'topic', 'topic_id': 't1'},
    {'q': 'c', 'kind': 'topic', 'topic_id': 't1'},
    {'q': 'd', 'kind': 'none', 'topic_id': None},
]
POOLS = {'t1': {'V2'}}


def test_run_config_counts_hits_and_fallbacks():
    picks = iter([1, RerankError('bad'), LLMError('down')])

    def fn(llm, question, hits):
        pick = next(picks)
        if isinstance(pick, Exception):
            raise pick
        return pick

    out = run_config('x', _Retriever(), fn, None, DATASET, POOLS)
    assert out['n'] == 3
    assert out['hit@1'] == 1 / 3  # 只有第一題選到 V2；失敗的兩題退回檢索第 1 名 V1，未命中
    assert out['fallbacks'] == 2
    assert out['hit@20'] == 1.0   # V2 在候選內
