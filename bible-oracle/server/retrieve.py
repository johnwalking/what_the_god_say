"""向量檢索：numpy 矩陣乘法 + 餘弦（向量已 L2 正規化，內積即餘弦）。"""
from __future__ import annotations

import os
from dataclasses import dataclass
from typing import List

import numpy as np

from server.corpus import Corpus, Verse
from server.embedder import Embedder

DEFAULT_INDEX_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'index.npy')


@dataclass(frozen=True)
class Hit:
    verse: Verse
    score: float


def load_index(path: str = DEFAULT_INDEX_PATH) -> np.ndarray:
    return np.load(path)


class Retriever:
    def __init__(self, corpus: Corpus, matrix: np.ndarray, embedder: Embedder):
        if matrix.shape[0] != len(corpus):
            raise ValueError(f'索引列數 {matrix.shape[0]} 與語料筆數 {len(corpus)} 不符')
        self.corpus = corpus
        self.matrix = matrix
        self.embedder = embedder

    def search(self, question: str, k: int = 20) -> List[Hit]:
        qvec = self.embedder.encode([question])[0]
        scores = self.matrix @ qvec
        k = min(k, len(scores))
        top = np.argpartition(-scores, k - 1)[:k]
        top = top[np.argsort(-scores[top])]
        return [Hit(self.corpus.verses[i], float(scores[i])) for i in top]
