#!/usr/bin/env python3
"""Rerank 變體消融。只評 rerank（不生成補刀）。用法：python eval/rerank_experiment.py [config 名稱...]"""
from __future__ import annotations

import json
import os
import sys
import time
from typing import Callable, Dict, List

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))

from eval.metrics import hit_at_k, percentile  # noqa: E402
from eval.pools import HERE, load_dataset, load_topics, topic_pools  # noqa: E402
from server.llm import LLMError  # noqa: E402
from server.rerank import CONFIGS, RerankError  # noqa: E402,F401

RESULTS_PATH = os.path.join(HERE, 'rerank_results.json')


def run_config(name: str, retriever, rerank_fn: Callable, llm, dataset: List[dict], pools: Dict[str, set]) -> dict:
    rows, fallbacks, latencies, hit1, hit20 = 0, 0, [], 0, 0
    for item in dataset:
        if item['kind'] != 'topic':
            continue
        started = time.perf_counter()
        hits = retriever.search(item['q'], 20)
        try:
            chosen = rerank_fn(llm, item['q'], hits)
        except (LLMError, RerankError):
            chosen, fallbacks = 0, fallbacks + 1
        latencies.append((time.perf_counter() - started) * 1000)
        ids = [hits[chosen].verse.id] + [h.verse.id for i, h in enumerate(hits) if i != chosen]
        pool = pools[item['topic_id']]
        rows += 1
        hit1 += hit_at_k(ids, pool, 1)
        hit20 += hit_at_k(ids, pool, 20)
    return {
        'name': name, 'n': rows, 'hit@1': hit1 / rows, 'hit@20': hit20 / rows, 'fallbacks': fallbacks,
        'p50_ms': percentile(latencies, 50), 'p95_ms': percentile(latencies, 95),
    }


def main(argv: List[str]) -> None:
    from server.corpus import load_corpus
    from server.embedder import BgeM3Embedder
    from server.llm import OllamaLLM
    from server.retrieve import HybridRetriever, curated_ids_from_topics, load_index

    topics_file = load_topics()
    pools, dataset = topic_pools(topics_file), load_dataset()
    corpus, matrix, embedder = load_corpus(), load_index(), BgeM3Embedder()
    curated = curated_ids_from_topics(topics_file)
    llm = OllamaLLM()
    names = argv[1:] or list(CONFIGS)

    results = []
    for name in names:
        cfg = CONFIGS[name]
        retriever = HybridRetriever(corpus, matrix, embedder, curated, k_curated=cfg['k_curated'])
        results.append(run_config(name, retriever, cfg['fn'], llm, dataset, pools))
        print(f"{name}: hit@1 {results[-1]['hit@1']:.1%}  hit@20 {results[-1]['hit@20']:.1%}  "
              f"fallbacks {results[-1]['fallbacks']}  p50 {results[-1]['p50_ms']:.0f}ms", flush=True)

    with open(RESULTS_PATH, 'w', encoding='utf-8') as handle:
        json.dump(results, handle, ensure_ascii=False, indent=1)
    print('\n| 設定 | hit@1 | hit@20 | 退回次數 | p50 (ms) | p95 (ms) |\n|---|---|---|---|---|---|')
    for r in results:
        print(f"| {r['name']} | {r['hit@1']:.1%} | {r['hit@20']:.1%} | {r['fallbacks']} | {r['p50_ms']:.0f} | {r['p95_ms']:.0f} |")


if __name__ == '__main__':
    main(sys.argv)
