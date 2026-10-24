"""前後端安全閘與 normalize 必須一致：對同一批輸入，Python 與 JS 的結論要相同。"""
from __future__ import annotations

import json
import shutil
import subprocess

import pytest

from eval.pools import load_dataset
from server.safety import is_crisis
from server.test_safety import I1_NEGATIVE, I1_POSITIVE
from server.textutil import normalize

pytestmark = pytest.mark.skipif(shutil.which('node') is None, reason='需要 node')

_POSITIVE = [
    '我不想活了', '每天都想死', '我想自殺', '活著好累，想結束生命', '想從樓上跳樓', '我真的活不下去了',
]
_NEGATIVE = ['我老闆很機車', '加班累死了', '今天笑死我了', '我想離職', '跟老婆吵架', '好想死你喔']


def _node(script, payload):
    out = subprocess.run(
        ['node', '--input-type=module', '-e', script],
        input=json.dumps(payload), capture_output=True, text=True, check=True,
    ).stdout
    return json.loads(out)


def test_is_crisis_matches_frontend():
    texts = [r['q'] for r in load_dataset()] + _POSITIVE + _NEGATIVE + I1_POSITIVE + I1_NEGATIVE
    js = (
        "import { isCrisis } from './assets/match.js';"
        "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>"
        "console.log(JSON.stringify(JSON.parse(s).map(t=>isCrisis(t)))));"
    )
    assert _node(js, texts) == [is_crisis(t) for t in texts]


def test_care_message_matches_frontend():
    from server.safety import CARE_MESSAGE
    js = "import { CARE_MESSAGE } from './assets/match.js';console.log(JSON.stringify(CARE_MESSAGE));"
    assert _node(js, None) == CARE_MESSAGE


def test_normalize_matches_frontend():
    texts = ['ＡＢＣ１２３，你好！', '我 老婆，很煩！ ABC', 'Hello, World~', '「引號」『雙』（括號）(x)', '  ', '破折號—連字-號', '']
    js = (
        "import { normalize } from './assets/match.js';"
        "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>"
        "console.log(JSON.stringify(JSON.parse(s).map(t=>normalize(t)))));"
    )
    assert _node(js, texts) == [normalize(t) for t in texts]
