#!/usr/bin/env python3
"""LLM-as-judge 的取樣與彙整。評分本身由 subagent 做（見計畫 Task 11 Step 5）。
用法：python eval/judge.py sample | summarize"""
from __future__ import annotations

import json
import os
import random
import sys
from collections import defaultdict
from typing import Dict, List, Tuple

HERE = os.path.dirname(os.path.abspath(__file__))
JUDGE_DIR = os.path.join(HERE, 'judge')
JUDGED_PREFIXES = ('B0', 'B1h', 'B2')  # B0 的補刀是人工寫的，當上限參考；B1 純全語料已知離題，不評


def judged_keys(results: dict) -> List[str]:
    """依前綴從 results['rows'] 找出要評審的方案名稱，順序固定為 B0、B1h、B2。"""
    keys = []
    for prefix in JUDGED_PREFIXES:
        match = [k for k in results['rows'] if k == prefix or k.startswith(prefix + ' ')]
        if len(match) != 1:
            raise ValueError(f'找不到唯一的 {prefix} 方案：{match}')
        keys.append(match[0])
    return keys


def sample(results: dict, n: int = 40, seed: int = 0) -> Tuple[List[dict], Dict[str, dict]]:
    """對 B0、B1h、B2 取同一批題目，打散並匿名化，裁判看不到方案名。"""
    rng = random.Random(seed)
    methods = judged_keys(results)
    per_method = {m: {r['q']: r for r in results['rows'][m] if r['kind'] == 'topic'} for m in methods}
    common = sorted(set.intersection(*(set(rows) for rows in per_method.values())))
    questions = rng.sample(common, min(n, len(common)))

    items = []
    for method in methods:
        for q in questions:
            pick = per_method[method][q]['pick']
            items.append({'method': method, 'q': q, 'ref': pick['ref'], 'text': pick['text'], 'quip': pick['quip']})
    rng.shuffle(items)

    batch, key = [], {}
    for i, item in enumerate(items, 1):
        item_id = f'item-{i:03d}'
        key[item_id] = {'method': item['method'], 'q': item['q']}
        batch.append({'id': item_id, 'q': item['q'], 'ref': item['ref'], 'text': item['text'], 'quip': item['quip']})
    return batch, key


def validate_scores(key: Dict[str, dict], scores: List[dict]) -> None:
    """檢查評分清單：id 必須都在 key、不重複、完整覆蓋；數值為 1..5 的 int，compliant 為真正的 bool。"""
    seen = set()
    for score in scores:
        item_id = score.get('id')
        if item_id not in key:
            raise ValueError(f'未知的 id：{item_id!r}')
        if item_id in seen:
            raise ValueError(f'重複的 id：{item_id!r}')
        seen.add(item_id)
        for field in ('relevance', 'funny'):
            value = score.get(field)
            if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= 5:
                raise ValueError(f'{item_id} 的 {field} 必須是 1..5 的整數，收到 {value!r}')
        if not isinstance(score.get('compliant'), bool):
            raise ValueError(f"{item_id} 的 compliant 必須是 bool，收到 {score.get('compliant')!r}")
    missing = sorted(set(key) - seen)
    if missing:
        raise ValueError(f'缺少 {len(missing)} 個 id 的評分：{missing[:5]}')


def summarize(key: Dict[str, dict], scores: List[dict]) -> Dict[str, dict]:
    validate_scores(key, scores)
    grouped = defaultdict(list)
    for score in scores:
        grouped[key[score['id']]['method']].append(score)
    return {
        method: {
            'n': len(rows),
            'relevance': sum(r['relevance'] for r in rows) / len(rows),
            'funny': sum(r['funny'] for r in rows) / len(rows),
            'compliant': sum(bool(r['compliant']) for r in rows) / len(rows),
        }
        for method, rows in grouped.items()
    }


def _dump(name: str, value) -> None:
    os.makedirs(JUDGE_DIR, exist_ok=True)
    with open(os.path.join(JUDGE_DIR, name), 'w', encoding='utf-8') as handle:
        json.dump(value, handle, ensure_ascii=False, indent=1)


def _load(name: str):
    with open(os.path.join(JUDGE_DIR, name), encoding='utf-8') as handle:
        return json.load(handle)


def main(argv: List[str]) -> None:
    if argv[1:2] == ['sample']:
        with open(os.path.join(HERE, 'results.json'), encoding='utf-8') as handle:
            batch, key = sample(json.load(handle))
        _dump('batch.json', batch)
        _dump('key.json', key)
        print(f'已寫入 {len(batch)} 項到 eval/judge/batch.json')
    elif argv[1:2] == ['summarize']:
        summary = summarize(_load('key.json'), _load('scores.json'))
        for method, s in summary.items():
            print(f"{method}: n={s['n']} 相關度 {s['relevance']:.2f}/5 好笑 {s['funny']:.2f}/5 合規 {s['compliant']:.0%}")
    else:
        sys.exit(__doc__)


if __name__ == '__main__':
    main(sys.argv)
