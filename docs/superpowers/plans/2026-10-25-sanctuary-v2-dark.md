# 聖殿 UI 修訂：無入口、常駐配樂、黑暗沉重、教徒動畫 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 依使用者回饋修訂 `2026-10-24-sanctuary-ui-design.md`：拿掉入口與玫瑰窗、配樂載入即嘗試播放且常駐循環、整體更暗更沉重、新增底部教徒跪拜剪影動畫來推進問答氣氛。

**Architecture:** 沿用 `sanctuary.js`（視覺）／`audio.js`（配樂）／`app.js`（接線）。移除 gate 與玫瑰窗相關程式；`audio.js` 改為可在沒有使用者手勢時先建立、被擋時於第一次互動恢復；新增純函式 `congregationSVG` 與教徒狀態機，以 CSS 狀態切換動畫。

**Tech Stack:** 原生 ES modules、CSS、SVG、Canvas 2D、Web Audio API；`node --test`；Chrome 無頭 CDP 驗證。

## 使用者回饋（原話摘要）
起始網頁的圓圈（玫瑰窗）過大且看不懂；不需要點擊；音樂要一直都有；頁面黑暗、沉重且神聖；附上教徒動畫推進氣氛。已確認：圓圈**完全拿掉**；教徒用**底部跪拜剪影**（平時跪坐起伏、送出問題時低頭、揭曉時舉手、危機訊息時靜止低頭）；音樂被瀏覽器擋住時顯示**淡淡的提示**，第一次互動即啟動。

## Global Constraints

- 工作目錄 `/Users/wangchengzhong/Desktop/New-Try/bible-oracle`；git root 為其上一層。零外部依賴／字型／音檔／網路。
- **瀏覽器限制（不可繞過）**：無使用者手勢時 AudioContext 會是 `suspended`。流程必須是：載入即嘗試啟動；若未在 running，掛上一次性監聽（`pointerdown`、`keydown`、`touchstart`、`click`）於第一次互動呼叫 `audio.start()`／`resume()`；提示 `#hint`（淡淡一行「觸碰任一處，聆聽聖樂」）在非 running 時顯示，running 後淡出移除。
- 音樂**常駐循環**，永不自行停止；仍保留右上角靜音鍵（無障礙，且尊重使用者已存的靜音偏好）；預設不靜音。
- 危機訊息：**沒有任何儀式**（不閃光、不逐字、不響鐘、教徒維持「靜止低頭」不做動作），音樂降為 hush 但**不停止**。這是上一輪安全審查的硬性不變式，不得退步（前端 `isCrisis` 預檢、API `crisis`、靜態退路三條路徑）。
- 主配色更暗更沉重：背景約 `#050403`（可略帶極深暖褐），金色降低飽和與亮度（約 `#b8995a`，標題可略亮），次要文字約 `#8f7f68`；加重暗角；允許極少量深紅（約 `#4a0f14`）作陰影或光暈，不要彩色玻璃；整體去飽和。字距與留白維持莊嚴。
- 配樂更低沉：整體低八度、更慢（和弦轉換約 24 秒）、更暗的低通、更長殘響；加入極低的持續低音（sub drone）與遠處緩慢的低沉鐘聲（約每 30–45 秒一聲，隨機抖動，hush／靜音時不響）。總音量上限仍 0.25；hush 位準維持低但可聽（約 0.06）。
- `prefers-reduced-motion`：不旋轉／不漂浮／不逐字；教徒維持對應狀態的靜態姿勢（無過渡動畫）。
- 既有行為不得退步：`npm test`、`.venv/bin/pytest -q`（220）、靜態模式與 API 模式、`match.js` 前端安全閘、手機無橫向捲動（390px）。
- 不改 `server/`、`match.js`、`card.js`（卡片色票已是暗底金字）。commit 訊息結尾加：`Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`；不新增計畫未列出的檔案；絕不 `git add -A`（根目錄有未追蹤的 `主的旨意-技術筆記.md`，不可加入）。
- 此計畫的視覺／音訊細節為創作性工作，下列為約束與驗收條件。

---

### Task 1: audio.js — 沉重配樂與免手勢啟動

**Files:** Modify `assets/audio.js`、`tests/audio.test.js`

**Interfaces（維持既有匯出與簽名，僅擴充）:**
- `createAudio(...)` 新增 `state(): 'running' | 'suspended' | 'blocked' | 'unavailable'`（目前 context 狀態；沒有 context 或不可用回對應值）與 `onStateChange(cb) -> unsubscribe`（context 的 `statechange` 轉發；沒有 context 時為無作用）。
- `start()` 必須能在**沒有使用者手勢**時被呼叫：建立 context 與整個節點圖、排程淡入（ctx.currentTime 在 suspended 時為 0，resume 後才推進，因此淡入自然從恢復時開始）；`resume()` 若 pending 或被拒絕都**不可**拆掉 context（改為保持 suspended，下次 `start()`／互動再 `resume()`）。重複呼叫 `start()` 仍冪等，且每次呼叫都要嘗試 `resume()`。
- `bell()` 不變（揭曉時的鐘聲）；新增內部的「遠鐘」排程（`TOLL_MIN_SEC=30`、`TOLL_MAX_SEC=45`，低沉、長衰減、殘響更多、音量約 `BELL_LEVEL * 0.7`），在 `muted`／`hush` 時略過本次，`stop()` 時清除計時器。
- 常數調整（集中於檔頭，有註解）：`CHORD_SEC=24`、`CROSSFADE_SEC=6`、`HUSH_LEVEL≈0.06`、整體低一個八度（`CHORDS` 的 MIDI 全部 −12，bass 若低於 24 則調整到可聽的 ≥ 24）；加入 `SUB_LEVEL` 的持續次低音；`PROGRESSION` 改為更陰鬱的循環（例如 Dm、Bb、Gm、Dm、Am、Bb、Gm、A —— 以 `CHORDS` 新增 Am／A 的實際音高資料，仍至少 4 聲部）；低通截止降低、殘響 wet 提高、`REVERB_SEC` 約 7。
- 測試：更新和弦與音域測試（新的音域範圍）；新增：`start()` 在 suspended 的 context 上不拆除、`resume()` 被拒絕仍保留節點圖且下次 `start()` 會再嘗試 resume；`state()`／`onStateChange` 行為；遠鐘在 muted／hush 時不建立 oscillator、`stop()` 後不再排程；hush 位準 > 0 且 ≤ 0.1；master 峰值仍 ≤ 0.25。

- [ ] 依 TDD（先寫失敗測試，show RED，再實作，show GREEN）；`npm test` 全過且輸出無雜訊。
- [ ] 報告中列出每個音色常數與「太薄／太刺／太悶／太吵」時該調哪個。
- [ ] Commit：`feat: 配樂改為低沉常駐並支援免手勢啟動`（只 add audio.js、tests/audio.test.js）

---

### Task 2: 移除入口與玫瑰窗、黑暗主題、教徒動畫

**Files:** Modify `index.html`、`assets/style.css`、`assets/sanctuary.js`、`tests/sanctuary.test.js`

**Interfaces:**
- 移除：`#gate`（含 noscript 規則、fallback 腳本）、`#rose-window`、`roseWindowSVG`、`mountWindow`、`openGate`、`focusGate`、`lockMain`／`inert` 機制與其測試。`ceremonyFor`、`revealSchedule`、`quipDelay`、`splitGraphemes` 保留。
- 新增純函式（`sanctuary.js` 上半部，不碰 DOM）：
  - `worshipLayout({ count = 11, seed = 7 } = {}) -> Array<{ x: number, scale: number, row: 0|1, delay: number, flip: boolean }>`：確定性（以 seed 的簡單 LCG，不使用 `Math.random`）排出兩排教徒的位置（x 為 0–100 的百分比、後排 row=0 較小較暗、前排 row=1）、縮放（0.8–1.15）、呼吸動畫延遲（0–6 秒）；`x` 需分散且彼此不重疊太近（相鄰 x 差 ≥ 4）。
  - `worshipperSVG() -> string`：單一教徒跪坐的 SVG 字串（純色剪影，`fill="currentColor"`），包含可由 CSS 選取的 `<g class="w-head">`、`<g class="w-torso">`、`<g class="w-arms-down">`、`<g class="w-arms-up">` 四組（頭、身、雙手合十低垂、雙手高舉）。
  - `congregationHTML(layout) -> string`：回傳 `<div class="worshipper" style="--x:..;--s:..;--d:..s" data-row=".."> …svg… </div>` 的串接字串（flip 時加 class `flip`）。
  - `worshipState(event) -> 'idle' | 'bow' | 'raise' | 'still'`：事件 `'load'|'ask'|'reveal'|'crisis'|'reset'` 對應 `idle|bow|raise|still|idle`；未知事件回 `'idle'`。
- DOM 控制器 `createSanctuary` 調整：`mountCongregation()`（把 `congregationHTML(worshipLayout())` 放入 `#congregation`，容錯）、`setWorship(event)`（設定 `#congregation` 的 `data-state`；`reducedMotion` 時同樣設狀態但 CSS 不做過渡）、`pulse()` 改為「頂部光線一閃」（`#beams` 增亮 + 暗角瞬間收緊，不再有玫瑰窗光環）、`setBusy`／`reveal`／`calm`／`startDust`／`stopDust` 保留（`calm()` 另設 `data-state="still"`）。`reveal` 的危機路徑仍不加任何動畫 class，且 `setWorship('crisis')` 由呼叫端決定。
- 視覺：
  - `#congregation` 固定在畫面底部（`position: fixed; bottom: 0; left: 0; right: 0; height: 約 22vh; pointer-events: none; z-index` 在內容之下、背景之上），教徒為近黑剪影，帶極淡的上方邊緣光（上緣微亮的 `drop-shadow` 要避免昂貴濾鏡：用漸層遮罩或 `text-shadow` 以外的廉價方式；不得對連續動畫元素使用 `filter`）。後排較暗較小、前排較大。
  - 狀態動畫：`idle` 呼吸（torso translateY ±2px，6–9 秒，依 `--d` 錯開）；`bow` 頭與上身前傾（0.8 秒過渡）；`raise` 顯示 `w-arms-up`、隱藏 `w-arms-down`，身體微挺、整排微微抬高並加一道由上而下的光柱（`#beams` 增亮，持續到下一次提問）；`still` 低頭、無任何動畫、無光柱。轉換用 `transition`，不要 `animation` 重播造成跳動。
  - 載入時教徒由全黑淡入（約 3 秒）。
  - 背景：更暗的暗角、緩慢漂移的低透明度霧層（2 層 radial-gradient，速度極慢）、燭光般的邊緣暖光緩慢閃爍（CSS 透明度 4–7 秒不規則關鍵影格）；保留 `#beams`（降低亮度）與 `#dust`（粒子更少更暗，約 40）。移除所有旋轉玫瑰窗樣式。
  - 標題更沉重（字距、略暗的金色、微弱光暈）；輸入框與按鈕改為暗金細邊、聚焦時一圈深金光與清楚的 `:focus-visible` 外框；`#hint` 樣式：固定於底部中央偏上、極淡小字、可淡出。
  - 手機（<600px）：教徒數量以 CSS 隱藏後排（`[data-row="0"]`）或縮小，確保不橫向溢位且不遮住表單與答案；`overflow-x: clip` 保持。
- 無障礙：`#congregation` 與 `#beams`、`#dust` 皆 `aria-hidden="true"`；`#hint` 為 `role="status"`、極淡但對比仍 ≥ 3:1（文字僅作提示）。
- 測試（`tests/sanctuary.test.js`）：刪除入口與玫瑰窗測試；新增 `worshipLayout`（長度、確定性、x 範圍與最小間距、兩排都有、scale 範圍）、`worshipperSVG`（含四個 class 群組）、`congregationHTML`（元素數量 = layout 長度、flip class）、`worshipState`（全部事件與未知事件）。

- [ ] 依 TDD；`npm test` 全過。
- [ ] 以 Chrome 無頭 CDP 截圖（桌面 1280 與手機 390，狀態各一張：idle、bow、raise、still）並 Read 檢視：教徒剪影是否一眼看得出是跪拜的人、畫面是否黑暗沉重且文字清晰可讀、標題與表單無遮擋。逐一修到合理；不能自動判斷的美感部分在報告中如實說明。
- [ ] Commit：`feat: 拿掉入口與玫瑰窗，改為黑暗主題與底部教徒剪影動畫`（只 add 上述四個檔案）

---

### Task 3: app.js 接線、免手勢音樂與驗證

**Files:** Modify `assets/app.js`、`README.md`

- [ ] **接線**：載入時建立 `sanctuary`（`mountCongregation()`、`startDust()`、`setWorship('load')`）與 `audio`（`localStorage` 以 try/catch 取用）；立即嘗試 `audio.start()`；若 `audio.state() !== 'running'` 顯示 `#hint` 並掛一次性互動監聽（`pointerdown`/`keydown`/`touchstart`/`click`，`{ once: false }` 直到 running 為止，running 後全部移除）；`audio.onStateChange` 在 running 時淡出 `#hint`。不再有任何 gate 邏輯；`?q=` 深連結在資料載入完成後**立即**作答（不再等待入口），危機深連結需沿用 `#notice` 可被播報的處理（若因移除 inert 已自然成立則不需額外程式，並在報告中說明）。靜音鍵保留（`aria-pressed`、圖示）；靜音偏好沿用既有儲存邏輯，移除「靜默進入」相關的暫停寫入包裝。
- [ ] **提問流程狀態**：提問開始 `setBusy(true)` + 「求問中⋯」，並 `setWorship('ask')`（低頭）——但**必須在 `isCrisis` 前端預檢通過、且結果非危機之後**才呼叫 `pulse()`／`audio.hush(false)`（沿用上一輪修正後的順序，不得退步）；注意：`setWorship('ask')` 在結果出來前呼叫是允許的（低頭是靜態姿勢、不屬於儀式），但若最終結果為危機，必須立刻 `setWorship('crisis')`（靜止低頭）；一般結果：`pulse()`、`render` 後 `reveal`、`setWorship('reveal')`（舉手）、`audio.bell()`；之後下一次提問回到 `ask`。危機（前端預檢、API `crisis`、靜態退路）：`calm()`、`setWorship('crisis')`、`audio.hush(true)`、只 `showNotice`。
- [ ] **驗證**（CDP；靜態伺服 `python3 -m http.server 8765`，結束後關閉；scratchpad 目錄 `/private/tmp/claude-501/-Users-wangchengzhong-Desktop-New-Try/a89496d4-e393-44d0-bd57-78129062c809/scratchpad`）：(a) 載入後沒有 gate／玫瑰窗，表單可立即輸入；(b) 掛鉤 `AudioContext`（`Page.addScriptToEvaluateOnNewDocument`）：載入時建立 1 個 context，初始 state 為 suspended 時 `#hint` 可見；模擬第一次 `pointerdown`（`Input.dispatchMouseEvent`）後 state 變 running、`#hint` 消失；之後不再建立新 context；(c) 一般提問 `data-state` 依序為 `bow`→`raise`，危機提問（「我不想活了」）為 `still` 且無 `.ch`／`.reveal-late`／`pulse`；後端危機（覆寫 fetch 回 `{kind:'crisis',...}`、問「今天好累」）同樣為 `still` 且 `pulse` 從未出現；(d) `?q=` 深連結立即作答；(e) 390px 與 1280px 的 `scrollWidth == clientWidth`；(f) 截圖：桌面載入後、提問中（bow）、揭曉後（raise）、危機（still）、手機一張，Read 檢視並描述；(g) console 無錯誤（favicon 404 與靜態伺服的 501 除外）、無 unhandled rejection。
- [ ] `npm test` 與 `.venv/bin/pytest -q` 全過。
- [ ] **README**：更新「聖殿 UI」小節（無入口、音樂載入即嘗試並於第一次互動啟動、常駐循環與靜音鍵、教徒狀態動畫、危機不播儀式、`prefers-reduced-motion`、聲音與動畫未經自動驗證）；移除過時的入口、玫瑰窗、靜默進入描述。
- [ ] Commit：`feat: 免手勢常駐配樂與教徒動畫接線`（只 add app.js、README.md；若為接線必須動到其他檔案，需在報告明列並一併加入）
