"""評估指標。標準：選出的經文落在該題正確主題的人工經文池內即命中。"""
from __future__ import annotations

from collections import Counter
from typing import Dict, List, Optional, Set


def hit_at_k(ranked: List[str], pool: Set[str], k: int) -> bool:
    return any(verse_id in pool for verse_id in ranked[:k])


def percentile(values: List[float], p: float) -> float:
    ordered = sorted(values)
    index = min(len(ordered) - 1, int(round(p / 100 * (len(ordered) - 1))))
    return ordered[index]


def summarize(rows: List[dict], pools: Dict[str, Set[str]], ks=(1, 5, 20)) -> dict:
    topic_rows = [r for r in rows if r['kind'] == 'topic']
    out: dict = {'n': len(topic_rows)}
    for k in ks:
        if topic_rows and all(len(r['ranked']) >= k for r in topic_rows):
            hits = sum(hit_at_k(r['ranked'], pools[r['gold']], k) for r in topic_rows)
            out[f'hit@{k}'] = hits / len(topic_rows)
        else:
            out[f'hit@{k}'] = None

    latencies = [r['latency_ms'] for r in topic_rows if r.get('latency_ms') is not None]
    if latencies:
        out['p50_ms'] = percentile(latencies, 50)
        out['p95_ms'] = percentile(latencies, 95)

    verbatim = [r['verbatim'] for r in topic_rows if 'verbatim' in r]
    if verbatim:
        out['verbatim'] = sum(verbatim) / len(verbatim)

    stages = Counter(r['stage'] for r in topic_rows if r.get('stage'))
    if stages:
        out['stages'] = dict(stages)

    none_rows = [r for r in rows if r['kind'] == 'none' and 'kind_out' in r]
    if none_rows:
        out['none_fallback_rate'] = sum(r['kind_out'] == 'fallback' for r in none_rows) / len(none_rows)
    return out


def _pct(value: Optional[float]) -> str:
    return '—' if value is None else f'{value * 100:.1f}%'


def _ms(value: Optional[float]) -> str:
    return '—' if value is None else f'{value:.0f}'


def to_markdown(summaries: Dict[str, dict]) -> str:
    lines = [
        '| 方案 | 題數 | hit@1 | hit@5 | hit@20 | p50 (ms) | p95 (ms) |',
        '|---|---|---|---|---|---|---|',
    ]
    for name, s in summaries.items():
        lines.append(
            f"| {name} | {s['n']} | {_pct(s.get('hit@1'))} | {_pct(s.get('hit@5'))} | "
            f"{_pct(s.get('hit@20'))} | {_ms(s.get('p50_ms'))} | {_ms(s.get('p95_ms'))} |"
        )
    return '\n'.join(lines)
