import test from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32 } from '../assets/mandala-math.js';
import {
  Builder, PART, SHOULDER, HIP, NECK, DECOR_KINDS, spline,
  buildDisciple, buildCross, buildDecor, planRings, buildRingGeometry,
} from '../assets/mandala-shapes.js';

const range = (arr, axis) => {
  let lo = Infinity, hi = -Infinity;
  for (let i = axis; i < arr.length; i += 3) { lo = Math.min(lo, arr[i]); hi = Math.max(hi, arr[i]); }
  return [lo, hi];
};

test('Builder.box 產生 36 個頂點，法線為軸向單位向量', () => {
  const b = new Builder();
  b.box(0, 0, 0, 1, 2, 3, PART.ARM);
  assert.equal(b.count, 36);
  assert.equal(b.parts.length, 36);
  assert.equal(b.normals.length, 108);
  for (let i = 0; i < 36; i++) {
    const n = b.normals.slice(i * 3, i * 3 + 3);
    assert.ok(Math.abs(Math.hypot(...n) - 1) < 1e-9);
    assert.equal(n.filter(v => Math.abs(v) === 1).length, 1);
    assert.equal(b.parts[i], PART.ARM);
  }
});

test('Builder 位移與縮放狀態、toArrays 型別', () => {
  const b = new Builder();
  b.o = [10, 0, 0]; b.s = 2;
  b.box(0, 0, 0, 1, 1, 1);
  const [lo, hi] = range(b.positions, 0);
  assert.ok(Math.abs(lo - 9) < 1e-9 && Math.abs(hi - 11) < 1e-9);
  const a = b.toArrays();
  assert.ok(a.positions instanceof Float32Array && a.normals instanceof Float32Array && a.parts instanceof Float32Array);
  assert.equal(a.positions.length, 108);
  assert.equal(a.parts.length, 36);
});

test('三角形繞向與法線一致（由外向內看為逆時針）', () => {
  const b = new Builder();
  b.box(0, 0, 0, 1, 1, 1);
  for (let t = 0; t < 12; t++) {
    const p = i => b.positions.slice((t * 3 + i) * 3, (t * 3 + i) * 3 + 3);
    const [a, c, d] = [p(0), p(1), p(2)];
    const u = c.map((v, k) => v - a[k]), v = d.map((x, k) => x - a[k]);
    const cr = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const n = b.normals.slice(t * 9, t * 9 + 3);
    assert.ok(cr[0] * n[0] + cr[1] * n[1] + cr[2] * n[2] > 0);
  }
});

test('buildDisciple：部位、範圍、兜帽凸出、變體', () => {
  const g = buildDisciple();
  assert.ok(g.count > 0);
  const parts = new Set(g.parts);
  assert.ok(parts.has(PART.HEAD) && parts.has(PART.ARM) && parts.has(PART.BODY));
  assert.ok(g.positions.every(Number.isFinite));
  const [y0, y1] = range(g.positions, 1);
  assert.ok(y0 > -0.05 && y0 < 0.1, `y0=${y0}`);
  assert.ok(y1 > 3.8 && y1 < 4.6, `y1=${y1}`);
  const [x0, x1] = range(g.positions, 0);
  assert.ok(x0 < -0.2 && x1 > 0.2);
  assert.notDeepEqual(buildDisciple({ variant: 0 }).positions, buildDisciple({ variant: 2 }).positions);
  assert.equal(SHOULDER.length, 3);
  assert.equal(HIP.length, 3);
  assert.ok(SHOULDER[1] > HIP[1]);
});

test('門徒：袍腳比肩寬、雙袖、臉與手、腰繩', () => {
  const g = buildDisciple();
  const zw = part => { const pos = []; for (let i = 0; i < g.count; i++) if (g.parts[i] === part) pos.push(g.positions[i * 3 + 2]); return Math.max(...pos) - Math.min(...pos); };
  assert.ok(zw(PART.ARM) > 0.8);
  // 袍腳（y<0.5 的頂點）z 寬大於頸肩（y 在 3.0~3.3）
  const wAt = (a, b) => { const z = []; for (let i = 0; i < g.count; i++) { const y = g.positions[i * 3 + 1]; if (g.parts[i] === PART.BODY && y >= a && y <= b) z.push(g.positions[i * 3 + 2]); } return Math.max(...z) - Math.min(...z); };
  assert.ok(wAt(0, 0.5) > wAt(3.0, 3.3) * 1.2);
  const parts = new Set(g.parts);
  assert.ok(parts.has(PART.SKIN) && parts.has(PART.ROPE));
  assert.ok(!parts.has(PART.EMISSIVE));
  assert.equal(NECK.length, 3);
  assert.ok(NECK[1] > SHOULDER[1]);
});

test('Builder.surface：單位法線、繞向與法線一致、略過極點的零面積三角形、預設第二姿勢等於第一姿勢', () => {
  const b = new Builder();
  const sphere = (u, v) => { const th = u * 2 * Math.PI, ph = v * Math.PI; return [Math.sin(ph) * Math.cos(th), -Math.cos(ph), Math.sin(ph) * Math.sin(th)]; };
  b.surface(sphere, 12, 8, { part: PART.SKIN, center: () => [0, 0, 0], aux: (u, v) => [u, v, 0.5, 1] });
  assert.ok(b.count > 0 && b.count % 3 === 0);
  assert.ok(b.count < 12 * 8 * 6, '極點三角形應被略過');
  assert.deepEqual(b.positions2, b.positions);
  assert.deepEqual(b.normals2, b.normals);
  assert.equal(b.aux.length, b.count * 4);
  for (let i = 0; i < b.count; i++) {
    const p = b.positions.slice(i * 3, i * 3 + 3), n = b.normals.slice(i * 3, i * 3 + 3);
    assert.ok(Math.abs(Math.hypot(...n) - 1) < 1e-6);
    assert.ok(n[0] * p[0] + n[1] * p[1] + n[2] * p[2] > 0.8, '球面法線朝外');
    assert.equal(b.parts[i], PART.SKIN);
  }
  for (let t = 0; t < b.count / 3; t++) {
    const p = i => b.positions.slice((t * 3 + i) * 3, (t * 3 + i) * 3 + 3);
    const [a, c, d] = [p(0), p(1), p(2)];
    const u = c.map((v, k) => v - a[k]), v = d.map((x, k) => x - a[k]);
    const cr = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    assert.ok(cr[0] * a[0] + cr[1] * a[1] + cr[2] * a[2] > 0, '由外向內看為逆時針');
  }
  const arr = b.toArrays();
  assert.ok(arr.positions2 instanceof Float32Array && arr.aux instanceof Float32Array);
  assert.equal(arr.aux.length, arr.parts.length * 4);
});

test('spline：通過控制點、區間內平滑、超出範圍線性外插', () => {
  const f = spline([0, 1, 2], [0, 1, 0]);
  assert.ok(Math.abs(f(0)) < 1e-12 && Math.abs(f(1) - 1) < 1e-12 && Math.abs(f(2)) < 1e-12);
  assert.ok(f(0.5) > 0.5 && f(1.5) > 0.5);
  assert.ok(Math.abs((f(-1) - f(-0.5)) - (f(-0.5) - f(0))) < 1e-12);
});

test('門徒是平滑曲面（不是方塊）：法線方向多樣、三角形數在預算內、繞向一致', () => {
  for (const variant of [0, 1, 2]) {
    const g = buildDisciple({ variant });
    assert.ok(g.count / 3 <= 4000, `tris=${g.count / 3}`);
    const dirs = new Set();
    for (let i = 0; i < g.count; i++) {
      const n = g.normals.slice(i * 3, i * 3 + 3);
      assert.ok(Math.abs(Math.hypot(...n) - 1) < 1e-5);
      dirs.add(n.map(c => Math.round(c * 20)).join(','));
    }
    assert.ok(dirs.size > 400, `法線方向數 ${dirs.size}（方塊只有 6 個）`);
    let bad = 0;
    for (let t = 0; t < g.count / 3; t++) {
      const P = k => g.positions.slice((t * 3 + k) * 3, (t * 3 + k) * 3 + 3), N = k => g.normals.slice((t * 3 + k) * 3, (t * 3 + k) * 3 + 3);
      const [a, c, d] = [P(0), P(1), P(2)];
      const u = c.map((v, k) => v - a[k]), v = d.map((x, k) => x - a[k]);
      const cr = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const ns = [0, 1, 2].map(k => N(0)[k] + N(1)[k] + N(2)[k]);
      if (cr[0] * ns[0] + cr[1] * ns[1] + cr[2] * ns[2] <= 0) bad++;
    }
    assert.equal(bad, 0);
  }
});

test('門徒長袍法線朝外、帶垂直布褶（袍襬半徑隨角度起伏）', () => {
  const g = buildDisciple();
  let out = 0, tot = 0;
  const hemR = [];
  for (let i = 0; i < g.count; i++) {
    if (g.parts[i] !== PART.BODY) continue;
    const x = g.positions[i * 3], y = g.positions[i * 3 + 1], z = g.positions[i * 3 + 2];
    tot++;
    if (g.normals[i * 3] * x + g.normals[i * 3 + 2] * z > 0) out++;
    if (y < 0.01) hemR.push(Math.hypot(x / 0.6, z / 0.76));
  }
  assert.ok(out / tot > 0.97, `朝外比例 ${out / tot}`);
  assert.ok(Math.max(...hemR) - Math.min(...hemR) > 0.08, '袍襬應有布褶起伏');
});

test('門徒的舉手變形目標：只有袖與手移動；合掌在胸前、舉手時手高過肩', () => {
  const g = buildDisciple();
  const moved = new Set();
  const skinA = [], skinB = [];
  for (let i = 0; i < g.count; i++) {
    const d = Math.hypot(...[0, 1, 2].map(k => g.positions2[i * 3 + k] - g.positions[i * 3 + k]));
    if (d > 1e-6) moved.add(g.parts[i]);
    if (g.parts[i] === PART.SKIN && g.positions[i * 3 + 1] < 3.2) { skinA.push(g.positions.slice(i * 3, i * 3 + 3)); skinB.push(g.positions2.slice(i * 3, i * 3 + 3)); }
  }
  assert.deepEqual([...moved].sort(), [PART.ARM, PART.SKIN].sort());
  assert.ok(skinA.length > 0);
  // 合掌：雙手在胸前、靠近中線
  assert.ok(skinA.every(p => p[0] < -0.3 && p[1] > 2.4 && p[1] < 3.2 && Math.abs(p[2]) < 0.25));
  // 舉手：手在肩之上、向兩側張開
  assert.ok(skinB.every(p => p[1] > SHOULDER[1] + 0.4));
  assert.ok(Math.max(...skinB.map(p => p[2])) > 0.7 && Math.min(...skinB.map(p => p[2])) < -0.7);
});

test('門徒 aux：遮蔽與頭部權重在 [0,1]；兜帽頂權重為 1、長袍為 0', () => {
  const g = buildDisciple();
  for (let i = 0; i < g.count; i++) {
    const [cav, hw] = [g.aux[i * 4], g.aux[i * 4 + 1]];
    assert.ok(cav >= 0 && cav <= 1 && hw >= 0 && hw <= 1);
    if (g.parts[i] === PART.BODY) assert.equal(hw, 0);
    if (g.parts[i] === PART.HEAD && g.positions[i * 3 + 1] > 3.6) assert.ok(hw > 0.99);
  }
});

test('buildCross：發光、高約 10、橫梁寬約 6', () => {
  const g = buildCross();
  assert.ok(g.positions.every(Number.isFinite));
  assert.ok(g.parts.every(p => p === PART.EMISSIVE || p === PART.BODY));
  assert.ok(g.parts.includes(PART.EMISSIVE) && g.parts.includes(PART.BODY));
  const [, y1] = range(g.positions, 1);
  assert.ok(Math.abs(y1 - 10) <= 0.5);
  const em = []; for (let i = 0; i < g.count; i++) if (g.parts[i] === PART.EMISSIVE) em.push(g.positions[i * 3 + 2]);
  assert.ok(Math.abs(Math.max(...em) - Math.min(...em) - 6) < 0.5);
});

test('buildDecor：各 kind 確定且有限', () => {
  assert.deepEqual(DECOR_KINDS, ['fin', 'comb', 'arch', 'tower', 'lattice']);
  for (const k of DECOR_KINDS) {
    const a = buildDecor(k, 2.4, mulberry32(7)), b = buildDecor(k, 2.4, mulberry32(7));
    assert.ok(a.count > 0, k);
    assert.deepEqual(a.positions, b.positions);
    assert.ok(a.positions.every(Number.isFinite));
    assert.ok(a.parts.every(p => p === PART.BODY));
  }
  assert.throws(() => buildDecor('nope', 2, mulberry32(1)));
});

test('planRings：確定性與結構', () => {
  const p = planRings({ seed: 3 });
  assert.deepEqual(p, planRings({ seed: 3 }));
  const dis = p.rings.filter(r => r.role === 'disciple');
  const dec = p.rings.filter(r => r.role === 'decor');
  assert.equal(dis.length, 3);
  assert.deepEqual(dis.map(r => r.N), [3, 4, 5]);
  assert.equal(dec.length, 12);
  assert.ok(dis.every(r => r.y === 0 && r.kind === 'disciple'));
  assert.ok(dis[0].dir !== dis[1].dir && dis[1].dir !== dis[2].dir);
  assert.ok(Math.abs(dis[0].spinSpeed) > Math.abs(dis[2].spinSpeed));
  for (let i = 1; i < dec.length; i++) {
    assert.ok(dec[i].y > dec[i - 1].y && dec[i].R < dec[i - 1].R);
    assert.notEqual(dec[i].kind, dec[i - 1].kind);
  }
  assert.equal(dec[0].y, 2); assert.equal(dec[11].y, 24);
  assert.equal(dec[0].R, 20); assert.equal(dec[11].R, 7);
  for (const r of p.rings) {
    assert.ok(r.color.every(c => c >= 0 && c <= 1) && Math.max(...r.color) < 0.8);
    assert.ok(Math.abs(r.w - 2 * Math.PI * r.R / r.N) < 1e-6);
  }
  assert.ok(dec.every(r => r.N >= 8 && r.N % 4 === 0 && DECOR_KINDS.includes(r.kind)));
  assert.ok(new Set(p.rings.map(r => r.id)).size === p.rings.length);
});

test('buildRingGeometry：instances 長度 N*2，門徒與裝飾皆可建', () => {
  for (const r of planRings({ seed: 1 }).rings) {
    const g = buildRingGeometry(r, mulberry32(r.variantSeed));
    assert.equal(g.instances.length, r.N * 2);
    assert.ok(g.instances instanceof Float32Array);
    assert.ok(g.positions.length > 0 && g.positions.length === g.normals.length);
    assert.equal(g.parts.length * 3, g.positions.length);
    assert.equal(g.positions2.length, g.positions.length);
    assert.equal(g.normals2.length, g.positions.length);
    assert.equal(g.aux.length, g.parts.length * 4);
  }
});
