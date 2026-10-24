from __future__ import annotations

from eval.judge import judged_keys, sample, summarize


def _results():
    def rows(quip):
        return [
            {'q': f'題{i}', 'kind': 'topic', 'pick': {'id': f'V{i}', 'ref': f'書 {i}:1', 'text': f'經{i}', 'quip': quip}}
            for i in range(10)
        ]
    return {'rows': {
        'B0 TF-IDF': rows('人工補刀人工補刀'),
        'B1 bge-m3': rows(None),
        'B1h 混合檢索': rows(None),
        'B2 某設定': rows('補刀補刀補刀補刀'),
    }}


def test_judged_keys_selects_b0_b1h_b2_by_prefix():
    assert judged_keys(_results()) == ['B0 TF-IDF', 'B1h 混合檢索', 'B2 某設定']


def test_sample_hides_method_and_is_deterministic():
    batch, key = sample(_results(), n=6, seed=0)
    assert len(batch) == 18 and len(key) == 18  # 6 題 × 3 方案
    assert all('method' not in item for item in batch)
    assert {key[item['id']]['method'] for item in batch} == {'B0 TF-IDF', 'B1h 混合檢索', 'B2 某設定'}
    assert sample(_results(), n=6, seed=0) == (batch, key)


def test_sample_uses_same_questions_for_every_method():
    _, key = sample(_results(), n=4, seed=1)
    by_method = {}
    for entry in key.values():
        by_method.setdefault(entry['method'], set()).add(entry['q'])
    assert len({frozenset(qs) for qs in by_method.values()}) == 1


def test_summarize_averages_per_method():
    key = {'a': {'method': 'M1', 'q': 'x'}, 'b': {'method': 'M1', 'q': 'y'}, 'c': {'method': 'M2', 'q': 'x'}}
    scores = [
        {'id': 'a', 'relevance': 4, 'funny': 2, 'compliant': True},
        {'id': 'b', 'relevance': 2, 'funny': 4, 'compliant': False},
        {'id': 'c', 'relevance': 5, 'funny': 5, 'compliant': True},
    ]
    out = summarize(key, scores)
    assert out['M1'] == {'n': 2, 'relevance': 3.0, 'funny': 3.0, 'compliant': 0.5}
    assert out['M2']['relevance'] == 5.0
