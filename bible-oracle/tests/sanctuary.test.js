import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitGraphemes, revealSchedule, quipDelay, charJitter, ceremonyFor, worshipState, discipleRings, projectDisciple, clampPitch, clampZoom, sceneSpeed, createSanctuary } from '../assets/sanctuary.js';

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

test('charJitter 確定性且落在 [0, 1)，相鄰值不同', () => {
  const xs = Array.from({ length: 300 }, (_, i) => charJitter(i));
  assert.deepEqual(xs, Array.from({ length: 300 }, (_, i) => charJitter(i)));
  for (const x of xs) assert.ok(x >= 0 && x < 1, `x=${x}`);
  assert.ok(new Set(xs.map((x) => x.toFixed(3))).size > 250);
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  assert.ok(mean > 0.35 && mean < 0.65, `mean=${mean}`);
});

test('revealSchedule 的 fade 參數計入 total；jitter 讓延遲成波但不早於 startDelay', () => {
  const plain = revealSchedule('一二三', { startDelay: 0.2, perChar: 0.1, maxTotal: 9, fade: 2 });
  assert.deepEqual(plain.delays, [0.2, 0.3, 0.4]);
  assert.equal(plain.total, 2.4);
  const wave = revealSchedule('字'.repeat(60), { startDelay: 0.6, perChar: 0.11, maxTotal: 8, fade: 2, jitter: 0.45 });
  assert.ok(wave.delays.every((d) => d >= 0.6));
  assert.ok(wave.delays.some((d, i) => i > 0 && d < wave.delays[i - 1]), '應該有些字比前一個字早一點浮現');
  assert.equal(wave.total, Math.round((Math.max(...wave.delays) + 2) * 1000) / 1000);
  assert.ok(wave.total <= 8, `total=${wave.total}`);
  assert.deepEqual(wave, revealSchedule('字'.repeat(60), { startDelay: 0.6, perChar: 0.11, maxTotal: 8, fade: 2, jitter: 0.45 }));
});

test('revealSchedule 長經文加 jitter 仍壓在 maxTotal 內', () => {
  for (const n of [1, 10, 45, 120, 400]) {
    const { total } = revealSchedule('字'.repeat(n), { startDelay: 0.6, perChar: 0.11, maxTotal: 8, fade: 2, jitter: 0.45 });
    assert.ok(total <= 8, `n=${n} total=${total}`);
  }
});

test('quipDelay 可指定停頓秒數', () => {
  assert.equal(quipDelay(6, 2), 8);
});

// ---- reveal（最小 DOM 替身）----
function fakeNode(tag = 'span') {
  const classes = new Set();
  const props = new Map();
  const attrs = new Map();
  const node = {
    tagName: tag.toUpperCase(), children: [], className: '', offsetWidth: 0,
    get textContent() { return node._text ?? node.children.map((c) => c.textContent).join(''); },
    set textContent(v) { node._text = String(v); node.children = []; },
    classList: { add: (...c) => c.forEach((x) => classes.add(x)), remove: (...c) => c.forEach((x) => classes.delete(x)), contains: (c) => classes.has(c), toggle() {} },
    style: { setProperty: (k, v) => props.set(k, v), getPropertyValue: (k) => props.get(k) ?? '' },
    setAttribute: (k, v) => attrs.set(k, v),
    getAttribute: (k) => attrs.get(k) ?? null,
    appendChild(child) {
      node._text = undefined;
      if (child.isFragment) node.children.push(...child.children); else node.children.push(child);
      return child;
    },
  };
  return node;
}
function revealRig(reducedMotion = false) {
  const d = {
    createDocumentFragment: () => Object.assign(fakeNode('#fragment'), { isFragment: true }),
    createElement: (t) => fakeNode(t),
  };
  const verseEl = Object.assign(fakeNode('blockquote'), { ownerDocument: d });
  const refEl = fakeNode('cite');
  const quipEl = fakeNode('p');
  const root = { nodeType: 9, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] };
  const s = createSanctuary({ root, reducedMotion });
  return { s, verseEl, refEl, quipEl };
}

test('reveal：逐字 span 帶延遲與時長、aria-hidden，並保留完整文字給螢幕閱讀器；出處與解讀依序延後', () => {
  const { s, verseEl, refEl, quipEl } = revealRig();
  const text = '你們作妻子的、當順服自己的丈夫、如同順服主．';
  const { total } = s.reveal({ verseEl, refEl, quipEl, text, kind: 'oracle' });
  const [full, ...chars] = verseEl.children;
  assert.equal(full.className, 'visually-hidden');
  assert.equal(full.textContent, text);
  assert.equal(chars.length, [...text].length);
  for (const c of chars) {
    assert.equal(c.className, 'ch');
    assert.equal(c.getAttribute('aria-hidden'), 'true');
    const dur = parseFloat(c.style.getPropertyValue('--dur'));
    assert.ok(dur >= 1.4 && dur <= 2.0, `dur=${dur}`);
    assert.ok(parseFloat(c.style.getPropertyValue('--d')) + dur <= total + 1e-9);
  }
  assert.ok(total > 3 && total <= 8, `total=${total}`);
  assert.ok(verseEl.classList.contains('inscribing'));
  assert.equal(parseFloat(refEl.style.getPropertyValue('--d')), total);
  assert.ok(parseFloat(quipEl.style.getPropertyValue('--d')) - total >= 1.9);
  assert.ok(refEl.classList.contains('reveal-late') && quipEl.classList.contains('reveal-late'));
});

test('reveal 重來時清掉上一次的字，不留殘餘', () => {
  const { s, verseEl, refEl, quipEl } = revealRig();
  s.reveal({ verseEl, refEl, quipEl, text: '甲乙丙丁戊', kind: 'oracle' });
  s.reveal({ verseEl, refEl, quipEl, text: '天地', kind: 'oracle' });
  assert.equal(verseEl.children.length, 1 + 2);
  assert.equal(verseEl.children[0].textContent, '天地');
});

test('reveal：危機訊息與 reducedMotion 都是純文字，沒有任何動畫 class', () => {
  for (const [reduced, kind] of [[false, 'crisis'], [true, 'oracle']]) {
    const { s, verseEl, refEl, quipEl } = revealRig(reduced);
    s.reveal({ verseEl, refEl, quipEl, text: '甲乙丙', kind });
    assert.equal(verseEl.children.length, 0);
    assert.equal(verseEl.textContent, '甲乙丙');
    assert.ok(!verseEl.classList.contains('inscribing'));
    assert.ok(!refEl.classList.contains('reveal-late') && !quipEl.classList.contains('reveal-late'));
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

// ---- WebGL 曼陀羅後端（注入假的 createMandala）----
function fakeWin() {
  const w = { raf: 0, listeners: new Map(), innerWidth: 390, innerHeight: 800, devicePixelRatio: 1 };
  w.requestAnimationFrame = () => { w.raf += 1; return w.raf; };
  w.cancelAnimationFrame = () => {};
  w.addEventListener = (t, fn) => w.listeners.set(t, fn);
  w.removeEventListener = (t) => w.listeners.delete(t);
  return w;
}
function mandalaRig({ result = 'ok', reducedMotion = false } = {}) {
  const calls = [];
  const win = fakeWin();
  const mk = (id) => ({ ...fakeEl(id), addEventListener() {}, removeEventListener() {}, style: { setProperty() {} } });
  const canvas = { ...mk('scene'), getContext: (k) => { calls.push(`ctx:${k}`); return k === '2d' ? { setTransform() {}, clearRect() {} } : null; } };
  const els = { scene: canvas, cross: mk('cross'), beams: fakeEl('beams'), notice: fakeEl('notice') };
  const root = { nodeType: 9, defaultView: win, getElementById: (id) => els[id] ?? null, querySelector: () => null, querySelectorAll: () => [] };
  let opts = null;
  const m = {
    setState: (s) => calls.push(`state:${s}`), pulse: () => calls.push('pulse'), setPaused() {}, isPaused: () => false,
    orbitInput() {}, zoomBy() {}, setHeld() {}, resize() {}, destroy: () => calls.push('destroy'), getDebug: () => ({ frames: 1 }),
  };
  const createMandalaFn = (c, o) => { opts = o; calls.push('create'); return result === 'ok' ? m : null; };
  const s = createSanctuary({ root, reducedMotion, createMandalaFn });
  return { s, calls, win, els, getOpts: () => opts };
}

test('WebGL 成功時使用 webgl 後端、不啟動 2D 迴圈，並轉送姿勢狀態', () => {
  const { s, calls, win } = mandalaRig();
  assert.equal(s.getSceneBackend(), null);
  s.mountScene();
  assert.equal(s.getSceneBackend(), 'webgl');
  assert.equal(win.raf, 0);
  assert.ok(!calls.includes('ctx:2d'));
  s.setWorship('ask');
  s.setWorship('reveal');
  s.setWorship('reset');
  s.calm();
  assert.deepEqual(calls.filter((c) => c.startsWith('state:')), ['state:idle', 'state:bow', 'state:raise', 'state:idle', 'state:still']);
  s.unmountScene();
  assert.ok(calls.includes('destroy'));
  assert.equal(s.getSceneBackend(), null);
});

test('createMandala 回 null 時退回 2D 後備', () => {
  const { s, calls, win } = mandalaRig({ result: 'null' });
  s.mountScene();
  assert.equal(s.getSceneBackend(), 'canvas2d');
  assert.ok(calls.includes('ctx:2d'));
  assert.equal(win.raf, 1);
  s.unmountScene();
});

test('執行期 onFail 也退回 2D 並銷毀 mandala', () => {
  const { s, calls, getOpts } = mandalaRig();
  s.mountScene();
  const warn = console.warn;
  const warned = [];
  console.warn = (...a) => warned.push(a.join(' '));
  try { getOpts().onFail('webgl context lost'); } finally { console.warn = warn; }
  assert.equal(warned.length, 1);
  assert.equal(s.getSceneBackend(), 'canvas2d');
  assert.ok(calls.includes('destroy'));
  s.unmountScene();
});

test('pulse：webgl 轉送；reducedMotion 時不呼叫 mandala', () => {
  const a = mandalaRig();
  a.s.mountScene(); a.s.pulse();
  assert.ok(a.calls.includes('pulse'));
  const b = mandalaRig({ reducedMotion: true });
  b.s.mountScene(); b.s.pulse();
  assert.ok(!b.calls.includes('pulse'));
  assert.equal(b.getOpts().reducedMotion, true);
});

test('晚於 mountScene 的 setWorship 之前已設的狀態會在掛載時帶入', () => {
  const { s, calls } = mandalaRig();
  s.setWorship('crisis');
  s.mountScene();
  assert.deepEqual(calls.filter((c) => c.startsWith('state:')), ['state:still']);
});
