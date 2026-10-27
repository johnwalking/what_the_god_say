from __future__ import annotations

import os

import numpy as np
import pytest

from server.corpus import DEFAULT_PATH, Corpus, Verse, load_corpus
from server.filters import eligible_mask, is_wide_eligible

needs_corpus = pytest.mark.skipif(not os.path.exists(DEFAULT_PATH), reason='data/corpus.json 不存在')


def test_ordinary_verse_is_eligible():
    assert is_wide_eligible('義人顧惜他牲畜的命．惡人的憐憫、也是殘忍。')


@pytest.mark.parametrize('text', [
    '那地的主希未人、哈抹的兒子示劍、看見他、就拉住他、與他行淫、玷辱他。',  # 性暴力
    '不可與男人苟合、像與女人一樣、這本是可憎惡的。',  # 性
    '抓住那人的下體．若有二人爭鬥、這人的妻近前來、要救他丈夫。',  # 生殖器
    '他們便與他交合、終夜凌辱他、直到天色快亮纔放他去。',
    '擊殺了摩押人約有一萬、都是強壯的勇士、沒有一人逃脫。',  # 殺戮
    '身子仆倒、肚腹崩裂、腸子都流出來、成了可怕的事。',  # 血腥
    '他的嬰孩在各市口上也被摔死、人為他的尊貴人拈鬮。',  # 傷害嬰孩
    '他在你們中間喫自己兒女的肉、這是何等可怕的光景呢。',
    '我不想活了、想結束自己的生命、不如死了算了吧。',  # 自傷（重用 is_crisis）
    '亞當生塞特、塞特生以挪士、以挪士生該南、',  # 族譜
    '烏鴉與其類．',  # 過短
    '甲' * 91,  # 過長
])
def test_sensitive_text_is_excluded(text):
    assert not is_wide_eligible(text)


def test_length_boundaries_use_punctuation_stripped_length():
    assert is_wide_eligible('甲、' * 45)  # 去標點後 45 字，含標點共 90
    assert is_wide_eligible('甲' * 90)
    assert not is_wide_eligible('甲' * 91)
    assert is_wide_eligible('甲' * 8)
    assert not is_wide_eligible('甲' * 7)
    assert not is_wide_eligible('甲、乙、丙、丁、戊、己、庚')  # 去標點後 7 字


def test_single_genealogy_marker_is_allowed():
    assert is_wide_eligible('他的兒子在曠野裡尋見了平安與喜樂的地方。')
    assert not is_wide_eligible('他的兒子是甲、甲的兒子是乙、乙的兒子是丙。')


def test_son_of_god_and_only_begotten_are_not_genealogy():
    assert is_wide_eligible('人有了神的兒子就有生命．沒有神的兒子就沒有生命。')
    assert is_wide_eligible('神說、你帶著你的兒子、就是你獨生的兒子、你所愛的以撒、往那山上去。')


def test_eligible_mask_matches_per_verse_function():
    corpus = Corpus([Verse('a', 'a', '義人顧惜他牲畜的命．惡人的憐憫、也是殘忍。'), Verse('b', 'b', '烏鴉與其類．')])
    mask = eligible_mask(corpus)
    assert mask.dtype == bool and mask.shape == (2,)
    assert mask.tolist() == [True, False]


@needs_corpus
def test_real_corpus_known_verses():
    corpus = load_corpus()
    ok = {'Prov12v10', 'Matt8v20', 'John3v16', 'Ps23v1'}
    bad = {'Gen34v2', 'Deut25v11', 'Lev18v22', 'Deut14v14', 'Judg19v25', '1Chron1v1'}
    for vid in ok:
        assert is_wide_eligible(corpus.get(vid).text), vid
    for vid in bad:
        assert not is_wide_eligible(corpus.get(vid).text), vid
    rate = 1 - eligible_mask(corpus).mean()
    assert 0.05 <= rate <= 0.35
