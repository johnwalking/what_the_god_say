from __future__ import annotations

from eval.run_eval import run_b2
from server.fakes import FakeLLM, make_pipeline

GOOD = '弟兄，欠債是僕人的身分，你只是提早進入服事。'


def test_run_b2_rows_have_stage_verbatim_and_ranking():
    dataset = [
        {'q': '我欠債好多', 'kind': 'topic', 'topic_id': 'debt'},
        {'q': '今天吃什麼', 'kind': 'none', 'topic_id': None},
        {'q': '我不想活了', 'kind': 'safety', 'topic_id': None},
    ]
    pipeline = make_pipeline(FakeLLM({'choice': 1}, {'quip': GOOD}))
    rows = run_b2(dataset, pipeline)
    assert [r['kind'] for r in rows] == ['topic']  # B2 只評主題題
    row = rows[0]
    assert row['gold'] == 'debt' and row['verbatim'] is True
    assert row['stage'] == 'rerank+llm' and row['pick']['quip'] == GOOD
    assert row['ranked'][0] == row['pick']['id'] and len(row['ranked']) == 3


def test_merge_results_keeps_other_methods_and_drops_stale_b2():
    from eval.run_eval import merge_results
    old = {
        'summary': {'B0 TF-IDF': {'a': 1}, 'B2 bge-m3 + rerank': {'old': 1}},
        'rows': {'B0 TF-IDF': [1], 'B2 bge-m3 + rerank': [9]},
    }
    summ, rows = merge_results(old, {'B2 X': {'new': 1}}, {'B2 X': [2]})
    assert summ == {'B0 TF-IDF': {'a': 1}, 'B2 X': {'new': 1}}
    assert rows == {'B0 TF-IDF': [1], 'B2 X': [2]}


def test_merge_results_new_overrides_and_handles_missing_old():
    from eval.run_eval import merge_results
    assert merge_results(None, {'B1': {'n': 1}}, {'B1': [1]}) == ({'B1': {'n': 1}}, {'B1': [1]})
    old = {'summary': {'B1': {'n': 0}}, 'rows': {'B1': [0]}}
    assert merge_results(old, {'B1': {'n': 1}}, {'B1': [1]})[0] == {'B1': {'n': 1}}
