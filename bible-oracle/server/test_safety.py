from __future__ import annotations

import pytest

from server.safety import CARE_MESSAGE, is_crisis


@pytest.mark.parametrize('text', [
    '我不想活了', '每天都想死', '我想自殺', '活著好累，想結束生命', '想從樓上跳樓', '我真的活不下去了',
])
def test_crisis_detected(text):
    assert is_crisis(text)


@pytest.mark.parametrize('text', [
    '我老闆很機車', '加班累死了', '今天笑死我了', '我想離職', '跟老婆吵架', '好想死你喔',
])
def test_ordinary_complaints_pass(text):
    assert not is_crisis(text)


def test_care_message_has_hotline():
    assert '1925' in CARE_MESSAGE


I1_POSITIVE = [
    '不想再活', '想自我了結', '我想自我了斷', '活不了了', '想不開', '我想吃安眠藥', '我想傷害自己',
    '想割自己', '想從頂樓跳下去', '結束我的生命', '不如死了好', '活著沒有意義',
    '我想自杀', '想跳楼', '烧炭', '我想结束生命', '活着没有意义',
    'I want to kill myself', 'suicide', 'Thinking about suicidal stuff', 'KMS',
]

I1_NEGATIVE = [
    '累死了', '煩死了', '笑死我了', '氣死我了', '餓死了', '忙死了', '熱死我了', '好想死你', '想死你了',
    '跳下去游泳', '我想跳下去游泳', '老闆好煩想離職', '我想吃宵夜', '安全帽好貴', '今天好累想睡覺',
    '結束會議後去吃飯', '我的生活沒什麼意見', '殺價失敗', '想你想到睡不著',
]


@pytest.mark.parametrize('text', I1_POSITIVE)
def test_i1_crisis_detected(text):
    assert is_crisis(text)


@pytest.mark.parametrize('text', I1_NEGATIVE)
def test_i1_ordinary_complaints_pass(text):
    assert not is_crisis(text)
