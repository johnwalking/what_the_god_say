"""data/extra_topics.json：只供靜態模式使用的日常主題。經文逐字、補刀合規、不觸發安全閘。"""
from __future__ import annotations

import json
import os

import pytest

from server.quip import validate_quip
from server.safety import is_crisis

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
EXTRA_PATH = os.path.join(ROOT, 'data', 'extra_topics.json')
TOPICS_PATH = os.path.join(ROOT, 'data', 'topics.json')
CORPUS_PATH = os.path.join(ROOT, 'data', 'corpus.json')
EXPECTED_IDS = {'pets', 'food', 'weather', 'tech', 'study', 'travel'}


def _load(path):
    with open(path, encoding='utf-8') as handle:
        return json.load(handle)


@pytest.fixture(scope='module')
def extra():
    return _load(EXTRA_PATH)['topics']


@pytest.fixture(scope='module')
def corpus():
    if not os.path.exists(CORPUS_PATH):
        pytest.skip('data/corpus.json 不存在（先跑 tools/extract.py --corpus）')
    return {v['id']: v for v in _load(CORPUS_PATH)}


def test_six_everyday_topics(extra):
    assert {t['id'] for t in extra} == EXPECTED_IDS


def test_topic_ids_do_not_clash_with_topics_json(extra):
    curated = {t['id'] for t in _load(TOPICS_PATH)['topics']}
    assert not curated & {t['id'] for t in extra}


def test_minimum_sizes(extra):
    for topic in extra:
        assert topic['label']
        assert len(topic['keywords']) >= 6, topic['id']
        assert len(topic.get('phrases', [])) >= 6, topic['id']
        assert 5 <= len(topic['verses']) <= 6, topic['id']
        for keyword in topic['keywords']:
            assert keyword['w'] and keyword['s'] in (1, 3), (topic['id'], keyword)


def test_verses_are_verbatim_from_corpus(extra, corpus):
    for topic in extra:
        for verse in topic['verses']:
            assert verse['id'] in corpus, (topic['id'], verse['id'])
            assert verse['text'] == corpus[verse['id']]['text'], (topic['id'], verse['id'])
            assert verse['ref'] == corpus[verse['id']]['ref'], (topic['id'], verse['id'])


def test_verse_ids_are_unique(extra):
    ids = [v['id'] for t in extra for v in t['verses']]
    assert len(ids) == len(set(ids))


def test_quips_pass_validator(extra):
    bad = [(t['id'], v['id'], v['quip']) for t in extra for v in t['verses'] if not validate_quip(v.get('quip'))]
    assert bad == []


def test_nothing_triggers_crisis_gate(extra):
    for topic in extra:
        texts = [k['w'] for k in topic['keywords']] + topic['phrases'] + [v['quip'] for v in topic['verses']]
        assert [t for t in texts if is_crisis(t)] == [], topic['id']
