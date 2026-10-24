import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mulberry32, clamp, mat4Identity, mat4Perspective, mat4LookAt, mat4Multiply,
  mat4TransformPoint, orbitEye, ORBIT_DEFAULTS, createOrbit, stepOrbit, projectToScreen,
} from '../assets/mandala-math.js';

const near = (a, b, eps = 1e-5) => assert.ok(Math.abs(a - b) <= eps, `${a} !~ ${b}`);
const NOINPUT = { dragDAz: 0, dragDEl: 0, zoomFactor: 1, held: false, autoOrbit: true, paused: false };

test('mulberry32 is deterministic and in [0,1)', () => {
  const a = mulberry32(42), b = mulberry32(42), c = mulberry32(43);
  const sa = [], sb = [], sc = [];
  for (let i = 0; i < 100; i++) { sa.push(a()); sb.push(b()); sc.push(c()); }
  assert.deepEqual(sa, sb);
  assert.notDeepEqual(sa, sc);
  for (const v of sa) assert.ok(v >= 0 && v < 1);
});

test('clamp', () => {
  assert.equal(clamp(5, 0, 3), 3);
  assert.equal(clamp(-1, 0, 3), 0);
  assert.equal(clamp(2, 0, 3), 2);
});

test('mat4Multiply(identity, m) == m, and out is reused', () => {
  const m = mat4LookAt([3, 4, 5], [0, 1, 0], [0, 1, 0]);
  const same = (x, y) => x.forEach((v, i) => near(v, y[i], 0)); // 0 與 -0 視為相等
  same(mat4Multiply(mat4Identity(), m), m);
  same(mat4Multiply(m, mat4Identity()), m);
  const out = new Float32Array(16);
  assert.equal(mat4Multiply(mat4Identity(), m, out), out);
});

test('mat4Multiply convention: a*b applies b first, then a', () => {
  const T = mat4Identity(); T[12] = 10;           // translate x +10
  const S = mat4Identity(); S[0] = 2;             // scale x by 2
  const p = mat4TransformPoint(mat4Multiply(T, S), [1, 0, 0]); // scale then translate
  near(p[0], 12);
  const q = mat4TransformPoint(mat4Multiply(S, T), [1, 0, 0]); // translate then scale
  near(q[0], 22);
});

test('mat4Multiply tolerates out aliasing an input', () => {
  const T = mat4Identity(); T[12] = 3;
  const S = mat4Identity(); S[0] = 2;
  mat4Multiply(T, S, S);
  near(mat4TransformPoint(S, [1, 0, 0])[0], 5);
});

test('mat4Perspective entries', () => {
  const m = mat4Perspective(Math.PI / 2, 2, 0.1, 100);
  near(m[5], 1 / Math.tan(Math.PI / 4));
  near(m[0], m[5] / 2);
  near(m[11], -1);
});

test('mat4LookAt puts target on -z axis in view space', () => {
  const v = mat4LookAt([3, 4, 5], [1, 2, 0], [0, 1, 0]);
  const p = mat4TransformPoint(v, [1, 2, 0]);
  near(p[0], 0); near(p[1], 0);
  assert.ok(p[2] < 0);
  near(p[2], -Math.hypot(2, 2, 5), 1e-4);
});

test('mat4TransformPoint keeps point under identity', () => {
  const p = mat4TransformPoint(mat4Identity(), [1, 2, 3]);
  assert.deepEqual(Array.from(p), [1, 2, 3, 1]);
});

test('orbitEye', () => {
  const e = orbitEye([0, 0, 0], 0, 0, 10);
  near(e[0], 0); near(e[1], 0); near(e[2], 10);
  const t = orbitEye([0, 1, 0], 0, Math.PI / 2, 10);
  near(t[0], 0); near(t[1], 11); near(t[2], 0);
  const out = [0, 0, 0];
  assert.equal(orbitEye([0, 0, 0], 1, 0.2, 5, out), out);
});

test('createOrbit initial state', () => {
  const s = createOrbit();
  assert.deepEqual(s, { az: 0.4, el: ORBIT_DEFAULTS.startEl, dist: ORBIT_DEFAULTS.startDist, vAz: 0, vEl: 0, idleFor: 0, autoBlend: 0, orbitT: 0 });
});

test('stepOrbit: no auto before idleDelay, auto after', () => {
  let s = createOrbit();
  s = stepOrbit(s, 1, NOINPUT);
  assert.equal(s.autoBlend, 0);
  assert.equal(s.az, 0.4);
  s = createOrbit(); s.idleFor = ORBIT_DEFAULTS.idleDelay;
  const s2 = stepOrbit(s, 1, NOINPUT);
  assert.ok(s2.autoBlend > 0);
  assert.ok(s2.orbitT > 0);
  const target = ORBIT_DEFAULTS.azAmp * Math.sin(s2.orbitT * ORBIT_DEFAULTS.azRate);
  assert.ok(Math.abs(s2.az - target) < Math.abs(s.az - target));
});

test('stepOrbit: drag resets idle/autoBlend and moves az', () => {
  const s = { ...createOrbit(), idleFor: 10, autoBlend: 0.7 };
  const r = stepOrbit(s, 0.016, { ...NOINPUT, dragDAz: 0.1, held: true });
  assert.equal(r.idleFor, 0);
  assert.equal(r.autoBlend, 0);
  near(r.az, s.az + 0.1);
  near(r.vAz, 0.1 / 0.016);
});

test('stepOrbit: held with no drag resets idle', () => {
  const s = { ...createOrbit(), idleFor: 10, autoBlend: 0.5 };
  const r = stepOrbit(s, 0.1, { ...NOINPUT, held: true });
  assert.equal(r.idleFor, 0);
  assert.equal(r.autoBlend, 0);
});

test('stepOrbit: paused or autoOrbit:false disables auto', () => {
  const s = { ...createOrbit(), idleFor: 10 };
  for (const inp of [{ ...NOINPUT, paused: true }, { ...NOINPUT, autoOrbit: false }]) {
    const r = stepOrbit(s, 1, inp);
    assert.equal(r.autoBlend, 0);
    assert.equal(r.orbitT, 0);
    assert.equal(r.az, s.az);
  }
});

test('stepOrbit: idleFor accumulates when idle', () => {
  const r = stepOrbit(createOrbit(), 0.5, NOINPUT);
  near(r.idleFor, 0.5);
});

test('stepOrbit: el and dist clamp', () => {
  const P = ORBIT_DEFAULTS;
  let r = stepOrbit(createOrbit(), 0.016, { ...NOINPUT, dragDEl: 5, held: true });
  assert.equal(r.el, P.maxEl);
  r = stepOrbit(createOrbit(), 0.016, { ...NOINPUT, dragDEl: -5, held: true });
  assert.equal(r.el, P.minEl);
  r = stepOrbit(createOrbit(), 0.016, { ...NOINPUT, zoomFactor: 100 });
  assert.equal(r.dist, P.maxDist);
  r = stepOrbit(createOrbit(), 0.016, { ...NOINPUT, zoomFactor: 0.001 });
  assert.equal(r.dist, P.minDist);
});

test('stepOrbit: missing zoomFactor defaults to 1', () => {
  const r = stepOrbit(createOrbit(), 0.016, { held: false });
  assert.equal(r.dist, ORBIT_DEFAULTS.startDist);
});

test('stepOrbit does not mutate inputs and is deterministic', () => {
  const s = Object.freeze({ ...createOrbit(), idleFor: 9 });
  const inp = Object.freeze({ ...NOINPUT, dragDAz: 0.05 });
  const a = stepOrbit(s, 0.016, inp), b = stepOrbit(s, 0.016, inp);
  assert.deepEqual(a, b);
  assert.notEqual(a, s);
  assert.equal(s.idleFor, 9);
});

test('stepOrbit inertia: velocity decays, drift continues but shrinks', () => {
  let s = stepOrbit(createOrbit(), 0.016, { ...NOINPUT, dragDAz: 0.1, held: true });
  const v0 = s.vAz;
  const az0 = s.az;
  s = stepOrbit(s, 0.1, NOINPUT);
  const d1 = s.az - az0;
  assert.ok(s.vAz < v0 && s.vAz > 0);
  assert.ok(d1 > 0);
  const az1 = s.az;
  s = stepOrbit(s, 0.1, NOINPUT);
  const d2 = s.az - az1;
  assert.ok(d2 > 0 && d2 < d1);
});

test('projectToScreen: view-center point maps to screen center', () => {
  const eye = [0, 5, 20], target = [0, 0, 0];
  const vp = mat4Multiply(mat4Perspective(1, 800 / 600, 0.1, 100), mat4LookAt(eye, target, [0, 1, 0]));
  const r = projectToScreen(vp, target, 800, 600);
  near(r.x, 400, 1e-2); near(r.y, 300, 1e-2);
  assert.equal(r.visible, true);
  assert.ok(r.w > 0);
});

test('projectToScreen: point above is higher on screen; behind camera invisible', () => {
  const vp = mat4Multiply(mat4Perspective(1, 1, 0.1, 100), mat4LookAt([0, 0, 20], [0, 0, 0], [0, 1, 0]));
  assert.ok(projectToScreen(vp, [0, 3, 0], 100, 100).y < 50);
  assert.equal(projectToScreen(vp, [0, 0, 40], 100, 100).visible, false);
  assert.equal(projectToScreen(vp, [500, 0, 0], 100, 100).visible, false);
});
