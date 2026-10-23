"""安全閘：自傷相關輸入不走諷刺流程。用規則比對，確保確定性、不依賴 LLM。"""
from __future__ import annotations

import re

from server.textutil import normalize

CARE_MESSAGE = (
    '聽起來你現在很辛苦。這個網站只是在開玩笑，請不要把它當成答案。'
    '如果你有傷害自己的念頭，請現在撥打 1925（24 小時安心專線）或 1995（生命線）；'
    '若有立即的危險，請撥 119。你不需要一個人撐著。'
)

_PATTERNS = [
    '想死(?!你)', '不想活', '自殺', '輕生', '尋死', '去死', '結束生命', '結束自己', '了結自己',
    '活不下去', '不想存在', '想消失', '割腕', '跳樓', '上吊', '燒炭', '吞藥',
    '死了算了', '死掉算了', '活著沒意思', '活著好累',
]
_CRISIS = re.compile('|'.join(_PATTERNS))


def is_crisis(text: str) -> bool:
    return _CRISIS.search(normalize(text)) is not None
