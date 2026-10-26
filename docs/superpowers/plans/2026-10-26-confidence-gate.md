# 離題問題的信心門檻 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 使用者輸入「貓咪」得到毫無關聯的經文（1 哥林多前書 16:13，實為前端靜態備援的隨機池）。即使走 API，候選也只限精選庫 145 節，離題問題難以貼題。加入「信心門檻」：精選庫的最高相似度偏低時，改在 31k 全語料取候選再 rerank。

**Architecture:** `Pipeline` 新增可選的 `wide_retriever`（全語料 `Retriever`）與 `wide_threshold`；`rank()` 先以精選庫候選取最高相似度，低於門檻就改用 `wide_retriever.search`。`Answer` 與 API 回應新增 `pool: 'curated'|'wide'`。預設不啟用，既有行為與測試不變。

**依據（已量測，`eval/dataset.jsonl`，bge-m3，精選庫 145 節最高相似度）：** 正常煩惱題（151 題）min 0.469／p10 0.517／中位數 0.566／max 0.676；日常離題題（16 題）min 0.390／p50 0.491／p90 0.514／max 0.523。門檻 0.52 時：離題題 94% 低於門檻、正常題 11% 低於門檻；0.50 時離題 69%／正常 3%；0.54 時離題 100%／正常 25%。

## Global Constraints

- 工作目錄 `/Users/wangchengzhong/Desktop/New-Try/bible-oracle`；git root 為其上一層；分支 `feat/bible-oracle`。Python 3.9.6（`from __future__ import annotations`，不用 `X | Y`、`match`）。零雲端 API。
- LLM 仍只回傳編號；`text` 必須逐字等於語料庫該 `verse_id` 的 `text`。安全閘（`is_crisis`）仍在所有檢索之前，行為不得改變。
- 預設參數（`wide_retriever=None`）時 `Pipeline` 行為與回應內容必須和現在完全相同（`pool` 固定為 `'curated'`）；既有 220 項 Python 測試不得改動（除非只是新增欄位造成的斷言需要，並說明）。
- 不改 `assets/`（前端）、`match.js`、`audio.js`、`card.js`。`app.js` 只讀 API 的既有欄位，新增 `pool` 不影響它。
- commit 訊息結尾加：`Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`；絕不 `git add -A`（根目錄有未追蹤的 `主的旨意-技術筆記.md`）；不新增計畫未列出的檔案。

---

### Task 1: Pipeline 信心門檻與全語料展開

**Files:** Modify `server/pipeline.py`、`server/test_pipeline.py`、`server/main.py`、`server/test_main.py`、`server/fakes.py`

**Interfaces:**
- `pipeline.DEFAULT_WIDE_THRESHOLD = 0.52`（附一行註解寫明上述量測依據）。
- `Pipeline.__init__(..., wide_retriever=None, wide_threshold=DEFAULT_WIDE_THRESHOLD)`：新增兩個可選參數。
- `Pipeline.rank(question) -> Tuple[List[str], bool]` 的簽名**保持不變**（回傳 `(order, rerank_ok)`），另新增 `Pipeline.rank_with_pool(question) -> Tuple[List[str], bool, str]`（`rank` 內部委派它並丟棄 pool），pool 為 `'curated'` 或 `'wide'`。
- 決策邏輯：先 `hits = self.retriever.search(question, self.k)`；若 `self.wide_retriever` 存在且 `hits[0].score < self.wide_threshold`（`hits` 依分數降冪），改用 `hits = self.wide_retriever.search(question, self.k)`、`pool = 'wide'`；其餘流程（rerank、降級、快取）相同。快取值需記錄 `pool`（`{'order': [...], 'pool': 'curated'|'wide'}`；讀到舊格式（沒有 `pool`）時視為 `'curated'`）。
- `Answer` 新增欄位 `pool: str = 'curated'`（置於最後、有預設值，避免破壞既有建構）；`ask()` 填入；危機訊息的 `pool` 為 `'curated'`。API 回應（`asdict(Answer)`）因此多一個 `pool` 欄位。
- `main.build_default_pipeline`：另建一個全語料 `Retriever(corpus, load_index(), embedder)`（共用同一個 embedder 與矩陣，不重複載入）傳為 `wide_retriever`；`cache_ns` 加入門檻與模式：`f'{RERANK_CONFIG_NAME}|{len(corpus)}|wide{DEFAULT_WIDE_THRESHOLD}'`。
- `fakes.make_pipeline` 新增可選參數 `wide=False`／`wide_threshold`，供測試建構帶全語料展開的小型 pipeline（用既有 4 節小語料，精選與全語料可用不同的子集模擬）。

**測試（TDD）：** 預設無 `wide_retriever` 時行為不變且 `pool == 'curated'`；有 wide 且精選最高分 ≥ 門檻 → `pool == 'curated'`、候選來自精選；< 門檻 → `pool == 'wide'` 且候選來自全語料；`rank` 與 `rank_with_pool` 一致；快取命中保留 pool、舊格式快取視為 curated；`text` 仍逐字等於語料；危機訊息不受影響且不呼叫任何檢索或 LLM；`wide_threshold=0` 時永不展開；API 回應含 `pool` 欄位且 `set(body)` 的既有測試更新為包含它（只改該斷言）。

- [ ] 依 TDD（先寫失敗測試、show RED、再實作、show GREEN）；`.venv/bin/pytest -q` 全過、輸出無雜訊。
- [ ] Commit：`feat: 精選庫信心偏低時展開全語料取候選（離題問題更貼題）`（只 add 上述檔案）

---

### Task 2: 量測與評估、README

**Files:** Create `eval/gate_eval.py`；Modify `eval/run_eval.py`（新增方法 `b3`）、`eval/test_run_eval.py` 或新增小測試、`README.md`、`eval/results.json`

**Interfaces / 內容：**
- `eval/gate_eval.py`：不用 LLM，只用 embedding：載入 corpus／索引／精選庫，對資料集的 `topic` 與 `none` 題算「精選庫最高相似度」，輸出分佈（min/p10/p50/p90/max）與一組門檻（0.50、0.52、0.54、0.56）下「低於門檻」的比例，並把結果寫成 Markdown 表格到 stdout（不寫檔）；README 引用這張表。
- `run_eval.py`：新增方法 `b3`：用 `build_default_pipeline` 的同一組設定（含 wide）跑 **所有 `topic` 與 `none` 題**，列名 `B3 {RERANK_CONFIG_NAME} + 信心門檻{DEFAULT_WIDE_THRESHOLD}`；rows 紀錄每題 `stage`、`pool`、`verbatim`、`pick`；`summarize` 要能呈現 `pool_counts`（若 rows 含 `pool`）以及各 `kind` 的 pool 分佈（`topic` 題 `wide` 比例、`none` 題 `wide` 比例）；命中指標只對 `topic` 題計（沿用既有定義）。`merge_results` 行為不變（保留其他方法、B2 不得被覆蓋）。為 `summarize` 新增的欄位寫測試。
- 跑評估：先 `gate_eval.py`；再 `.venv/bin/python eval/run_eval.py b3`（約 30 至 40 分鐘，背景執行；開跑前確認沒有其他 `run_eval`／`uvicorn`／`rerank_experiment` 行程在跑，避免互相拖慢延遲）。**誠實回報**：B3 相對 B2 的 hit@1／hit@5／hit@20 變化（約 11% 的正常題被導向全語料，這些題的候選不含精選池，命中指標預期會下降），以及離題題實際拿到什麼（列出 16 題 `none` 題的 問題｜經文｜補刀｜pool，不要美化）。
- README：在評估章節新增 B3 一列與 `gate_eval` 的分佈表；用誠實的話說明取捨（離題問題更貼題 vs 命中指標以精選池為標準而下降）、門檻 0.52 的依據與其限制（樣本小：離題題只有 16 題；門檻在 0.50–0.54 之間的取捨）；保留 B2 為預設以外的對照並說明目前上線設定（`build_default_pipeline`）使用了信心門檻；更新「上線只提供精選庫」的陳述（現在離題題會用到全語料）。不要編造數字，全部取自 `results.json` 與 `gate_eval` 輸出。

- [ ] 先寫 `summarize` 新欄位與 `b3` 列名的測試（RED → GREEN）；`.venv/bin/pytest -q` 全過。
- [ ] 執行 `gate_eval.py` 與 `run_eval.py b3`，貼出完整輸出。
- [ ] Commit：`feat: 信心門檻的量測腳本、B3 評估與 README`（add 本任務列出的檔案；`eval/results.json` 因為是已追蹤的結果檔需一併提交）
