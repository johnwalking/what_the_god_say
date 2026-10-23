# 主的旨意 v2：RAG 後端與評估框架 — 設計文件

日期：2026-10-23
前置文件：`2026-08-29-bible-oracle-design.md`（v1，純前端、關鍵字加 bigram TF-IDF）

## 一、目標

把 v1 升級成可放進 LLM 工程師履歷的專案：

1. 全本地推論（embedding 與 LLM），零 API 成本，可離線重現。
2. 用完整 RAG 流程取代手寫主題庫：檢索、rerank、生成、驗證。
3. 有量化評估：三種方案的消融實驗，產出可寫進履歷與 README 的數字。
4. 工程完整度：FastAPI 後端、快取、安全閘、降級策略。

**不做**：微調、帳號系統、雲端 API、多語言。

## 二、關鍵決策

| 決策 | 選擇 | 理由 |
|---|---|---|
| Embedding | 本地 `BAAI/bge-m3`（sentence-transformers） | 繁中表現好，免費，可離線 |
| LLM | Ollama 跑約 4B 模型（Qwen 或 Gemma 3，實測後定） | 機器為 M3 / 16GB，4B 可順跑 |
| 後端 | Python + FastAPI | 使用者指定 |
| 向量庫 | numpy 矩陣 + 餘弦（31k × 1024 約 127MB float32） | 規模小，不需要 FAISS 或向量資料庫，少一個依賴 |
| 經文處理 | **LLM 永遠不輸出經文，只回傳候選編號** | 4B 模型會背錯經文；由編號回語料庫取字，逐字正確由結構保證 |
| 評估標準 | 以 `topics.json` 的主題池為標準 | 客觀、可重現、標註快 |
| 輔助評估 | 用 subagent 當 LLM-as-judge | 4B 當裁判不可靠，改由更強的模型離線評分 |

## 三、流程

```
POST /api/oracle { q }
  → [1 安全閘] 規則比對自傷字眼；命中 → 回關懷式回應，終止
  → [2 檢索]   bge-m3 對 31,031 節做餘弦，取 top-K（預設 20）
  → [3 Rerank] 4B 從 K 個候選選 1 個，只輸出編號（JSON schema 約束）
  → [4 取字]   用編號回語料庫取原文 ref / text
  → [5 解讀]   4B 依規範生成一句假牧師補刀（結構化輸出）
  → [6 驗證]   編號在候選內、補刀長度與格式合規、無破梗詞；不合規則重試一次
  → 回傳 { ref, verseId, text, quip, stage, latency_ms }
```

### 降級策略（每層都有退路）

| 失敗點 | 退路 |
|---|---|
| Ollama 無法連線或逾時 | 跳過 rerank，取檢索第 1 名；補刀用固定包裝詞 |
| Rerank 回傳非法編號 | 重試一次，仍失敗取檢索第 1 名 |
| 補刀驗證不過 | 重試一次，仍失敗用固定包裝詞 |
| embedding 模型載入失敗 | 退回 v1 的 TF-IDF 比對（Python 版或前端靜態模式） |

回應的 `stage` 欄位標示實際走到哪一層，評估與除錯都用得到。

### 補刀規範（沿用 v1，轉為 system prompt 與驗證規則）

一到兩句、教會長輩口吻、立場永遠是「經文是對的，是你不夠屬靈」、不破梗（禁「哈哈」「其實」「諷刺」與顏文字）、不攻擊具體的人或教會。few-shot 範例取自 `topics.json` 現有 180 條人工補刀。

### 安全閘

v1 有 `despair` 等主題。v2 對自傷、自殺相關輸入一律不走諷刺流程，改回固定的關懷訊息（含台灣求助專線 1925）。用規則比對，不用 LLM，確保確定性。評估集裡要有此類題目，驗證 100% 被攔下。

## 四、目錄結構

```
bible-oracle/
  server/
    main.py          # FastAPI 路由、快取、rate limit
    pipeline.py      # 六階段流程的組裝與降級邏輯
    retrieve.py      # 載入索引、餘弦檢索
    rerank.py        # Ollama 呼叫：選編號
    quip.py          # Ollama 呼叫：生成補刀與驗證
    safety.py        # 安全閘
    corpus.py        # 載入 31k 節語料
    test_*.py        # pytest
  tools/
    build_index.py   # 一次性：語料 → embedding 矩陣 (.npy)
  eval/
    dataset.jsonl    # 100–150 題 {q, topic_id}，另含安全題
    run_eval.py      # 跑三種方案，輸出指標表
    judge/           # subagent 評分的輸入與結果
  assets/            # 前端：改為呼叫 API，保留靜態模式為 fallback
```

語料來源沿用 `tools/extract.py` 的抽取邏輯，擴充為輸出全部 31,031 節（現只輸出 3,800 節兜底池）。索引檔 `.npy` 不進 git，由 `build_index.py` 產生。

Python 注意：系統為 3.9.6，預設用 venv；若依賴需要更高版本，再升級。

## 五、評估

### 資料集

- 100–150 題台灣人實際會講的煩惱，涵蓋 30 個主題，每題標 `topic_id`。
- 另含約 10 題安全題（預期被攔截）與約 10 題無主題題（預期走兜底）。
- 由模型起草，使用者審閱。與 `topics.json` 的 `phrases` 不重複，避免訓練即測試。

### 三種方案（消融）

| 方案 | 內容 |
|---|---|
| B0 | v1 的關鍵字加 TF-IDF（Python 重現），baseline |
| B1 | bge-m3 檢索取第 1 名 |
| B2 | bge-m3 top-20 加 4B rerank |

### 指標

- **Topic hit@1**：選出的經文落在該題正確主題的經文池內。
- **Topic hit@5**（僅 B0 與 B1）：top-5 內有命中。
- **逐字準確率**：回傳 text 與語料庫完全相符（預期 100%，驗證設計）。
- **降級率**：各階段 fallback 的比例。
- **延遲** p50 與 p95，及每請求的本地推論時間。
- **安全題攔截率**。

結果輸出為 Markdown 表格，直接貼進 README。

### 輔助：LLM-as-judge（C）

對 B1、B2 各抽樣約 40 題，由 subagent 依 rubric 評分：經文與問題的相關度（1–5）、荒謬或好笑程度（1–5）、補刀是否符合規範（是/否）。judge 的輸入輸出存於 `eval/judge/`，並註明裁判模型，供履歷說明。這部分是離線人工觸發的步驟，不在 CI 內。

## 六、測試

- `pytest`：safety（規則）、pipeline 降級（以 mock 的 Ollama 模擬逾時、非法編號）、verbatim 驗證、檢索（小型 fixture 索引）。
- 沿用既有 `node --test` 測試，前端靜態模式不退化。
- 評估腳本本身可用小資料集 smoke test。

## 七、前端變更

- 優先呼叫 `/api/oracle`；失敗或逾時（>8 秒）自動退回現有靜態比對，使用者無感。
- 網址分享維持 `?q=`。LLM 輸出不具決定性，所以後端以問題字串的 hash 當 key 快取結果，同一個 `q` 永遠回同一張卡。快取存本地檔或 SQLite。
- 「再求一次」改為取 rerank 結果的下一名，並寫入網址 `&n=`。

## 八、履歷與 README 呈現

README 包含：架構圖、三方案評估表、延遲與資源數據、「LLM 不輸出經文」的設計說明、降級策略、如何本地重現（`ollama pull`、`build_index.py`、`run_eval.py`）。

## 九、實作順序

1. 語料全量抽取、`build_index.py`、檢索層與 B0 baseline。
2. 評估集與 `run_eval.py`，先跑出 B0 與 B1 數字。
3. Ollama 接入：rerank、補刀、驗證與降級。
4. 安全閘。
5. FastAPI 路由、快取、前端串接。
6. judge 評分、README。

每步結束都有可跑的測試與可看的數字。
