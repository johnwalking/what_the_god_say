"""向量檢索：numpy 矩陣乘法 + 餘弦（向量已 L2 正規化，內積即餘弦）。"""
from __future__ import annotations

import os
from dataclasses import dataclass
from typing import List, Optional, Set

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
    def __init__(self, corpus: Corpus, matrix: np.ndarray, embedder: Embedder, mask: Optional[np.ndarray] = None):
        if matrix.shape[0] != len(corpus):
            raise ValueError(f'索引列數 {matrix.shape[0]} 與語料筆數 {len(corpus)} 不符')
        if mask is not None and mask.shape != (len(corpus),):
            raise ValueError(f'mask 長度 {mask.shape} 與語料筆數 {len(corpus)} 不符')
        self.mask = mask  # None = 不過濾；否則 True 的列才可能出現在結果中
        self.corpus = corpus
        self.matrix = matrix
        self.embedder = embedder

    def search(self, question: str, k: int = 20) -> List[Hit]:
        qvec = self.embedder.encode([question])[0]
        scores = self.matrix @ qvec
        if self.mask is not None:
            scores = np.where(self.mask, scores, -np.inf)
            k = min(k, int(self.mask.sum()))
        k = min(k, len(scores))
        if k <= 0:
            return []
        top = np.argpartition(-scores, k - 1)[:k]
        top = top[np.argsort(-scores[top])]
        return [Hit(self.corpus.verses[i], float(scores[i])) for i in top]


def curated_ids_from_topics(topics_file: dict) -> Set[str]:
    return {verse['id'] for topic in topics_file['topics'] for verse in topic['verses']}


class HybridRetriever(Retriever):
    """候選 = 精選庫 top-k_curated，其餘名額由全語料排名補滿。

    純全語料檢索在口語煩惱上常撈到離題的經文（評估見 README）；精選庫是人工挑過、
    本來就適合拿來回答煩惱的經文，全語料則負責長尾。
    """

    def __init__(self, corpus: Corpus, matrix: np.ndarray, embedder: Embedder,
                 curated_ids: Set[str], k_curated: int = 10):
        super().__init__(corpus, matrix, embedder)
        self.k_curated = k_curated
        self._curated_idx = np.array(
            [i for i, verse in enumerate(corpus.verses) if verse.id in curated_ids], dtype=np.int64
        )
        if len(self._curated_idx) == 0:
            raise ValueError('curated_ids 沒有任何一筆存在於語料中')

    def search(self, question: str, k: int = 20) -> List[Hit]:
        scores = self.matrix @ self.embedder.encode([question])[0]
        k = min(k, len(scores))

        curated_scores = scores[self._curated_idx]
        n_curated = min(self.k_curated, k, len(curated_scores))
        best = np.argsort(-curated_scores)[:n_curated]
        chosen = [int(self._curated_idx[i]) for i in best]
        taken = set(chosen)

        for i in np.argsort(-scores):
            if len(chosen) >= k:
                break
            if int(i) not in taken:
                chosen.append(int(i))
                taken.add(int(i))

        chosen.sort(key=lambda i: -scores[i])
        return [Hit(self.corpus.verses[i], float(scores[i])) for i in chosen]
