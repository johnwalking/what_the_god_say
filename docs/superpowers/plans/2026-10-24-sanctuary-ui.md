# 主的旨意：哥德式大教堂 UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 為 bible-oracle 前端加上哥德式大教堂視覺、動畫與即時合成的配樂（設計見 `docs/superpowers/specs/2026-10-24-sanctuary-ui-design.md`）。

**Architecture:** 兩個新的 ES module：`sanctuary.js`（純函式加 DOM 控制器）與 `audio.js`（純函式加 Web Audio 合成引擎），由 `app.js` 以最少的掛勾接上。純邏輯用 `node --test` 驗證；視覺用無頭 Chrome 截圖驗證；聲音與動畫的主觀品質交給使用者。

**Tech Stack:** 原生 ES modules、CSS animation、SVG、Canvas 2D、Web Audio API；`node --test`；Google Chrome 無頭模式（`/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`）截圖。

## Global Constraints

- 工作目錄 `/Users/wangchengzhong/Desktop/New-Try/bible-oracle`；git root 為其上一層。
- 零外部依賴、零建置、零外部字型與音檔；不得從網路載入任何資源。
- 既有 `npm test`（47 項）與 `.venv/bin/pytest -q`（220 項）必須維持通過。
- 色票：背景約 `#0b0907`、金 `#d8b45a`、次要文字 `#a8957a`、墨 `#241f18`（卡片字色）。
- 配樂總音量上限 0.25；所有音色／時間參數集中在 `audio.js` 最上方常數。
- 危機訊息（API 回 `crisis` 或前端 `isCrisis` 命中）：**不得**播放任何儀式動畫或鐘聲，音樂降為 hush，只顯示靜態關懷訊息。
- `prefers-reduced-motion`：關閉旋轉、灰塵、逐字浮現、光環，只留淡入。
- 沒有 `AudioContext` 時音訊模組回傳無作用物件，不丟錯。
- 靜態模式（無後端）與 API 模式行為不變；不得改動 `assets/match.js` 與 `server/`。
- 程式風格：沿用 `app.js`／`card.js` 的註解密度與命名慣例（中文變數名可用）。
- 不新增本計畫未列出的檔案；commit 訊息結尾加：`Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`
- 此計畫的 UI／音訊實作屬創作性工作：下列「Interfaces」與驗收條件是約束，視覺與音色細節由實作者依設計文件發揮，並在報告中說明可調整的常數。

---

### Task 1: sanctuary.js 純函式

**Files:**
- Create: `assets/sanctuary.js`、`tests/sanctuary.test.js`

**Interfaces:**
- Produces:
  - `splitGraphemes(text) -> string[]`：以 `Array.from` 逐碼點拆分，`null`／`undefined` 視為空字串。
  - `revealSchedule(text, { startDelay = 0.2, perChar = 0.06, maxTotal = 4.5 } = {}) -> { chars: string[], delays: number[], total: number }`：每字延遲 `startDelay + i * step`，`step = min(perChar, (maxTotal - startDelay) / chars.length)`，延遲四捨五入到小數 3 位；`total` 為最後一字延遲加 0.6（空字串時各為空／0）。
  - `quipDelay(total) -> number`：`total + 1.5`（四捨五入到小數 3 位）。
  - `ceremonyFor(kind) -> { animate: boolean, bell: boolean, hush: boolean }`：`kind === 'crisis'` 回 `{animate:false, bell:false, hush:true}`；其他回 `{animate:true, bell:true, hush:false}`。
  - `roseWindowSVG({ petals = 12, size = 400 } = {}) -> string`：回傳完整 `<svg>` 字串（見 Step 3 的實作）。

- [ ] **Step 1: 寫失敗的測試**

`tests/sanctuary.test.js`：

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitGraphemes, revealSchedule, quipDelay, ceremonyFor, roseWindowSVG } from '../assets/sanctuary.js';

test('splitGraphemes 依碼點拆分且容忍空值', () => {
  assert.deepEqual(splitGraphemes('主的旨意'), ['主', '的', '旨', '意']);
  assert.deepEqual(splitGraphemes('𠀀a'), ['𠀀', 'a']);
  assert.deepEqual(splitGraphemes(null), []);
});

test('revealSchedule 以固定間隔排程', () => {
  const { chars, delays, total } = revealSchedule('一二三', { startDelay: 0.2, perChar: 0.1, maxTotal: 4.5 });
  assert.equal(chars.length, 3);
  assert.deepEqual(delays, [0.2, 0.3, 0.4]);
  assert.equal(total, 1.0);
});

test('revealSchedule 長文字會被壓進 maxTotal', () => {
  const { delays } = revealSchedule('字'.repeat(200), { startDelay: 0.2, perChar: 0.06, maxTotal: 4.5 });
  assert.equal(delays.length, 200);
  assert.ok(delays[199] <= 4.5);
  assert.ok(delays.every((d, i) => i === 0 || d >= delays[i - 1]));
});

test('revealSchedule 空字串', () => {
  assert.deepEqual(revealSchedule(''), { chars: [], delays: [], total: 0 });
});

test('quipDelay 在經文浮現完之後再等 1.5 秒', () => {
  assert.equal(quipDelay(3), 4.5);
});

test('危機訊息不得有儀式', () => {
  assert.deepEqual(ceremonyFor('crisis'), { animate: false, bell: false, hush: true });
  assert.deepEqual(ceremonyFor('oracle'), { animate: true, bell: true, hush: false });
  assert.deepEqual(ceremonyFor(undefined), { animate: true, bell: true, hush: false });
});

test('roseWindowSVG 產生內外兩圈花瓣與金色環', () => {
  const svg = roseWindowSVG({ petals: 12, size: 400 });
  assert.match(svg, /^<svg [^>]*viewBox="0 0 400 400"/);
  assert.equal((svg.match(/<path /g) || []).length, 24);
  assert.ok((svg.match(/<circle /g) || []).length >= 3);
  assert.ok(svg.endsWith('</svg>'));
});
```

- [ ] **Step 2: 確認失敗**

Run: `node --test tests/sanctuary.test.js`
Expected: FAIL（找不到 `../assets/sanctuary.js`）

- [ ] **Step 3: 實作**

`assets/sanctuary.js`：

```js
/**
 * 聖殿的視覺：純函式（可在 node 下測試）加 DOM 控制器（Task 3 加入）。
 * 這個檔案的上半部不碰 DOM。
 */

/** 逐碼點拆字，讓罕用字（surrogate pair）不會被切成兩半。 */
export function splitGraphemes(text) {
  return Array.from(String(text ?? ''));
}

const round3 = (n) => Math.round(n * 1000) / 1000;

/** 經文逐字浮現的排程：每字一個延遲秒數，總長被壓在 maxTotal 以內。 */
export function revealSchedule(text, { startDelay = 0.2, perChar = 0.06, maxTotal = 4.5 } = {}) {
  const chars = splitGraphemes(text);
  if (chars.length === 0) return { chars, delays: [], total: 0 };
  const step = Math.min(perChar, (maxTotal - startDelay) / chars.length);
  const delays = chars.map((_, i) => round3(startDelay + i * step));
  return { chars, delays, total: round3(delays[delays.length - 1] + 0.6) };
}

/** 「屬靈解讀」晚一點才出現，補刀才有喜劇節奏。 */
export function quipDelay(total) {
  return round3(total + 1.5);
}

/** 危機訊息不能被包裝成神蹟：沒有動畫、沒有鐘聲，音樂降為近乎無聲。 */
export function ceremonyFor(kind) {
  if (kind === 'crisis') return { animate: false, bell: false, hush: true };
  return { animate: true, bell: true, hush: false };
}

const 玻璃色 = ['#7a1f2b', '#1f3a6b', '#c8a13a', '#2c6b4a', '#5b2a6b', '#a8432a'];

function polar(c, r, a) {
  return [c + r * Math.cos(a), c + r * Math.sin(a)];
}

/** 環形扇面：外弧順時針、內弧逆時針封閉。 */
function wedge(c, r0, r1, a0, a1) {
  const f = (n) => n.toFixed(2);
  const [x0, y0] = polar(c, r1, a0);
  const [x1, y1] = polar(c, r1, a1);
  const [x2, y2] = polar(c, r0, a1);
  const [x3, y3] = polar(c, r0, a0);
  return `M${f(x0)} ${f(y0)} A${f(r1)} ${f(r1)} 0 0 1 ${f(x1)} ${f(y1)} L${f(x2)} ${f(y2)} A${f(r0)} ${f(r0)} 0 0 0 ${f(x3)} ${f(y3)} Z`;
}

/** 玫瑰窗：外圈大花瓣、內圈小花瓣、三道金環與中心圓。純字串，方便測試。 */
export function roseWindowSVG({ petals = 12, size = 400 } = {}) {
  const c = size / 2;
  const step = (Math.PI * 2) / petals;
  const gap = step * 0.06;
  const paths = [];
  for (let i = 0; i < petals; i += 1) {
    const a0 = i * step + gap;
    const a1 = (i + 1) * step - gap;
    paths.push(`<path d="${wedge(c, c * 0.42, c * 0.92, a0, a1)}" fill="${玻璃色[i % 玻璃色.length]}"/>`);
    paths.push(`<path d="${wedge(c, c * 0.12, c * 0.38, a0, a1)}" fill="${玻璃色[(i + 3) % 玻璃色.length]}"/>`);
  }
  const ring = (r) => `<circle cx="${c}" cy="${c}" r="${(c * r).toFixed(2)}" fill="none" stroke="#d8b45a" stroke-width="2"/>`;
  const core = `<circle cx="${c}" cy="${c}" r="${(c * 0.1).toFixed(2)}" fill="#d8b45a"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" role="img" aria-label="玫瑰窗">${paths.join('')}${ring(0.95)}${ring(0.4)}${ring(0.12)}${core}</svg>`;
}
```

- [ ] **Step 4: 確認通過**

Run: `node --test tests/sanctuary.test.js && npm test`
Expected: sanctuary 7 項通過，整體測試無退步。

- [ ] **Step 5: Commit**

```bash
git add assets/sanctuary.js tests/sanctuary.test.js
git commit -m "feat: 聖殿視覺的純函式（逐字排程、儀式規則、玫瑰窗 SVG）

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: audio.js 配樂引擎

**Files:**
- Create: `assets/audio.js`、`tests/audio.test.js`

**Interfaces:**
- Produces（純函式）：
  - `midiToFreq(m) -> number`：`440 * 2 ** ((m - 69) / 12)`
  - `CHORDS`：`Array<{ name: string, bass: number, voices: number[] }>`（MIDI 音高）；`PROGRESSION: number[]`（索引，順序 Dm、Bb、F、C、Dm、Gm、Bb、C）
  - `chordAt(i) -> chord`：`CHORDS[PROGRESSION[i % PROGRESSION.length]]`
  - `createMuteStore(storage) -> { get(): boolean, set(muted: boolean): void }`：key 為 `'sanctuary-muted'`；`storage` 缺少或拋錯時 `get()` 回 `false`、`set()` 靜默忽略。
  - 常數（檔案最上方，可調）：`MASTER_LEVEL = 0.25`、`FADE_IN_SEC = 3`、`CHORD_SEC = 16`、`CROSSFADE_SEC = 4`、`REVERB_SEC = 5`、`HUSH_LEVEL = 0.03`、`BELL_LEVEL`。
- Produces（引擎）：`createAudio({ AudioContextCtor = globalThis.AudioContext || globalThis.webkitAudioContext, storage } = {}) -> { start(), stop(), setMuted(m), isMuted(), hush(on), bell(), available: boolean }`
  - 沒有 `AudioContextCtor` 時 `available === false`，所有方法為無作用且不丟錯。
  - `start()`（須在使用者手勢內呼叫）：建立／resume context；建立 master gain（由 0 在 `FADE_IN_SEC` 內升到 `MASTER_LEVEL`，若已靜音則維持 0）、convolver 殘響（程式生成指數衰減雜訊，`REVERB_SEC` 長）、低音 oscillator 組、合唱音墊（每個和弦聲部 3 個失諧鋸齒波，經 2 個 bandpass 母音共振峰濾波）、LFO 緩慢調變濾波頻率；以 `setTimeout`／context 時間每 `CHORD_SEC` 換和弦並以 `CROSSFADE_SEC` 淡入淡出。重複呼叫 `start()` 不重複建立。
  - `setMuted(m)`：master gain 在約 0.4 秒內淡到 0（或回到 `MASTER_LEVEL`），並寫入 `createMuteStore(storage)`；`isMuted()` 反映目前狀態（初始值讀自 store）。
  - `hush(on)`：`on` 時 master 淡到 `HUSH_LEVEL`（未靜音時）；`false` 時回到 `MASTER_LEVEL`。
  - `bell()`：靜音或 hush 時不發聲；否則以正弦加泛音（約 2.76×、5.4× 基頻）、指數衰減約 6 秒、經殘響送出一聲遠處鐘響。

- [ ] **Step 1: 寫失敗的測試**

`tests/audio.test.js` 至少包含下列測試（假的 AudioContext 只需記錄 `createOscillator`／`createGain`／`createConvolver`／`createBiquadFilter`／`createBuffer`／`resume` 的呼叫次數，並讓各節點的 `connect`、`start`、`stop`、`frequency.setValueAtTime`、`gain.linearRampToValueAtTime`、`gain.setTargetAtTime`、`gain.cancelScheduledValues`、`gain.value` 等為可呼叫的空實作或記錄器，`currentTime` 可由測試推進；若實作用到其他 API，請相應擴充假物件）：

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { midiToFreq, CHORDS, PROGRESSION, chordAt, createMuteStore, createAudio, MASTER_LEVEL } from '../assets/audio.js';

test('midiToFreq', () => {
  assert.equal(midiToFreq(69), 440);
  assert.ok(Math.abs(midiToFreq(57) - 220) < 1e-9);
});

test('和弦音高都在合理音域，且至少有四個聲部', () => {
  for (const chord of CHORDS) {
    assert.ok(chord.bass >= 28 && chord.bass <= 48);
    assert.ok(chord.voices.length >= 4);
    for (const v of chord.voices) assert.ok(v >= 50 && v <= 76);
  }
});

test('進行為 Dm Bb F C Dm Gm Bb C 並可循環', () => {
  const names = PROGRESSION.map((i) => CHORDS[i].name);
  assert.deepEqual(names, ['Dm', 'Bb', 'F', 'C', 'Dm', 'Gm', 'Bb', 'C']);
  assert.equal(chordAt(8), chordAt(0));
  assert.equal(chordAt(9), chordAt(1));
});

test('靜音儲存：正常、無 storage、storage 拋錯都不丟例外', () => {
  const data = new Map();
  const ok = createMuteStore({ getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) });
  assert.equal(ok.get(), false);
  ok.set(true);
  assert.equal(ok.get(), true);
  const none = createMuteStore(undefined);
  none.set(true);
  assert.equal(none.get(), false);
  const boom = createMuteStore({ getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); } });
  boom.set(true);
  assert.equal(boom.get(), false);
});

test('沒有 AudioContext 時回傳無作用物件', () => {
  const audio = createAudio({ AudioContextCtor: null, storage: undefined });
  assert.equal(audio.available, false);
  assert.doesNotThrow(() => { audio.start(); audio.setMuted(true); audio.hush(true); audio.bell(); audio.stop(); });
});

// 另外請用假 AudioContext 補測：
// 1. start() 只建立一次 context（呼叫兩次 start 不重複建立 oscillator 組）
// 2. start() 後 master gain 的目標值不超過 MASTER_LEVEL；初始已靜音（store 為 true）時不會升到 MASTER_LEVEL
// 3. setMuted(true) 後 isMuted() 為 true 且寫入 store；bell() 在靜音時不建立任何新的 oscillator
// 4. hush(true) 時 bell() 不發聲；hush(false) 後恢復
// 5. stop() 之後不會再排程換和弦（推進假計時器不再建立新節點）
```

- [ ] **Step 2: 確認失敗**

Run: `node --test tests/audio.test.js`
Expected: FAIL（找不到 `../assets/audio.js`）

- [ ] **Step 3: 實作 `assets/audio.js`**

依上方 Interfaces 實作。和弦資料（MIDI）：

```js
export const CHORDS = [
  { name: 'Dm', bass: 38, voices: [57, 62, 65, 69] },
  { name: 'Bb', bass: 34, voices: [58, 62, 65, 70] },
  { name: 'F',  bass: 41, voices: [57, 60, 65, 69] },
  { name: 'C',  bass: 36, voices: [55, 60, 64, 67] },
  { name: 'Gm', bass: 31, voices: [55, 58, 62, 67] },
];
export const PROGRESSION = [0, 1, 2, 3, 0, 4, 1, 3];
```

音色建議（可調，但必須集中在檔頭常數）：低音用 2 個 triangle／sine（基頻與八度）；合唱音墊每聲部 3 個 sawtooth 失諧 ±7 cents，經 bandpass（母音「啊」的共振峰約 800 Hz 與 1200 Hz，Q 約 5–8）再接 lowpass（約 2400 Hz）；LFO 0.07 Hz 輕微調變 lowpass 截止頻率與總音量（±8%）；殘響 wet 約 0.55、dry 約 0.45。換和弦時對每個聲部的 oscillator 頻率用 `setTargetAtTime`（時間常數約 `CROSSFADE_SEC / 3`）滑向下一個和弦，而不是硬切，避免爆音。

- [ ] **Step 4: 確認通過**

Run: `node --test tests/audio.test.js && npm test`
Expected: audio 測試全過，整體無退步，輸出無警告或雜訊。

- [ ] **Step 5: Commit**

```bash
git add assets/audio.js tests/audio.test.js
git commit -m "feat: Web Audio 即時合成的教堂配樂引擎

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: 主題、版面與 DOM 控制器

**Files:**
- Modify: `index.html`、`assets/style.css`、`assets/card.js`（只改色票）、`assets/sanctuary.js`（加入 DOM 控制器）

**Interfaces:**
- Consumes: Task 1 的 `revealSchedule`、`quipDelay`、`ceremonyFor`、`roseWindowSVG`
- Produces（`sanctuary.js` 新增匯出）：`createSanctuary({ root = document, reducedMotion } = {}) -> { mountWindow(), startDust(), stopDust(), openGate(), pulse(), setBusy(on), reveal({ verseEl, refEl, quipEl, text, kind }) -> { total }, calm() }`
  - `mountWindow()`：把 `roseWindowSVG()` 放進 `#rose-window`。
  - `startDust()`／`stopDust()`：在 `#dust` canvas 畫約 60 顆緩慢漂浮的金色粒子；`reducedMotion` 時不啟動；`document.hidden` 時暫停；視窗縮放時重設尺寸。
  - `openGate()`：給 `#gate` 加上開啟用的 class（黑幕向兩側打開、光束展開），動畫結束後把 `#gate` 設為 `hidden` 並移除主內容的 `inert`。
  - `pulse()`：玫瑰窗亮度一閃加光環擴散（加 class，動畫結束後移除）。
  - `setBusy(on)`：切換 `#notice` 的呼吸閃動 class。
  - `reveal({...})`：依 `ceremonyFor(kind)`；`animate` 為 false 或 `reducedMotion` 時直接設定文字、不加動畫 class；否則將經文拆成 `<span class="ch" style="--d: 秒數" aria-hidden="true">`，並在 `verseEl` 設 `aria-label` 為完整經文，出處與補刀分別以 CSS 變數 `--d` 延遲淡入（補刀用 `quipDelay(total)`）。回傳 `{ total }`。
  - `calm()`：移除所有儀式 class（`pulse`、`busy`、玫瑰窗亮度），並停止光環。

- [ ] **Step 1: index.html**

在 `<body>` 開頭加入（結構由實作者微調，但這些 id 必須存在）：`#gate`（含微光十字、`#enter-sound`「進入聖殿」按鈕、`#enter-silent`「靜默進入」按鈕）、`#rose-window`、`#beams`、`#dust`（canvas）、`#mute`（右上角靜音鍵，`aria-pressed`，預設 `hidden` 直到進入後）。把原本 `<main class="page">` 加上 `inert`（入口開啟後由 JS 移除）。既有 `#ask-form`、`#question`、`#notice`、`#answer`、`#asked-text`、`#verse-text`、`#verse-ref`、`#quip`、`#again`、`#save` 的 id 與語意不得改變。標題、副標、頁尾文字不變。

- [ ] **Step 2: style.css**

整份改寫：色票用 CSS 變數（背景 `#0b0907`、金 `#d8b45a`、次要 `#a8957a`）；`body` 深色背景加暗角（`radial-gradient`）；玫瑰窗置頂、緩慢旋轉（`animation: spin 120s linear infinite`）加金色 `filter: drop-shadow` 光暈；`#beams` 以數道斜向 `linear-gradient` 加緩慢明暗起伏；`#dust` 固定全螢幕、`pointer-events: none`；標題金色 `text-shadow` 光暈；輸入框金邊發光（focus 時更亮）；按鈕金邊、hover 加亮；`.ch` 逐字浮現（opacity 與輕微 blur、`animation-delay: var(--d)`）；`.reveal-late`（出處與補刀）以 `--d` 延遲淡入；`.pulse` 光環擴散與亮度一閃；`.busy` 呼吸閃動；`#gate` 全黑、置中十字微光、`.open` 時兩側黑幕滑開；`@media (prefers-reduced-motion: reduce)` 關閉旋轉、粒子之外的所有 `animation`，元素直接顯示；行動裝置（寬度 < 600px）縮小玫瑰窗並確保無橫向捲動。保留 `.visually-hidden`。

- [ ] **Step 3: DOM 控制器**

在 `assets/sanctuary.js` 檔尾實作 `createSanctuary`（匯出）。控制器須以注入的 `root` 查詢元素（便於未來測試），並對缺少的元素容錯（找不到就略過該功能，不丟錯）。

- [ ] **Step 4: card.js 色票**

只改頂端常數：`紙色` → `'#0b0907'`、`墨色` → `'#e9dfc7'`（經文字色，在暗底上要清晰）、`金色` → `'#d8b45a'`、`淡色` → `'#a8957a'`；其餘排版邏輯不動。若卡片上有依紙色畫的邊框或分隔線，確認在暗底上仍清楚可見。

- [ ] **Step 5: 截圖驗證（無頭 Chrome）**

在背景啟動靜態伺服器：`python3 -m http.server 8765`（於 `bible-oracle/`）。以 Chrome 截三張圖並 Read 檢視：

```bash
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
"$CHROME" --headless=new --disable-gpu --hide-scrollbars --window-size=1280,900 --virtual-time-budget=3000 --screenshot=/tmp/gate.png "http://localhost:8765/"
```

注意：入口畫面需要使用者點擊才會開啟；為了截主畫面，**Task 4 完成後**才能完整截圖。本 task 只需確認：入口畫面截圖版面正確（黑底、十字、兩個按鈕）、`node --test` 與 `npm test` 通過，以及 `--dump-dom` 輸出中沒有 JS 錯誤（可加 `--enable-logging=stderr --v=0` 觀察 console）。將截圖路徑與你對畫面的觀察寫在報告中。

- [ ] **Step 6: Commit**

```bash
git add index.html assets/style.css assets/sanctuary.js assets/card.js
git commit -m "feat: 哥德式大教堂主題、玫瑰窗、光束與 DOM 控制器

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: app.js 接線與整體驗證

**Files:**
- Modify: `assets/app.js`、`README.md`（加一小節）

**Interfaces:**
- Consumes: `createSanctuary`、`createAudio`、`ceremonyFor`、既有的 `isCrisis`／`CARE_MESSAGE`（來自 `match.js`）、既有的 `ask`、`render`、`showNotice`、`fetchOracle` 流程
- Produces: 行為（見下）

- [ ] **Step 1: 接線**

在 `app.js`：建立 `sanctuary = createSanctuary({ reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches })` 與 `audio = createAudio({ storage: window.localStorage })`（localStorage 存取以 try/catch 包起來）。載入時 `sanctuary.mountWindow()`、`sanctuary.startDust()`。

入口：`#enter-sound` 點擊 → `audio.start()`（須在此事件處理器內同步呼叫）、`sanctuary.openGate()`、顯示 `#mute`；`#enter-silent` 點擊 → `audio.setMuted(true)` 之外**不**呼叫 `start()`，同樣 `openGate()`；若使用者先前已靜音（`audio.isMuted()`），「進入聖殿」仍會 `start()` 但保持無聲。`#mute` 點擊切換 `audio.setMuted()` 並更新 `aria-pressed` 與圖示文字。

若網址帶 `?q=`（分享連結），入口仍要顯示；進入之後才自動作答。

問問題（沿用現有 `ask` 結構，只加掛勾）：開始時 `sanctuary.pulse()`、`sanctuary.setBusy(true)`；
- 結果為危機（API `crisis`，或前端 `isCrisis` 命中）：`sanctuary.calm()`、`audio.hush(true)`、只 `showNotice(...)`，**不呼叫** `reveal`、不響鐘；之後下一個非危機問題開始時 `audio.hush(false)`。
- 一般結果：`sanctuary.setBusy(false)`、`render` 後改由 `sanctuary.reveal({ verseEl, refEl, quipEl, text, kind })` 顯示，並在揭曉時 `audio.bell()`。
`render()` 內的文字設定要改成交給 `reveal`（保持 `#asked-text`、`#again` 顯示邏輯不變）。「存成圖片」與「再求一次」行為不變。

- [ ] **Step 2: 測試與回歸**

Run: `npm test && .venv/bin/pytest -q`
Expected: 全過（Node 測試 ≥ 47 + 新增的 sanctuary 與 audio 測試；Python 220）。

- [ ] **Step 3: 四種狀態截圖（無頭 Chrome）**

啟動靜態伺服器（靜態模式即可）。因為入口需要點擊，截圖時用一個一次性的 Chrome 啟動參數頁或以 `--dump-dom` 不可行時，改以**暫時的測試頁**驗證：在 scratchpad（不在 repo 內）建立一個 HTML 檔，載入 `http://localhost:8765/` 的同源資源不可行時，改用 Chrome 的 `--remote-debugging-port` 搭配簡短的 node 腳本（使用 Node 內建 `fetch`／`WebSocket`，不安裝套件）點擊 `#enter-silent`、填入問題、送出，再呼叫 `Page.captureScreenshot`。若上述太繁瑣，可在 `?q=` 流程中提供一個僅供截圖的 URL 參數 `?nogate=1`（只跳過入口黑幕，不啟動音樂），但**必須**在報告中說明並確保預設行為不受影響。依序截並 Read 檢視：(1) 入口、(2) 進入後的主畫面（玫瑰窗與光束）、(3) 問「我老婆一直碎念」揭曉完成後、(4) 問「我不想活了」的靜態關懷畫面（應無玫瑰窗亮度閃動、無逐字浮現）。每張圖寫下你看到的版面問題並修正；確認 console 無錯誤。

- [ ] **Step 4: README 一小節**

在 `README.md` 加「聖殿 UI」小節（5–8 行）：風格、配樂為即時合成、入口與靜默模式、靜音鍵、`prefers-reduced-motion`、危機訊息不播儀式，以及「聲音與動畫的主觀品質未經自動驗證」。

- [ ] **Step 5: Commit**

```bash
git add assets/app.js README.md
git commit -m "feat: 入口儀式、問答動畫與配樂接線，危機訊息不播儀式

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```
