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
