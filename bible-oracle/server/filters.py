"""全語料展開的內容過濾：規則式，擋掉不適合出現在日常問題答案裡的經文。

只作用於全語料（wide）檢索；精選庫是人工挑過的，不過濾。規則依 data/corpus.json 的實際用字
逐詞統計後訂定（過程與誤殺／漏網統計見 .superpowers/sdd/filter-task-f-report.md）。
和合本的「強暴」多指暴力而非性侵、「凌辱」「赤身露體」多指羞辱或貧困，誤殺率高，所以不列入。
"""
from __future__ import annotations

import re
from typing import Dict, List

import numpy as np

from server.safety import is_crisis
from server.textutil import normalize

# 每組一行註解；依序比對原文（含標點）。
SENSITIVE_PATTERNS: Dict[str, List[str]] = {
    # 性行為與性侵：淫、姦（含淫亂／姦淫／行淫／淫婦）、妓女娼妓、玷辱、苟合、交合、同寢／同房、男色、與某人睡／躺臥
    'sexual': ['淫', '姦', '妓女', '娼妓', '玷辱', '苟合', '交合', '同寢', '同房', '男色', '強辱', '與[他她]睡', '與他躺臥'],
    # 生殖器官與生理：下體、月經、遺精、精液、精足、割禮（含未受割禮的人）、割包皮、兩乳／乳頭、大腿（聖經中常為生殖器的委婉語）
    'anatomy': ['下體', '月經', '遺精', '精液', '精足', '割禮', '前皮', '兩乳', '乳頭', '懷乳', '大腿'],
    # 血腥殺戮與肢體傷害：殺（殺死／殺了／擊殺／殺戮／宰殺）、砍斷／砍下／砍倒、剖開、刺透、割下、剝皮、腸子流出、摔死嬰孩
    'violence': ['殺', '砍斷', '砍下', '砍倒', '剖開', '刺透', '割下', '剝皮', '腸子', '刀下', '用刀', '摔死', '摔碎'],
    # 屍體與焚燒：屍（屍首／屍身／死屍）、焚燒、火燒、燒死
    'corpse_fire': ['屍', '焚燒', '火燒', '燒死'],
    # 食人：吃（喫）自己兒女／兒子／女兒的肉
    'cannibal': ['[吃喫].{0,6}[兒女子].{0,4}肉', '[兒女子]的肉.{0,6}[吃喫]'],
}
_SENSITIVE = re.compile('|'.join(p for group in SENSITIVE_PATTERNS.values() for p in group))
# 族譜名單：「X生Y」「生了」「X的兒子是／、Y」累計 ≥ 2 次視為名單；「神的兒子」「獨生的兒子」不算（審查抽樣時發現會誤殺）
_GENEALOGY = re.compile(r'生了|(?<!獨生)的兒子(?=[是、．。])|(?<!獨)生(?=[\u4e00-\u9fff]{1,4}[、．。])(?!命|活|氣|病|日|產|養)')
MIN_LEN = 8
MAX_LEN = 90


def is_wide_eligible(text: str) -> bool:
    length = len(normalize(text))
    if length < MIN_LEN or length > MAX_LEN:
        return False
    if _SENSITIVE.search(text) or is_crisis(text):
        return False
    return len(_GENEALOGY.findall(text)) < 2


def eligible_mask(corpus) -> np.ndarray:
    return np.array([is_wide_eligible(verse.text) for verse in corpus.verses], dtype=bool)
