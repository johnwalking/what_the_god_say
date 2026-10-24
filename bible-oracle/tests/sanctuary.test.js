import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitGraphemes, revealSchedule, quipDelay, ceremonyFor, worshipLayout, worshipperSVG, congregationHTML, worshipState, createSanctuary } from '../assets/sanctuary.js';

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

// ---- 教徒 ----
test('worshipLayout 確定性、數量、兩排、範圍與間距', () => {
  const a = worshipLayout();
  assert.equal(a.length, 11);
  assert.deepEqual(a, worshipLayout({ count: 11, seed: 7 }));
  assert.notDeepEqual(a, worshipLayout({ seed: 8 }));
  assert.ok(a.some((w) => w.row === 0) && a.some((w) => w.row === 1));
  for (const w of a) {
    assert.ok(w.x >= 0 && w.x <= 100, `x=${w.x}`);
    assert.ok(w.scale >= 0.8 && w.scale <= 1.15, `scale=${w.scale}`);
    assert.ok(w.delay >= 0 && w.delay <= 6, `delay=${w.delay}`);
    assert.ok(w.row === 0 || w.row === 1);
    assert.equal(typeof w.flip, 'boolean');
  }
  const xs = a.map((w) => w.x).sort((p, q) => p - q);
  for (let i = 1; i < xs.length; i += 1) assert.ok(xs[i] - xs[i - 1] >= 4, `gap ${xs[i - 1]}→${xs[i]}`);
});

test('worshipLayout 其他數量與 seed 仍符合約束', () => {
  for (const count of [1, 6, 14]) {
    for (const seed of [1, 7, 99, 12345]) {
      const l = worshipLayout({ count, seed });
      assert.equal(l.length, count);
      const xs = l.map((w) => w.x).sort((p, q) => p - q);
      for (let i = 1; i < xs.length; i += 1) assert.ok(xs[i] - xs[i - 1] >= 4);
    }
  }
});

test('worshipperSVG 含四組可選取的 g 與 currentColor', () => {
  const svg = worshipperSVG();
  assert.match(svg, /^<svg /);
  for (const c of ['w-head', 'w-torso', 'w-arms-down', 'w-arms-up']) {
    assert.equal((svg.match(new RegExp(`<g class="${c}"`, 'g')) || []).length, 1, c);
  }
  assert.match(svg, /currentColor/);
  assert.ok(svg.endsWith('</svg>'));
});

test('congregationHTML 元素數量等於 layout 長度，flip 加 class', () => {
  const layout = [
    { x: 10, scale: 1, row: 0, delay: 1.5, flip: false },
    { x: 50, scale: 0.9, row: 1, delay: 0, flip: true },
  ];
  const html = congregationHTML(layout);
  assert.equal((html.match(/<div class="worshipper/g) || []).length, 2);
  assert.equal((html.match(/class="worshipper flip"/g) || []).length, 1);
  assert.match(html, /--x:10%;--s:1;--d:1.5s/);
  assert.match(html, /data-row="1"/);
  assert.equal(congregationHTML([]), '');
});

test('worshipState 對應事件', () => {
  assert.equal(worshipState('load'), 'idle');
  assert.equal(worshipState('ask'), 'bow');
  assert.equal(worshipState('reveal'), 'raise');
  assert.equal(worshipState('crisis'), 'still');
  assert.equal(worshipState('reset'), 'idle');
  assert.equal(worshipState('???'), 'idle');
  assert.equal(worshipState(undefined), 'idle');
});

// ---- 控制器（最小 DOM 替身）----
function fakeEl(id) {
  const classes = new Set();
  const attrs = new Map();
  return {
    id, innerHTML: '', textContent: '',
    classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c), toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)) },
    setAttribute: (k, v) => attrs.set(k, v),
    getAttribute: (k) => attrs.get(k) ?? null,
    dataset: {},
  };
}
function fakeRoot() {
  const els = Object.fromEntries(['congregation', 'beams', 'notice'].map((i) => [i, fakeEl(i)]));
  const root = { nodeType: 9, getElementById: (id) => els[id] ?? null, querySelector: () => null, querySelectorAll: () => [] };
  return { root, els };
}

test('mountCongregation 與 setWorship 設定狀態；calm 設為 still', () => {
  const { root, els } = fakeRoot();
  const s = createSanctuary({ root, reducedMotion: true });
  s.mountCongregation();
  assert.equal((els.congregation.innerHTML.match(/<div class="worshipper/g) || []).length, 11);
  s.setWorship('ask');
  assert.equal(els.congregation.getAttribute('data-state'), 'bow');
  s.setWorship('reveal');
  assert.equal(els.congregation.getAttribute('data-state'), 'raise');
  s.setWorship('crisis');
  assert.equal(els.congregation.getAttribute('data-state'), 'still');
  s.setWorship('reset');
  assert.equal(els.congregation.getAttribute('data-state'), 'idle');
  s.calm();
  assert.equal(els.congregation.getAttribute('data-state'), 'still');
});

test('缺少元素時控制器不丟錯', () => {
  const root = { nodeType: 9, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] };
  const s = createSanctuary({ root, reducedMotion: true });
  s.mountCongregation(); s.setWorship('ask'); s.pulse(); s.calm(); s.setBusy(true);
});
