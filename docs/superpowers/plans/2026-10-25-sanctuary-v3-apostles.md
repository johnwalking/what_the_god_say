# 聖殿 UI 再修訂：十字架與十二門徒 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 依使用者新回饋，把主畫面改成「全螢幕畫布：中央發光十字架，十二門徒在其周圍的多層軌道上緩慢轉圈」；點擊十字架才開啟詢問對話框；十字架上方有「點擊這裡」提示。取代 `2026-10-25-sanctuary-v2-dark.md` 中底部跪拜教徒的設計（該計畫的 Task 1 配樂與 Task 2 的黑暗主題保留）。

**Architecture:** 新增 Canvas 2D 偽 3D 場景（`#scene`）：純函式負責軌道配置與透視投影，DOM 控制器負責繪製與互動（拖曳環繞、滾輪／雙指縮放）；十字架是畫布上的圖形加上其上方一個透明的 `<button>` 作為可聚焦的點擊目標；詢問介面改為原生 `<dialog>`（既有表單與答案元素搬進去，id 不變）。

**Tech Stack:** 原生 ES modules、Canvas 2D、`<dialog>`、Pointer Events、Web Audio；`node --test`；Chrome 無頭 CDP 驗證。零外部依賴。

## 使用者回饋（原話摘要）
參考一個「曼陀羅」全螢幕畫布頁（拖曳環繞、滾輪縮放、點擊切換、空白鍵暫停；原始碼無法讀取，僅依貼上的 HTML 與描述理解）。要改成：門徒在轉圈；點擊中間的十字架會觸發詢問介面框；十字架上要有提示詞說要點擊這裡。先前已確認：起始頁不要有大圓圈（玫瑰窗已移除）、不需要點擊入口、音樂常駐、整體黑暗沉重神聖、門徒動畫用來推進氣氛。已確認：畫面用 **2D 畫布偽 3D**；底部跪拜教徒**改成**繞十字架的**十二門徒**。

## Global Constraints

- 工作目錄 `/Users/wangchengzhong/Desktop/New-Try/bible-oracle`；git root 為其上一層。零外部依賴／字型／音檔／網路。
- 保留 v2-dark 計畫已完成的成果：低沉常駐配樂與免手勢啟動（`audio.js` 不要改）、黑暗主題變數、霧層／燭光／光束／灰塵、`#hint`（音樂提示）、靜音鍵（常駐可見）。
- **危機不變式（上一輪安全審查，不得退步）**：危機訊息（前端 `isCrisis` 預檢、API `crisis`、靜態退路）沒有任何儀式：不閃光、不逐字、不響鐘、門徒進入「靜止低頭」且不做任何動畫、音樂 hush 但不停止。
- 十字架與提示：十字架在畫面正中偏上（約 50% / 46%）；提示文字「點擊這裡」位於十字架正上方，淡金色、緩慢呼吸閃動、下方一個小箭頭；對話框開啟過一次後提示淡出不再顯示（以記憶體旗標，不寫 localStorage）。十字架按鈕 `#cross` 有 `aria-label="點擊十字架，向主求問"`、可 Tab 聚焦、Enter／Space 觸發、`:focus-visible` 有清楚外框。
- 詢問介面框使用原生 `<dialog id="ask-dialog">` + `showModal()`；內含既有的 `#ask-form`、`#question`、`#notice`、`#answer`、`#asked-text`、`#verse-text`、`#verse-ref`、`#quip`、`#again`、`#save`（id 與語意不變）、一個關閉按鈕 `#close-dialog`；Esc／關閉鈕關閉並把焦點還給 `#cross`；開啟時聚焦 `#question`（若已有答案則維持）；深色、金色細邊、`::backdrop` 為半透明黑。對話框內文字對比與先前一致。
- 門徒共 12 位，分 3 層軌道（內 3、中 4、外 5，或你認為視覺更好的 12 位分配），各層半徑遞增、速度不同、交替方向；遠處較小較暗、近處較大較亮；剪影為帶兜帽的長袍人形，近黑色，細金邊（rgba 金色，隨深度變淡）；姿勢：`idle`（雙手下垂合十）、`bow`（低頭前傾）、`raise`（雙手高舉）、`still`（低頭靜止）。
- 狀態對應：`load/reset → idle`（約 0.04 rad/s 基準軌道速度）；`ask → bow`（速度 ×0.25）；`reveal → raise`（速度 ×1.8，十字架光暈增亮，持續到下一次提問或關閉）；`crisis → still`（速度 0、姿勢低頭、不增亮）；對話框關閉 → `idle`。
- 互動：拖曳（Pointer Events）旋轉視角（yaw 無限、pitch 限制在約 0.15–1.0 rad）；滾輪與雙指縮放（zoom 限制約 0.6–1.8）；拖曳超過約 6px 不視為點擊；放開後 yaw 帶輕微慣性衰減。`prefers-reduced-motion`：不自動旋轉（yaw 固定）、不慣性、不灰塵；門徒仍依狀態切換姿勢（無過渡）；仍可手動拖曳。
- 借用自參考頁（`tunnel.html`／`controls.js`，僅行為層面，不引入 three.js／tweakpane）：(1) **自動環繞**：閒置時視角（yaw）持續緩慢自轉，使用者拖曳後暫停，閒置約 4 秒（`IDLE_DELAY_SEC`）後平順恢復；(2) **空白鍵**暫停／繼續門徒轉動（`aria-live` 不需要，但鍵盤焦點在輸入框時不可攔截空白鍵）；(3) **旋渦感**：每層軌道的半徑隨相位有極小幅度的正弦起伏（`SWIRL` 常數，約 0.04–0.08 的相對幅度），讓軌跡略呈螺旋而非正圓；(4) **霧距**：越遠越暗越淡（已由 depth→alpha 表達，另加一個 `FOG` 常數控制遠處衰減強度）；(5) 這些可調參數集中在 `sanctuary.js` 檔頭的具名常數，每個一行註解。
- 畫布效能：`devicePixelRatio` 上限 2；`requestAnimationFrame`，`document.hidden` 時暫停；resize 重算；不使用 `filter`；每幀只畫 12 位門徒與十字架。手機（<600px）縮小半徑使整體在 390px 寬內；`scrollWidth == clientWidth`。
- 保留既有行為：`npm test`、`.venv/bin/pytest -q`（220）、靜態模式與 API 模式、`match.js` 前端安全閘、`card.js`（卡片）不改。
- 不改 `server/`、`match.js`、`card.js`、`audio.js`。commit 訊息結尾加：`Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`；絕不 `git add -A`（根目錄有未追蹤的 `主的旨意-技術筆記.md`，不可加入）；不新增計畫未列出的檔案。
- 視覺／美感為創作性工作，下列為約束與驗收條件。

---

### Task A: 場景、十字架、對話框外殼與樣式

**Files:** Modify `index.html`、`assets/style.css`、`assets/sanctuary.js`、`tests/sanctuary.test.js`

**Interfaces（`sanctuary.js` 純函式，不碰 DOM）:**
- 刪除（連同測試）：`worshipLayout`、`worshipperSVG`、`congregationHTML`、`#congregation` 相關 DOM 與 CSS、控制器的 `mountCongregation`。保留：`splitGraphemes`、`revealSchedule`、`quipDelay`、`ceremonyFor`、`worshipState(event) -> 'idle'|'bow'|'raise'|'still'`。
- 新增：
  - `discipleRings(count = 12) -> Array<{ ring: 0|1|2, index: number, phase: number, radius: number, dir: 1|-1, speed: number }>`：確定性；3 層，`radius` 為 0–1 的相對半徑（內 ≈0.38、中 ≈0.62、外 ≈0.88），同層 phase 等角均分並加上層間錯開，`dir` 逐層交替，`speed` 為該層相對速度（內層較快）；總數恰為 `count`。
  - `projectDisciple(d, { t, yaw, pitch, zoom, width, height, baseSpeed = 0.04, cx = 0.5, cy = 0.5 }) -> { x, y, scale, alpha, depth, z }`：以 `θ = d.phase + d.dir * d.speed * baseSpeed * t + yaw`、`R = d.radius * min(width, height) * 0.42 * zoom`；`x3 = R cosθ`、`z3 = R sinθ`；螢幕 `x = cx*width + x3`、`y = cy*height + z3 * sin(pitch)`；`depth = (z3 / R + 1) / 2`（0 遠 1 近）；`scale = 0.55 + 0.6 * depth`（再乘以 `zoom` 的平方根）、`alpha = 0.3 + 0.7 * depth`；`z = z3`（用於與十字架的前後排序）。
  - `clampPitch(p)`（0.15–1.0）、`clampZoom(z)`（0.6–1.8）、`sceneSpeed(state) -> number`（`idle 1`、`bow 0.25`、`raise 1.8`、`still 0`，未知回 1）。
  - 軌道時間以「累積相位」而非 `speed * 絕對時間`處理速度變化：控制器維護一個 `t`，每幀 `t += dt * sceneSpeed(state)`（平滑趨近目標速度，避免速度突變）。
- 控制器 `createSanctuary` 調整：`mountScene()`（建立並啟動 `#scene` 畫布繪製迴圈、事件、resize、visibility）、`setWorship(event)`（用 `worshipState` 設定場景狀態與 `data-state`）、`pulse()`（十字架光暈與光束一閃；`reducedMotion` 時略過）、`setBusy`／`reveal`／`calm`／`startDust`／`stopDust` 保留、`getCrossRect() -> DOMRect | null`（用於提示定位，可省略若純 CSS 定位足夠）。`openDialog()`／`closeDialog()` 放在 app.js（Task B），此處只提供外殼。
- 繪製（DOM 部分，不測）：`drawCross(ctx, cx, cy, size, glow)`：細長的金色拉丁十字（橫梁在上三分之一）、漸層與柔和光暈（`radialGradient`，不用 `filter`），`glow` 0–1；`drawDisciple(ctx, p, pose, tint)`：兜帽長袍剪影（頭圓、肩線、梯形袍身，必要時手臂線），近黑色填色，金色細邊 `rgba(184,153,90,alpha*0.5)`；排序：依 `z` 由遠到近，十字架畫在 `z = 0` 的位置（遠的先畫、十字架、近的後畫）。

**Markup / 樣式:**
- `index.html`：移除 `#congregation`；新增全螢幕 `<canvas id="scene" aria-hidden="true">`（位於霧層／光束之上、內容之下）、`<button id="cross" type="button" aria-label="點擊十字架，向主求問">`（透明，絕對定位於十字架位置，約 56×96 px，手機略大以利觸控）、`<p id="cross-hint">點擊這裡<span class="arrow">↓</span></p>`（在十字架上方）、`<dialog id="ask-dialog" aria-labelledby="dialog-title">`（標題 `<h2 id="dialog-title">向主求問</h2>`、關閉鈕 `#close-dialog`、並搬入既有表單與答案區）；主標題縮小並留在頂部，不與十字架提示重疊；`#hint`（音樂提示）、`#mute` 保留；頁面主區塊（`main`）不再包含表單與答案（它們在 dialog 內），頁尾 colophon 保留在畫面底部淡淡顯示。
- `style.css`：移除 congregation 與跪拜相關樣式；加入 `#scene`、`#cross`（含 `:focus-visible`）、`#cross-hint`（呼吸閃動、箭頭上下浮動；reduced-motion 時靜態）、`dialog`（深色近黑、金色細邊、圓角極小、內距寬鬆、最大寬度約 36rem、`max-height: 86vh` 可捲動）與 `::backdrop`（半透明黑加模糊以外的輕量處理：`background: rgba(0,0,0,.72)`；不用 `backdrop-filter`）；對話框開啟動畫為淡入 + 輕微上浮（reduced-motion 無動畫）；手機版對話框佔滿寬度的 94%。

**測試（`tests/sanctuary.test.js`）:** 刪除 congregation 相關測試；新增：`discipleRings`（長度 12、3 層、每層至少 3 位、確定性、radius 遞增、dir 逐層交替、phase 在 [0, 2π) 內）、`projectDisciple`（z>0 比 z<0 的 scale 與 alpha 大、`depth` 在 [0,1]、yaw 增加 2π 結果相同、zoom 放大使半徑增大、pitch 變大使 y 方向展開增大）、`clampPitch`／`clampZoom`／`sceneSpeed`。

- [ ] TDD：先寫失敗測試，show RED，再實作，show GREEN；`npm test` 全過且輸出無雜訊。
- [ ] CDP 截圖（桌面 1280×900 與手機 390 寬）：載入後的主畫面（可見十字架與「點擊這裡」提示與十二位門徒）、`bow`、`raise`、`still` 各狀態、對話框開啟（可在臨時測試頁用腳本呼叫 `dialog.showModal()`；app.js 在 Task B 才接線，**本任務不得修改 app.js**，臨時測試頁放在 scratchpad 而不是 repo）。Read 每張並誠實描述：門徒是否一眼看得出是兜帽人形？十字架提示是否明顯？是否黑暗沉重？文字是否清楚？手機是否溢位（`scrollWidth == clientWidth`）？
- [ ] Commit：`feat: 十字架與十二門徒繞行場景，詢問介面改為對話框`（只 add 上述四個檔案）

---

### Task B: app.js 接線、驗證與 README

**Files:** Modify `assets/app.js`、`README.md`

- [ ] **接線**：載入時 `mountScene()`、`startDust()`、`setWorship('load')`；音樂：立即嘗試 `audio.start()`，若 `audio.state() !== 'running'` 顯示 `#hint`（音樂提示）並掛一次性互動監聽，直到 running 後移除；`#cross` 的 click（含鍵盤）→ `openDialog()`（`showModal()`、聚焦 `#question`、`setWorship('ask')`、隱藏 `#cross-hint` 且之後不再顯示；同一個點擊也要呼叫 `audio.start()` 以滿足手勢）；`#close-dialog` 與 `dialog` 的 `close` 事件 → `setWorship('reset')`、焦點還給 `#cross`；`?q=` 深連結：資料載入後**自動開啟對話框並作答**（危機深連結：對話框開啟後 `#notice` 顯示關懷訊息，焦點移到 `#notice`，因為 `dialog` 不是 inert 區域，應可被播報）。
- [ ] **提問流程狀態**（沿用先前修正後的順序，不得退步）：提交時 `setBusy(true)` 與「求問中⋯」，`setWorship('ask')`；前端 `isCrisis` 預檢在 `pulse()`／`audio.hush(false)` **之前**；一般結果：`setBusy(false)`、`audio.hush(false)`、`pulse()`、`render` + `reveal`、`setWorship('reveal')`（`bell()` **僅在** `audio.state() === 'running'` 時呼叫，因為 `bell()` 在 suspended 的 context 上會排隊並在恢復時才響）；危機（前端預檢、API `crisis`、靜態退路）：`setBusy(false)`、`calm()`、`setWorship('crisis')`、`audio.hush(true)`、只 `showNotice`；對話框關閉或下一次提問時恢復 `idle`／`ask`。「存成圖片」、「再求一次」行為不變（它們在 dialog 內）。
- [ ] **驗證**（CDP；靜態伺服 `python3 -m http.server 8765`，結束後關閉；scratchpad `/private/tmp/claude-501/-Users-wangchengzhong-Desktop-New-Try/a89496d4-e393-44d0-bd57-78129062c809/scratchpad`）：(a) 載入後沒有入口與玫瑰窗，畫面有十字架、「點擊這裡」提示、12 位門徒（以 `Runtime.evaluate` 讀取場景狀態或畫布像素非空即可）；(b) 掛鉤 `AudioContext`：載入時建立 1 個 context，suspended 時 `#hint` 可見；第一次 `pointerdown`（點十字架）後 running、`#hint` 消失、不新增 context；(c) 點十字架：dialog `open`、焦點在 `#question`、`#cross-hint` 消失；Esc 關閉後焦點回 `#cross`；(d) 一般提問後 `data-state` 依序 `bow`→`raise`，有 `.ch`；前端危機（「我不想活了」）與後端危機（覆寫 fetch 回 `{kind:'crisis',...}`、問「今天好累」）皆為 `still`，且無 `.ch`／`.reveal-late`、從未出現 `pulse`；(e) `?q=我老婆一直碎念` 與 `?q=我不想活了` 深連結行為正確（後者 `document.activeElement` 為 `#notice`）；(f) 拖曳與滾輪改變視角與縮放（讀取內部狀態或截圖比較）、拖曳不會誤觸十字架點擊；(g) 390px 與 1280px 的 `scrollWidth == clientWidth`（主畫面、dialog 開啟、答案顯示三種狀態）；(h) 截圖（桌面：主畫面、dialog 開啟含答案、危機；手機：主畫面、dialog 含答案）並 Read 描述；(i) console 無錯誤（favicon 404 與靜態伺服 501 除外）、無 unhandled rejection。
- [ ] `npm test` 與 `.venv/bin/pytest -q` 全過。
- [ ] **README**「聖殿 UI」小節改寫：十字架與十二門徒場景、點擊十字架開啟詢問框、音樂載入即嘗試並於第一次互動啟動且常駐、靜音鍵、`prefers-reduced-motion`、危機訊息不播儀式、聲音與動畫未經自動驗證；移除入口、玫瑰窗、底部教徒的過時描述。
- [ ] Commit：`feat: 點擊十字架開啟詢問框，門徒場景與音樂接線`（只 add app.js、README.md；若接線必須動到其他檔案，在報告明列並一併加入）
