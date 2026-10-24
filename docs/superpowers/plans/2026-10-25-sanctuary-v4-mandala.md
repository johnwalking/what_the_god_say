# 聖殿 UI v4：WebGL2 曼陀羅漏斗（十字架與十二門徒） Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 依使用者提供的參考程式（WebGL2 生成式曼陀羅：同心環、環上實例化的方塊模組、輪廓線／遮蔽／霧後製、自動環繞相機、可切換「世界」調色盤），做出自己的零依賴版本：暗黑神聖的調色盤、中央發光十字架、**十二位兜帽門徒（由方塊拼成的人形）混在旋轉的環中**；點擊中央十字架開啟詢問對話框；十字架上方有「點擊這裡」提示。取代 `2026-10-25-sanctuary-v3-apostles.md` 中 Task A 的 Canvas 2D 場景作為**主場景**，但 Task A 已完成的 2D 場景保留為 WebGL2 不可用時的**後備**；v3 的 Task B（app.js 接線、驗證、README）仍然適用（本計畫完成後執行）。

**Architecture:** 三個新模組：`mandala-math.js`（純函式：矩陣、軌道相機、種子亂數）、`mandala-shapes.js`（純函式：方塊建構器、門徒／十字架／裝飾模組、環配置）、`mandala.js`（WebGL2 渲染：場景 pass 寫入 color／normal／depth 到 FBO，後製 pass 做輪廓線、環境遮蔽、霧、暗角）。`sanctuary.js` 的 `mountScene()` 優先使用 `mandala.js`，失敗則退回既有 2D 場景；`setWorship`／`pulse`／`calm` 等介面不變。

**Tech Stack:** 原生 ES modules、WebGL2（GLSL ES 3.00，字串內嵌 shader）、Pointer Events；`node --test`；Chrome 無頭 + CDP 驗證（WebGL 用軟體渲染：`--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist`）。**零外部依賴、零建置**（不使用 wtc-gl／three.js／tweakpane／Vite）。

## 使用者回饋與已確認的決定
- 參考頁：Manifold Mandala（漏斗曼陀羅，可環繞縮放，點擊切換世界，R 重生長，D 暗色，空白鍵暫停）與 Manifold Tunnel（向前飛行的隧道）。參考程式缺少三支 shader（`ring.vert.js`、`ring.frag.js`、`post.frag.js`），**shader 需自行撰寫**。
- 已確認：**自寫 WebGL2、零依賴**；版型用**曼陀羅漏斗**（不是隧道）；門徒「雜在」旋轉的環裡；中央十字架可點擊並有「點擊這裡」提示；整體黑暗沉重神聖；音樂常駐（已完成）；不要入口、不要大圓圈（已完成）。
- 不做 tweakpane 調參面板；可調參數集中為各檔頭的具名常數（每個一行註解）。可選：`?debug=1` 在畫面角落顯示 FPS，非必要。

## Global Constraints

- 工作目錄 `/Users/wangchengzhong/Desktop/New-Try/bible-oracle`；git root 為其上一層。零外部依賴／字型／音檔／網路；不新增建置流程；仍可用 `python3 -m http.server` 直接開。
- 不得改動：`assets/audio.js`、`assets/match.js`、`assets/card.js`、`server/`。`app.js` 在 v3 Task B 才接線（本計畫的任務**不得**修改它）。
- 保留 v2-dark／v3 已完成成果：黑暗主題變數、霧層／燭光／光束（CSS）、`#dust`、`#hint`、`#mute`、`<dialog id="ask-dialog">` 與其內表單、`#cross` 按鈕與 `#cross-hint`、2D 後備場景。
- **危機不變式（不得退步）**：`calm()`／`setWorship('crisis')` → 門徒靜止低頭、無任何光暈增亮、無閃光；`pulse()` 在 `reducedMotion` 時略過。渲染層不得自行對文字內容做任何儀式動畫。
- `prefers-reduced-motion`：不自動環繞、環不自轉、無慣性；門徒姿勢仍依狀態切換但**無過渡**（直接到位）；仍可手動拖曳與縮放。
- 場景座標約定：**Y 向上**；十字架立於原點，高約 10；三圈門徒環水平放置於地面（y≈0），半徑約 6.5／10／13.5，每圈 3／4／5 位（共 12），**面向中心**；裝飾環（約 12 圈，種類取自 fin／comb／arch／tower／lattice）在上方形成向上收窄的漏斗／穹頂（高度 2→24、半徑 20→7）。環內模組局部座標：`+x` 徑向向外、`+y` 向上、`+z` 切線方向；門徒面朝 `-x`（面向中心）。
- 配色（暗黑神聖，可在檔頭常數中調整）：背景漸層近黑帶極淡暗紅（約 `#050403` → `#0d0506`）；門徒長袍近黑（約 `rgb(0.05,0.045,0.05)`）；金色輪廓與光（約 `rgb(0.72,0.58,0.25)`）；裝飾環在暗赭／暗紅／骨色之間（約 `rgb(0.25,0.06,0.07)`、`rgb(0.45,0.07,0.1)`、`rgb(0.7,0.64,0.5)` 低亮度）；十字架發光金（`rgb(1.0,0.82,0.45)` 自發光）。整體去飽和、沉重。
- 光源：十字架頂端的暖色點光（強度由狀態驅動），極低環境光；`still` 時最暗。
- 效能預算：每幀最多 ~15 次 instanced draw + 1 次全螢幕後製；`devicePixelRatio` 上限 1.5（手機）／2（桌面，寬度 ≥ 900px）；`document.hidden` 時暫停 rAF；視窗縮放時重建 FBO；不得每幀配置新陣列（熱路徑重用預先配置的 Float32Array）。
- WebGL 失敗處理：`createMandala` 在不支援 WebGL2、shader 編譯／連結失敗、FBO 不完整、或 context lost 時回傳 `null`／呼叫 `onFail` 並由 `sanctuary.js` 退回 2D 後備；不得丟出未處理例外；不得在 console 留下 `console.log` 除錯輸出（`console.warn` 一次性說明退回原因可以）。
- 程式風格沿用既有檔案（註解密度、命名；中文變數名可用）。commit 訊息結尾加：`Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`；絕不 `git add -A`（根目錄有未追蹤的 `主的旨意-技術筆記.md`）；不新增本計畫未列出的檔案。
- 視覺／美感為創作性工作：下列介面與驗收條件為約束，細節由實作者發揮並如實報告看到的結果。

---

### Task 1: mandala-math.js（純函式）

**Files:** Create `assets/mandala-math.js`、`tests/mandala-math.test.js`

**Interfaces:**
- `mulberry32(seed) -> () => number`：確定性亂數，回傳 [0,1)。
- `clamp(v, lo, hi)`。
- 矩陣一律為 `Float32Array(16)` 行主序（column-major，與 WebGL 一致）：`mat4Identity()`、`mat4Perspective(fovY, aspect, near, far)`、`mat4LookAt(eye, target, up)`、`mat4Multiply(a, b)`（回傳 `a * b`）、`mat4TransformPoint(m, [x, y, z]) -> [x, y, z, w]`；以上函式接受可選的 `out` 參數以重用陣列（熱路徑不配置）。
- `orbitEye(target, az, el, dist) -> [x, y, z]`：方位角 `az` 繞 Y 軸（az=0 在 +Z 方向），仰角 `el` 為離水平面的角度（+ 在上）。
- 軌道相機狀態機（參考頁的自動環繞，改為純函式）：
  - `ORBIT_DEFAULTS`（具名常數、每個一行註解）：`azAmp 0.955`、`elAmp 0.45`（弧度；自動路徑振幅）、`azRate 0.09`、`elRate 0.13`、`elPhase 10.7`、`follow 2.6`、`ramp 0.4`、`idleDelay 4`（秒）、`inertia 0.9`（拖曳慣性衰減，每秒指數）、`minEl -0.15`、`maxEl 1.2`、`minDist 16`、`maxDist 70`、`startDist 36`、`startEl 0.32`。
  - `createOrbit(overrides?) -> state`：`{ az, el, dist, vAz, vEl, idleFor, autoBlend, orbitT }`，初值 `az 0.4`、`el startEl`、`dist startDist`，其餘 0。
  - `stepOrbit(state, dt, input, params = ORBIT_DEFAULTS) -> state'`（不可修改傳入物件，回傳新物件）：`input = { dragDAz, dragDEl, zoomFactor, held, autoOrbit, paused }`；規則：有拖曳量（`dragDAz`／`dragDEl` 非 0）或 `held` 時 `idleFor = 0`、`autoBlend = 0`，並將拖曳量加到 `az`／`el` 且記錄為速度（`vAz`/`vEl` = 量 / dt）；`held` 為 false 時速度以 `exp(-dt * (1 - inertia) * 10)` 衰減並繼續位移；縮放：`dist = clamp(dist * zoomFactor, minDist, maxDist)`（zoomFactor 預設 1）；`autoOrbit && !paused` 且 `idleFor >= idleDelay` 時：`autoBlend` 以 `1 - exp(-dt*ramp)` 趨近 1、`orbitT += dt * autoBlend`，並讓 `az`/`el` 以 `1 - exp(-dt*follow*autoBlend)` 朝路徑點 `azAmp*sin(orbitT*azRate)`、`elAmp*sin(orbitT*elRate+elPhase)+startEl` 靠近；`el` 一律 clamp 於 [minEl, maxEl]；`idleFor` 在未拖曳且未 held 時累加 dt。
- `projectToScreen(viewProj, point, width, height) -> { x, y, visible, w }`：回傳 CSS 像素座標（原點左上）；`visible` 為 `w > 0` 且 NDC 在 [-1.2, 1.2] 內。

**Steps:**
- [ ] **Step 1: 寫失敗的測試**（`tests/mandala-math.test.js`，至少涵蓋）：`mulberry32` 確定性與範圍；`mat4Multiply(identity, m) == m`；`mat4Perspective` 的 [0][0]、[1][1] 與 `fovY`／`aspect` 關係；`mat4LookAt` 後把 `target` 轉到視空間 z<0 且 x=y=0（容差 1e-5）；`mat4TransformPoint` 對 identity 保持點；`orbitEye(az=0, el=0)` 在 +Z；`el=π/2` 在頂端；`stepOrbit`：idleFor < idleDelay 時 `autoBlend == 0`、超過後 > 0 且 `az` 有向路徑移動；有 `dragDAz` 時 `idleFor`/`autoBlend` 歸零且 `az` 位移；`paused` 或 `autoOrbit:false` 時不自動環繞；`el`／`dist` clamp；不修改輸入 state；慣性：`held:false` 後速度衰減、位移持續但遞減；`projectToScreen` 對視線中心點回傳畫面中心。
- [ ] **Step 2:** `node --test tests/mandala-math.test.js` → FAIL（模組不存在）。
- [ ] **Step 3:** 實作 `assets/mandala-math.js`（無 DOM、無全域副作用；`import` 時不得存取 `window`/`document`）。
- [ ] **Step 4:** `node --test tests/mandala-math.test.js && npm test` → 全過，輸出無雜訊。
- [ ] **Step 5: Commit**：`git add assets/mandala-math.js tests/mandala-math.test.js` → `feat: 曼陀羅場景的矩陣與軌道相機純函式`

---

### Task 2: mandala-shapes.js（方塊建構器、門徒、十字架、環配置）

**Files:** Create `assets/mandala-shapes.js`、`tests/mandala-shapes.test.js`

**Interfaces:**
- `Builder` 類別：`box(cx, cy, cz, sx, sy, sz, part = 0)`（軸對齊方塊，每面兩個三角形；每個頂點附 `part` 屬性）、`positions: number[]`、`normals: number[]`、`parts: number[]`（每頂點一個值）、`get count()`（頂點數）、`toArrays() -> { positions: Float32Array, normals: Float32Array, parts: Float32Array }`、可選的位移／縮放狀態（`o`、`s`）。
- 部位代碼（常數匯出 `PART`）：`BODY 0`、`HEAD 1`、`ARM 2`、`EMISSIVE 3`。
- `buildDisciple(opts = {}) -> Builder`：由方塊拼成的兜帽長袍人形，高約 4（單位與十字架高 10 成比例，約為其 0.4）、面朝 `-x`、站立於 y=0、局部原點在腳底中央。需包含：下寬上窄的長袍（至少 3 層疊放方塊）、略凸的肩線、**兜帽**（頭部方塊加一個向前的深色兜帽罩／略大的後方方塊，讓側影呈兜帽輪廓；`part = HEAD`）、**雙臂**（合十低垂於身前，各為至少 2 段方塊；`part = ARM`，且靠近肩部的樞軸位置固定為 `SHOULDER = [0, 3.1, 0]` 之類的具名常數，供 shader 旋轉用）；身體其餘為 `BODY`。頭與上身的前傾樞軸（`HIP`）亦為具名常數匯出。`opts.variant`（0–2）微調長袍寬度與兜帽大小，讓十二位不完全相同。
- `buildCross(opts = {}) -> Builder`：立於原點的拉丁十字，高 10、橫梁寬 6 於高度約 7；`part = EMISSIVE`；含底座數層方塊（底座 `BODY`）。
- 裝飾模組：`buildDecor(kind, w, rng) -> Builder`，`kind ∈ DECOR_KINDS = ['fin','comb','arch','tower','lattice']`，移植自參考頁 `shapes.js` 的概念（隨機以 `rng` 取代 `Math.random`），局部座標 `+x` 徑向外、`+y` 向上、`+z` 切線；`w` 為切線方向槽寬；全部 `part = BODY`。
- `planRings({ seed = 1, decorCount = 12 } = {}) -> { cross, rings }`：確定性。`rings` 為陣列，每筆 `{ id, role: 'disciple'|'decor', kind, R, y, N, w, spinSpeed, dir, phase, color: [r,g,b], variantSeed }`；`role:'disciple'` 恰 3 圈，`N` 依序 3、4、5（總 12），`kind:'disciple'`，`R` 約 6.5／10／13.5，`y = 0`，`dir` 逐圈交替，內圈轉較快；`role:'decor'` 恰 `decorCount` 圈，`y` 由 2 遞增到 24、`R` 由 20 遞減到 7（漏斗向上收窄）、`N = max(8, round(2πR / wTarget / 4) * 4)`、`w = 2πR / N`、`kind` 取自 `DECOR_KINDS`（相鄰兩圈不同種）、`color` 在暗赭／暗紅／骨色之間（亮度低、去飽和）。
- `buildRingGeometry(ring, rng) -> { positions, normals, parts, instances }`：`instances` 為 `Float32Array(N*2)`（每槽 `[slot, random]`）；`disciple` 圈使用 `buildDisciple({ variant })`，`decor` 圈使用 `buildDecor`。

**Steps:**
- [ ] **Step 1: 寫失敗的測試**：`Builder.box` 產生 36 個頂點（6 面×2 三角×3）；所有法線為單位長度、與面方向軸對齊；`parts.length == count`；`toArrays` 型別正確；`buildDisciple` 頂點數 > 0、含 HEAD 與 ARM 兩種 part、所有座標有限、y 範圍約 [0, 4.4]（容差）、x 範圍關於 -x 前方有凸出（兜帽）——例如最小 x 小於 -0.2 且最大 x 大於 0.2；不同 `variant` 的幾何不全相同；`buildCross` 全是 EMISSIVE 或底座 BODY、y 最大約 10（容差 ±0.5）、橫梁寬約 6；`buildDecor` 對每個 kind 在固定 seed 下確定且頂點數 > 0、座標有限；`planRings`：確定性（同 seed 結果深度相等）、disciple 圈恰 3 且 `N` 總和 12、decor 圈恰 12、`y` 與 `R` 單調、相鄰 decor kind 不同、顏色分量皆在 [0,1] 且亮度（max 分量）< 0.8、`w` 與 `N` 一致（`w ≈ 2πR/N`）；`buildRingGeometry` 的 `instances.length == N*2`。
- [ ] **Step 2:** `node --test tests/mandala-shapes.test.js` → FAIL。
- [ ] **Step 3:** 實作 `assets/mandala-shapes.js`（純函式；使用 `mulberry32` from `./mandala-math.js`；無 DOM）。
- [ ] **Step 4:** `node --test tests/mandala-shapes.test.js && npm test` → 全過。
- [ ] **Step 5:** 在一個**臨時腳本**（放 scratchpad，不進 repo）把 `buildDisciple` 的方塊以簡單正交投影畫到 SVG／PNG（例如輸出側視圖與前視圖的 SVG 字串，再用 Chrome 無頭截圖），Read 檢視：側影是否像「兜帽長袍的人」？雙臂與兜帽是否可辨？不像就調整比例。把截圖路徑與觀察寫入報告。
- [ ] **Step 6: Commit**：`git add assets/mandala-shapes.js tests/mandala-shapes.test.js` → `feat: 方塊建構的兜帽門徒、十字架與裝飾模組，及環配置`

---

### Task 3: mandala.js（WebGL2 渲染器）與獨立驗證

**Files:** Create `assets/mandala.js`；（驗證用的臨時頁放 scratchpad，不進 repo）

**Interfaces:**
- `createMandala(canvas, { reducedMotion = false, seed = 1, onFrame = null, onFail = null } = {}) -> null | Mandala`
  - `Mandala`: `{ setState(state: 'idle'|'bow'|'raise'|'still'), pulse(), setPaused(b), isPaused(), orbitInput(dAz, dEl), zoomBy(factor), setHeld(b), resize(), destroy(), getDebug() }`。
  - 內部每幀：更新 `stepOrbit`（呼叫 `mandala-math.js`）、環自轉（`spin += spinSpeed * dir * sceneSpeed * dt`，`sceneSpeed` 由狀態平滑趨近：idle 1、bow 0.25、raise 1.8、still 0）、姿勢混合（`bowBlend`／`raiseBlend` 平滑趨近目標；`reducedMotion` 時直接到位）、光強 `glow`（idle 0.6、bow 0.45、raise 1.4、still 0.25，平滑；`pulse()` 暫時疊加一個衰減的閃光）。`onFrame({ cross: {x, y, topY, bottomY, visible} })`：每幀以 `projectToScreen` 提供十字架中心與上下端的 CSS 像素位置，供 DOM 對位。
  - `getDebug()` 回傳 `{ frames, state, orbit: {az, el, dist}, rings: n, draws: n, glow, bowBlend, raiseBlend }`（供 CDP 驗證，非 UI）。
- 渲染流程：(1) 建立 FBO：color RGBA8、normal RGBA8（a 通道 = 自發光旗標）、depth 以 `DEPTH_COMPONENT24` 紋理（WebGL2 原生可取樣，不需要擴充）；`drawBuffers([COLOR0, COLOR1])`；(2) 場景 pass：每圈一次 instanced draw（含十字架一次）；頂點 shader 由 `uRing = [R, y, spin, scale]`、`inst = [slot, rnd]` 計算位置：`θ = spin + dir*0 + 2π*slot/N`（`dir` 已體現在 spin 的增量）、先把模組局部座標繞 Y 轉到徑向（局部 +x 指向外），再平移到 `(R cosθ, y, R sinθ)`；門徒的姿勢變形：以 `part` 屬性區分，`HEAD`/上身依 `bowBlend` 繞 `HIP` 樞軸向前（朝 -x，即面向中心）傾斜，`ARM` 依 `raiseBlend` 繞 `SHOULDER` 樞軸向上舉，並加上依 `rnd` 錯開的極輕微呼吸起伏；`uGlow`、`uLight`（十字架頂端點光）與 `part == EMISSIVE` 的自發光；fragment shader 輸出 lit color（方塊面以法線與點光做簡單 Lambert + 極低環境光；加上距離衰減）與編碼法線；(3) 後製 pass（全螢幕三角形）：由 depth 紋理重建線性深度，Sobel／鄰域差分偵測深度與法線不連續 → 金色細輪廓（線寬隨深度略減、強度受 `uLines` 控制），簡易 SSAO（8 個鄰點深度比較）壓暗凹處，距離霧混入背景漸層（背景為近黑帶暗紅的垂直漸層），暗角，`uPulse` 閃光，輸出到螢幕。
- 互動由 `Mandala` 提供鉤子（`orbitInput`／`zoomBy`／`setHeld`）；**事件綁定在 Task 4（`sanctuary.js`）**，本任務只實作渲染與狀態。
- 錯誤處理與資源：shader 編譯／連結錯誤、`checkFramebufferStatus` 不完整、context lost → 呼叫 `onFail(reason)` 並回傳 `null`（或在 runtime 時停止迴圈）；`destroy()` 釋放所有 GL 資源並取消 rAF；`resize()` 重建 FBO 與 viewport。

**Steps:**
- [ ] **Step 1:** 讀 Task 1、2 已完成的模組；用 TDD 的精神，先寫一個**不依賴 WebGL 的小測試** `tests/mandala.test.js`：`createMandala` 在沒有 WebGL2 的假 canvas（`getContext` 回 `null`）上回傳 `null` 並呼叫 `onFail`；在 `getContext` 拋錯時同樣處理（show RED → 實作 → GREEN）。（此檔案屬於本任務允許新增的測試檔。）
- [ ] **Step 2:** 實作 `assets/mandala.js`（shader 以模板字串內嵌；`import` 時不得存取 `window`/`document`；熱路徑不配置）。
- [ ] **Step 3 — 獨立驗證**：在 scratchpad 建一個臨時 HTML 頁，載入 `/assets/mandala.js` 與一個全螢幕 canvas，啟動 `createMandala`，並用 CDP 驅動：載入 `http://localhost:8765/<臨時頁>`（`python3 -m http.server 8765` 從 `bible-oracle/` 啟動，臨時頁以相對路徑放在 repo 之外時，改用把臨時頁複製到 scratchpad 並以 `file://` 不可行——請改在 scratchpad 內另起一個 `python3 -m http.server 8766`，把 `assets/` 以符號連結或複製加入該 scratchpad 目錄）。Chrome 參數：`--headless=new --use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist --window-size=1280,900`。若 WebGL2 在無頭環境無法建立，如實報告並嘗試其他旗標；仍不可行時，以 `getDebug()`／shader 編譯日誌盡可能驗證，並明確標示「未能目視驗證」。
- [ ] **Step 4 — 目視**：截圖（桌面 1280×900 與手機 390 寬）涵蓋 `idle`、`bow`、`raise`、`still`，Read 並誠實描述：曼陀羅漏斗是否成形？門徒是否可辨為兜帽人形圍繞發光十字架？是否黑暗、沉重、神聖？輪廓線／霧／暗角效果如何？有無 z-fighting、閃爍、破面？調整常數與 shader 直到合理。報告需列出可調常數（光強、輪廓粗細與強度、霧距、AO 強度、環數、顏色）。
- [ ] **Step 5:** `npm test` 全過。
- [ ] **Step 6: Commit**：`git add assets/mandala.js tests/mandala.test.js` → `feat: WebGL2 曼陀羅渲染器（實例化方塊環、輪廓線與遮蔽後製）`

---

### Task 4: 接入 sanctuary.js、事件與 DOM 對位、後備

**Files:** Modify `assets/sanctuary.js`、`assets/style.css`、`index.html`（僅必要的調整）、`tests/sanctuary.test.js`

**Interfaces:**
- `mountScene()`：優先嘗試 `createMandala(#scene, { reducedMotion, onFrame, onFail })`；成功時**不啟動** 2D 場景迴圈；失敗（回 `null` 或 `onFail`）退回 Task A 的 2D 場景（保持其既有行為與測試）。控制器內以單一欄位記錄目前使用的後端（`'webgl'|'canvas2d'`），`getSceneBackend()` 回傳之（供驗證）。
- `setWorship(event)`、`pulse()`、`calm()`、`reveal()`、`setBusy()`、`startDust()/stopDust()` 的行為與簽名不變，內部依後端轉送：WebGL 後端呼叫 `mandala.setState(worshipState(event))`／`mandala.pulse()`。
- 互動（WebGL 後端）：在 `#scene` 上綁定 Pointer Events——單指／滑鼠拖曳 → `orbitInput(dAz, dEl)`（水平 1px ≈ 0.006 rad，垂直 1px ≈ 0.005 rad）並 `setHeld(true/false)`；移動超過 6px 視為拖曳，**拖曳結束不得觸發十字架按鈕的 click**（沿用 Task A 的防誤觸作法）；滾輪與雙指縮放 → `zoomBy(factor)`；空白鍵 → `setPaused` 切換（焦點在 `input`／`textarea`／`dialog` 內時不攔截）；`visibilitychange` 時由 mandala 內部暫停。
- DOM 對位：`onFrame` 回傳的十字架螢幕位置寫入 CSS 變數（`#cross` 的 `--cx/--cy/--cw/--ch`，`#cross-hint` 的 `--hx/--hy`）；`#cross` 的點擊區為十字架外框稍微放大（寬至少 56px、手機至少 72px，高度取十字架螢幕高度），`#cross-hint`「點擊這裡」固定在十字架頂端上方約 24px；在 2D 後備下沿用既有定位。`getCrossRect()` 回傳目前十字架按鈕的 `DOMRect`（供驗證）。
- 樣式：`#scene` 全螢幕；移除任何與 2D 場景耦合而干擾 WebGL 版的樣式；確保 `#dust`、霧層、燭光不蓋過十字架提示；dialog 開啟時（`dialog[open]`）可略降場景亮度（`#scene` 加 class，CSS `opacity` 轉場；reduced-motion 無轉場）。
- 測試（`tests/sanctuary.test.js` 或新的小測試於同檔內）：用假的 `document`／假的 `createMandala` 注入（為此給 `createSanctuary` 增加可注入的 `createMandalaFn` 選項，預設為真實的），驗證：成功時使用 WebGL 後端且不啟動 2D 迴圈；回 `null` 時退回 2D 並呼叫其初始化；`setWorship` 轉送正確的狀態；`calm()` 轉送 `still`；`reducedMotion` 時 `pulse()` 不呼叫 mandala；`getSceneBackend()` 值正確。

**Steps:**
- [ ] **Step 1:** 先寫上述注入測試（RED），再實作（GREEN）；`npm test` 全過且輸出乾淨。
- [ ] **Step 2 — 目視／互動驗證（CDP；靜態伺服 `python3 -m http.server 8765` 從 `bible-oracle/`；Chrome 旗標同 Task 3）**：因為 `app.js` 尚未接線，使用 scratchpad 的臨時測試頁（載入 `/assets/sanctuary.js`，並依真實的 `index.html` 標記建立 DOM，例如將 `index.html` 的 `<body>` 內容複製到臨時頁、移除對 `app.js` 的 `<script>`，改成自己的 `<script type="module">` 呼叫 `createSanctuary().mountScene()` 等）。驗證：(a) WebGL 後端被選用（`getSceneBackend()`），並在強制 `onFail` 時退回 2D；(b) `#cross` 與 `#cross-hint` 位置隨縮放／環繞保持對位（讀取 `getBoundingClientRect` 與 `getDebug()`）；(c) 拖曳改變 `orbit.az/el`、滾輪改變 `dist` 並被 clamp、拖曳後不觸發十字架 click、單擊十字架觸發 click；(d) 閒置超過 `idleDelay` 後自動環繞開始（`autoBlend > 0`），拖曳會立即中止；(e) 空白鍵暫停；(f) 四種姿勢狀態與危機情境（`calm()`）無光暈增亮、無閃光；(g) 390px 與 1280px 的 `scrollWidth == clientWidth`；(h) 截圖：桌面與手機的主畫面（可見十字架、「點擊這裡」、十二位門徒與漏斗）、`raise`、`still`、dialog 開啟；Read 並描述；(i) console 無錯誤。
- [ ] **Step 3: Commit**：`git add assets/sanctuary.js assets/style.css index.html tests/sanctuary.test.js` → `feat: 曼陀羅場景接入控制器，含互動、十字架對位與 2D 後備`

---

**完成後**：回到 `2026-10-25-sanctuary-v3-apostles.md` 的 Task B（app.js 接線、驗證、README），並在驗證項目 (a)(f) 另外確認 WebGL 後端與 2D 後備兩種情況下的行為；之後做整體最終審查。
