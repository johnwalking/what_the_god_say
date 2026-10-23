from __future__ import annotations

import numpy as np
import pytest

from server.corpus import Corpus, Verse
from server.embedder import HashEmbedder
from server.retrieve import Retriever


def _corpus():
    return Corpus([
        Verse('Eph5v22', '以弗所書 5:22', '你們作妻子的、當順服自己的丈夫、如同順服主．'),
        Verse('Prov22v7', '箴言 22:7', '富戶管轄窮人．欠債的是債主的僕人。'),
        Verse('Matt6v34', '馬太福音 6:34', '所以不要為明天憂慮．因為明天自有明天的憂慮。'),
    ])


def _retriever():
    corpus, embedder = _corpus(), HashEmbedder()
    matrix = embedder.encode([v.text for v in corpus.verses])
    return Retriever(corpus, matrix, embedder)


def test_hash_embedder_rows_are_unit_length():
    vecs = HashEmbedder().encode(['你好嗎', '欠債'])
    assert vecs.dtype == np.float32
    assert np.allclose(np.linalg.norm(vecs, axis=1), 1.0, atol=1e-5)


def test_search_ranks_overlapping_verse_first():
    hits = _retriever().search('我欠債好多', k=3)
    assert hits[0].verse.id == 'Prov22v7'
    assert [h.score for h in hits] == sorted((h.score for h in hits), reverse=True)


def test_search_k_larger_than_corpus_returns_all():
    assert len(_retriever().search('明天', k=50)) == 3


def test_matrix_must_match_corpus():
    with pytest.raises(ValueError):
        Retriever(_corpus(), np.zeros((2, 8), dtype=np.float32), HashEmbedder())


from server.retrieve import HybridRetriever, curated_ids_from_topics  # noqa: E402


def _hybrid(k_curated=1):
    corpus, embedder = _corpus(), HashEmbedder()
    matrix = embedder.encode([v.text for v in corpus.verses])
    return HybridRetriever(corpus, matrix, embedder, {'Eph5v22'}, k_curated=k_curated)


def test_curated_ids_from_topics_collects_all_verse_ids():
    topics_file = {'topics': [{'verses': [{'id': 'A'}, {'id': 'B'}]}, {'verses': [{'id': 'B'}, {'id': 'C'}]}]}
    assert curated_ids_from_topics(topics_file) == {'A', 'B', 'C'}


def test_hybrid_always_includes_best_curated_even_if_far_from_query():
    hits = _hybrid(k_curated=1).search('我欠債好多', k=2)
    ids = [h.verse.id for h in hits]
    assert 'Eph5v22' in ids and 'Prov22v7' in ids  # 精選庫的 Eph5v22 被保送，全語料第一名 Prov22v7 也在
    assert len(ids) == len(set(ids)) == 2
    assert [h.score for h in hits] == sorted((h.score for h in hits), reverse=True)


def test_hybrid_fills_exactly_k_without_duplicates_when_curated_overlaps_full_top():
    hits = _hybrid(k_curated=1).search('你們作妻子的順服', k=3)
    ids = [h.verse.id for h in hits]
    assert len(ids) == len(set(ids)) == 3


def test_hybrid_rejects_curated_ids_missing_from_corpus():
    corpus, embedder = _corpus(), HashEmbedder()
    matrix = embedder.encode([v.text for v in corpus.verses])
    with pytest.raises(ValueError):
        HybridRetriever(corpus, matrix, embedder, {'NOPE'})
