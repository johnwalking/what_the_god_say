import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitGraphemes, revealSchedule, quipDelay, ceremonyFor, worshipState, discipleRings, projectDisciple, clampPitch, clampZoom, sceneSpeed, createSanctuary } from '../assets/sanctuary.js';

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

// ---- 十二門徒 ----
test('discipleRings 確定性、數量、三層、半徑遞增、方向交替、phase 範圍', () => {
  const a = discipleRings();
  assert.equal(a.length, 12);
  assert.deepEqual(a, discipleRings(12));
  assert.equal(discipleRings(7).length, 7);
  const byRing = [0, 1, 2].map((r) => a.filter((d) => d.ring === r));
  for (const g of byRing) assert.ok(g.length >= 3, `ring size ${g.length}`);
  assert.equal(byRing.reduce((n, g) => n + g.length, 0), 12);
  assert.ok(byRing[0][0].radius < byRing[1][0].radius && byRing[1][0].radius < byRing[2][0].radius);
  assert.ok(byRing[0][0].dir !== byRing[1][0].dir && byRing[1][0].dir !== byRing[2][0].dir);
  assert.ok(byRing[0][0].speed > byRing[2][0].speed);
  for (const d of a) {
    assert.ok(d.phase >= 0 && d.phase < Math.PI * 2, `phase=${d.phase}`);
    assert.ok(d.radius > 0 && d.radius <= 1);
    assert.ok(d.dir === 1 || d.dir === -1);
  }
  for (const g of byRing) for (const d of g) assert.equal(d.radius, g[0].radius);
});

const view = { t: 0, yaw: 0, pitch: 0.6, zoom: 1, width: 1000, height: 800 };
const disc = { ring: 1, index: 0, phase: 0, radius: 0.62, dir: 1, speed: 1 };

test('projectDisciple 近處比遠處大且亮，depth 在 0..1', () => {
  const near = projectDisciple({ ...disc, phase: Math.PI / 2 }, view); // sin>0 → z>0
  const far = projectDisciple({ ...disc, phase: -Math.PI / 2 }, view);
  assert.ok(near.z > 0 && far.z < 0);
  assert.ok(near.scale > far.scale);
  assert.ok(near.alpha > far.alpha);
  for (const p of [near, far]) assert.ok(p.depth >= 0 && p.depth <= 1);
  assert.ok(near.depth > far.depth);
});

test('projectDisciple yaw 加 2π 結果相同；時間依 dir*speed*baseSpeed 前進', () => {
  const a = projectDisciple(disc, view);
  const b = projectDisciple(disc, { ...view, yaw: Math.PI * 2 });
  assert.ok(Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6 && Math.abs(a.scale - b.scale) < 1e-9);
  const c = projectDisciple(disc, { ...view, t: 10, baseSpeed: 0.1 });
  const d = projectDisciple({ ...disc, phase: 1 }, view); // θ = 0 + 1*1*0.1*10 = 1
  assert.ok(Math.abs(c.x - d.x) < 1e-6 && Math.abs(c.y - d.y) < 1e-6);
});

test('projectDisciple zoom 放大半徑、pitch 增大使 y 展開增大、cx/cy 為中心', () => {
  const d = { ...disc, phase: Math.PI / 3 };
  const lo = projectDisciple(d, view);
  const hi = projectDisciple(d, { ...view, zoom: 1.5 });
  assert.ok(Math.abs(hi.x - 500) > Math.abs(lo.x - 500));
  const flat = projectDisciple(d, { ...view, pitch: 0.2 });
  const tall = projectDisciple(d, { ...view, pitch: 0.9 });
  assert.ok(Math.abs(tall.y - 400) > Math.abs(flat.y - 400));
  const moved = projectDisciple(d, { ...view, cy: 0.46 });
  assert.ok(Math.abs(moved.y - lo.y + 800 * 0.04) < 1e-6);
});

test('clampPitch / clampZoom / sceneSpeed', () => {
  assert.equal(clampPitch(-1), 0.15);
  assert.equal(clampPitch(5), 1.0);
  assert.equal(clampPitch(0.5), 0.5);
  assert.equal(clampZoom(0), 0.6);
  assert.equal(clampZoom(9), 1.8);
  assert.equal(clampZoom(1.2), 1.2);
  assert.deepEqual(['idle', 'bow', 'raise', 'still', '??'].map(sceneSpeed), [1, 0.25, 1.8, 0, 1]);
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
  const els = Object.fromEntries(['scene', 'beams', 'notice'].map((i) => [i, fakeEl(i)]));
  const root = { nodeType: 9, getElementById: (id) => els[id] ?? null, querySelector: () => null, querySelectorAll: () => [] };
  return { root, els };
}

test('setWorship 設定 beams 與 scene 的 data-state；calm 設為 still', () => {
  const { root, els } = fakeRoot();
  const s = createSanctuary({ root, reducedMotion: true });
  s.setWorship('ask');
  assert.equal(els.scene.getAttribute('data-state'), 'bow');
  assert.equal(els.beams.getAttribute('data-state'), 'bow');
  s.setWorship('reveal');
  assert.equal(els.scene.getAttribute('data-state'), 'raise');
  s.setWorship('crisis');
  assert.equal(els.scene.getAttribute('data-state'), 'still');
  s.setWorship('reset');
  assert.equal(els.scene.getAttribute('data-state'), 'idle');
  s.calm();
  assert.equal(els.scene.getAttribute('data-state'), 'still');
});

test('缺少元素時控制器不丟錯', () => {
  const root = { nodeType: 9, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] };
  const s = createSanctuary({ root, reducedMotion: true });
  s.mountScene(); s.getCrossRect(); s.setWorship('ask'); s.pulse(); s.calm(); s.setBusy(true);
});
