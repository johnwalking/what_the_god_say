from __future__ import annotations

import pytest

from server.corpus import Verse
from server.fakes import FakeLLM
from server.llm import LLMError
from server.quip import QuipError, generate_quip, load_examples, validate_quip

VERSE = Verse('Prov22v7', '箴言 22:7', '富戶管轄窮人．欠債的是債主的僕人。')
GOOD = '弟兄，欠債是僕人的身分，你只是提早進入服事。'


def test_validate_accepts_good_quip():
    assert validate_quip(GOOD)


@pytest.mark.parametrize('bad', [
    '', '太短了', 'x' * 61, '哈哈這太好笑了啦朋友', '其實這是在開玩笑的啦朋友', '弟兄，請安靜。\n另一行',
    '這是諷刺的東西啦朋友', 123, None,
])
def test_validate_rejects_bad_quip(bad):
    assert not validate_quip(bad)


@pytest.mark.parametrize('bad', [
    '弟兄，這是主的恩典啊，要感謝🙏', '弟兄，這是主的恩典啊，要感謝✨', '弟兄，這是主的恩典啊，要感謝\u2764\ufe0f',
    '弟兄，這是主的恩典啊 (^_^)', '弟兄，這是主的恩典啊（T_T）', '弟兄，這是主的恩典啊 ^_^', '弟兄，這是主的恩典啊 T_T',
    '弟兄，這是主的恩典啊 QQ', '弟兄，這是主的恩典啊 Xd', '弟兄，這是主的恩典啊 xD', '弟兄，這是主的恩典啊 xd',
    '弟兄，這是主的恩典啊。你要多禱告。再多順服。', '弟兄，這是主的恩典啊。你要多禱告！再多順服',
])
def test_validate_rejects_emoji_kaomoji_banned_case_and_too_many_sentences(bad):
    assert not validate_quip(bad)


@pytest.mark.parametrize('good', [
    '弟兄，欠債是僕人的身分。你只是提早進入服事。',
    '弟兄，欠債是僕人的身分，你只是提早進入服事（約翰福音）。',
    '弟兄，欠債、受苦都是主的安排，你只是提早進入服事。',
    '弟兄，欠債是僕人的身分！你只是提早進入服事？',
])
def test_validate_accepts_two_sentences_and_cjk_parenthetical(good):
    assert validate_quip(good)


def test_generate_non_dict_result_counts_as_invalid_attempt():
    llm = FakeLLM(['not a dict'], {'quip': GOOD})
    assert generate_quip(llm, '我欠債', VERSE, []) == GOOD
    with pytest.raises(QuipError):
        generate_quip(FakeLLM(None, ['x']), '我欠債', VERSE, [])


def test_load_examples_spreads_across_topics():
    topics_file = {'topics': [
        {'verses': [{'text': f't{i}', 'quip': f'q{i}'}]} for i in range(10)
    ]}
    examples = load_examples(topics_file, n=5)
    assert len(examples) == 5
    assert examples[0] == ('t0', 'q0')
    assert len({e[0] for e in examples}) == 5


def test_generate_returns_first_valid():
    assert generate_quip(FakeLLM({'quip': GOOD}), '我欠債', VERSE, [('經', '補')]) == GOOD


def test_generate_retries_once_on_invalid_output():
    llm = FakeLLM({'quip': '哈哈哈哈哈哈哈哈哈'}, {'quip': GOOD})
    assert generate_quip(llm, '我欠債', VERSE, []) == GOOD
    assert len(llm.calls) == 2


def test_generate_raises_after_all_attempts_invalid():
    with pytest.raises(QuipError):
        generate_quip(FakeLLM({'quip': 'x'}, {'quip': 'y'}), '我欠債', VERSE, [])


def test_llm_error_is_not_retried():
    llm = FakeLLM(LLMError('down'), {'quip': GOOD})
    with pytest.raises(LLMError):
        generate_quip(llm, '我欠債', VERSE, [])
    assert len(llm.calls) == 1


def test_prompt_contains_verse_question_and_examples():
    llm = FakeLLM({'quip': GOOD})
    generate_quip(llm, '我欠債', VERSE, [('範例經文', '範例補刀')])
    system, user = llm.calls[0]
    assert '範例經文' in system and '範例補刀' in system
    assert '我欠債' in user and VERSE.text in user and '箴言 22:7' in user
