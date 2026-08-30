# 主的旨意（聖經解答之書）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建一個純靜態網站，使用者輸入人生煩惱，網站以一字不改的和合本經文回答，並附一句假牧師補刀。

**Architecture:** 單頁靜態站，無後端無建置步驟。兩支 Python 腳本負責離線資料管線（從既有的 `bible-cut/CUT/` HTML 語料抽出兜底經文池、驗證策展庫的經文與原檔一字不差）；瀏覽器端三個 ES module：`match.js` 純函式比對邏輯、`card.js` canvas 產圖、`app.js` 只做接線。

**Tech Stack:** 原生 HTML/CSS/ES modules（零 runtime 依賴）、Node 20+ 內建 `node --test`、Python 3 標準函式庫。

## Global Constraints

- **經文一字不改。** 這是全站笑點的基礎。`topics.json` 內每一節都必須通過 `tools/verify.py` 與 `bible-cut/CUT/` 原檔的逐字比對。
- **零 runtime 依賴、零建置步驟。** 不引入任何 npm 套件到瀏覽器端，不使用打包工具。`node --test` 與 Python 只在開發期使用。
- **所有路徑用相對路徑**，網站要能部署在 GitHub Pages 的子目錄下（如 `/bible-oracle/`）。
- **補刀寫作規範**（`topics.json` 的 `quip` 欄位）：一到兩句；教會長輩的溫柔口吻；立場永遠是「經文顯然是對的，是你不夠屬靈」；絕不出現「哈哈」「其實」「這是諷刺」或任何自我揭露；攻擊推論方式，不攻擊具體的人或教會。
- **語料抽取正則必須是** `r'<p id="([A-Za-z0-9]+?)(\d+)v(\d+)"[^>]*>(.*?)</p>'`。`[^>]*` 不可省略 —— 紅字經文寫成 `<p id="Matt19v24" class="wj">`，少了它會靜默漏掉 114 節。
- **繁體中文**：所有使用者可見文字、註解、commit message 一律繁體中文。
- **補刀長度上限 100 字。** 答案卡是 840×1200 的固定畫布。以最長經文（4 行）加最長問題（2 行）的最壞組合推算，補刀起始 y≈766，超過約 160 字會壓到 y=1100 的頁腳。該推算用的是 CJK 全形字寬約等於字級的近似值，有 ±10~15% 誤差，因此實務上保守抓在 100 字以內，不要逼近理論線。

## File Structure

```
bible-oracle/
  package.json            # {"type":"module","private":true} — 讓 node --test 認得 ES module
  index.html              # 版面骨架
  assets/style.css        # 莊嚴聖經風視覺
  assets/match.js         # 比對與選經文（純函式，無 DOM，可在 node 測）
  assets/card.js          # canvas 產圖（唯一碰 canvas 的檔案）
  assets/app.js           # 接線：載資料、綁事件、渲染、管網址（不含業務邏輯）
  data/topics.json        # 策展庫（手寫，核心資產）
  data/fallback.json      # 兜底經文池（extract.py 產生，不手改）
  tools/extract.py        # CUT → fallback.json
  tools/verify.py         # 驗證 topics.json 與原檔一字不差
  tools/test_extract.py   # extract.py 的單元測試
  tests/match.test.js     # match.js 的單元測試
```

責任邊界：`match.js` 不知道 DOM 存在，`card.js` 不知道比對規則存在，`app.js` 不含任何可獨立測試的邏輯。`verify.py` 從 `extract.py` import 共用的解析函式，解析規則只有一份。

---

### Task 1: 資料抽取管線

從 `bible-cut/CUT/` 抽出兜底經文池。這一步先做，因為後面所有東西都靠它產出的資料。

**Files:**
- Create: `bible-oracle/package.json`
- Create: `bible-oracle/tools/extract.py`
- Create: `bible-oracle/tools/test_extract.py`
- Generate: `bible-oracle/data/fallback.json`

**Interfaces:**
- Consumes: `bible-cut/CUT/CUT_*.html`（既有語料，不修改）
- Produces: `data/fallback.json`，格式為 `[{ "ref": "詩篇 17:6", "id": "Ps17v6", "text": "…" }]`；以及 `extract.py` 中供 `verify.py` 重用的 `VERSE_RE`、`clean_verse(raw) -> str`、`book_name(page) -> str|None`

- [ ] **Step 1: 建立 package.json**

`bible-oracle/package.json`：

```json
{
  "name": "bible-oracle",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test"
  }
}
```

- [ ] **Step 2: 寫失敗的測試**

`bible-oracle/tools/test_extract.py`：

```python
"""extract.py 的單元測試。執行：python3 -m unittest discover -s tools -v"""
import unittest
import extract


class TestCleanVerse(unittest.TestCase):
    def test_移除標籤與開頭節號(self):
        raw = '<span id="T_Eph5v22" class="verse">22</span> 你們作妻子的、當順服自己的丈夫、如同順服主．'
        self.assertEqual(extract.clean_verse(raw), '你們作妻子的、當順服自己的丈夫、如同順服主．')

    def test_還原_html_實體(self):
        self.assertEqual(extract.clean_verse('<span>1</span> 神說&#12289;要有光'), '神說、要有光')


class TestVerseRegex(unittest.TestCase):
    def test_抓得到紅字經文(self):
        """回歸測試：耶穌的話帶 class="wj"，正則少了 [^>]* 會漏掉 114 節。"""
        page = '<p id="Matt19v24" class="wj"><span class="verse">24</span> 駱駝穿過鍼的眼。</p>'
        found = extract.VERSE_RE.findall(page)
        self.assertEqual(len(found), 1)
        self.assertEqual(found[0][0], 'Matt')
        self.assertEqual((found[0][1], found[0][2]), ('19', '24'))

    def test_書卷代號含數字時仍正確切分(self):
        page = '<p id="1Cor7v9"><span class="verse">9</span> 倒不如嫁娶為妙。</p>'
        book, chap, verse, _ = extract.VERSE_RE.findall(page)[0]
        self.assertEqual((book, chap, verse), ('1Cor', '7', '9'))


class TestBookName(unittest.TestCase):
    def test_詩篇分卷正規化為詩篇(self):
        self.assertEqual(extract.book_name('<title>詩篇卷五（和合本）</title>'), '詩篇')

    def test_去除_bom(self):
        self.assertEqual(extract.book_name('<title>﻿約翰三書（和合本）</title>'), '約翰三書')

    def test_索引頁沒有書名(self):
        self.assertIsNone(extract.book_name('<title>舊約</title>'))


class TestKeepVerse(unittest.TestCase):
    def test_保留箴言語氣的句子(self):
        self.assertTrue(extract.keep_verse('喜樂的心、乃是良藥．憂傷的靈、使骨枯乾。'))

    def test_太短的不要(self):
        self.assertFalse(extract.keep_verse('要常常喜樂．'))

    def test_敘事句不要(self):
        self.assertFalse(extract.keep_verse('他們從約但河中取來的那十二塊石頭、約書亞就立在吉甲、你要記念。'))

    def test_沒有勸誡語氣的不要(self):
        self.assertFalse(extract.keep_verse('亞撒與他列祖同睡、葬在大衛城他列祖的墳地裡。'))


if __name__ == '__main__':
    unittest.main()
```

- [ ] **Step 3: 執行測試，確認失敗**

```bash
cd bible-oracle && python3 -m unittest discover -s tools -v
```

Expected: FAIL — `ModuleNotFoundError: No module named 'extract'`

- [ ] **Step 4: 寫 extract.py**

`bible-oracle/tools/extract.py`：

```python
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
ADMONITION_RE = re.compile(r'你|當|不可|凡|務要|要|人若|惟有|豈')
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
```

- [ ] **Step 5: 執行測試，確認通過**

```bash
cd bible-oracle && python3 -m unittest discover -s tools -v
```

Expected: PASS，11 個測試全綠

- [ ] **Step 6: 產生 fallback.json 並檢查數量**

```bash
cd bible-oracle && python3 tools/extract.py
```

Expected: `寫入 3800 節到 ../data/fallback.json`（若差距在 ±50 內視為正常，若差距很大代表過濾規則被改壞了）

```bash
cd bible-oracle && python3 -c "
import json; d=json.load(open('data/fallback.json'))
assert len(d)>3500, len(d)
assert all(v['text'] and v['ref'] and v['id'] for v in d)
assert len({v['id'] for v in d})==len(d), '有重複的 id'
print('兜底池檢查通過：', len(d), '節')
"
```

Expected: `兜底池檢查通過： 3800 節`

- [ ] **Step 7: Commit**

```bash
git add bible-oracle/package.json bible-oracle/tools/ bible-oracle/data/fallback.json
git commit -m "feat: 抽取兜底經文池（3,800 節）"
```

---

### Task 2: 比對邏輯

`match.js` 是全站唯一有分支邏輯的地方，先用假資料把它測到綠，再接真資料。

**Files:**
- Create: `bible-oracle/assets/match.js`
- Create: `bible-oracle/tests/match.test.js`

**Interfaces:**
- Consumes: 無（純函式，不讀檔）
- Produces:
  - `normalize(input: string) -> string`
  - `hashFNV1a(str: string) -> number`（unsigned 32-bit）
  - `scoreTopic(normalized: string, topic: Topic) -> number`
  - `pickTopic(normalized: string, topics: Topic[]) -> Topic | null`
  - `answer(question: string, data: OracleData, n = 0) -> Answer`
  - `THRESHOLD: number`（值為 3）
  - 型別：`Topic = { id, label, keywords: {w: string, s: number}[], verses: Verse[] }`；`Verse = { ref, id, text, quip }`；`OracleData = { topics: Topic[], fallback: {ref,id,text}[], wrappers: string[] }`；`Answer = { kind: 'topic'|'fallback', topicId: string|null, ref: string, verseId: string, text: string, quip: string, index: number, poolSize: number }`

- [ ] **Step 1: 寫失敗的測試**

`bible-oracle/tests/match.test.js`：

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize, hashFNV1a, scoreTopic, pickTopic, answer, THRESHOLD } from '../assets/match.js';

const 抱怨老婆 = {
  id: 'wife-complaint',
  label: '抱怨老婆',
  keywords: [{ w: '老婆', s: 3 }, { w: '太太', s: 3 }, { w: '吵架', s: 1 }],
  verses: [
    { ref: '以弗所書 5:22', id: 'Eph5v22', text: '妻一', quip: '補刀一' },
    { ref: '歌羅西書 3:18', id: 'Col3v18', text: '妻二', quip: '補刀二' },
    { ref: '箴言 21:9', id: 'Prov21v9', text: '妻三', quip: '補刀三' },
  ],
};

const 婚姻爭吵 = {
  id: 'marriage-fight',
  label: '婚姻爭吵',
  keywords: [{ w: '吵架', s: 1 }, { w: '冷戰', s: 1 }, { w: '離婚', s: 3 }, { w: '婚姻', s: 1 }],
  verses: [{ ref: '馬太福音 19:6', id: 'Matt19v6', text: '婚一', quip: '補刀四' }],
};

const data = {
  topics: [抱怨老婆, 婚姻爭吵],
  fallback: [
    { ref: '詩篇 17:6', id: 'Ps17v6', text: '兜底一' },
    { ref: '箴言 17:22', id: 'Prov17v22', text: '兜底二' },
  ],
  wrappers: ['神的意念高過你的意念。', '主已經回答了，是你還沒讀懂。'],
};

test('normalize 去除標點與空白', () => {
  assert.equal(normalize('我 老婆，不好！'), '我老婆不好');
});

test('normalize 把全形英數轉半形', () => {
  assert.equal(normalize('ＡＢＣ１２３'), 'abc123');
});

test('normalize 容忍 null 與 undefined', () => {
  assert.equal(normalize(null), '');
  assert.equal(normalize(undefined), '');
});

test('hashFNV1a 對同一字串永遠回傳同一值', () => {
  assert.equal(hashFNV1a('我老婆不好'), hashFNV1a('我老婆不好'));
});

test('hashFNV1a 對不同字串回傳不同值', () => {
  assert.notEqual(hashFNV1a('我老婆不好'), hashFNV1a('我老公不好'));
});

test('hashFNV1a 回傳非負的 32 位元整數', () => {
  const h = hashFNV1a('虛空的虛空');
  assert.ok(Number.isInteger(h) && h >= 0 && h <= 0xffffffff);
});

test('scoreTopic 累加命中的關鍵字權重', () => {
  assert.equal(scoreTopic('我老婆一直跟我吵架', 抱怨老婆), 4);
});

test('scoreTopic 沒命中時回傳 0', () => {
  assert.equal(scoreTopic('今天天氣很好', 抱怨老婆), 0);
});

test('pickTopic 低於門檻時回傳 null', () => {
  assert.equal(pickTopic('我們常常吵架', [抱怨老婆]), null);
});

test('pickTopic 取分數最高的主題', () => {
  assert.equal(pickTopic('我想離婚因為老婆很煩', data.topics).id, 'wife-complaint');
});

test('pickTopic 同分時取關鍵字表較長者（較具體）', () => {
  const 甲 = { id: 'a', label: '甲', keywords: [{ w: '錢', s: 3 }], verses: [] };
  const 乙 = { id: 'b', label: '乙', keywords: [{ w: '錢', s: 3 }, { w: '債', s: 1 }, { w: '窮', s: 1 }], verses: [] };
  assert.equal(pickTopic('沒錢', [甲, 乙]).id, 'b');
});

test('THRESHOLD 為 3', () => {
  assert.equal(THRESHOLD, 3);
});

test('命中主題時回傳該主題的經文與補刀', () => {
  const a = answer('我老婆不好', data);
  assert.equal(a.kind, 'topic');
  assert.equal(a.topicId, 'wife-complaint');
  assert.ok(抱怨老婆.verses.some((v) => v.ref === a.ref && v.quip === a.quip));
  assert.equal(a.poolSize, 3);
});

test('沒命中時走兜底並套用包裝詞', () => {
  const a = answer('我家的貓不吃飯', data);
  assert.equal(a.kind, 'fallback');
  assert.equal(a.topicId, null);
  assert.ok(data.fallback.some((v) => v.ref === a.ref));
  assert.ok(data.wrappers.includes(a.quip));
});

test('同一組 (問題, n) 連續呼叫 100 次都回傳同一節', () => {
  const first = answer('我老婆不好', data, 0);
  for (let i = 0; i < 100; i += 1) {
    assert.equal(answer('我老婆不好', data, 0).ref, first.ref);
  }
});

test('不同的 n 走到經文池中不同的位置', () => {
  const refs = new Set([0, 1, 2].map((n) => answer('我老婆不好', data, n).ref));
  assert.equal(refs.size, 3);
});

test('n 超過經文池長度時取模回繞', () => {
  assert.equal(answer('我老婆不好', data, 3).ref, answer('我老婆不好', data, 0).ref);
});

test('空字串走兜底且不拋錯', () => {
  const a = answer('', data);
  assert.equal(a.kind, 'fallback');
  assert.ok(a.text);
});
```

- [ ] **Step 2: 執行測試，確認失敗**

```bash
cd bible-oracle && node --test
```

Expected: FAIL — `Cannot find module .../assets/match.js`

- [ ] **Step 3: 寫 match.js**

`bible-oracle/assets/match.js`：

```js
/**
 * 比對邏輯：把使用者的問題對應到一節經文。
 * 純函式，不碰 DOM、不讀檔，所以可以直接在 node 下測試。
 */

/** 主題命中門檻：至少一個核心詞（3 分），或三個邊緣詞。 */
export const THRESHOLD = 3;

const 標點與空白 = /[\s、。，．！？；：「」『』〔〕（）(),.!?;:'"~～\-—]/g;

/** 正規化輸入：全形轉半形、去標點空白、轉小寫。中文不需要斷詞。 */
export function normalize(input) {
  return String(input ?? '')
    .replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(標點與空白, '')
    .toLowerCase();
}

/** FNV-1a 32-bit。用來把問題字串轉成穩定的亂數種子，確保分享出去的連結重現同一張卡。 */
export function hashFNV1a(str) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** 主題分數 = 所有命中關鍵字的權重總和。 */
export function scoreTopic(normalized, topic) {
  let score = 0;
  for (const keyword of topic.keywords) {
    if (normalized.includes(keyword.w)) score += keyword.s;
  }
  return score;
}

/** 取分數最高且達門檻的主題；同分時取關鍵字表較長者（較具體）。 */
export function pickTopic(normalized, topics) {
  const ranked = topics
    .map((topic) => ({ topic, score: scoreTopic(normalized, topic) }))
    .filter((entry) => entry.score >= THRESHOLD)
    .sort((a, b) => b.score - a.score || b.topic.keywords.length - a.topic.keywords.length);
  return ranked.length > 0 ? ranked[0].topic : null;
}

/**
 * 回答一個問題。
 * @param {string} question 使用者原始輸入
 * @param {{topics: Array, fallback: Array, wrappers: string[]}} data
 * @param {number} n 「再求一次」的位移，同時也是網址上的 n 參數
 */
export function answer(question, data, n = 0) {
  const normalized = normalize(question);
  const seed = hashFNV1a(normalized);
  const topic = pickTopic(normalized, data.topics);

  if (topic) {
    const verse = topic.verses[(seed + n) % topic.verses.length];
    return {
      kind: 'topic',
      topicId: topic.id,
      ref: verse.ref,
      verseId: verse.id,
      text: verse.text,
      quip: verse.quip,
      index: n,
      poolSize: topic.verses.length,
    };
  }

  const verse = data.fallback[(seed + n) % data.fallback.length];
  return {
    kind: 'fallback',
    topicId: null,
    ref: verse.ref,
    verseId: verse.id,
    text: verse.text,
    quip: data.wrappers[(seed + n) % data.wrappers.length],
    index: n,
    poolSize: data.fallback.length,
  };
}
```

- [ ] **Step 4: 執行測試，確認通過**

```bash
cd bible-oracle && node --test
```

Expected: PASS，18 個測試全綠

- [ ] **Step 5: Commit**

```bash
git add bible-oracle/assets/match.js bible-oracle/tests/match.test.js
git commit -m "feat: 加入問題比對與選經文邏輯"
```

---

### Task 3: 策展庫種子與原文驗證

寫下前 5 個主題，並建立守護整站命脈的驗證腳本 —— 經文一字不改。

**Files:**
- Create: `bible-oracle/data/topics.json`
- Create: `bible-oracle/tools/verify.py`

**Interfaces:**
- Consumes: `extract.py` 的 `VERSE_RE`、`clean_verse`、`book_name`、`iter_verses`
- Produces: `data/topics.json`，結構為 `{"wrappers": string[], "topics": Topic[]}`，`Topic` 與 `Verse` 型別同 Task 2

- [ ] **Step 1: 寫 topics.json 的前 5 個主題**

以下 21 節經文的文字已逐字核對過 `bible-cut/CUT/`，請原樣貼上、一個字都不要動。

`bible-oracle/data/topics.json`：

```json
{
  "wrappers": [
    "神的意念高過你的意念。",
    "你所求的，不一定是你所需的。",
    "主已經回答了，是你還沒讀懂。",
    "這節經文今天單單為你預備。",
    "不要問為什麼是這一節，要問你為什麼還在問。",
    "主的安排自有祂的美意。",
    "你若不明白，是因為你讀得還不夠多。",
    "領受吧，弟兄姊妹。"
  ],
  "topics": [
    {
      "id": "wife-complaint",
      "label": "抱怨老婆",
      "keywords": [
        { "w": "老婆", "s": 3 }, { "w": "妻子", "s": 3 }, { "w": "太太", "s": 3 },
        { "w": "黃臉婆", "s": 3 }, { "w": "牽手", "s": 1 }, { "w": "另一半", "s": 1 },
        { "w": "她很煩", "s": 1 }, { "w": "碎念", "s": 1 }
      ],
      "verses": [
        {
          "ref": "以弗所書 5:22",
          "id": "Eph5v22",
          "text": "你們作妻子的、當順服自己的丈夫、如同順服主．",
          "quip": "弟兄，問題不在她好不好，而在你還沒帶她上主日學。"
        },
        {
          "ref": "歌羅西書 3:18",
          "id": "Col3v18",
          "text": "你們作妻子的、當順服自己的丈夫、這在主裡面是相宜的。",
          "quip": "「相宜」兩個字很溫柔對不對？保羅是很懂得體恤人的。"
        },
        {
          "ref": "彼得前書 3:1",
          "id": "1Pet3v1",
          "text": "你們作妻子的、要順服自己的丈夫．這樣、若有不信從道理的丈夫、他們雖然不聽道、也可以因妻子的品行被感化過來．",
          "quip": "你看，連你這樣的丈夫，聖經都還沒放棄。這是何等的恩典。"
        },
        {
          "ref": "箴言 21:9",
          "id": "Prov21v9",
          "text": "寧可住在房頂的角上、不在寬闊的房屋、與爭吵的婦人同住。",
          "quip": "所羅門有七百個妻子，他說這話是有份量的。今晚就上去吧。"
        },
        {
          "ref": "箴言 27:15",
          "id": "Prov27v15",
          "text": "大雨之日連連滴漏、和爭吵的婦人一樣．",
          "quip": "主用了一個這麼詩意的比喻，可見祂是真的懂你。"
        }
      ]
    },
    {
      "id": "bad-boss",
      "label": "老闆爛、想離職",
      "keywords": [
        { "w": "老闆", "s": 3 }, { "w": "主管", "s": 3 }, { "w": "上司", "s": 3 },
        { "w": "離職", "s": 3 }, { "w": "辭職", "s": 3 }, { "w": "公司", "s": 1 },
        { "w": "加班", "s": 1 }, { "w": "工作", "s": 1 }, { "w": "職場", "s": 1 }
      ],
      "verses": [
        {
          "ref": "以弗所書 6:5",
          "id": "Eph6v5",
          "text": "你們作僕人的、要懼怕戰兢、用誠實的心聽從你們肉身的主人、好像聽從基督一般。",
          "quip": "「懼怕戰兢」——你看，主早就知道你上班是什麼感覺，而且祂認為這樣是對的。"
        },
        {
          "ref": "彼得前書 2:18",
          "id": "1Pet2v18",
          "text": "你們作僕人的、凡事要存敬畏的心順服主人．不但順服那善良溫和的、就是那乖僻的也要順服。",
          "quip": "特別把「乖僻的」寫出來，是怕你以為有例外。沒有例外。"
        },
        {
          "ref": "歌羅西書 3:22",
          "id": "Col3v22",
          "text": "你們作僕人的、要凡事聽從你們肉身的主人、不要只在眼前事奉、像是討人喜歡的、總要存心誠實敬畏主．",
          "quip": "所以老闆不在的時候你也要認真工作。這節經文在辦公室特別實用。"
        },
        {
          "ref": "提摩太前書 6:1",
          "id": "1Tim6v1",
          "text": "凡在軛下作僕人的、當以自己主人配受十分的恭敬、免得神的名和道理、被人褻瀆。",
          "quip": "你抱怨老闆，褻瀆的其實是神的名。這個責任有點重，是不是？"
        }
      ]
    },
    {
      "id": "money-trouble",
      "label": "沒錢、負債、想發財",
      "keywords": [
        { "w": "沒錢", "s": 3 }, { "w": "負債", "s": 3 }, { "w": "欠債", "s": 3 },
        { "w": "發財", "s": 3 }, { "w": "薪水", "s": 3 }, { "w": "投資", "s": 3 },
        { "w": "存款", "s": 1 }, { "w": "買房", "s": 1 }, { "w": "窮", "s": 1 }, { "w": "貸款", "s": 1 }
      ],
      "verses": [
        {
          "ref": "提摩太前書 6:10",
          "id": "1Tim6v10",
          "text": "貪財是萬惡之根．有人貪戀錢財、就被引誘離了真道、用許多愁苦把自己刺透了。",
          "quip": "你現在的愁苦，是自己刺的。奉獻箱在門口。"
        },
        {
          "ref": "馬太福音 6:24",
          "id": "Matt6v24",
          "text": "一個人不能事奉兩個主．不是惡這個愛那個、就是重這個輕那個．你們不能又事奉神、又事奉瑪門。〔瑪門是財利的意思〕",
          "quip": "既然不能兩個都要，那就別想錢了。這樣問題不就解決了嗎。"
        },
        {
          "ref": "馬太福音 19:24",
          "id": "Matt19v24",
          "text": "我又告訴你們、駱駝穿過鍼的眼、比財主進神的國還容易呢。",
          "quip": "所以你沒錢是好消息。要為此獻上感謝。"
        },
        {
          "ref": "箴言 22:7",
          "id": "Prov22v7",
          "text": "富戶管轄窮人．欠債的是債主的僕人。",
          "quip": "聖經沒有叫你還債，只是告訴你你現在是誰的僕人。認清身分很重要。"
        }
      ]
    },
    {
      "id": "despair",
      "label": "憂鬱、人生沒意義",
      "keywords": [
        { "w": "憂鬱", "s": 3 }, { "w": "想死", "s": 3 }, { "w": "沒意義", "s": 3 },
        { "w": "痛苦", "s": 3 }, { "w": "難過", "s": 3 }, { "w": "撐不下去", "s": 3 },
        { "w": "累", "s": 1 }, { "w": "空虛", "s": 1 }, { "w": "焦慮", "s": 1 }, { "w": "失眠", "s": 1 }
      ],
      "verses": [
        {
          "ref": "傳道書 1:2",
          "id": "Eccles1v2",
          "text": "傳道者說、虛空的虛空、虛空的虛空．凡事都是虛空。",
          "quip": "你看，聖經同意你。而且是用比你更絕望的語氣說的。"
        },
        {
          "ref": "傳道書 1:18",
          "id": "Eccles1v18",
          "text": "因為多有智慧、就多有愁煩．加增知識的、就加增憂傷。",
          "quip": "所以解決辦法很簡單：不要再想那麼多了。"
        },
        {
          "ref": "腓立比書 4:4",
          "id": "Phil4v4",
          "text": "你們要靠主常常喜樂．我再說、你們要喜樂。",
          "quip": "保羅講了兩次，就是知道你第一次沒有照做。現在請喜樂。"
        },
        {
          "ref": "箴言 17:22",
          "id": "Prov17v22",
          "text": "喜樂的心、乃是良藥．憂傷的靈、使骨枯乾。",
          "quip": "既然是良藥，就不需要看醫生了。省下的掛號費可以奉獻。"
        }
      ]
    },
    {
      "id": "lust-single",
      "label": "單身、慾望",
      "keywords": [
        { "w": "單身", "s": 3 }, { "w": "交不到", "s": 3 }, { "w": "約砲", "s": 3 },
        { "w": "自慰", "s": 3 }, { "w": "性慾", "s": 3 }, { "w": "看a片", "s": 3 },
        { "w": "寂寞", "s": 1 }, { "w": "脫魯", "s": 1 }, { "w": "曖昧", "s": 1 }
      ],
      "verses": [
        {
          "ref": "哥林多前書 7:9",
          "id": "1Cor7v9",
          "text": "倘若自己禁止不住、就可以嫁娶。與其慾火攻心、倒不如嫁娶為妙。",
          "quip": "保羅給了你兩個選項，而且他明顯比較推薦第一個。"
        },
        {
          "ref": "哥林多前書 7:1",
          "id": "1Cor7v1",
          "text": "論到你們信上所提的事、我說男不近女倒好。",
          "quip": "你不是單身，你是照著聖經活。要為此喜樂。"
        },
        {
          "ref": "馬太福音 5:28",
          "id": "Matt5v28",
          "text": "只是我告訴你們、凡看見婦女就動淫念的、這人心裡已經與他犯姦淫了。",
          "quip": "既然想了就等於做了，那你其實已經很有經驗了。"
        },
        {
          "ref": "帖撒羅尼迦前書 4:3",
          "id": "1Thess4v3",
          "text": "神的旨意就是要你們成為聖潔、遠避淫行．",
          "quip": "你問神的旨意是什麼，這裡直接寫出來了。不客氣。"
        }
      ]
    }
  ]
}
```

- [ ] **Step 2: 寫 verify.py**

`bible-oracle/tools/verify.py`：

```python
#!/usr/bin/env python3
"""驗證 data/topics.json 的每一節經文與 bible-cut/CUT 原檔一字不差。

這是全站的命脈：笑點來自「這真的是聖經寫的」，只要改過一個字就全垮了。
任何不符即以非零狀態碼結束。
"""
import json
import os
import sys

from extract import CUT_DIR, iter_verses

HERE = os.path.dirname(os.path.abspath(__file__))
TOPICS_PATH = os.path.join(HERE, '..', 'data', 'topics.json')


def build_index():
    """節錨點 id -> (期望的 ref 字串, 原文)。"""
    index = {}
    for name, _stem, verse_id, chap, verse, text in iter_verses(CUT_DIR):
        index[verse_id] = (f'{name} {chap}:{verse}', text)
    return index


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

    if errors:
        print(f'✗ 驗證失敗，{len(errors)} 個問題：\n')
        for error in errors:
            print(f'  {error}')
        sys.exit(1)

    print(f'✓ {len(data["topics"])} 個主題、{checked} 節經文，全部與原檔一字不差')


if __name__ == '__main__':
    main()
```

- [ ] **Step 3: 執行驗證，確認通過**

```bash
cd bible-oracle && python3 tools/verify.py
```

Expected: `✓ 5 個主題、21 節經文，全部與原檔一字不差`

- [ ] **Step 4: 確認驗證腳本真的抓得到錯（故意改壞一個字）**

```bash
cd bible-oracle && python3 -c "
import json,io
d=json.load(open('data/topics.json',encoding='utf-8'))
d['topics'][0]['verses'][0]['text']='你們作妻子的、當順服自己的老公、如同順服主．'
json.dump(d,open('/tmp/broken-topics.json','w',encoding='utf-8'),ensure_ascii=False)
" && cp data/topics.json /tmp/topics-backup.json && cp /tmp/broken-topics.json data/topics.json && python3 tools/verify.py; echo "離開碼：$?"; cp /tmp/topics-backup.json data/topics.json
```

Expected: 印出「經文與原檔不符」並顯示兩行對照，離開碼為 1。還原後再跑一次 `python3 tools/verify.py` 應回到通過。

- [ ] **Step 5: Commit**

```bash
git add bible-oracle/data/topics.json bible-oracle/tools/verify.py
git commit -m "feat: 策展庫前五個主題與原文驗證腳本"
```

---

### Task 4: 端到端網頁

把資料、比對邏輯和畫面接起來。做完這一步網站就能問能答了。

**Files:**
- Create: `bible-oracle/index.html`
- Create: `bible-oracle/assets/style.css`
- Create: `bible-oracle/assets/app.js`

**Interfaces:**
- Consumes: `match.js` 的 `answer(question, data, n)`；`data/topics.json`（`{wrappers, topics}`）；`data/fallback.json`（`[{ref,id,text}]`）
- Produces: `app.js` 內部函式 `loadData() -> Promise<OracleData>`、`render(answerObj, question)`、`ask(question, n)`、`showNotice(message)`；DOM 契約：`#question`、`#ask-form`、`#answer`、`#asked-text`、`#verse-text`、`#verse-ref`、`#quip`、`#again`、`#notice`

- [ ] **Step 1: 寫 index.html**

`bible-oracle/index.html`：

```html
<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>主的旨意</title>
<meta name="description" content="把你的煩惱交給主。祂會用經文回答你。">
<link rel="stylesheet" href="assets/style.css">
</head>
<body>
<main class="page">
  <header class="masthead">
    <div class="rule"></div>
    <h1>主 的 旨 意</h1>
    <p class="subtitle">凡勞苦擔重擔的人、可以到這裡來</p>
    <div class="rule"></div>
  </header>

  <form id="ask-form" class="ask" autocomplete="off">
    <label for="question" class="visually-hidden">你的煩惱</label>
    <input id="question" name="question" type="text" maxlength="100"
           placeholder="說出你的煩惱⋯⋯">
    <button type="submit">求 問</button>
  </form>

  <p id="notice" class="notice" hidden></p>

  <section id="answer" class="answer" hidden>
    <p class="asked">你問：<span id="asked-text"></span></p>
    <blockquote id="verse-text" class="verse"></blockquote>
    <cite id="verse-ref" class="ref"></cite>
    <p id="quip" class="quip"></p>
    <div class="actions">
      <button type="button" id="again">再 求 一 次</button>
    </div>
  </section>

  <footer class="colophon">
    <p>經文引自和合本，一字未改。</p>
  </footer>
</main>
<script type="module" src="assets/app.js"></script>
</body>
</html>
```

- [ ] **Step 2: 寫 style.css**

`bible-oracle/assets/style.css`：

```css
/* 莊嚴聖經風：米白紙、襯線體、暗金。安靜、無動畫。 */
:root {
  --paper: #f4f0e6;
  --ink: #241f18;
  --gold: #8a7434;
  --faded: #7a7266;
  --serif: "Noto Serif TC", "Songti TC", "PMingLiU", "SimSun", serif;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  padding: 3rem 1.25rem 4rem;
  background: var(--paper);
  color: var(--ink);
  font-family: var(--serif);
  line-height: 1.9;
}

.page { max-width: 40rem; margin: 0 auto; }

.masthead { text-align: center; margin-bottom: 3rem; }
.masthead h1 {
  margin: 1.2rem 0 0.6rem;
  font-size: 2rem;
  font-weight: 400;
  letter-spacing: 0.4em;
  text-indent: 0.4em;
}
.subtitle { margin: 0 0 1.2rem; color: var(--faded); font-size: 0.9rem; letter-spacing: 0.15em; }
.rule { height: 1px; background: var(--gold); opacity: 0.55; }

.ask { display: flex; gap: 0.75rem; }
.ask input {
  flex: 1;
  padding: 0.7rem 0.9rem;
  border: 1px solid rgba(138, 116, 52, 0.5);
  background: transparent;
  color: var(--ink);
  font-family: var(--serif);
  font-size: 1rem;
}
.ask input:focus { outline: 1px solid var(--gold); }

button {
  padding: 0.7rem 1.1rem;
  border: 1px solid var(--gold);
  background: transparent;
  color: var(--gold);
  font-family: var(--serif);
  font-size: 0.95rem;
  letter-spacing: 0.15em;
  cursor: pointer;
}
button:hover { background: rgba(138, 116, 52, 0.08); }

.notice { margin: 1.5rem 0 0; color: var(--faded); font-size: 0.95rem; }

.answer { margin-top: 3rem; }
.asked { margin: 0 0 2rem; color: var(--faded); font-size: 0.9rem; letter-spacing: 0.05em; }
.verse {
  margin: 0;
  padding: 0;
  font-size: 1.35rem;
  line-height: 2.1;
  text-indent: 2em;
}
.ref {
  display: block;
  margin-top: 1.2rem;
  text-align: right;
  font-style: normal;
  color: var(--gold);
  letter-spacing: 0.1em;
}
.quip {
  margin: 2.5rem 0 0;
  padding-top: 1.5rem;
  border-top: 1px solid rgba(138, 116, 52, 0.35);
  color: var(--faded);
  font-size: 1rem;
}
.actions { margin-top: 2.5rem; display: flex; gap: 0.75rem; }

.colophon { margin-top: 5rem; text-align: center; color: var(--faded); font-size: 0.8rem; }

.visually-hidden {
  position: absolute; width: 1px; height: 1px;
  padding: 0; margin: -1px; overflow: hidden;
  clip: rect(0 0 0 0); white-space: nowrap; border: 0;
}
```

- [ ] **Step 3: 寫 app.js**

`bible-oracle/assets/app.js`：

```js
/**
 * 接線層：載資料、綁事件、渲染。
 * 這裡不放任何業務邏輯 —— 比對規則全在 match.js。
 */
import { answer } from './match.js';

/** topics.json 或 fallback.json 掛掉時的緊急經文池，確保網站永遠答得出來。 */
const 緊急經文池 = [
  { ref: '以弗所書 5:22', id: 'Eph5v22', text: '你們作妻子的、當順服自己的丈夫、如同順服主．' },
  { ref: '以弗所書 6:5', id: 'Eph6v5', text: '你們作僕人的、要懼怕戰兢、用誠實的心聽從你們肉身的主人、好像聽從基督一般。' },
  { ref: '歌羅西書 3:18', id: 'Col3v18', text: '你們作妻子的、當順服自己的丈夫、這在主裡面是相宜的。' },
  { ref: '歌羅西書 3:22', id: 'Col3v22', text: '你們作僕人的、要凡事聽從你們肉身的主人、不要只在眼前事奉、像是討人喜歡的、總要存心誠實敬畏主．' },
  { ref: '彼得前書 3:1', id: '1Pet3v1', text: '你們作妻子的、要順服自己的丈夫．這樣、若有不信從道理的丈夫、他們雖然不聽道、也可以因妻子的品行被感化過來．' },
  { ref: '彼得前書 2:18', id: '1Pet2v18', text: '你們作僕人的、凡事要存敬畏的心順服主人．不但順服那善良溫和的、就是那乖僻的也要順服。' },
  { ref: '箴言 21:9', id: 'Prov21v9', text: '寧可住在房頂的角上、不在寬闊的房屋、與爭吵的婦人同住。' },
  { ref: '箴言 27:15', id: 'Prov27v15', text: '大雨之日連連滴漏、和爭吵的婦人一樣．' },
  { ref: '箴言 22:7', id: 'Prov22v7', text: '富戶管轄窮人．欠債的是債主的僕人。' },
  { ref: '箴言 17:22', id: 'Prov17v22', text: '喜樂的心、乃是良藥．憂傷的靈、使骨枯乾。' },
  { ref: '箴言 13:24', id: 'Prov13v24', text: '不忍用杖打兒子的、是恨惡他．疼愛兒子的、隨時管教。' },
  { ref: '提摩太前書 2:12', id: '1Tim2v12', text: '我不許女人講道、也不許他轄管男人、只要沉靜。' },
  { ref: '提摩太前書 6:10', id: '1Tim6v10', text: '貪財是萬惡之根．有人貪戀錢財、就被引誘離了真道、用許多愁苦把自己刺透了。' },
  { ref: '提摩太前書 6:1', id: '1Tim6v1', text: '凡在軛下作僕人的、當以自己主人配受十分的恭敬、免得神的名和道理、被人褻瀆。' },
  { ref: '馬太福音 6:24', id: 'Matt6v24', text: '一個人不能事奉兩個主．不是惡這個愛那個、就是重這個輕那個．你們不能又事奉神、又事奉瑪門。〔瑪門是財利的意思〕' },
  { ref: '馬太福音 6:34', id: 'Matt6v34', text: '所以不要為明天憂慮．因為明天自有明天的憂慮．一天的難處一天當就夠了。' },
  { ref: '馬太福音 19:24', id: 'Matt19v24', text: '我又告訴你們、駱駝穿過鍼的眼、比財主進神的國還容易呢。' },
  { ref: '哥林多前書 14:34', id: '1Cor14v34', text: '婦女在會中要閉口不言、像在聖徒的眾教會一樣．因為不准他們說話．他們總要順服、正如律法所說的。' },
  { ref: '傳道書 1:2', id: 'Eccles1v2', text: '傳道者說、虛空的虛空、虛空的虛空．凡事都是虛空。' },
  { ref: '傳道書 1:18', id: 'Eccles1v18', text: '因為多有智慧、就多有愁煩．加增知識的、就加增憂傷。' },
];

const 緊急包裝詞 = [
  '神的意念高過你的意念。',
  '主已經回答了，是你還沒讀懂。',
  '你所求的，不一定是你所需的。',
];

const el = {
  form: document.querySelector('#ask-form'),
  input: document.querySelector('#question'),
  notice: document.querySelector('#notice'),
  answer: document.querySelector('#answer'),
  asked: document.querySelector('#asked-text'),
  verse: document.querySelector('#verse-text'),
  ref: document.querySelector('#verse-ref'),
  quip: document.querySelector('#quip'),
  again: document.querySelector('#again'),
};

let data = null;
let 目前的問題 = '';
let 目前的位移 = 0;

async function loadJSON(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`${path} ${response.status}`);
  return response.json();
}

/** 載入資料；任何一份掛掉就退到緊急池，網站仍然可用。 */
async function loadData() {
  try {
    const [topicsFile, fallback] = await Promise.all([
      loadJSON('data/topics.json'),
      loadJSON('data/fallback.json'),
    ]);
    return { topics: topicsFile.topics, wrappers: topicsFile.wrappers, fallback };
  } catch (error) {
    console.warn('資料載入失敗，改用緊急經文池：', error);
    return { topics: [], wrappers: 緊急包裝詞, fallback: 緊急經文池 };
  }
}

function showNotice(message) {
  el.notice.textContent = message;
  el.notice.hidden = false;
  el.answer.hidden = true;
}

function render(result, question) {
  el.notice.hidden = true;
  el.asked.textContent = question.length > 100 ? `${question.slice(0, 100)}⋯` : question;
  el.verse.textContent = result.text;
  el.ref.textContent = `—— ${result.ref}`;
  el.quip.textContent = result.quip;
  el.answer.hidden = false;
  el.again.hidden = result.poolSize <= 1;
}

function ask(question, n) {
  目前的問題 = question;
  目前的位移 = n;
  render(answer(question, data, n), question);
}

el.form.addEventListener('submit', (event) => {
  event.preventDefault();
  const question = el.input.value.trim();
  if (!question) {
    showNotice('你的問題呢？「你們祈求、就給你們」');
    return;
  }
  ask(question, 0);
});

el.again.addEventListener('click', () => {
  ask(目前的問題, 目前的位移 + 1);
});

data = await loadData();
```

- [ ] **Step 4: 開起來手動測**

```bash
cd bible-oracle && python3 -m http.server 8000
```

在瀏覽器打開 `http://localhost:8000`，逐項確認：

1. 輸入「我老婆不好」→ 出現 以弗所書／歌羅西書／彼得前書／箴言 其中一節加補刀
2. 按「再求一次」→ 換成同主題的另一節
3. 輸入「我家的貓不吃飯」→ 出現一節兜底經文加包裝詞
4. 空白送出 → 顯示「你的問題呢？「你們祈求、就給你們」」
5. 輸入「老闆很爛」「沒錢」「好想死」「單身好久」→ 各自命中對應主題

- [ ] **Step 5: 確認資料載入失敗時仍可用**

```bash
cd bible-oracle && mv data/topics.json /tmp/ && python3 -m http.server 8000
```

在瀏覽器輸入任何問題，應該仍然得到經文（來自緊急池），且 console 有「資料載入失敗」的警告。確認後還原：

```bash
mv /tmp/topics.json bible-oracle/data/
```

- [ ] **Step 6: Commit**

```bash
git add bible-oracle/index.html bible-oracle/assets/style.css bible-oracle/assets/app.js
git commit -m "feat: 端到端問答頁面"
```

---

### Task 5: 網址分享

`?q=` 讓別人點開看到同一張卡；`&n=` 讓「再求一次」之後複製的連結也對得上。

**Files:**
- Modify: `bible-oracle/assets/app.js`

**Interfaces:**
- Consumes: Task 4 的 `ask(question, n)`、`el`
- Produces: `readURL() -> {question: string, n: number}`、`writeURL(question, n)`

- [ ] **Step 1: 加入網址讀寫**

在 `app.js` 中 `ask` 函式的**上方**加入：

```js
/** 控制字元不該出現在網址參數裡，一律濾掉。 */
const 控制字元 = /[\u0000-\u001f\u007f]/g;

/** 從網址讀出問題與位移；參數不合法時當作沒有。 */
function readURL() {
  const params = new URLSearchParams(window.location.search);
  const question = (params.get('q') ?? '').replace(控制字元, '').trim().slice(0, 100);
  const n = Number.parseInt(params.get('n') ?? '0', 10);
  return { question, n: Number.isInteger(n) && n >= 0 ? n : 0 };
}

/** 把目前的問題與位移寫回網址，讓使用者看到什麼、複製出去就是什麼。 */
function writeURL(question, n) {
  const params = new URLSearchParams({ q: question });
  if (n > 0) params.set('n', String(n));
  window.history.replaceState(null, '', `?${params.toString()}`);
}
```

- [ ] **Step 2: 讓 ask 同步網址**

把 `ask` 函式改成：

```js
function ask(question, n) {
  目前的問題 = question;
  目前的位移 = n;
  writeURL(question, n);
  render(answer(question, data, n), question);
}
```

- [ ] **Step 3: 載入時自動作答**

把檔案最後一行 `data = await loadData();` 改成：

```js
data = await loadData();

const 來自網址 = readURL();
if (來自網址.question) {
  el.input.value = 來自網址.question;
  ask(來自網址.question, 來自網址.n);
}
```

- [ ] **Step 4: 手動測分享連結**

```bash
cd bible-oracle && python3 -m http.server 8000
```

1. 打開 `http://localhost:8000/?q=我老婆不好` → 輸入框自動填入，直接顯示答案
2. 記下顯示的出處，重新整理 → 出處完全相同
3. 按「再求一次」→ 網址列自動變成 `?q=我老婆不好&n=1`，且經文換了一節
4. 複製那個網址，開新分頁貼上 → 看到的是**同一節**（不是第一節）
5. 打開 `http://localhost:8000/?q=` → 正常顯示首頁，不顯示答案

- [ ] **Step 5: Commit**

```bash
git add bible-oracle/assets/app.js
git commit -m "feat: 網址帶問題與位移，分享連結可重現同一張卡"
```

---

### Task 6: 答案卡產圖

canvas 手繪 840×1200 直式卡。**不用 html2canvas** —— 它處理中文字型常常缺字或行高跑掉，自己畫反而穩定。

**Files:**
- Create: `bible-oracle/assets/card.js`
- Modify: `bible-oracle/index.html`（加一顆按鈕）
- Modify: `bible-oracle/assets/app.js`（接上按鈕）

**Interfaces:**
- Consumes: Task 2 的 `Answer` 物件（用到 `text`、`ref`、`quip`）
- Produces: `drawCard(result, question) -> Promise<HTMLCanvasElement>`、`downloadCard(result, question) -> Promise<void>`

- [ ] **Step 1: 寫 card.js**

`bible-oracle/assets/card.js`：

```js
/**
 * 把答案畫成一張 840×1200 的直式卡，供分享用。
 * 中文沒有詞界，換行只能逐字量寬度，不能靠空白切。
 */
const 寬 = 840;
const 高 = 1200;
const 邊距 = 90;
const 紙色 = '#f4f0e6';
const 墨色 = '#241f18';
const 金色 = '#8a7434';
const 淡色 = '#7a7266';
const 字體 = '"Noto Serif TC", "Songti TC", "PMingLiU", serif';

/** 逐字累加量寬，超過就換行。回傳每一行的字串。 */
function wrapCJK(ctx, text, maxWidth) {
  const lines = [];
  let line = '';
  for (const ch of text) {
    const 試 = line + ch;
    if (ctx.measureText(試).width > maxWidth && line !== '') {
      lines.push(line);
      line = ch;
    } else {
      line = 試;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** 畫出多行文字，回傳畫完之後的 y 座標。 */
function drawLines(ctx, lines, x, y, lineHeight) {
  let cursor = y;
  for (const line of lines) {
    ctx.fillText(line, x, cursor);
    cursor += lineHeight;
  }
  return cursor;
}

export async function drawCard(result, question) {
  const canvas = document.createElement('canvas');
  canvas.width = 寬;
  canvas.height = 高;
  const ctx = canvas.getContext('2d');

  // 字型要先確定載好，否則會用預設字型畫出來
  if (document.fonts && document.fonts.ready) {
    await document.fonts.ready;
  }

  ctx.fillStyle = 紙色;
  ctx.fillRect(0, 0, 寬, 高);

  // 上下金線
  ctx.fillStyle = 金色;
  ctx.globalAlpha = 0.55;
  ctx.fillRect(邊距, 120, 寬 - 邊距 * 2, 1);
  ctx.fillRect(邊距, 高 - 150, 寬 - 邊距 * 2, 1);
  ctx.globalAlpha = 1;

  // 站名
  ctx.fillStyle = 墨色;
  ctx.font = `36px ${字體}`;
  ctx.textAlign = 'center';
  ctx.fillText('主 的 旨 意', 寬 / 2, 90);

  ctx.textAlign = 'left';
  const 內寬 = 寬 - 邊距 * 2;
  let y = 210;

  // 問題
  ctx.fillStyle = 淡色;
  ctx.font = `26px ${字體}`;
  const 問 = question.length > 40 ? `${question.slice(0, 40)}⋯` : question;
  y = drawLines(ctx, wrapCJK(ctx, `你問：${問}`, 內寬), 邊距, y, 44) + 60;

  // 經文
  ctx.fillStyle = 墨色;
  ctx.font = `40px ${字體}`;
  y = drawLines(ctx, wrapCJK(ctx, result.text, 內寬), 邊距, y, 72) + 30;

  // 出處
  ctx.fillStyle = 金色;
  ctx.font = `26px ${字體}`;
  ctx.textAlign = 'right';
  ctx.fillText(`—— ${result.ref}`, 寬 - 邊距, y);
  ctx.textAlign = 'left';
  y += 90;

  // 補刀（上方一條淡金分隔線）
  ctx.fillStyle = 金色;
  ctx.globalAlpha = 0.35;
  ctx.fillRect(邊距, y - 40, 內寬, 1);
  ctx.globalAlpha = 1;
  ctx.fillStyle = 淡色;
  ctx.font = `28px ${字體}`;
  drawLines(ctx, wrapCJK(ctx, result.quip, 內寬), 邊距, y, 48);

  // 頁腳
  ctx.fillStyle = 淡色;
  ctx.font = `22px ${字體}`;
  ctx.textAlign = 'center';
  ctx.fillText('經文引自和合本，一字未改。', 寬 / 2, 高 - 100);

  return canvas;
}

export async function downloadCard(result, question) {
  const canvas = await drawCard(result, question);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('產圖失敗');
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `主的旨意-${result.ref.replace(/[\s:]/g, '')}.png`;
  link.click();
  URL.revokeObjectURL(url);
}
```

- [ ] **Step 2: 在 index.html 加按鈕**

把 `<div class="actions">` 區塊改成：

```html
    <div class="actions">
      <button type="button" id="again">再 求 一 次</button>
      <button type="button" id="save">存 成 圖 片</button>
    </div>
```

- [ ] **Step 3: 在 app.js 接上按鈕**

在 `import { answer } from './match.js';` 下一行加入：

```js
import { downloadCard } from './card.js';
```

在 `el` 物件中加入一行：

```js
  save: document.querySelector('#save'),
```

在 `let 目前的位移 = 0;` 下一行加入：

```js
let 目前的答案 = null;
```

把 `ask` 函式改成（記住目前的答案，供產圖使用）：

```js
function ask(question, n) {
  目前的問題 = question;
  目前的位移 = n;
  目前的答案 = answer(question, data, n);
  writeURL(question, n);
  render(目前的答案, question);
}
```

在 `el.again` 的事件監聽下方加入：

```js
el.save.addEventListener('click', async () => {
  if (!目前的答案) return;
  try {
    await downloadCard(目前的答案, 目前的問題);
  } catch (error) {
    console.warn('產圖失敗，改為複製文字：', error);
    const 文字 = `${目前的答案.text}\n—— ${目前的答案.ref}\n\n${目前的答案.quip}`;
    await navigator.clipboard.writeText(文字);
    showNotice('產圖失敗，已改為複製文字到剪貼簿。');
  }
});
```

- [ ] **Step 4: 手動測產圖**

```bash
cd bible-oracle && python3 -m http.server 8000
```

1. 問「我老婆不好」→ 按「存成圖片」→ 下載一張 PNG
2. 打開那張圖，確認：中文沒有變成方框或亂碼、長經文有正確換行沒有超出邊界、出處靠右、補刀在金線下方
3. 問「沒錢」直到抽中馬太福音 6:24（那節帶〔瑪門是財利的意思〕的括號註解，是全庫最長的一節），確認長文換行仍然正常沒有溢出畫布底部

- [ ] **Step 5: Commit**

```bash
git add bible-oracle/assets/card.js bible-oracle/index.html bible-oracle/assets/app.js
git commit -m "feat: 答案卡 canvas 產圖與下載"
```

---

### Task 7: 補滿三十個主題

前面六個任務做完，網站已經能用了。這一個任務是內容工作，也是整站價值所在 —— 每寫完一組就 commit，隨時停下來都有可用的網站。

**Files:**
- Modify: `bible-oracle/data/topics.json`
- Modify: `bible-oracle/tests/match.test.js`

**Interfaces:**
- Consumes: Task 3 的 `topics.json` 結構與 `tools/verify.py`；Task 1 的 `extract.iter_verses`
- Produces: 30 個主題的完整策展庫

**寫作流程**（每個主題重複一次）：

1. 在 `bible-cut/CUT/` 裡找到要用的經文，用這段指令取出**一字不差**的原文與出處：

```bash
cd bible-oracle && python3 -c "
import sys; sys.path.insert(0, 'tools')
from extract import CUT_DIR, iter_verses
想要 = {'1Cor14v34', 'Lev15v19'}   # 改成你要的節錨點
for name, _stem, vid, chap, verse, text in iter_verses(CUT_DIR):
    if vid in 想要:
        print(f'{vid}  {name} {chap}:{verse}')
        print(f'  {text}')
"
```

2. 貼進 `topics.json`，補上 `quip`（遵守 Global Constraints 的補刀寫作規範）
3. 跑 `python3 tools/verify.py` —— 必須通過才能 commit

**主題清單**（Task 3 已完成前 5 個，以下為其餘 25 個）：

每個主題都要寫**兩組**東西：`keywords`（精準比對用的核心詞）與 `phrases`（向量比對用的自然例句，每題 6–9 句整句、刻意涵蓋關鍵字沒有的講法）。見 Task 8 Step 11 的寫作原則。

| 群組 | id | 主題 | 核心關鍵字（3 分）起頭 |
|---|---|---|---|
| 婚姻伴侶 | `husband-complaint` | 老公廢 | 老公、丈夫、先生 |
| 婚姻伴侶 | `divorce` | 想離婚 | 離婚、想離、分開 |
| 婚姻伴侶 | `affair` | 外遇 | 外遇、劈腿、小三 |
| 婚姻伴侶 | `in-laws` | 婆媳 | 婆婆、公婆、媳婦 |
| 女性處境 | `woman-at-work` | 職場被壓 | 被打斷、不被尊重、女生 |
| 女性處境 | `woman-speaking` | 想發言 | 想說話、被無視、我的意見 |
| 女性處境 | `childbirth` | 生育壓力 | 生小孩、催生、不孕 |
| 女性處境 | `menstruation` | 生理期 | 生理期、月經、經痛 |
| 性與慾望 | `homosexuality` | 同志 | 同性戀、出櫃、喜歡同性 |
| 性與慾望 | `porn` | 看A片 | a片、色情、成人片 |
| 工作 | `overtime` | 加班 | 加班、爆肝、責任制 |
| 工作 | `low-pay` | 薪水低 | 薪水低、低薪、加薪 |
| 工作 | `bad-colleague` | 同事機車 | 同事、推卸、搶功勞 |
| 金錢 | `get-rich` | 想發財 | 發財、中樂透、暴富 |
| 金錢 | `buy-house` | 買房 | 買房、房貸、頭期款 |
| 人際 | `bullied` | 被霸凌 | 霸凌、排擠、被欺負 |
| 人際 | `betrayed` | 朋友背叛 | 背叛、出賣、被騙 |
| 人際 | `revenge` | 想報復 | 報復、復仇、討回來 |
| 存在 | `insomnia` | 失眠 | 失眠、睡不著、多夢 |
| 存在 | `illness` | 生病 | 生病、癌症、化療 |
| 存在 | `fear-of-death` | 怕死 | 怕死、死亡、絕症 |
| 教養 | `discipline-kids` | 小孩不聽話 | 小孩、兒子、女兒、管教 |
| 教養 | `family-pressure` | 家人逼迫 | 父母、爸媽、被逼 |
| 彩蛋 | `does-god-exist` | 神存在嗎 | 神存在、有神嗎、你是誰 |
| 彩蛋 | `are-you-mocking` | 你在嘲笑基督徒嗎 | 嘲笑、諷刺、褻瀆 |

**注意**：`husband-complaint` 與 `wife-complaint` 的關鍵字會互相干擾（「我老公不好」不該命中抱怨老婆）。寫完這兩題後務必用 Step 9 的 fixture 驗證兩個方向都對。

彩蛋兩題的答案要親手挑，不走一般規則 —— 這是整站唯一可以自我指涉的地方，也是留給認真讀完的人的獎賞。

- [ ] **Step 1: 婚姻伴侶四題**（`husband-complaint`、`divorce`、`affair`、`in-laws`）

依上述流程寫入 `topics.json`，每題 4–6 節。

```bash
cd bible-oracle && python3 tools/verify.py
```

Expected: `✓ 9 個主題、… 節經文，全部與原檔一字不差`

```bash
git add bible-oracle/data/topics.json && git commit -m "content: 婚姻伴侶四題"
```

- [ ] **Step 2: 女性處境四題**（`woman-at-work`、`woman-speaking`、`childbirth`、`menstruation`）

```bash
cd bible-oracle && python3 tools/verify.py
```

Expected: `✓ 13 個主題、… 節經文，全部與原檔一字不差`

```bash
git add bible-oracle/data/topics.json && git commit -m "content: 女性處境四題"
```

- [ ] **Step 3: 性與慾望兩題**（`homosexuality`、`porn`）

```bash
cd bible-oracle && python3 tools/verify.py
```

Expected: `✓ 15 個主題、… 節經文，全部與原檔一字不差`

```bash
git add bible-oracle/data/topics.json && git commit -m "content: 性與慾望兩題"
```

- [ ] **Step 4: 工作三題**（`overtime`、`low-pay`、`bad-colleague`）

```bash
cd bible-oracle && python3 tools/verify.py
```

Expected: `✓ 18 個主題、… 節經文，全部與原檔一字不差`

```bash
git add bible-oracle/data/topics.json && git commit -m "content: 工作三題"
```

- [ ] **Step 5: 金錢兩題**（`get-rich`、`buy-house`）

```bash
cd bible-oracle && python3 tools/verify.py
```

Expected: `✓ 20 個主題、… 節經文，全部與原檔一字不差`

```bash
git add bible-oracle/data/topics.json && git commit -m "content: 金錢兩題"
```

- [ ] **Step 6: 人際三題**（`bullied`、`betrayed`、`revenge`）

```bash
cd bible-oracle && python3 tools/verify.py
```

Expected: `✓ 23 個主題、… 節經文，全部與原檔一字不差`

```bash
git add bible-oracle/data/topics.json && git commit -m "content: 人際三題"
```

- [ ] **Step 7: 存在三題與教養兩題**（`insomnia`、`illness`、`fear-of-death`、`discipline-kids`、`family-pressure`）

```bash
cd bible-oracle && python3 tools/verify.py
```

Expected: `✓ 28 個主題、… 節經文，全部與原檔一字不差`

```bash
git add bible-oracle/data/topics.json && git commit -m "content: 存在與教養五題"
```

- [ ] **Step 8: 彩蛋兩題**（`does-god-exist`、`are-you-mocking`）

```bash
cd bible-oracle && python3 tools/verify.py
```

Expected: `✓ 30 個主題、… 節經文，全部與原檔一字不差`

```bash
git add bible-oracle/data/topics.json && git commit -m "content: 彩蛋兩題"
```

- [ ] **Step 9: 補齊比對測試的 fixture**

在 `tests/match.test.js` **檔案最上方**的 import 區加入：

```js
import { readFileSync } from 'node:fs';
```

在檔案**末尾**加入：

```js
function 讀真資料() {
  const topicsFile = JSON.parse(readFileSync(new URL('../data/topics.json', import.meta.url), 'utf8'));
  return {
    topics: topicsFile.topics,
    wrappers: topicsFile.wrappers,
    fallback: [{ ref: '詩篇 17:6', id: 'Ps17v6', text: '兜底' }],
  };
}

test('三十個主題各自能被典型問法命中', () => {
  const 真資料 = 讀真資料();
  const 樣本 = [
    ['我老婆不好', 'wife-complaint'],
    ['老闆很爛想離職', 'bad-boss'],
    ['我沒錢又欠債', 'money-trouble'],
    ['好憂鬱好想死', 'despair'],
    ['我單身好久了', 'lust-single'],
    // 其餘 25 題各補一行，格式相同。id 逐一取自本任務開頭的主題清單表格，
    // 每個 id 一行，問法要用該主題核心關鍵字寫成一句自然的抱怨
  ];
  assert.equal(樣本.length, 30, '每個主題都要有一條 fixture');
  const 涵蓋 = new Set(樣本.map(([, id]) => id));
  assert.equal(涵蓋.size, 30, 'fixture 的主題 id 不可重複');
  for (const [問, 期望] of 樣本) {
    assert.equal(answer(問, 真資料).topicId, 期望, `「${問}」應命中 ${期望}`);
  }
});

test('冷門問題走兜底', () => {
  const 真資料 = 讀真資料();
  for (const 問 of ['我家的貓不吃飯', '今天天氣如何', '推薦一部電影', '腳踏車壞了', '要不要學法文']) {
    assert.equal(answer(問, 真資料).kind, 'fallback', `「${問}」不該命中任何主題`);
  }
});
```

```bash
cd bible-oracle && node --test
```

Expected: PASS，20 個測試全綠

```bash
git add bible-oracle/tests/match.test.js && git commit -m "test: 三十個主題的比對 fixture"
```

---

### Task 8: 向量比對層

在關鍵字與隨機兜底之間插入一層字元 bigram 的 TF-IDF 餘弦相似度，接住「差一點」的問法。

**設計背景（實測數據）：** 17 條真實問法上，純關鍵字表 8 條正確；純向量單獨使用更差（門檻切不乾淨：正確命中只有 0.065，錯誤命中卻有 0.102）；關鍵字優先、落空才用向量的混合策略 17 條全對。另外實測確認**只能用 bigram，不能加 unigram** —— 加了之後「主管每天罵我」會因為與「每天都想死」共用「每」「天」而被判成憂鬱主題。

**Files:**
- Create: `bible-oracle/assets/vector.js`
- Create: `bible-oracle/tests/vector.test.js`
- Modify: `bible-oracle/assets/match.js`
- Modify: `bible-oracle/tests/match.test.js`
- Modify: `bible-oracle/data/topics.json`（5 個既有主題各補一組 `phrases`）
- Modify: `bible-oracle/assets/app.js`（載入資料後建索引）

**Interfaces:**
- Consumes: Task 2 的 `normalize`
- Produces:
  - `vector.js`：`bigramCounts(normalized: string) -> {[gram]: number}`、`buildIndex(docs: {id: string, texts: string[]}[]) -> Index`、`query(index: Index, normalized: string) -> {id: string, score: number}[]`（依分數由高到低）
  - `match.js`：`COSINE_THRESHOLD = 0.05`、`buildTopicIndex(topics) -> Index`、`pickTopic(normalized, topics, index = null)` 多一個選填參數、`answer(question, data, n)` 的 `data` 多一個選填的 `index` 欄位，回傳物件多一個 `tier: 'keyword' | 'vector' | null` 欄位

- [ ] **Step 1: 寫 vector.js 的失敗測試**

`bible-oracle/tests/vector.test.js`：

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bigramCounts, buildIndex, query } from '../assets/vector.js';

test('bigramCounts 切出相鄰兩字的組合', () => {
  assert.deepEqual(bigramCounts('老婆很煩'), { 老婆: 1, 婆很: 1, 很煩: 1 });
});

test('bigramCounts 累計重複出現的組合', () => {
  assert.equal(bigramCounts('老婆老婆')['老婆'], 2);
});

test('bigramCounts 對單一字元回傳空表', () => {
  assert.deepEqual(bigramCounts('我'), {});
});

test('bigramCounts 對空字串回傳空表', () => {
  assert.deepEqual(bigramCounts(''), {});
});

test('buildIndex 不會產生跨例句邊界的 bigram', () => {
  // 「老婆」結尾接「老闆」開頭，不可以生出「婆老」這個假組合
  const index = buildIndex([
    { id: 'a', texts: ['我老婆', '老闆很爛'] },
    { id: 'b', texts: ['完全無關的句子'] },
  ]);
  const a = index.vectors.find((v) => v.id === 'a');
  assert.equal(a.vec['婆老'], undefined);
  assert.ok(a.vec['老婆'] !== undefined || a.vec['老闆'] !== undefined);
});

test('出現在每一份文件的組合權重為零（不具鑑別力）', () => {
  const index = buildIndex([
    { id: 'a', texts: ['老婆'] },
    { id: 'b', texts: ['老婆'] },
  ]);
  assert.equal(index.idf['老婆'], 0);
});

test('query 依相似度由高到低排序', () => {
  const index = buildIndex([
    { id: 'wife', texts: ['我老婆很煩', '太太一直唸我'] },
    { id: 'boss', texts: ['老闆很爛', '主管針對我'] },
    { id: 'money', texts: ['我沒錢', '負債好多'] },
  ]);
  const ranked = query(index, '我老婆很煩');
  assert.equal(ranked[0].id, 'wife');
  assert.ok(ranked[0].score > ranked[1].score);
});

test('query 對完全無關的輸入給出接近零的分數', () => {
  const index = buildIndex([
    { id: 'wife', texts: ['我老婆很煩'] },
    { id: 'boss', texts: ['老闆很爛'] },
  ]);
  const ranked = query(index, '推薦一部電影');
  assert.ok(ranked[0].score < 0.01, `分數應接近零，實際為 ${ranked[0].score}`);
});

test('query 對空輸入不拋錯', () => {
  const index = buildIndex([{ id: 'a', texts: ['我老婆很煩'] }, { id: 'b', texts: ['老闆很爛'] }]);
  const ranked = query(index, '');
  assert.equal(ranked.length, 2);
  assert.equal(ranked[0].score, 0);
});

test('buildIndex 對空的 docs 不拋錯', () => {
  const index = buildIndex([]);
  assert.deepEqual(query(index, '任何東西'), []);
});
```

- [ ] **Step 2: 執行測試，確認失敗**

Run: `cd bible-oracle && npm test`
Expected: FAIL — `Cannot find module .../assets/vector.js`

- [ ] **Step 3: 寫 vector.js**

`bible-oracle/assets/vector.js`：

```js
/**
 * 字元 bigram 的 TF-IDF 餘弦相似度。純數學，與聖經無關。
 *
 * 刻意不使用 unigram：實測加入單字元特徵後，「我、的、很、每、天」這類
 * 高頻字會造成假相似 —— 「主管每天罵我」會因為與「每天都想死」共用字元
 * 而被判成憂鬱主題。
 */

/** 把已正規化的字串切成字元 bigram 的計數表。 */
export function bigramCounts(normalized) {
  const counts = {};
  for (let i = 0; i < normalized.length - 1; i += 1) {
    const gram = normalized.slice(i, i + 2);
    counts[gram] = (counts[gram] || 0) + 1;
  }
  return counts;
}

/** L2 正規化，之後算餘弦相似度只需要做點積。 */
function l2Normalize(vec) {
  let sum = 0;
  for (const gram in vec) sum += vec[gram] * vec[gram];
  const length = Math.sqrt(sum) || 1;
  const out = {};
  for (const gram in vec) out[gram] = vec[gram] / length;
  return out;
}

/** 用 idf 加權並正規化。不在 idf 表中的組合權重視為 0，直接略過。 */
function weigh(counts, idf) {
  const vec = {};
  for (const gram in counts) {
    const weight = idf[gram];
    if (weight) vec[gram] = counts[gram] * weight;
  }
  return l2Normalize(vec);
}

/**
 * 建索引。
 * @param {{id: string, texts: string[]}[]} docs
 *   texts 必須已經正規化過，且**逐句分開**傳入 —— 不要先串接再切，
 *   否則會生出跨句邊界的假組合（「我老婆」+「老闆很爛」會生出「婆老」）。
 */
export function buildIndex(docs) {
  const counted = docs.map((doc) => {
    const merged = {};
    for (const text of doc.texts) {
      const counts = bigramCounts(text);
      for (const gram in counts) merged[gram] = (merged[gram] || 0) + counts[gram];
    }
    return { id: doc.id, counts: merged };
  });

  const documentFrequency = {};
  for (const doc of counted) {
    for (const gram in doc.counts) {
      documentFrequency[gram] = (documentFrequency[gram] || 0) + 1;
    }
  }

  const total = counted.length;
  const idf = {};
  for (const gram in documentFrequency) {
    // 出現在每一份文件的組合會得到 0，等於自動被忽略
    idf[gram] = Math.log((total + 1) / (documentFrequency[gram] + 1));
  }

  return {
    idf,
    vectors: counted.map((doc) => ({ id: doc.id, vec: weigh(doc.counts, idf) })),
  };
}

function dot(a, b) {
  let sum = 0;
  for (const gram in a) {
    if (b[gram]) sum += a[gram] * b[gram];
  }
  return sum;
}

/** 查詢，回傳依相似度由高到低排序的 [{id, score}]。 */
export function query(index, normalized) {
  const vec = weigh(bigramCounts(normalized), index.idf);
  return index.vectors
    .map((entry) => ({ id: entry.id, score: dot(vec, entry.vec) }))
    .sort((a, b) => b.score - a.score);
}
```

- [ ] **Step 4: 執行測試，確認通過**

Run: `cd bible-oracle && npm test`
Expected: PASS，30 個測試全綠（原本 20 個 + vector.js 的 10 個）

- [ ] **Step 5: Commit**

```bash
git add bible-oracle/assets/vector.js bible-oracle/tests/vector.test.js
git commit -m "feat: 加入字元 bigram 的 TF-IDF 向量比對"
```

- [ ] **Step 6: 寫 match.js 整合的失敗測試**

在 `bible-oracle/tests/match.test.js` 的 import 區加入：

```js
import { buildTopicIndex, COSINE_THRESHOLD } from '../assets/match.js';
```

在檔案末尾加入：

```js
const 帶例句的主題 = [
  {
    id: 'wife-complaint',
    label: '抱怨老婆',
    keywords: [{ w: '老婆', s: 3 }],
    phrases: ['我老婆很煩', '太太一直唸我', '內人很難相處', '跟妻子吵架'],
    verses: [{ ref: '以弗所書 5:22', id: 'Eph5v22', text: '妻一', quip: '補刀一' }],
  },
  {
    id: 'bad-boss',
    label: '老闆爛',
    keywords: [{ w: '老闆', s: 3 }],
    phrases: ['老闆很爛', '主管一直針對我', '想離職', '工作好痛苦想換'],
    verses: [{ ref: '以弗所書 6:5', id: 'Eph6v5', text: '僕一', quip: '補刀二' }],
  },
];

const 帶索引的資料 = {
  topics: 帶例句的主題,
  wrappers: ['神的意念高過你的意念。'],
  fallback: [{ ref: '詩篇 17:6', id: 'Ps17v6', text: '兜底一' }],
  index: buildTopicIndex(帶例句的主題),
};

test('COSINE_THRESHOLD 為 0.05', () => {
  assert.equal(COSINE_THRESHOLD, 0.05);
});

test('關鍵字命中時不走向量層', () => {
  const a = answer('我老婆不好', 帶索引的資料);
  assert.equal(a.topicId, 'wife-complaint');
  assert.equal(a.tier, 'keyword');
});

test('關鍵字落空時由向量層接住近似的問法', () => {
  const a = answer('內人很難相處', 帶索引的資料);
  assert.equal(a.topicId, 'wife-complaint');
  assert.equal(a.tier, 'vector');
});

test('向量層也接得住換句話說的離職問題', () => {
  const a = answer('我想換工作', 帶索引的資料);
  assert.equal(a.topicId, 'bad-boss');
  assert.equal(a.tier, 'vector');
});

test('兩層都落空才走兜底', () => {
  const a = answer('推薦一部電影', 帶索引的資料);
  assert.equal(a.kind, 'fallback');
  assert.equal(a.tier, null);
});

test('沒有提供 index 時退化成純關鍵字比對，不拋錯', () => {
  const a = answer('內人很難相處', { ...帶索引的資料, index: undefined });
  assert.equal(a.kind, 'fallback');
  assert.equal(a.tier, null);
});

test('向量層仍然是決定論的', () => {
  const first = answer('內人很難相處', 帶索引的資料);
  for (let i = 0; i < 50; i += 1) {
    assert.equal(answer('內人很難相處', 帶索引的資料).ref, first.ref);
  }
});
```

- [ ] **Step 7: 執行測試，確認失敗**

Run: `cd bible-oracle && npm test`
Expected: FAIL — `buildTopicIndex` 不是一個匯出

- [ ] **Step 8: 修改 match.js**

在 `match.js` 檔案開頭加入 import：

```js
import { buildIndex, query } from './vector.js';
```

在 `THRESHOLD` 下方加入：

```js
/** 向量層的餘弦相似度門檻。實測 0.02–0.10 對負面案例都無誤判，取中間值。 */
export const COSINE_THRESHOLD = 0.05;
```

在 `pickTopic` 上方加入：

```js
/**
 * 由主題的 phrases 建向量索引。呼叫端建一次，之後每次查詢重複使用。
 * 例句逐句傳入，不要先串接 —— 否則會生出跨句邊界的假組合。
 */
export function buildTopicIndex(topics) {
  return buildIndex(
    topics.map((topic) => ({
      id: topic.id,
      texts: (topic.phrases ?? []).map((phrase) => normalize(phrase)),
    })),
  );
}
```

把 `pickTopic` 整個換成：

```js
/**
 * 選主題。兩層：先精準的加權關鍵字，落空才用寬鬆的向量相似度。
 * @returns {{topic: object, tier: 'keyword'|'vector'} | null}
 */
export function pickTopic(normalized, topics, index = null) {
  const ranked = topics
    .map((topic) => ({ topic, score: scoreTopic(normalized, topic) }))
    .filter((entry) => entry.score >= THRESHOLD)
    .sort((a, b) => b.score - a.score || b.topic.keywords.length - a.topic.keywords.length);
  if (ranked.length > 0) return { topic: ranked[0].topic, tier: 'keyword' };

  if (!index) return null;
  const [best] = query(index, normalized);
  if (!best || best.score < COSINE_THRESHOLD) return null;
  const topic = topics.find((entry) => entry.id === best.id);
  return topic ? { topic, tier: 'vector' } : null;
}
```

把 `answer` 中取用 `pickTopic` 的那一段改成：

```js
  const 命中 = pickTopic(normalized, data.topics, data.index ?? null);

  if (命中) {
    const verse = 命中.topic.verses[(seed + 位移) % 命中.topic.verses.length];
    return {
      kind: 'topic',
      topicId: 命中.topic.id,
      tier: 命中.tier,
      ref: verse.ref,
      verseId: verse.id,
      text: verse.text,
      quip: verse.quip,
      index: 位移,
      poolSize: 命中.topic.verses.length,
    };
  }
```

並在 fallback 的回傳物件中加入 `tier: null,`（放在 `topicId: null,` 下一行）。

**注意：`pickTopic` 的回傳型別變了**（從 `Topic | null` 變成 `{topic, tier} | null`）。既有測試中直接使用 `pickTopic(...).id` 的三個案例要跟著改成 `pickTopic(...).topic.id`，回傳 null 的案例不用改。

- [ ] **Step 9: 執行測試，確認通過**

Run: `cd bible-oracle && npm test`
Expected: PASS，37 個測試全綠（vector 10 個 + match 原本 20 個 + 新增 7 個）

- [ ] **Step 10: Commit**

```bash
git add bible-oracle/assets/match.js bible-oracle/tests/match.test.js
git commit -m "feat: 比對加入向量層，關鍵字落空時接住近似問法"
```

- [ ] **Step 11: 為既有 5 個主題補上 phrases**

在 `data/topics.json` 的每個主題中，於 `keywords` 之後加入 `phrases` 欄位。每個主題寫 6–9 句台灣人實際會怎麼講這件事的自然例句：

```json
      "phrases": [
        "我老婆很煩", "太太一直唸我", "跟妻子吵架", "另一半很難搞",
        "老婆脾氣很差", "內人很難相處", "我跟我牽手處不來", "老婆一直碎念"
      ],
```

其餘四個主題（`bad-boss`、`money-trouble`、`despair`、`lust-single`）比照辦理。寫例句時的原則：

- 寫**整句**，不要寫詞。「我想換工作」比「換工作」好，因為 bigram 能吃到更多脈絡
- 刻意涵蓋關鍵字表**沒有**的講法（「內人」「手頭很緊」「不想活」），這才是這一層存在的意義
- 每個主題至少 6 句，句子之間用字盡量不重複，涵蓋面才廣

- [ ] **Step 12: 驗證原文與測試都沒被弄壞**

```bash
cd bible-oracle && python3 tools/verify.py && npm test
```

Expected: `✓ 5 個主題、21 節經文，以及緊急經文池 20 節，全部與原檔一字不差`，且測試 37 個全綠

- [ ] **Step 13: 用真實資料量一次比對品質**

寫一個臨時 node 腳本（跑完刪掉，不要 commit），載入真實的 `topics.json` 與 `fallback.json`，建索引，對以下 17 條問法各跑一次 `answer()`，印出 `tier` 與 `topicId`，並統計正確率：

```
我老婆很煩 → wife-complaint          內人很難相處 → wife-complaint
跟太太又吵架了 → wife-complaint       老闆是個王八蛋 → bad-boss
我想換工作 → bad-boss                主管每天罵我 → bad-boss
最近手頭很緊 → money-trouble          卡債還不完 → money-trouble
我好像有點憂鬱 → despair              每天起床都不想活 → despair
三十歲還沒交過女朋友 → lust-single
我家的貓不吃飯 → 兜底                 今天天氣真好 → 兜底
推薦一部電影 → 兜底                   腳踏車壞了 → 兜底
要不要學法文 → 兜底
```

**目標是 17/17。** 若有未達標的，先調整該主題的 `phrases`（加一句涵蓋該講法的例句），**不要調 `COSINE_THRESHOLD`，也不要動 `vector.js` 的演算法** —— 例句是內容問題，門檻是結構問題，這兩件事不要混在一起解。把每一輪的結果與你加了哪些例句寫進報告。

- [ ] **Step 14: 在 app.js 建索引**

在 `loadData()` 的 `return` 之前建索引。把成功路徑的 return 改成：

```js
    const topics = topicsFile.topics;
    return { topics, wrappers: topicsFile.wrappers, fallback, index: buildTopicIndex(topics) };
```

失敗路徑（緊急池）的 return 改成：

```js
    return { topics: [], wrappers: 緊急包裝詞, fallback: 緊急經文池, index: null };
```

並在 `app.js` 開頭的 import 改成：

```js
import { answer, buildTopicIndex } from './match.js';
```

- [ ] **Step 15: 確認整站仍然可用並 commit**

```bash
cd bible-oracle && npm test && python3 tools/verify.py
```

Expected: 37 個測試全綠、原文驗證通過

```bash
git add bible-oracle/data/topics.json bible-oracle/assets/app.js
git commit -m "feat: 五個主題補上例句，網頁載入時建立向量索引"
```
