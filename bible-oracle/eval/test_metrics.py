from __future__ import annotations

from eval.metrics import hit_at_k, percentile, summarize, to_markdown

POOLS = {'a': {'A1', 'A2'}, 'b': {'B1'}}


def _row(gold, ranked, **extra):
    return {'q': 'x', 'kind': 'topic', 'gold': gold, 'ranked': ranked, 'latency_ms': 10.0, **extra}


def test_hit_at_k():
    assert hit_at_k(['X', 'A1'], {'A1'}, 2)
    assert not hit_at_k(['X', 'A1'], {'A1'}, 1)


def test_percentile():
    assert percentile([1, 2, 3, 4, 5], 50) == 3
    assert percentile([1, 2, 3, 4, 5], 95) == 5


def test_summarize_hit_rates():
    rows = [_row('a', ['A1', 'X']), _row('b', ['X', 'B1']), _row('a', ['X', 'Y'])]
    s = summarize(rows, POOLS, ks=(1, 2, 5))
    assert s['n'] == 3
    assert s['hit@1'] == 1 / 3
    assert s['hit@2'] == 2 / 3
    assert s['hit@5'] is None  # 排名清單不足 5 筆，不報
    assert s['p50_ms'] == 10.0


def test_summarize_ignores_non_topic_rows_for_hits_and_reports_none_fallback():
    rows = [
        _row('a', ['A1']),
        {'q': 'n', 'kind': 'none', 'gold': None, 'ranked': ['Z'], 'latency_ms': 1.0, 'kind_out': 'fallback'},
        {'q': 'm', 'kind': 'none', 'gold': None, 'ranked': ['Z'], 'latency_ms': 1.0, 'kind_out': 'topic'},
    ]
    s = summarize(rows, POOLS, ks=(1,))
    assert s['n'] == 1 and s['hit@1'] == 1.0
    assert s['none_fallback_rate'] == 0.5


def test_summarize_verbatim_and_stages():
    rows = [_row('a', ['A1'], verbatim=True, stage='rerank+llm'), _row('a', ['A1'], verbatim=True, stage='top1+template')]
    s = summarize(rows, POOLS, ks=(1,))
    assert s['verbatim'] == 1.0
    assert s['stages'] == {'rerank+llm': 1, 'top1+template': 1}


def test_to_markdown_renders_none_as_dash():
    md = to_markdown({'B1': {'n': 2, 'hit@1': 0.5, 'hit@5': None, 'hit@20': 1.0, 'p50_ms': 12.0, 'p95_ms': 30.0}})
    assert '| B1 | 2 | 50.0% | — | 100.0% |' in md
