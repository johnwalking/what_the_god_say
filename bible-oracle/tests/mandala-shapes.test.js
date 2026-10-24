import test from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32 } from '../assets/mandala-math.js';
import {
  Builder, PART, SHOULDER, HIP, DECOR_KINDS,
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

test('門徒：兜帽比頭大、袍腳比肩寬、雙臂各至少 2 段', () => {
  const g = buildDisciple();
  const zw = part => { const pos = []; for (let i = 0; i < g.count; i++) if (g.parts[i] === part) pos.push(g.positions[i * 3 + 2]); return Math.max(...pos) - Math.min(...pos); };
  assert.ok(zw(PART.ARM) > 0.8);
  // 袍腳（y<0.5 的頂點）z 寬大於肩（y 在 3.2~3.5）
  const wAt = (a, b) => { const z = []; for (let i = 0; i < g.count; i++) { const y = g.positions[i * 3 + 1]; if (g.parts[i] === PART.BODY && y >= a && y <= b) z.push(g.positions[i * 3 + 2]); } return Math.max(...z) - Math.min(...z); };
  assert.ok(wAt(0, 0.5) > wAt(3.2, 3.5) * 1.2);
  // 手臂方塊數 >= 4（每方塊 36 頂點）
  assert.ok(g.parts.filter(p => p === PART.ARM).length >= 4 * 36);
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
  }
});
