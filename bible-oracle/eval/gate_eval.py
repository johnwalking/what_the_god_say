#!/usr/bin/env python3
"""信心門檻的量測：精選庫最高相似度在 topic／none 題的分佈，與各門檻下的「低於門檻」比例。
只用 embedding（不呼叫 LLM）。Markdown 表格輸出到 stdout，不寫檔。用法：python eval/gate_eval.py"""
from __future__ import annotations

import os
import sys
from typing import Dict, List

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))

from eval.metrics import percentile  # noqa: E402
from eval.pools import load_dataset, load_topics  # noqa: E402

THRESHOLDS = (0.50, 0.52, 0.54, 0.56)
KINDS = (('topic', '正常煩惱題'), ('none', '日常離題題'))


def curated_top_scores(dataset: List[dict], retriever) -> Dict[str, List[float]]:
    """每題精選庫最高相似度（retriever 只含精選庫）。"""
    out: Dict[str, List[float]] = {kind: [] for kind, _ in KINDS}
    for row in dataset:
        if row['kind'] in out:
            out[row['kind']].append(retriever.search(row['q'], 1)[0].score)
    return out


def to_markdown(scores: Dict[str, List[float]], thresholds=THRESHOLDS) -> str:
    lines = [
        '| 類別 | 題數 | min | p10 | p50 | p90 | max |',
        '|---|---|---|---|---|---|---|',
    ]
    for kind, label in KINDS:
        v = scores[kind]
        lines.append(
            f'| {label}（{kind}） | {len(v)} | {min(v):.3f} | {percentile(v, 10):.3f} | '
            f'{percentile(v, 50):.3f} | {percentile(v, 90):.3f} | {max(v):.3f} |'
        )
    lines += ['', '| 門檻 | ' + ' | '.join(f'{label}低於門檻' for _, label in KINDS) + ' |', '|---|---|---|']
    for t in thresholds:
        cells = [f'{sum(s < t for s in scores[kind]) / len(scores[kind]) * 100:.1f}%' for kind, _ in KINDS]
        lines.append(f'| {t:.2f} | ' + ' | '.join(cells) + ' |')
    return '\n'.join(lines)


def main() -> None:
    from server.corpus import Corpus, load_corpus
    from server.embedder import BgeM3Embedder
    from server.retrieve import Retriever, curated_ids_from_topics, load_index

    corpus, matrix = load_corpus(), load_index()
    curated = curated_ids_from_topics(load_topics())
    idx = [i for i, v in enumerate(corpus.verses) if v.id in curated]
    retriever = Retriever(Corpus([corpus.verses[i] for i in idx]), matrix[idx], BgeM3Embedder())
    print(to_markdown(curated_top_scores(load_dataset(), retriever)))


if __name__ == '__main__':
    main()
