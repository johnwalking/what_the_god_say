#!/usr/bin/env python3
"""把 data/corpus.json 全部經文編成 bge-m3 向量，輸出 data/index.npy（約 127MB，不進 git）。"""
from __future__ import annotations

import os
import sys
import time

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))

from server.corpus import load_corpus  # noqa: E402
from server.embedder import BgeM3Embedder  # noqa: E402
from server.retrieve import DEFAULT_INDEX_PATH  # noqa: E402

CHUNK = 512


def main():
    corpus = load_corpus()
    texts = [verse.text for verse in corpus.verses]
    embedder = BgeM3Embedder()
    parts = []
    start = time.time()
    for i in range(0, len(texts), CHUNK):
        parts.append(embedder.encode(texts[i:i + CHUNK]))
        done = min(i + CHUNK, len(texts))
        print(f'{done}/{len(texts)}  {time.time() - start:.0f}s', flush=True)
    matrix = np.vstack(parts)
    np.save(DEFAULT_INDEX_PATH, matrix)
    print(f'寫入 {matrix.shape} 到 {os.path.relpath(DEFAULT_INDEX_PATH)}')


if __name__ == '__main__':
    main()
