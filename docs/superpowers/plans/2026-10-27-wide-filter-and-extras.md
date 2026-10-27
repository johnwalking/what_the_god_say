# 全語料內容過濾與靜態備援日常主題 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 延續 `2026-10-26-confidence-gate.md`：(A) 靜態備援（沒有後端時的前端比對）新增約 6 個日常主題，讓「貓咪」之類的問題不再抽到毫無關聯的隨機經文；(B) API 路徑的「信心偏低時展開全語料」加上內容過濾，擋掉不適合出現在日常問題答案裡的經文（性暴力、血腥殺戮、自傷等）。

**Architecture:** (A) 新資料檔 `data/extra_topics.json`（同 `topics.json` 的主題格式），**只供靜態模式**使用：前端 `loadData` 合併兩份主題；API 的精選庫與既有評估數字**不變**（避免牽動已量測的 B2／判官結果）。(B) 新模組 `server/filters.py` 提供 `eligible_mask(corpus)`，`Retriever` 支援可選的 `mask`，只用於全語料展開的 retriever。

## Global Constraints

- 工作目錄 `/Users/wangchengzhong/Desktop/New-Try/bible-oracle`；git root 為其上一層；分支 `feat/bible-oracle`。Python 3.9.6（`from __future__ import annotations`、不用 `X | Y`／`match`）。零雲端 API、零前端依賴。
- 經文一字不改：任何顯示的 `text` 必須逐字等於語料庫（`data/corpus.json`，由 `tools/extract.py --corpus` 產生）該 `id` 的 `text`；LLM 仍只回傳編號。
- 安全閘不變：`server/safety.is_crisis` 與 `assets/match.js` 的 `isCrisis` 規則維持一致且仍在所有比對之前；新增主題的 keywords／phrases／quips 不得觸發 `isCrisis`。
- 補刀規範（沿用）：一到兩句、教會長輩口吻、立場是「經文是對的，是你不夠屬靈」、不破梗（不得有「哈哈」「其實」「諷刺」「開玩笑」「XD」「笑死」、表情符號、顏文字）、不攻擊具體的人或教會；必須通過 `server.quip.validate_quip`。
- **不得更動已量測的數字來源**：`eval/results.json` 中的 B0／B1／B1h／B2 列與 `eval/judge/*` 不得被覆蓋或重算；`data/topics.json` 不得修改（除非發現錯誤並單獨說明）。
- 不改音訊／3D 場景程式（`assets/audio.js`、`assets/mandala*.js`、`assets/sanctuary.js` 的場景部分）。
- commit 訊息結尾加：`Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`；絕不 `git add -A`（根目錄有未追蹤的 `主的旨意-技術筆記.md`）；不新增計畫未列出的檔案；`.venv/bin/pytest -q`（233）與 `npm test`（152）必須維持通過且輸出乾淨。

---

### Task E: 靜態備援的日常主題（`data/extra_topics.json`）

**Files:**
- Create: `data/extra_topics.json`、`server/test_extras.py`
- Modify: `assets/app.js`（`loadData` 只改資料載入與合併）、`server/main.py`（新增 `/data/extra_topics.json` 靜態路由，與 `topics.json`／`fallback.json` 相同做法）、`tests/match.test.js`（新增使用額外主題的測試）、`eval/b0.mjs`（支援 `--extras`）、`eval/run_eval.py`（新增方法 `b0x`）、`tools/verify.py`（把額外主題也納入逐字驗證）、`README.md`

**Interfaces / 內容:**
- `data/extra_topics.json`：`{ "topics": [ ... ] }`，每個主題與 `topics.json` 的主題物件同格式：`id`、`label`、`keywords: [{w, s}]`、`phrases: [...]`、`verses: [{ref, id, text, quip}]`。約 6 個主題（建議）：`pets` 寵物與動物（貓、狗、毛小孩、寵物、飼料、牠…）、`food` 吃飯與食物、`weather` 天氣與出門、`tech` 3C 與遊戲（手機、電腦、網路、遊戲）、`study` 考試與讀書、`travel` 交通與旅行（塞車、高鐵、旅遊、迷路）。每個主題：至少 6 個 keywords（核心詞權重 3，邊緣詞 1；單字核心詞需謹慎避免誤搶既有主題，例如不要拿「吃」單獨當核心詞而吃掉「想吃…」之外的句子——請用實測決定）、至少 6 個 phrases（台灣人實際會怎麼講）、**5 至 6 節經文**（從 `data/corpus.json` 中挑與該主題字面或意象真的相關的經文，`ref`／`id`／`text` 逐字取自語料；可含好笑的斷章取義選擇，如寵物 → 箴言 12:10「義人顧惜他牲畜的性命」、馬太福音 8:20「狐狸有洞」等，但需實際查證存在）與各自的補刀（符合上述規範）。
- 前端：`assets/app.js` 的 `loadData` 在載入 `topics.json` 與 `fallback.json` 之外，**選擇性**載入 `data/extra_topics.json`（失敗或 404 則忽略，不得影響原本流程），把 `extra.topics` 接在 `topics.json` 的 `topics` 之後，`buildTopicIndex` 以合併後的陣列建立；`wrappers` 與 `fallback` 不變。靜態模式因此能比對額外主題。API 路徑**不使用**額外主題。
- `eval/b0.mjs --extras`：同時讀入 `extra_topics.json` 並合併主題（預設行為不變，確保既有 B0 數字不變）。`run_eval.py` 新方法 `b0x`，列名 `B0x 靜態（含 6 個日常主題）`；評估 `topic` 與 `none` 題，沿用 `summarize`；`merge_results` 保留其他方法。**不得改動既有 `b0` 的行為與其結果列。**
- 測試：
  - `server/test_extras.py`（pytest；若 `data/corpus.json` 不存在則 `pytest.skip`）：每個額外主題的每節經文 `text` 與 `ref` 逐字等於語料、`id` 唯一、每節的 quip 通過 `validate_quip`、keywords／phrases／quip 皆不觸發 `is_crisis`、每個主題 keywords ≥ 6、phrases ≥ 6、verses ≥ 5、`id` 不與 `topics.json` 的主題 id 重複。
  - `tests/match.test.js`：用合併後的資料（讀兩個 JSON 檔）驗證：`answer('貓咪')`、`answer('我家的狗一直叫')` → `kind: 'topic'` 且 `topicId: 'pets'`；`answer('今天天氣好熱')` → weather；至少每個額外主題各一題的代表句命中該主題；所有 keywords／phrases 與 quips 不觸發 `isCrisis`；原本 `topics.json` 的代表句（例如「我老婆很煩」）仍命中原主題；`answer` 對與額外主題無關的亂句仍走 fallback。
- 量測與誠實回報：執行 `.venv/bin/python eval/run_eval.py b0x`，回報 B0x 相對 B0 的 `topic` 題 hit@1 變化（額外主題的關鍵字可能搶走既有主題的問題；若 hit@1 下降超過 2 個百分點，調整關鍵字權重直到不再搶，並在報告中說明改了什麼）、`none` 題的 `none_fallback_rate`（B0 為 56.3%，B0x 預期下降，因為寵物、食物、天氣等日常問題現在有對應主題），並列出 16 題 `none` 題在 B0x 下各自拿到什麼（問題｜kind_out｜topicId｜經文 ref｜補刀）。
- README：在適當章節新增「靜態模式的日常主題」一小節，說明額外主題只供沒有後端的模式使用、與 API 路徑的差異、B0x 數字（取自 `results.json`），以及「這些日常主題的經文是手工挑選、補刀由 Claude 草擬」。不得編造數字。

**Steps:**
- [ ] 先寫 `server/test_extras.py` 與 `tests/match.test.js` 的新測試（RED：資料檔不存在），再建立資料檔與前端載入（GREEN）。
- [ ] 實作並驗證 `tools/verify.py` 涵蓋額外主題（執行 `.venv/bin/python tools/verify.py` 並貼出輸出）。
- [ ] 跑 `b0x`，依上述規則回報與調整。
- [ ] 用真實瀏覽器流程驗證：以無頭 Chrome（`--headless=new --use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist`，CDP，靜態伺服 `python3 -m http.server 8765` 從 `bible-oracle/` 啟動並在結束後關閉；scratchpad 為 `/private/tmp/claude-501/-Users-wangchengzhong-Desktop-New-Try/a89496d4-e393-44d0-bd57-78129062c809/scratchpad`，可參考 `tb/run.mjs`）在靜態模式問「貓咪」「今天天氣好熱」「我家的狗一直叫」，確認答案分別來自 pets／weather／pets 主題的經文，Read 一張截圖確認版面正常；同時確認 `?q=我不想活了` 仍只顯示關懷訊息。
- [ ] Commit：`feat: 靜態備援新增日常主題（寵物、食物、天氣、3C、考試、交通）`（add 本任務列出的檔案，包含 `data/extra_topics.json`）

---

### Task F: 全語料展開的內容過濾

**Files:** Create `server/filters.py`、`server/test_filters.py`；Modify `server/retrieve.py`、`server/test_retrieve.py`、`server/main.py`、`eval/run_eval.py`（僅在需要時）、`README.md`、`eval/results.json`（B3 列重跑後更新）

**Interfaces:**
- `server/filters.py`：
  - `SENSITIVE_PATTERNS`（具名常數、每組一行註解）：涵蓋 (1) 性暴力與性器官／生殖相關描寫（如 強暴、強姦、下體、生殖、私處、淫亂、姦淫、妓女、娼妓、割禮…；請依語料實際用字查證並評估誤殺率）；(2) 血腥殺戮與肢體傷害（如 殺死、殺了、擊殺、屠殺、砍斷、剁、焚燒…的敘事句；以及吃兒女的肉這類）；(3) 自傷相關（直接重用 `server.safety.is_crisis(text)` 作為排除條件）；(4) 純名單與族譜（`生了`、`的兒子` 出現次數 ≥ 2）、過長（去標點後 > 90 字）或過短（< 8 字）的經文。
  - `is_wide_eligible(text: str) -> bool` 與 `eligible_mask(corpus) -> np.ndarray`（布林，長度為語料筆數）。
- `Retriever.__init__(corpus, matrix, embedder, mask=None)`：`mask` 為 `None` 時行為與現在完全相同；給定時長度必須等於語料（否則 `ValueError`），`search` 對不合格的列在排序前把分數設為 `-inf`，且回傳的 `k` 筆都來自合格列（合格列少於 `k` 時回傳較少，不補不合格的）。`HybridRetriever` 不受影響。
- `main.build_default_pipeline`：全語料展開用的 wide retriever 以 `mask=eligible_mask(corpus)` 建立；`cache_ns` 納入過濾版本（例如 `wide{threshold}f1`）使舊快取不被沿用。
- 調校原則：先統計被排除比例（預期 5% 至 35%），並抽樣檢視被排除與保留的經文各 30 節，在報告中誠實說明誤殺（被擋掉但其實無傷大雅）與漏網的例子；不要為了讓某題結果好看而特別調整規則。
- 測試（TDD）：`filters` 對代表性經文（用 `data/corpus.json` 查證的實際 id：如創世記 34:2 強暴、申命記 25:11、利未記 18:22、箴言 12:10、馬太福音 8:20、申命記 14:14 等）的合格／不合格判定（`corpus.json` 不存在時 skip）；`is_wide_eligible` 的純字串測試（不依賴語料）；`Retriever` mask：不合格列永不出現在結果、`mask=None` 行為不變、長度不符丟 `ValueError`；`build_default_pipeline` 的 wide retriever 使用 mask（以可注入的假物件或檢查屬性）。
- 重跑 B3：`.venv/bin/python eval/run_eval.py b3`（約 30 至 40 分鐘，背景執行；開跑前確認沒有其他 `run_eval`／`rerank_experiment` 行程在跑；Ollama 需運作）；回報過濾後的 B3 hit@1／5／20 與 `pool` 分佈，列出 16 題 `none` 題的 問題｜經文｜補刀｜pool，**並與過濾前的 B3（hit@1 48.3%、hit@5 67.5%、hit@20 82.8%；none 題的結果見 `.superpowers/sdd/gate-task-2-report.md`）誠實比較**；README 把 B3 列更新為過濾後的結果，並保留一行說明過濾前的數字。
- README：新增一小段說明過濾規則與其限制（規則式、可能誤殺／漏網、僅作用於全語料展開，精選庫不過濾）。
- Commit：`feat: 全語料展開加入內容過濾，並重跑 B3`（add 本任務列出的檔案）
