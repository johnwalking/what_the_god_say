import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitGraphemes, revealSchedule, quipDelay, ceremonyFor, roseWindowSVG, createSanctuary } from '../assets/sanctuary.js';

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

test('revealSchedule 200 字時 total 不超過 maxTotal（4.5）', () => {
  const { total } = revealSchedule('字'.repeat(200));
  assert.ok(total <= 4.5, `total=${total}`);
});

test('revealSchedule maxTotal 過小時延遲仍嚴格遞增且有限', () => {
  const { delays } = revealSchedule('字'.repeat(50), { maxTotal: 0.1 });
  for (let i = 0; i < delays.length; i++) {
    assert.ok(Number.isFinite(delays[i]));
    if (i > 0) assert.ok(delays[i] > delays[i - 1]);
  }
});

// ---- openGate：onOpen 與焦點（以最小的 DOM 替身驗證）----
function fakeEl(id, extra = {}) {
  const attrs = new Map();
  const classes = new Set();
  return {
    id, hidden: false, textContent: '', focused: false, ...extra,
    classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c), toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)) },
    setAttribute: (k, v) => attrs.set(k, v),
    removeAttribute(k) { attrs.delete(k); },
    hasAttribute: (k) => attrs.has(k),
    focus() { this.focused = true; },
  };
}
function fakeRoot() {
  const els = Object.fromEntries(['gate', 'mute', 'question', 'notice'].map((i) => [i, fakeEl(i)]));
  const main = fakeEl('main');
  const body = fakeEl('body');
  const root = {
    nodeType: 9, body, defaultView: globalThis,
    getElementById: (id) => els[id] ?? null,
    querySelector: (sel) => (sel === 'main.page' ? main : null),
    querySelectorAll: () => [],
  };
  return { root, els, main };
}

test('openGate：onOpen 在 inert 移除之後呼叫，可見的關懷訊息取得焦點', async () => {
  const { root, els, main } = fakeRoot();
  const s = createSanctuary({ root, reducedMotion: true });
  assert.ok(main.hasAttribute('inert'));
  let inertAtCall = null;
  els.notice.hidden = true;
  s.openGate(() => {
    inertAtCall = main.hasAttribute('inert');
    els.notice.textContent = '關懷';
    els.notice.hidden = false;
  });
  await new Promise((r) => setTimeout(r, 1100));
  assert.equal(inertAtCall, false);
  assert.equal(els.notice.focused, true);
  assert.equal(els.question.focused, false);
  assert.equal(els.notice.textContent, '關懷');
});

test('openGate：沒有可見訊息或訊息在忙時焦點給輸入框', async () => {
  const { root, els } = fakeRoot();
  const s = createSanctuary({ root, reducedMotion: true });
  els.notice.hidden = false;
  els.notice.classList.add('busy');
  s.openGate();
  await new Promise((r) => setTimeout(r, 1100));
  assert.equal(els.question.focused, true);
  assert.equal(els.notice.focused, false);
});
