"""評估用資料：主題經文池與評估集。"""
from __future__ import annotations

import json
import os
from typing import Dict, List, Set

HERE = os.path.dirname(os.path.abspath(__file__))
TOPICS_PATH = os.path.join(HERE, '..', 'data', 'topics.json')
DATASET_PATH = os.path.join(HERE, 'dataset.jsonl')


def load_topics(path: str = TOPICS_PATH) -> dict:
    with open(path, encoding='utf-8') as handle:
        return json.load(handle)


def topic_pools(topics_file: dict) -> Dict[str, Set[str]]:
    return {t['id']: {v['id'] for v in t['verses']} for t in topics_file['topics']}


def load_dataset(path: str = DATASET_PATH) -> List[dict]:
    with open(path, encoding='utf-8') as handle:
        return [json.loads(line) for line in handle if line.strip()]
