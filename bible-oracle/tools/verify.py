#!/usr/bin/env python3
"""驗證 data/topics.json 的每一節經文與 bible-cut/CUT 原檔一字不差。

這是全站的命脈：笑點來自「這真的是聖經寫的」，只要改過一個字就全垮了。
任何不符即以非零狀態碼結束。
"""
import json
import os
import re
import sys

from extract import CUT_DIR, iter_verses

HERE = os.path.dirname(os.path.abspath(__file__))
TOPICS_PATH = os.path.join(HERE, '..', 'data', 'topics.json')
APP_JS_PATH = os.path.join(HERE, '..', 'assets', 'app.js')
FALLBACK_PATH = os.path.join(HERE, '..', 'data', 'fallback.json')


def build_index():
    """節錨點 id -> (期望的 ref 字串, 原文)。"""
    index = {}
    for name, _stem, verse_id, chap, verse, text in iter_verses(CUT_DIR):
        index[verse_id] = (f'{name} {chap}:{verse}', text)
    return index


def parse_emergency_pool(app_js_path):
    """從 app.js 解析緊急經文池。

    返回 (verses, source_count)；verses 是 [(ref, id, text), ...] 的列表，
    source_count 是原始碼區塊中實際的項目數（用正則以外的方式粗略數出來，
    當作「解析器抓到幾筆」的獨立對照，避免正則寫死格式而悄悄漏檢）。
    若整個區塊都找不到，回傳 (None, None)。
    """
    try:
        with open(app_js_path, encoding='utf-8') as handle:
            content = handle.read()
    except FileNotFoundError:
        return None, None

    # 用正則抓出 緊急經文池 = [ ... ]; 區塊
    block_match = re.search(r'緊急經文池 = \[(.*?)\n\];', content, re.S)
    if not block_match:
        return None, None

    block = block_match.group(1)
    source_count = block.count('{ ref')

    # 從區塊中解析每一筆 { ref: '...', id: '...', text: '...' }
    verses = []
    for match in re.finditer(r"\{ ref: '([^']+)', id: '([^']+)', text: '([^']+)' \}", block):
        ref, verse_id, text = match.groups()
        verses.append((ref, verse_id, text))

    return verses, source_count


def check_fallback(fallback_path):
    """檢查 data/fallback.json：存在、是陣列、非空，且每筆都有非空的 ref／id／text。

    這是兜底的兜底 —— match.js 的 answer() 在主題落空時直接對這份陣列取模，
    陣列若是空的會讓 (seed % 0) 產生 NaN，undefined.ref 整站白畫面。
    回傳 (errors, count)。
    """
    errors = []

    if not os.path.exists(fallback_path):
        errors.append('fallback.json：檔案不存在')
        return errors, 0

    try:
        with open(fallback_path, encoding='utf-8') as handle:
            fallback = json.load(handle)
    except json.JSONDecodeError as exc:
        errors.append(f'fallback.json：不是合法的 JSON（{exc}）')
        return errors, 0

    if not isinstance(fallback, list):
        errors.append('fallback.json：頂層必須是陣列')
        return errors, 0

    if not fallback:
        errors.append('fallback.json：不可為空陣列，否則兜底池取模會產生 NaN')
        return errors, 0

    for i, verse in enumerate(fallback):
        where = f'fallback.json[{i}]'
        if not isinstance(verse, dict):
            errors.append(f'{where}：不是物件')
            continue
        for field in ('ref', 'id', 'text'):
            if not verse.get(field):
                errors.append(f'{where}：缺少非空的 {field}')

    return errors, len(fallback)


def main():
    with open(TOPICS_PATH, encoding='utf-8') as handle:
        data = json.load(handle)

    index = build_index()
    errors = []
    checked = 0
    seen_ids = set()

    if not data.get('wrappers'):
        errors.append('wrappers 不可為空')

    for topic in data['topics']:
        if not topic.get('verses'):
            errors.append(f'[{topic["id"]}] 沒有任何經文')
        if not topic.get('keywords'):
            errors.append(f'[{topic["id"]}] 沒有任何關鍵字')
        if topic['id'] in seen_ids:
            errors.append(f'[{topic["id"]}] 主題 id 重複')
        seen_ids.add(topic['id'])

        for verse in topic['verses']:
            checked += 1
            where = f'[{topic["id"]}] {verse["ref"]} ({verse["id"]})'
            if verse['id'] not in index:
                errors.append(f'{where}：原檔中找不到這個節錨點')
                continue
            expected_ref, expected_text = index[verse['id']]
            if verse['text'] != expected_text:
                errors.append(
                    f'{where}：經文與原檔不符\n'
                    f'    topics.json：{verse["text"]}\n'
                    f'    原檔　　　：{expected_text}'
                )
            if verse['ref'] != expected_ref:
                errors.append(f'{where}：出處應為「{expected_ref}」')
            if not verse.get('quip'):
                errors.append(f'{where}：缺少補刀')

    # 檢查 app.js 的緊急經文池
    emergency_verses, emergency_source_count = parse_emergency_pool(APP_JS_PATH)
    if emergency_verses is None:
        errors.append('app.js：無法解析緊急經文池（格式可能已變更）')
    else:
        if len(emergency_verses) != emergency_source_count:
            errors.append(
                f'app.js：緊急經文池解析到 {len(emergency_verses)} 筆，'
                f'但原始碼有 {emergency_source_count} 筆，可能是格式改變導致漏檢'
            )
        for ref, verse_id, text in emergency_verses:
            where = f'[緊急經文池] {ref} ({verse_id})'
            if verse_id not in index:
                errors.append(f'{where}：原檔中找不到這個節錨點')
                continue
            expected_ref, expected_text = index[verse_id]
            if text != expected_text:
                errors.append(
                    f'{where}：經文與原檔不符\n'
                    f'    app.js　　　：{text}\n'
                    f'    原檔　　　　：{expected_text}'
                )
            if ref != expected_ref:
                errors.append(f'{where}：出處應為「{expected_ref}」')

    if emergency_verses is not None:
        emergency_count = len(emergency_verses)
    else:
        emergency_count = 0

    # 檢查 data/fallback.json
    fallback_errors, fallback_count = check_fallback(FALLBACK_PATH)
    errors.extend(fallback_errors)

    if errors:
        print(f'✗ 驗證失敗，{len(errors)} 個問題：\n')
        for error in errors:
            print(f'  {error}')
        sys.exit(1)

    print(
        f'✓ {len(data["topics"])} 個主題、{checked} 節經文，以及緊急經文池 {emergency_count} 節，'
        f'fallback.json {fallback_count} 節，全部與原檔一字不差'
    )


if __name__ == '__main__':
    main()
