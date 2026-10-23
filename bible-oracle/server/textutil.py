"""與前端 assets/match.js 行為一致的文字工具，讓前後端對同一問題算出同一個 key 與種子。"""
from __future__ import annotations

import re
from typing import Optional

_PUNCT = re.compile(r"[\s、。，．！？；：「」『』〔〕（）(),.!?;:'\"~～\-—]")


def normalize(text: Optional[str]) -> str:
    """全形轉半形、去標點空白、轉小寫。"""
    raw = '' if text is None else str(text)
    folded = ''.join(chr(ord(c) - 0xFEE0) if '！' <= c <= '～' else c for c in raw)
    return _PUNCT.sub('', folded).lower()


def fnv1a(text: str) -> int:
    """FNV-1a 32-bit，逐 UTF-16 code unit 計算，與 JS 的 charCodeAt 一致。"""
    h = 0x811C9DC5
    data = text.encode('utf-16-le')
    for i in range(0, len(data), 2):
        h ^= data[i] | (data[i + 1] << 8)
        h = (h * 0x01000193) & 0xFFFFFFFF
    return h
