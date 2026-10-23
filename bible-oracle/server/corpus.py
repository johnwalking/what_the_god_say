"""語料：全部 31,031 節和合本經文，依節錨點 id 查詢。"""
from __future__ import annotations

import json
import os
from dataclasses import dataclass
from typing import Dict, List

DEFAULT_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'corpus.json')


@dataclass(frozen=True)
class Verse:
    id: str
    ref: str
    text: str


class Corpus:
    def __init__(self, verses: List[Verse]):
        self.verses = verses
        self._by_id: Dict[str, Verse] = {verse.id: verse for verse in verses}

    def __len__(self) -> int:
        return len(self.verses)

    def has(self, verse_id: str) -> bool:
        return verse_id in self._by_id

    def get(self, verse_id: str) -> Verse:
        return self._by_id[verse_id]


def load_corpus(path: str = DEFAULT_PATH) -> Corpus:
    with open(path, encoding='utf-8') as handle:
        rows = json.load(handle)
    return Corpus([Verse(id=row['id'], ref=row['ref'], text=row['text']) for row in rows])
