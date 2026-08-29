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


def build_index():
    """節錨點 id -> (期望的 ref 字串, 原文)。"""
    index = {}
    for name, _stem, verse_id, chap, verse, text in iter_verses(CUT_DIR):
        index[verse_id] = (f'{name} {chap}:{verse}', text)
    return index


def parse_emergency_pool(app_js_path):
    """從 app.js 解析緊急經文池。

    返回 [(ref, id, text), ...] 的列表；若無法解析則返回 None。
    """
    try:
        with open(app_js_path, encoding='utf-8') as handle:
            content = handle.read()
    except FileNotFoundError:
        return None

    # 用正則抓出 緊急經文池 = [ ... ]; 區塊
    block_match = re.search(r'緊急經文池 = \[(.*?)\n\];', content, re.S)
    if not block_match:
        return None

    block = block_match.group(1)

    # 從區塊中解析每一筆 { ref: '...', id: '...', text: '...' }
    verses = []
    for match in re.finditer(r"\{ ref: '([^']+)', id: '([^']+)', text: '([^']+)' \}", block):
        ref, verse_id, text = match.groups()
        verses.append((ref, verse_id, text))

    return verses if verses else None


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
    emergency_verses = parse_emergency_pool(APP_JS_PATH)
    if emergency_verses is None:
        errors.append('app.js：無法解析緊急經文池（格式可能已變更）')
    else:
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

    if errors:
        print(f'✗ 驗證失敗，{len(errors)} 個問題：\n')
        for error in errors:
            print(f'  {error}')
        sys.exit(1)

    print(f'✓ {len(data["topics"])} 個主題、{checked} 節經文，以及緊急經文池 {emergency_count} 節，全部與原檔一字不差')


if __name__ == '__main__':
    main()
