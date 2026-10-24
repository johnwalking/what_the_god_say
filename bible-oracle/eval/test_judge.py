from __future__ import annotations

import pytest

from eval.judge import judged_keys, sample, summarize, validate_scores


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


_KEY = {'a': {'method': 'M1', 'q': 'x'}, 'b': {'method': 'M2', 'q': 'x'}}


def _ok(i):
    return {'id': i, 'relevance': 3, 'funny': 3, 'compliant': True}


def test_validate_scores_accepts_complete_valid_scores():
    validate_scores(_KEY, [_ok('a'), _ok('b')])


def test_validate_scores_rejects_unknown_id():
    with pytest.raises(ValueError, match='zzz'):
        validate_scores(_KEY, [_ok('a'), _ok('b'), _ok('zzz')])


def test_validate_scores_rejects_duplicate_id():
    with pytest.raises(ValueError, match='a'):
        validate_scores(_KEY, [_ok('a'), _ok('a'), _ok('b')])


def test_validate_scores_rejects_missing_id():
    with pytest.raises(ValueError, match='b'):
        validate_scores(_KEY, [_ok('a')])


@pytest.mark.parametrize('field', ['relevance', 'funny'])
@pytest.mark.parametrize('bad', [0, 6, 3.5, '3', True, None])
def test_validate_scores_rejects_bad_rating(field, bad):
    row = dict(_ok('a'), **{field: bad})
    with pytest.raises(ValueError, match=field):
        validate_scores(_KEY, [row, _ok('b')])


@pytest.mark.parametrize('bad', ['false', 'true', 1, 0, None])
def test_validate_scores_rejects_non_bool_compliant(bad):
    with pytest.raises(ValueError, match='compliant'):
        validate_scores(_KEY, [dict(_ok('a'), compliant=bad), _ok('b')])


def test_summarize_validates_first():
    with pytest.raises(ValueError):
        summarize(_KEY, [_ok('a')])
