from __future__ import annotations

import json

import pytest

import extract
from server.corpus import Corpus, Verse, load_corpus


def test_build_corpus_covers_every_verse():
    rows = extract.build_corpus(extract.CUT_DIR)
    assert len(rows) == 31031
    assert len({row['id'] for row in rows}) == 31031
    eph = next(row for row in rows if row['id'] == 'Eph5v22')
    assert eph == {
        'ref': '以弗所書 5:22',
        'id': 'Eph5v22',
        'text': '你們作妻子的、當順服自己的丈夫、如同順服主．',
    }


def test_build_corpus_includes_red_letter_verses():
    ids = {row['id'] for row in extract.build_corpus(extract.CUT_DIR)}
    assert 'Matt19v24' in ids


def test_corpus_get_and_has():
    corpus = Corpus([Verse('A1v1', '甲書 1:1', '起初')])
    assert corpus.get('A1v1').text == '起初'
    assert corpus.has('A1v1') and not corpus.has('nope')
    assert len(corpus) == 1
    with pytest.raises(KeyError):
        corpus.get('nope')


def test_load_corpus_roundtrip(tmp_path):
    path = tmp_path / 'corpus.json'
    path.write_text(json.dumps([{'id': 'A1v1', 'ref': '甲書 1:1', 'text': '起初'}], ensure_ascii=False), encoding='utf-8')
    corpus = load_corpus(str(path))
    assert corpus.get('A1v1') == Verse('A1v1', '甲書 1:1', '起初')
