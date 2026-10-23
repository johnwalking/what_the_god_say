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


@pytest.mark.parametrize('bad', [{'choice': 0}, {'choice': 4}, {'choice': 'x'}, {'choice': True}, {}])
def test_invalid_choice_raises(bad):
    with pytest.raises(RerankError):
        rerank(FakeLLM(bad), 'q', _hits())


def test_llm_error_propagates():
    with pytest.raises(LLMError):
        rerank(FakeLLM(LLMError('down')), 'q', _hits())
