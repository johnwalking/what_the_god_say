from __future__ import annotations

import pytest

from server.corpus import Verse
from server.fakes import FakeLLM
from server.llm import LLMError
from server.rerank import RerankError, rerank
from server.retrieve import Hit


def _hits():
    return [Hit(Verse(f'V{i}', f'書 {i}:1', f'經文{i}'), 1.0 - i / 10) for i in range(1, 4)]


def test_returns_zero_based_index():
    assert rerank(FakeLLM({'choice': 2}), '我欠債', _hits()) == 1


def test_prompt_lists_numbered_candidates_and_question():
    llm = FakeLLM({'choice': 1})
    rerank(llm, '我欠債', _hits())
    system, user = llm.calls[0]
    assert '2. 書 2:1：經文2' in user and '我欠債' in user
    assert '忽略' in system  # 防 prompt injection 的指示
    assert '我欠債' not in system


@pytest.mark.parametrize('bad', [{'choice': 0}, {'choice': 4}, {'choice': 'x'}, {'choice': True}, {}])
def test_invalid_choice_raises(bad):
    with pytest.raises(RerankError):
        rerank(FakeLLM(bad), 'q', _hits())


def test_llm_error_propagates():
    with pytest.raises(LLMError):
        rerank(FakeLLM(LLMError('down')), 'q', _hits())


def test_non_dict_result_raises_rerank_error():
    with pytest.raises(RerankError):
        rerank(FakeLLM([1]), 'q', _hits())


from server.rerank import SYSTEM, SYSTEM_TOPICAL, rerank_scores, shuffled  # noqa: E402


def test_shuffled_is_deterministic_permutation_and_does_not_mutate():
    hits = _hits()
    a = shuffled(hits, '我欠債')
    assert a == shuffled(hits, '我欠債')
    assert sorted(h.verse.id for h in a) == sorted(h.verse.id for h in hits)
    assert [h.verse.id for h in hits] == ['V1', 'V2', 'V3']


def test_shuffle_returns_index_into_original_hits():
    hits = _hits()
    order = [h.verse.id for h in shuffled(hits, 'c')]
    assert order[0] != hits[0].verse.id  # 此問題洗牌後第一個不是原本第一個，下方斷言才不空泛
    llm = FakeLLM({'choice': 1})  # 1 = 洗牌後的第一個
    idx = rerank(llm, 'c', hits, shuffle=True)
    assert hits[idx].verse.id == order[0]
    first_line = llm.calls[0][1].split('候選經文：\n')[1].splitlines()[0]
    first_verse = next(h.verse for h in hits if h.verse.id == order[0])
    assert first_line == f'1. {first_verse.ref}：{first_verse.text}'


def test_prompt_p1_uses_topical_system_prompt():
    llm = FakeLLM({'choice': 1})
    rerank(llm, 'q', _hits(), prompt='P1')
    assert llm.calls[0][0] == SYSTEM_TOPICAL and SYSTEM_TOPICAL != SYSTEM
    assert '忽略' in SYSTEM_TOPICAL


def test_unknown_prompt_name_raises_value_error():
    with pytest.raises(ValueError):
        rerank(FakeLLM({'choice': 1}), 'q', _hits(), prompt='P9')


def test_rerank_scores_picks_highest_with_ties_to_earliest():
    assert rerank_scores(FakeLLM({'scores': [1, 3, 3]}), 'q', _hits()) == 1


@pytest.mark.parametrize('bad', [{'scores': [1, 2]}, {'scores': [1, 2, 9]}, {'scores': 'x'}, {'scores': [1, 2, True]}, {}])
def test_rerank_scores_invalid_raises(bad):
    with pytest.raises(RerankError):
        rerank_scores(FakeLLM(bad), 'q', _hits())
