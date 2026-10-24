// 曼陀羅場景的純函式：種子亂數、矩陣、軌道相機。無 DOM、無全域副作用。
// 矩陣一律為 Float32Array(16)，行主序（column-major，與 WebGL 一致）：元素 [col*4+row]。
// 所有函式接受可選的 out 參數以重用陣列（熱路徑不配置）。

export const ORBIT_DEFAULTS = Object.freeze({
  azAmp: 0.955,    // 自動路徑的方位角振幅（弧度）
  elAmp: 0.45,     // 自動路徑的仰角振幅（弧度）
  azRate: 0.09,    // 方位角路徑的角頻率（弧度／秒）
  elRate: 0.13,    // 仰角路徑的角頻率（弧度／秒）
  elPhase: 10.7,   // 仰角路徑的相位偏移
  follow: 2.6,     // 相機追上路徑點的速率（每秒指數）
  ramp: 0.4,       // 自動環繞混合量趨近 1 的速率（每秒指數）
  idleDelay: 4,    // 無操作多少秒後開始自動環繞
  inertia: 0.9,    // 拖曳慣性（越接近 1 衰減越慢；衰減率 = (1 - inertia) * 10 每秒）
  minEl: -0.15,    // 仰角下限（弧度）
  maxEl: 1.2,      // 仰角上限（弧度）
  minDist: 16,     // 相機距離下限
  maxDist: 70,     // 相機距離上限
  startDist: 36,   // 初始相機距離
  startEl: 0.32,   // 初始仰角，也是自動路徑的仰角中心
});

const INERTIA_RATE_SCALE = 10; // 慣性衰減指數的倍率（規格：exp(-dt*(1-inertia)*10)）
const VISIBLE_NDC_LIMIT = 1.2; // projectToScreen 判定可見的 NDC 範圍（略大於 1 以容納邊緣物件）

// 確定性亂數，回傳 [0,1)
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function mat4Identity(out = new Float32Array(16)) {
  out.fill(0);
  out[0] = out[5] = out[10] = out[15] = 1;
  return out;
}

export function mat4Perspective(fovY, aspect, near, far, out = new Float32Array(16)) {
  const f = 1 / Math.tan(fovY / 2);
  const nf = 1 / (near - far);
  out.fill(0);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) * nf;
  out[11] = -1;
  out[14] = 2 * far * near * nf;
  return out;
}

export function mat4LookAt(eye, target, up, out = new Float32Array(16)) {
  let zx = eye[0] - target[0], zy = eye[1] - target[1], zz = eye[2] - target[2];
  let l = Math.hypot(zx, zy, zz) || 1;
  zx /= l; zy /= l; zz /= l;
  let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
  l = Math.hypot(xx, xy, xz) || 1;
  xx /= l; xy /= l; xz /= l;
  const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
  out[0] = xx; out[1] = yx; out[2] = zx; out[3] = 0;
  out[4] = xy; out[5] = yy; out[6] = zy; out[7] = 0;
  out[8] = xz; out[9] = yz; out[10] = zz; out[11] = 0;
  out[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
  out[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
  out[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
  out[15] = 1;
  return out;
}

// 回傳 a * b（列向量慣例：變換一個點時先套用 b，再套用 a）。out 可與 a 或 b 為同一陣列。
export function mat4Multiply(a, b, out = new Float32Array(16)) {
  const r = out === a || out === b ? new Float32Array(16) : out;
  for (let c = 0; c < 4; c++) {
    for (let row = 0; row < 4; row++) {
      r[c * 4 + row] =
        a[row] * b[c * 4] + a[4 + row] * b[c * 4 + 1] +
        a[8 + row] * b[c * 4 + 2] + a[12 + row] * b[c * 4 + 3];
    }
  }
  if (r !== out) out.set(r);
  return out;
}

// 以 m 變換點 [x,y,z]（w=1），回傳 [x,y,z,w]（未做透視除法）
export function mat4TransformPoint(m, p, out = [0, 0, 0, 0]) {
  const x = p[0], y = p[1], z = p[2];
  out[0] = m[0] * x + m[4] * y + m[8] * z + m[12];
  out[1] = m[1] * x + m[5] * y + m[9] * z + m[13];
  out[2] = m[2] * x + m[6] * y + m[10] * z + m[14];
  out[3] = m[3] * x + m[7] * y + m[11] * z + m[15];
  return out;
}

// az 繞 Y 軸（az=0 在 +Z），el 為離水平面的角度（+ 在上）
export function orbitEye(target, az, el, dist, out = [0, 0, 0]) {
  const ce = Math.cos(el);
  out[0] = target[0] + dist * ce * Math.sin(az);
  out[1] = target[1] + dist * Math.sin(el);
  out[2] = target[2] + dist * ce * Math.cos(az);
  return out;
}

export function createOrbit(overrides = {}) {
  return {
    az: 0.4, el: ORBIT_DEFAULTS.startEl, dist: ORBIT_DEFAULTS.startDist,
    vAz: 0, vEl: 0, idleFor: 0, autoBlend: 0, orbitT: 0,
    ...overrides,
  };
}

// input = { dragDAz, dragDEl, zoomFactor, held, autoOrbit, paused }；回傳新物件，不修改傳入的 state
export function stepOrbit(state, dt, input, params = ORBIT_DEFAULTS) {
  const P = params;
  const dAz = input.dragDAz || 0, dEl = input.dragDEl || 0;
  const dragging = dAz !== 0 || dEl !== 0;
  const active = dragging || !!input.held;
  let { az, el, vAz, vEl, autoBlend, orbitT } = state;
  let idleFor = active ? 0 : state.idleFor + dt;

  if (dragging) {
    az += dAz; el += dEl;
    vAz = dt > 0 ? dAz / dt : 0;
    vEl = dt > 0 ? dEl / dt : 0;
  } else if (input.held) {
    vAz = 0; vEl = 0;
  } else {
    const k = Math.exp(-dt * (1 - P.inertia) * INERTIA_RATE_SCALE);
    vAz *= k; vEl *= k;
    az += vAz * dt; el += vEl * dt;
  }
  if (active) autoBlend = 0;

  const dist = clamp(state.dist * (input.zoomFactor ?? 1), P.minDist, P.maxDist);

  if (input.autoOrbit && !input.paused && idleFor >= P.idleDelay) {
    autoBlend += (1 - autoBlend) * (1 - Math.exp(-dt * P.ramp));
    orbitT += dt * autoBlend;
    const f = 1 - Math.exp(-dt * P.follow * autoBlend);
    az += (P.azAmp * Math.sin(orbitT * P.azRate) - az) * f;
    el += (P.elAmp * Math.sin(orbitT * P.elRate + P.elPhase) + P.startEl - el) * f;
  } else {
    autoBlend = 0;
  }

  el = clamp(el, P.minEl, P.maxEl);
  return { az, el, dist, vAz, vEl, idleFor, autoBlend, orbitT };
}

// 世界座標點 → CSS 像素（原點左上）。visible：w > 0 且 NDC 在 [-1.2, 1.2] 內
export function projectToScreen(viewProj, point, width, height, out = { x: 0, y: 0, visible: false, w: 0 }) {
  const c = mat4TransformPoint(viewProj, point, [0, 0, 0, 0]);
  const w = c[3];
  const nx = w !== 0 ? c[0] / w : 0, ny = w !== 0 ? c[1] / w : 0;
  out.x = (nx * 0.5 + 0.5) * width;
  out.y = (1 - (ny * 0.5 + 0.5)) * height;
  out.w = w;
  out.visible = w > 0 && Math.abs(nx) <= VISIBLE_NDC_LIMIT && Math.abs(ny) <= VISIBLE_NDC_LIMIT;
  return out;
}

// ---- 渲染排程 ----
export const THROTTLE_FPS = 24;      // 對話框開啟時的渲染幀率上限
const THROTTLE_SLACK_MS = 4;         // raf 抖動容許量：差這麼多以內視為到點
const CHANGE_EPS = 1e-6;

// 前後兩次的場景簽章（數值陣列）是否不同；用於靜止（暫停／減少動態）時判斷要不要重畫
export function sceneChanged(prev, cur) {
  if (!prev || prev.length !== cur.length) return true;
  for (let i = 0; i < cur.length; i++) if (Math.abs(prev[i] - cur[i]) > CHANGE_EPS) return true;
  return false;
}

// 節流：距上次渲染不足間隔就略過這一幀（intervalMs <= 0 代表不節流；lastRender < 0 代表還沒畫過）
export function throttleSkip(now, lastRender, intervalMs) {
  return intervalMs > 0 && lastRender >= 0 && now - lastRender < intervalMs - THROTTLE_SLACK_MS;
}
