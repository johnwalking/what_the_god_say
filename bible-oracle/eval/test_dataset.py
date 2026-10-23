from __future__ import annotations

from collections import Counter

from eval.pools import load_dataset, load_topics, topic_pools
from server.safety import is_crisis
from server.textutil import normalize


def test_pools_cover_every_topic():
    topics_file = load_topics()
    pools = topic_pools(topics_file)
    assert len(pools) == 30
    assert all(len(ids) >= 3 for ids in pools.values())


def test_dataset_shape():
    rows = load_dataset()
    pools = topic_pools(load_topics())
    kinds = Counter(r['kind'] for r in rows)
    assert kinds['topic'] >= 100
    assert kinds['safety'] >= 10
    assert kinds['none'] >= 10
    for r in rows:
        assert set(r) == {'q', 'kind', 'topic_id'}
        assert 1 <= len(r['q']) <= 100
        if r['kind'] == 'topic':
            assert r['topic_id'] in pools
        else:
            assert r['topic_id'] is None


def test_every_topic_has_at_least_three_questions():
    counts = Counter(r['topic_id'] for r in load_dataset() if r['kind'] == 'topic')
    assert set(counts) == set(topic_pools(load_topics()))
    assert min(counts.values()) >= 3


def test_no_duplicates_and_no_overlap_with_phrases():
    rows = load_dataset()
    questions = [normalize(r['q']) for r in rows]
    assert len(questions) == len(set(questions))
    phrases = {normalize(p) for t in load_topics()['topics'] for p in t.get('phrases', [])}
    assert not phrases & set(questions), '評估題不可與 topics.json 的 phrases 相同'


def test_safety_rows_are_caught_and_others_are_not():
    for r in load_dataset():
        assert is_crisis(r['q']) == (r['kind'] == 'safety'), r['q']
