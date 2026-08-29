#!/usr/bin/env python3
"""從 bible-cut/CUT 抽出兜底經文池，輸出 data/fallback.json。

兜底池不放全部 31,031 節：絕大多數經文（族譜、獻祭條例、敘事片段）
不像在回答問題。過濾規則見 keep_verse。
"""
import glob
import html
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
CUT_DIR = os.path.join(HERE, '..', '..', 'bible-cut', 'CUT')
OUT_PATH = os.path.join(HERE, '..', 'data', 'fallback.json')

# [^>]* 不可省略：紅字經文寫成 <p id="Matt19v24" class="wj">
VERSE_RE = re.compile(r'<p id="([A-Za-z0-9]+?)(\d+)v(\d+)"[^>]*>(.*?)</p>', re.S)
TITLE_RE = re.compile(r'<title>(.*?)（')
TAG_RE = re.compile(r'<[^>]+>')
LEADING_NUM_RE = re.compile(r'^\d+\s*')
PUNCT_RE = re.compile(r'[、。．，；：？！\s〔〕（）]')

# 兜底池只收智慧書、詩歌與新約書信 —— 律法書與歷史書整卷排除。
# 利未記那類真正好笑的條例改由 topics.json 精選收錄，不進兜底。
FALLBACK_BOOKS = {
    'Proverbs', 'Ecclesiastes', 'Song-of-Solomon',
    'Psalms-Book1', 'Psalms-Book2', 'Psalms-Book3', 'Psalms-Book4', 'Psalms-Book5',
    'Matthew', 'Mark', 'Luke', 'John', 'Romans',
    '1Corinthians', '2Corinthians', 'Galatians', 'Ephesians', 'Philippians',
    'Colossians', '1Thessalonians', '2Thessalonians', '1Timothy', '2Timothy',
    'Titus', 'Hebrews', 'James', '1Peter', '2Peter', '1John', '2John', '3John', 'Jude',
}

# 必須帶勸誡語氣，否則讀起來不像在回答你
ADMONITION_RE = re.compile(r'你|當|不可|凡|務要|要|人若|惟有|豈|乃是')
# 敘事與儀式特徵，一律排除
NARRATIVE_RE = re.compile(
    r'生了|的兒子|後裔|說、|對他說|耶穌說|回答說|那時|於是|就往|石頭|支派|城邑|祭|燔'
)


def clean_verse(raw):
    """把一節經文的 HTML 內容轉成純文字。"""
    text = TAG_RE.sub('', html.unescape(raw)).strip()
    return LEADING_NUM_RE.sub('', text)


def book_name(page):
    """從頁面 <title> 取中文書名；索引頁與版權頁回傳 None。"""
    match = TITLE_RE.search(page)
    if not match:
        return None
    name = match.group(1).replace('﻿', '')
    return re.sub(r'^詩篇卷.$', '詩篇', name)


def keep_verse(text):
    """判斷一節經文適不適合當兜底神諭。"""
    length = len(PUNCT_RE.sub('', text))
    if not 12 <= length <= 45:
        return False
    if NARRATIVE_RE.search(text):
        return False
    return bool(ADMONITION_RE.search(text))


def iter_verses(cut_dir):
    """走訪語料，逐節產出 (中文書名, 節錨點 id, 章, 節, 純文字)。"""
    for path in sorted(glob.glob(os.path.join(cut_dir, 'CUT_*.html'))):
        with open(path, encoding='utf-8') as handle:
            page = handle.read()
        name = book_name(page)
        if name is None:
            continue
        stem = os.path.basename(path)[len('CUT_'):-len('.html')]
        for book, chap, verse, raw in VERSE_RE.findall(page):
            yield name, stem, f'{book}{chap}v{verse}', chap, verse, clean_verse(raw)


def main():
    pool = []
    for name, stem, verse_id, chap, verse, text in iter_verses(CUT_DIR):
        if stem not in FALLBACK_BOOKS:
            continue
        if not keep_verse(text):
            continue
        pool.append({'ref': f'{name} {chap}:{verse}', 'id': verse_id, 'text': text})

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, 'w', encoding='utf-8') as handle:
        json.dump(pool, handle, ensure_ascii=False, separators=(',', ':'))
    print(f'寫入 {len(pool)} 節到 {os.path.relpath(OUT_PATH)}')


if __name__ == '__main__':
    main()
