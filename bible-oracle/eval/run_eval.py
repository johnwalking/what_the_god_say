#!/usr/bin/env python3
"""跑評估。用法：python eval/run_eval.py [b0] [b1] [b2]（預設 b0 b1）。結果寫入 eval/results.json。"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from typing import Dict, List, Optional, Tuple

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))

from eval.metrics import summarize, to_markdown  # noqa: E402
from eval.pools import HERE, load_dataset, load_topics, topic_pools  # noqa: E402
from server.main import RERANK_CONFIG_NAME  # noqa: E402
from server.safety import is_crisis  # noqa: E402

RESULTS_PATH = os.path.join(HERE, 'results.json')
B2_LABEL = f'B2 {RERANK_CONFIG_NAME}'
STALE_LABELS = ('B2 bge-m3 + rerank',)
EVALUABLE = ('topic', 'none')


def _rows_for(dataset: List[dict]) -> List[dict]:
    return [r for r in dataset if r['kind'] in EVALUABLE]


def run_b0(dataset: List[dict]) -> List[dict]:
    items = _rows_for(dataset)
    started = time.perf_counter()
    proc = subprocess.run(
        ['node', os.path.join(HERE, 'b0.mjs')],
        input=json.dumps([r['q'] for r in items], ensure_ascii=False),
        capture_output=True, text=True, check=True,
    )
    per_ms = (time.perf_counter() - started) * 1000 / max(len(items), 1)
    outs = json.loads(proc.stdout)
    return [
        {
            'q': r['q'], 'kind': r['kind'], 'gold': r['topic_id'], 'ranked': [o['verseId']],
            'latency_ms': per_ms, 'kind_out': o['kind'],
            'pick': {'id': o['verseId'], 'ref': o['ref'], 'text': o['text'], 'quip': o['quip']},
        }
        for r, o in zip(items, outs)
    ]


def run_b1(dataset: List[dict], retriever) -> List[dict]:
    rows = []
    for r in _rows_for(dataset):
        started = time.perf_counter()
        hits = retriever.search(r['q'], 20)
        elapsed = (time.perf_counter() - started) * 1000
        top = hits[0].verse
        rows.append({
            'q': r['q'], 'kind': r['kind'], 'gold': r['topic_id'],
            'ranked': [h.verse.id for h in hits], 'latency_ms': elapsed,
            'pick': {'id': top.id, 'ref': top.ref, 'text': top.text, 'quip': None},
        })
    return rows


def safety_report(dataset: List[dict]) -> dict:
    safety = [r for r in dataset if r['kind'] == 'safety']
    others = [r for r in dataset if r['kind'] != 'safety']
    return {
        'recall': sum(is_crisis(r['q']) for r in safety) / len(safety),
        'false_positives': sum(is_crisis(r['q']) for r in others),
    }


def merge_results(old: Optional[dict], summaries: Dict[str, dict], rows: Dict[str, list]) -> Tuple[dict, dict]:
    """保留舊檔中本次未執行方法的結果；已被取代的舊標籤丟棄。"""
    old = old or {}
    kept_s = {k: v for k, v in old.get('summary', {}).items() if k not in STALE_LABELS}
    kept_r = {k: v for k, v in old.get('rows', {}).items() if k not in STALE_LABELS}
    kept_s.update(summaries)
    kept_r.update(rows)
    return kept_s, kept_r


def main(argv: List[str]) -> None:
    methods = argv[1:] or ['b0', 'b1']
    dataset = load_dataset()
    pools = topic_pools(load_topics())
    rows_by_method = {}

    if 'b0' in methods:
        rows_by_method['B0 TF-IDF'] = run_b0(dataset)
    if 'b1' in methods:
        from server.corpus import load_corpus
        from server.embedder import BgeM3Embedder
        from server.retrieve import Retriever, load_index
        rows_by_method['B1 bge-m3'] = run_b1(dataset, Retriever(load_corpus(), load_index(), BgeM3Embedder()))
    if 'b1h' in methods:
        from server.corpus import load_corpus
        from server.embedder import BgeM3Embedder
        from server.retrieve import HybridRetriever, curated_ids_from_topics, load_index
        retriever = HybridRetriever(
            load_corpus(), load_index(), BgeM3Embedder(), curated_ids_from_topics(load_topics()),
        )
        rows_by_method['B1h 混合檢索'] = run_b1(dataset, retriever)
    if 'b2' in methods:
        from server.cache import Cache
        from server.main import build_default_pipeline
        rows_by_method[B2_LABEL] = run_b2(dataset, build_default_pipeline(cache=Cache()))

    summaries = {name: summarize(rows, pools) for name, rows in rows_by_method.items()}
    report = safety_report(dataset)
    old = None
    if os.path.exists(RESULTS_PATH):
        with open(RESULTS_PATH, encoding='utf-8') as handle:
            old = json.load(handle)
    summaries, rows_by_method = merge_results(old, summaries, rows_by_method)
    with open(RESULTS_PATH, 'w', encoding='utf-8') as handle:
        json.dump({'summary': summaries, 'safety': report, 'rows': rows_by_method}, handle, ensure_ascii=False, indent=1)
    print(to_markdown(summaries))
    print(f"\n安全閘：召回 {report['recall']:.0%}，誤攔 {report['false_positives']} 題")
    for name, summary in summaries.items():
        extras = {k: v for k, v in summary.items() if k in ('verbatim', 'stages', 'none_fallback_rate')}
        if extras:
            print(f'{name}: {extras}')


def run_b2(dataset: List[dict], pipeline) -> List[dict]:
    rows = []
    for r in dataset:
        if r['kind'] != 'topic':
            continue
        answer = pipeline.ask(r['q'])
        order, _ = pipeline.rank(r['q'])
        rows.append({
            'q': r['q'], 'kind': r['kind'], 'gold': r['topic_id'],
            'ranked': order[:20], 'latency_ms': answer.latency_ms, 'stage': answer.stage,
            'verbatim': answer.text == pipeline.corpus.get(answer.verse_id).text,
            'pick': {'id': answer.verse_id, 'ref': answer.ref, 'text': answer.text, 'quip': answer.quip},
        })
    return rows


if __name__ == '__main__':
    main(sys.argv)
