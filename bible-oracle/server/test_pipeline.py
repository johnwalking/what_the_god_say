from __future__ import annotations

from server.fakes import FakeLLM, make_pipeline, small_corpus
from server.llm import LLMError
from server.safety import CARE_MESSAGE

GOOD = '弟兄，欠債是僕人的身分，你只是提早進入服事。'
Q = '我欠債好多'


def _top_ids(pipeline, question=Q):
    return [h.verse.id for h in pipeline.retriever.search(question, pipeline.k)]


def test_full_path_uses_rerank_choice_and_llm_quip():
    pipeline = make_pipeline(FakeLLM({'choice': 2}, {'quip': GOOD}))
    ids = _top_ids(pipeline)
    answer = pipeline.ask(Q)
    assert answer.kind == 'oracle' and answer.stage == 'rerank+llm'
    assert answer.verse_id == ids[1] and answer.quip == GOOD
    assert answer.pool_size == 3


def test_text_is_verbatim_from_corpus():
    answer = make_pipeline(FakeLLM({'choice': 3}, {'quip': GOOD})).ask(Q)
    assert answer.text == small_corpus().get(answer.verse_id).text


def test_rerank_llm_error_degrades_to_top1():
    pipeline = make_pipeline(FakeLLM(LLMError('down'), {'quip': GOOD}))
    answer = pipeline.ask(Q)
    assert answer.stage == 'top1+llm' and answer.verse_id == _top_ids(pipeline)[0]


def test_invalid_rerank_choice_degrades_to_top1():
    answer = make_pipeline(FakeLLM({'choice': 99}, {'quip': GOOD})).ask(Q)
    assert answer.stage == 'top1+llm'


def test_invalid_quip_degrades_to_template():
    llm = FakeLLM({'choice': 1}, {'quip': '哈哈哈哈哈哈哈哈'}, {'quip': '哈哈哈哈哈哈哈哈'})
    answer = make_pipeline(llm).ask(Q)
    assert answer.stage == 'rerank+template'
    assert answer.quip == '主已經回答了，是你還沒讀懂。'


def test_no_llm_uses_top1_and_template():
    answer = make_pipeline(None).ask(Q)
    assert answer.stage == 'top1+template'


def test_crisis_short_circuits_without_llm():
    llm = FakeLLM()
    answer = make_pipeline(llm).ask('我不想活了')
    assert answer.kind == 'crisis' and answer.text == CARE_MESSAGE and answer.stage == 'safety'
    assert llm.calls == []


def test_second_ask_hits_cache_and_n_walks_the_ranking():
    llm = FakeLLM({'choice': 2}, {'quip': GOOD}, {'quip': GOOD}, {'quip': GOOD})
    pipeline = make_pipeline(llm)
    first = pipeline.ask(Q)
    calls_after_first = len(llm.calls)
    again = pipeline.ask(Q)
    assert (again.verse_id, again.quip) == (first.verse_id, first.quip)
    assert len(llm.calls) == calls_after_first
    nxt = pipeline.ask(Q, n=1)
    order, _ = pipeline.rank(Q)
    assert nxt.verse_id == order[1]


def test_degraded_results_are_not_cached():
    llm = FakeLLM(LLMError('down'), LLMError('down'), {'choice': 1}, {'quip': GOOD})
    pipeline = make_pipeline(llm)
    assert pipeline.ask(Q).stage == 'top1+template'
    assert pipeline.ask(Q).stage == 'rerank+llm'


def test_custom_rerank_fn_is_used():
    llm = FakeLLM({'quip': GOOD})
    pipeline = make_pipeline(llm)
    pipeline.rerank_fn = lambda llm_, question, hits: len(hits) - 1
    ids = _top_ids(pipeline)
    answer = pipeline.ask(Q)
    assert answer.stage == 'rerank+llm' and answer.verse_id == ids[-1]


def test_cache_namespace_isolates_rank_and_quip():
    from server.cache import Cache
    shared = Cache()
    llm = FakeLLM({'choice': 2}, {'quip': GOOD}, {'choice': 3}, {'quip': GOOD})
    first = make_pipeline(llm, cache=shared, cache_ns='cfgA|4').ask(Q)
    calls = len(llm.calls)
    # 同一個問題、不同 ns：不能吃到前一個設定的快取
    other = make_pipeline(llm, cache=shared, cache_ns='cfgB|4').ask(Q)
    assert len(llm.calls) == calls + 2
    assert other.verse_id != first.verse_id
    # 同 ns 命中快取，不再呼叫 LLM
    make_pipeline(llm, cache=shared, cache_ns='cfgA|4').ask(Q)
    assert len(llm.calls) == calls + 2


def test_empty_namespace_keeps_legacy_key_format():
    from server.cache import Cache
    from server.textutil import normalize
    shared = Cache()
    pipeline = make_pipeline(FakeLLM({'choice': 2}, {'quip': GOOD}), cache=shared)
    answer = pipeline.ask(Q)
    assert shared.get(f'rank:{normalize(Q)}') is not None
    assert shared.get(f'quip:{normalize(Q)}:{answer.verse_id}') == GOOD


# ---- 信心門檻：精選庫最高分偏低時展開全語料 ----

def _curated_best(pipeline, question=Q):
    return pipeline.retriever.search(question, pipeline.k)[0].score


def test_default_pipeline_is_curated_pool():
    answer = make_pipeline(FakeLLM({'choice': 1}, {'quip': GOOD})).ask(Q)
    assert answer.pool == 'curated'


def test_crisis_answer_pool_is_curated_and_skips_retrieval():
    pipeline = make_pipeline(FakeLLM(), wide=True, wide_threshold=2.0)

    def boom(*args, **kwargs):
        raise AssertionError('不應檢索')

    pipeline.retriever.search = boom
    pipeline.wide_retriever.search = boom
    answer = pipeline.ask('我不想活了')
    assert answer.kind == 'crisis' and answer.pool == 'curated' and answer.text == CARE_MESSAGE


def test_high_confidence_stays_curated():
    probe = make_pipeline(None, wide=True)
    best = _curated_best(probe)
    pipeline = make_pipeline(FakeLLM({'choice': 1}, {'quip': GOOD}), wide=True, wide_threshold=best)
    answer = pipeline.ask(Q)
    assert answer.pool == 'curated' and answer.pool_size == 2
    assert pipeline.rank_with_pool(Q)[2] == 'curated'


def test_low_confidence_widens_to_full_corpus():
    pipeline = make_pipeline(FakeLLM({'choice': 1}, {'quip': GOOD}), wide=True, wide_threshold=2.0)
    order, ok, pool = pipeline.rank_with_pool(Q)
    wide_ids = [h.verse.id for h in pipeline.wide_retriever.search(Q, pipeline.k)]
    assert pool == 'wide' and ok and order == wide_ids and len(order) == 3
    answer = pipeline.ask(Q)
    assert answer.pool == 'wide' and answer.pool_size == 3
    assert answer.text == small_corpus().get(answer.verse_id).text


def test_threshold_zero_never_widens():
    pipeline = make_pipeline(FakeLLM({'choice': 1}, {'quip': GOOD}), wide=True, wide_threshold=0)
    assert pipeline.ask(Q).pool == 'curated'


def test_rank_matches_rank_with_pool():
    pipeline = make_pipeline(None, wide=True, wide_threshold=2.0)
    order, ok, pool = pipeline.rank_with_pool(Q)
    assert pipeline.rank(Q) == (order, ok) and pool == 'wide'


def test_cache_hit_preserves_pool():
    llm = FakeLLM({'choice': 2}, {'quip': GOOD})
    pipeline = make_pipeline(llm, wide=True, wide_threshold=2.0)
    first = pipeline.rank_with_pool(Q)
    calls = len(llm.calls)
    assert pipeline.rank_with_pool(Q) == first and first[2] == 'wide'
    assert len(llm.calls) == calls


def test_legacy_cache_entry_without_pool_is_curated():
    from server.cache import Cache
    from server.textutil import normalize
    shared = Cache()
    shared.set(f'rank:{normalize(Q)}', {'order': ['Prov22v7', 'Eph5v22']})
    pipeline = make_pipeline(FakeLLM(), cache=shared, wide=True, wide_threshold=2.0)
    assert pipeline.rank_with_pool(Q) == (['Prov22v7', 'Eph5v22'], True, 'curated')


def test_degraded_wide_result_is_not_cached():
    llm = FakeLLM(LLMError('down'), {'choice': 1})
    pipeline = make_pipeline(llm, wide=True, wide_threshold=2.0)
    assert pipeline.rank_with_pool(Q)[1:] == (False, 'wide')
    assert pipeline.rank_with_pool(Q)[1:] == (True, 'wide')
