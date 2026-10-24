import test from 'node:test';
import assert from 'node:assert/strict';
import { createMandala } from '../assets/mandala.js';

test('沒有 WebGL2（getContext 回 null）→ 回傳 null 並呼叫 onFail', () => {
  const reasons = [];
  const asked = [];
  const canvas = { getContext: (type) => { asked.push(type); return null; } };
  const m = createMandala(canvas, { onFail: r => reasons.push(r) });
  assert.equal(m, null);
  assert.equal(reasons.length, 1);
  assert.equal(typeof reasons[0], 'string');
  assert.ok(asked.includes('webgl2'));
});

test('getContext 拋錯 → 回傳 null 並呼叫 onFail，不外拋', () => {
  const reasons = [];
  const canvas = { getContext: () => { throw new Error('boom'); } };
  const m = createMandala(canvas, { onFail: r => reasons.push(r) });
  assert.equal(m, null);
  assert.equal(reasons.length, 1);
  assert.match(reasons[0], /boom/);
});

test('沒有 onFail 也不外拋', () => {
  assert.equal(createMandala({ getContext: () => null }), null);
  assert.equal(createMandala(null), null);
});

// 假的 WebGL2：任何方法回傳一個空物件，常數回傳數字；可覆寫特定方法以模擬失敗
function fakeGl(overrides = {}) {
  let n = 1;
  return new Proxy({}, {
    get(_, prop) {
      if (prop in overrides) return overrides[prop];
      if (typeof prop === 'string' && /^[A-Z0-9_]+$/.test(prop)) return prop === 'FRAMEBUFFER_COMPLETE' ? 36053 : 1000 + (n++);
      if (prop === 'isContextLost') return () => false;
      if (prop === 'getShaderParameter' || prop === 'getProgramParameter') return () => true;
      if (prop === 'checkFramebufferStatus') return () => 36053;
      return () => ({});
    },
  });
}
const canvasWith = (gl) => ({ clientWidth: 100, clientHeight: 80, width: 0, height: 0, getContext: () => gl });

test('shader 編譯失敗 → onFail 帶 info log、回傳 null', () => {
  const reasons = [];
  const gl = fakeGl({ getShaderParameter: () => false, getShaderInfoLog: () => 'ERROR: 0:7: bad token' });
  assert.equal(createMandala(canvasWith(gl), { onFail: r => reasons.push(r) }), null);
  assert.equal(reasons.length, 1);
  assert.match(reasons[0], /compile failed: ERROR: 0:7: bad token/);
});

test('program 連結失敗 → onFail 帶 info log', () => {
  const reasons = [];
  const gl = fakeGl({ getProgramParameter: () => false, getProgramInfoLog: () => 'link: varying mismatch' });
  assert.equal(createMandala(canvasWith(gl), { onFail: r => reasons.push(r) }), null);
  assert.match(reasons[0], /link failed: link: varying mismatch/);
});

test('FBO 不完整 → onFail、回傳 null', () => {
  const reasons = [];
  const gl = fakeGl({ checkFramebufferStatus: () => 36054 });
  assert.equal(createMandala(canvasWith(gl), { onFail: r => reasons.push(r) }), null);
  assert.match(reasons[0], /framebuffer incomplete/);
});
