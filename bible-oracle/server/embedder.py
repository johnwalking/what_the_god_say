"""Embedding 後端。測試用 HashEmbedder，正式用本地 bge-m3。"""
from __future__ import annotations

import zlib
from typing import List, Optional

import numpy as np

try:  # Protocol 在 3.8+ 的 typing 內
    from typing import Protocol
except ImportError:  # pragma: no cover
    Protocol = object  # type: ignore


class Embedder(Protocol):
    def encode(self, texts: List[str]) -> np.ndarray:
        """回傳 float32、形狀 (n, d)、每列 L2 正規化的矩陣。"""


def _l2(matrix: np.ndarray) -> np.ndarray:
    norms = np.linalg.norm(matrix, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    return (matrix / norms).astype(np.float32)


class HashEmbedder:
    """字元 bigram 雜湊成固定維度。只用在測試：不用下載模型，重疊字越多越相似。"""

    def __init__(self, dim: int = 512):
        self.dim = dim

    def encode(self, texts: List[str]) -> np.ndarray:
        out = np.zeros((len(texts), self.dim), dtype=np.float32)
        for row, text in enumerate(texts):
            for i in range(len(text) - 1):
                out[row, zlib.crc32(text[i:i + 2].encode('utf-8')) % self.dim] += 1.0
        return _l2(out)


class BgeM3Embedder:
    """本地 BAAI/bge-m3（1024 維）。第一次呼叫才載入模型。"""

    MODEL = 'BAAI/bge-m3'

    def __init__(self, batch_size: int = 32):
        self.batch_size = batch_size
        self._model: Optional[object] = None

    def _load(self):
        import torch
        from sentence_transformers import SentenceTransformer

        device = 'mps' if torch.backends.mps.is_available() else 'cpu'
        self._model = SentenceTransformer(self.MODEL, device=device)
        self._model.max_seq_length = 256

    def encode(self, texts: List[str]) -> np.ndarray:
        if self._model is None:
            self._load()
        vecs = self._model.encode(
            texts,
            batch_size=self.batch_size,
            normalize_embeddings=True,
            convert_to_numpy=True,
            show_progress_bar=False,
        )
        return vecs.astype(np.float32)
