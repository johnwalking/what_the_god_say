// 曼陀羅場景的幾何純函式：建構器（方塊與參數曲面）、兜帽門徒、十字架、裝飾模組、環配置。
// 局部座標：+x 徑向向外、+y 向上、+z 切線方向；門徒面朝 -x（面向中心）。無 DOM、無全域副作用。
// 每頂點屬性：position、normal、part、position2／normal2（舉手姿勢的變形目標，非門徒手臂則同 position）、
// aux = [凹處遮蔽 0..1, 頭部權重（點頭／歪頭）, 布紋細褶振幅, 細褶相位（繞軸角度）]。
import { mulberry32 } from './mandala-math.js';

// 部位代碼（每頂點一個值，供 shader 判斷材質、動畫與發光）
export const PART = Object.freeze({ BODY: 0, HEAD: 1, ARM: 2, EMISSIVE: 3, SKIN: 4, ROPE: 5 });
export const DECOR_KINDS = Object.freeze(['fin', 'comb', 'arch', 'tower', 'lattice']);

// 門徒的樞軸（局部座標）
export const SHOULDER = Object.freeze([0, 2.96, 0]); // 手臂根部（合掌與舉手兩組姿勢共用此處）
export const HIP = Object.freeze([0, 1.6, 0]);       // 上身前傾（鞠躬）的樞軸
export const NECK = Object.freeze([0, 3.3, 0]);      // 兜帽點頭／歪頭的樞軸

const TAU = Math.PI * 2;
const ZERO4 = Object.freeze([0, 0, 0, 0]);

// ── 向量小工具（只在建模時使用，不在熱路徑） ──
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
// 布褶剖面：谷底尖、脊頂圓（值域 [-1, 1]，x=0 為谷）
const crease = (x) => 2 * Math.abs(Math.sin(x / 2)) - 1;

// 三次 Hermite 樣條（有限差分切線）；超出範圍時線性外插，讓數值微分在邊界仍平滑
export function spline(xs, ys) {
  const n = xs.length;
  const m = ys.map((_, i) => {
    const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
    return (ys[b] - ys[a]) / (xs[b] - xs[a]);
  });
  return (x) => {
    if (x <= xs[0]) return ys[0] + m[0] * (x - xs[0]);
    if (x >= xs[n - 1]) return ys[n - 1] + m[n - 1] * (x - xs[n - 1]);
    let i = 0;
    while (x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i], t = (x - xs[i]) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}

// 參數曲面的法線：中央差分 (∂P/∂u × ∂P/∂v)
function rawNormal(f, u, v) {
  const e = 1e-3;
  const pu = sub(f(u + e, v), f(u - e, v));
  const pv = sub(f(u, Math.min(1, v + e)), f(u, Math.max(0, v - e)));
  return cross(pu, pv);
}
// 極點（整圈 u 收成一點）退化時，取極點旁一圈法線的平均，避免極點上出現亮點
function surfaceNormal(f, u, v) {
  let n = rawNormal(f, u, v);
  if (Math.hypot(n[0], n[1], n[2]) < 1e-12) {
    const vv = v < 0.5 ? v + 0.02 : v - 0.02;
    n = [0, 0, 0];
    for (let k = 0; k < 12; k++) n = add(n, norm(rawNormal(f, k / 12, vv)));
  }
  const l = Math.hypot(n[0], n[1], n[2]);
  return l > 1e-12 ? [n[0] / l, n[1] / l, n[2] / l] : [0, 1, 0];
}

export class Builder {
  constructor() {
    this.positions = []; this.normals = []; this.parts = [];
    this.positions2 = []; this.normals2 = []; this.aux = [];
    this.o = [0, 0, 0]; // 位移
    this.s = 1;         // 縮放
  }
  get count() { return this.parts.length; }

  _vert(p, n, part, p2, n2, x) {
    const { o, s } = this;
    this.positions.push(p[0] * s + o[0], p[1] * s + o[1], p[2] * s + o[2]);
    this.normals.push(n[0], n[1], n[2]);
    this.positions2.push(p2[0] * s + o[0], p2[1] * s + o[1], p2[2] * s + o[2]);
    this.normals2.push(n2[0], n2[1], n2[2]);
    this.parts.push(part);
    this.aux.push(x[0], x[1], x[2], x[3]);
  }

  // 軸對齊方塊：6 面 × 2 三角形，逆時針繞向對應面法線（硬邊、每面法線）
  box(cx, cy, cz, sx, sy, sz, part = 0) {
    const c = [cx, cy, cz], h = [sx / 2, sy / 2, sz / 2];
    for (let a = 0; a < 3; a++) {
      const ua = (a + 1) % 3, va = (a + 2) % 3;
      for (const sign of [1, -1]) {
        const quad = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => {
          const p = [0, 0, 0];
          p[a] = c[a] + sign * h[a]; p[ua] = c[ua] + u * h[ua]; p[va] = c[va] + v * h[va];
          return p;
        });
        if (sign < 0) quad.reverse();
        const n = [0, 0, 0]; n[a] = sign;
        for (const i of [0, 1, 2, 0, 2, 3]) this._vert(quad[i], n, part, quad[i], n, ZERO4);
      }
    }
    return this;
  }

  // 參數曲面 f(u,v) → [x,y,z]，u、v ∈ [0,1]，nu × nv 格，平滑法線（數值微分）。
  // opts.pose2：同參數化的第二姿勢（變形目標）；opts.aux(u,v,p)：每頂點 aux；
  // opts.center(p)／center2(p)：給定時（分別用於兩組姿勢）把法線翻向「遠離 center(p)」的一側（凸形用）；opts.flip：整體翻轉法線。
  // 三角形繞向依頂點法線決定（由法線那側看為逆時針），零面積三角形（極點）略過。
  surface(f, nu, nv, { part = PART.BODY, pose2 = null, aux = null, center = null, center2 = center, flip = false } = {}) {
    const grid = (g, center) => {
      const P = [], N = [];
      for (let j = 0; j <= nv; j++) {
        for (let i = 0; i <= nu; i++) {
          const u = i / nu, v = j / nv, p = g(u, v);
          let n = surfaceNormal(g, u, v);
          if (flip) n = mul(n, -1);
          if (center && dot(n, sub(p, center(p))) < 0) n = mul(n, -1);
          P.push(p); N.push(n);
        }
      }
      return { P, N };
    };
    const A = grid(f, center), B = pose2 ? grid(pose2, center2) : A;
    const X = [];
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) X.push(aux ? aux(i / nu, j / nv, A.P[j * (nu + 1) + i]) : ZERO4);
    const id = (i, j) => j * (nu + 1) + i;
    for (let j = 0; j < nv; j++) {
      for (let i = 0; i < nu; i++) {
        const a = id(i, j), b = id(i + 1, j), c = id(i + 1, j + 1), d = id(i, j + 1);
        for (const t of [[a, b, c], [a, c, d]]) {
          const [p0, p1, p2] = t.map(k => A.P[k]);
          const g = cross(sub(p1, p0), sub(p2, p0));
          if (Math.hypot(g[0], g[1], g[2]) < 1e-9) continue;
          const ns = add(add(A.N[t[0]], A.N[t[1]]), A.N[t[2]]);
          const order = dot(g, ns) >= 0 ? t : [t[0], t[2], t[1]];
          for (const k of order) this._vert(A.P[k], A.N[k], part, B.P[k], B.N[k], X[k]);
        }
      }
    }
    return this;
  }

  toArrays() {
    return {
      positions: new Float32Array(this.positions),
      normals: new Float32Array(this.normals),
      parts: new Float32Array(this.parts),
      positions2: new Float32Array(this.positions2),
      normals2: new Float32Array(this.normals2),
      aux: new Float32Array(this.aux),
    };
  }
}

// ── 門徒（兜帽長袍的修士） ─────────────────────────────────────
// 高約 4.3，面朝 -x，腳底中央為原點。組成：鐘形長袍（垂直布褶往袍襬加深、幾道不對稱大褶）、
// 腰間繩帶與垂下的繩頭、披肩（斜肩、波浪下襬）、深兜帽（帽簷前探、內襯、陰影中的臉）、
// 寬袖（漸寬的管狀袖、袖口下垂、內側陰影）與合掌於胸前的雙手。舉手姿勢以變形目標（position2）表示。
const WAIST = 2.02;          // 腰繩高度
const ROBE_TOP = 3.3;        // 長袍頂（頸）
const ROBE_Y = [0, 0.45, 1.0, 1.55, 1.95, 2.1, 2.45, 2.8, 3.02, 3.18, 3.3];
const ROBE_RX = [0.6, 0.55, 0.47, 0.39, 0.33, 0.33, 0.36, 0.35, 0.3, 0.22, 0.14]; // 前後半徑
const ROBE_RZ = [0.76, 0.69, 0.6, 0.5, 0.42, 0.43, 0.49, 0.53, 0.5, 0.36, 0.16]; // 左右半徑
const ROBE_XOFF = [0, 0, 0, 0, 0, 0, 0.01, 0.03, 0.04, 0.04, 0.03];               // 微駝背
const ROBE_SEG = [30, 16];   // 長袍格數 [繞, 高]
const FOLD_HEM = 0.07;       // 袍襬處的布褶深度
const FOLD_WAIST = 0.012;    // 腰處的布褶深度
const CAPE_TOP = 3.4, CAPE_HEM = 2.5; // 披肩頂與下襬高度（前襬再高一些）
const CAPE_SEG = [24, 8];
const HOOD_C = [-0.02, 3.62, 0];      // 兜帽中心
const HOOD_R = [0.34, 0.38, 0.31];    // 兜帽半徑 [前後, 上下, 左右]
const HOOD_SEG = [20, 15];
const FACE_C = [0.01, 3.55, 0], FACE_R = [0.18, 0.24, 0.16]; // 臉（凹在兜帽內）
const SLEEVE_SEG = [8, 12];
const HAND_SEG = [6, 5];
const ROPE_R = 0.032;        // 腰繩粗細

// 長袍外形（不含布褶）
const robeRX = spline(ROBE_Y, ROBE_RX), robeRZ = spline(ROBE_Y, ROBE_RZ), robeXO = spline(ROBE_Y, ROBE_XOFF);

// 二次 Bézier，經過 a、b（中點附近）、c
const bez = (a, b, c) => {
  const q = sub(mul(b, 2), mul(add(a, c), 0.5));
  return (t) => add(add(mul(a, (1 - t) * (1 - t)), mul(q, 2 * t * (1 - t))), mul(c, t * t));
};

// 沿路徑的管狀曲面：u 繞截面、v 沿路徑。起點為圓頂；終點為圓頂或「袖口」（向內翻入，形成可見的袖內陰影）
function tube(path, radius, { ref = [0, 0, 1], sag = 0, cuff = false, cuffDepth = 0.16 } = {}) {
  const a = 0.06, b = cuff ? 0.86 : 0.94;
  return (u, v) => {
    const phi = u * TAU;
    let t, rs = 1, back = 0;
    if (v < a) { const s = v / a; t = 0; rs = Math.sin(s * Math.PI / 2); back = -(1 - s) * radius(0) * 0.5; }
    else if (v <= b) t = (v - a) / (b - a);
    else {
      const s = (v - b) / (1 - b); t = 1;
      if (cuff) { rs = 1 - 0.8 * s; back = -cuffDepth * s; } else { rs = Math.cos(s * Math.PI / 2); back = radius(1) * 0.5 * s; }
    }
    const C = path(t), T = norm(sub(path(t + 1e-3), path(t - 1e-3)));
    const N1 = norm(sub(ref, mul(T, dot(T, ref)))), N2 = cross(T, N1);
    const r = radius(t) * rs;
    const off = add(mul(N1, r * Math.cos(phi)), mul(N2, r * Math.sin(phi)));
    if (sag && off[1] < 0) off[1] *= 1 + sag * t * t; // 寬袖下垂
    return add(add(C, mul(T, back)), off);
  };
}

// 橢球：polar 為極軸（含長度），ex、ez 為截面兩軸（含長度）；bump(dir) 可加上局部凸起
function ellipsoid(c, ex, polar, ez, bump = null) {
  return (u, v) => {
    const th = u * TAU, ph = v * Math.PI;
    const s = Math.sin(ph), k = 1 + (bump ? bump(th, ph) : 0);
    return add(c, mul(add(add(mul(ex, s * Math.cos(th)), mul(polar, -Math.cos(ph))), mul(ez, s * Math.sin(th))), k));
  };
}

// 兩組手臂姿勢（side = ±1 為左右）：合掌（idle）與舉手張掌（raise）
function armPose(side, raised) {
  const z = (p) => [p[0], p[1], p[2] * side];
  if (!raised) return { S: z([0.02, 2.95, 0.4]), E: z([0.0, 2.33, 0.47]), W: z([-0.5, 2.62, 0.13]) };
  // 舉手：古典「奧蘭」祈禱姿（上臂向側前抬、肘彎、前臂向上、掌心朝前，雙手在兜帽兩側）
  return { S: z([0.02, 2.95, 0.4]), E: z([-0.2, 3.02, 0.86]), W: z([-0.36, 3.72, 0.98]) };
}
function handFrame(side, raised, pose) {
  if (!raised) { // 合掌：指尖朝上略前，掌心相對
    const F = norm([-0.3, 1, 0]), Th = norm(sub([0.5, 0, side], mul(F, -0.15))); // 掌心相對、手背略朝外前
    return { C: add([-0.58, 2.66, 0.048 * side], mul(F, 0.15)), F, Th, W: norm(cross(F, Th)), lw: 0.085, lt: 0.05, lf: 0.18 };
  }
  const F = norm(add(norm(sub(pose.W, pose.E)), [0, 0.6, 0])); // 張掌：指尖朝上，掌心朝前（-x）
  const Th = norm(sub([-1, 0, 0], mul(F, -F[0])));
  return { C: add(pose.W, mul(F, 0.07)), F, Th, W: norm(cross(F, Th)), lw: 0.1, lt: 0.04, lf: 0.19 };
}

// 兜帽剖面（沿 v）：內襯深處 → 內襯 → 帽緣捲邊 → 外殼 → 後頂；α 為與正前方的夾角，k 為半徑倍率
const HOOD_V = [0, 0.2, 0.34, 0.42, 0.5, 0.62, 0.8, 1];
const HOOD_K = spline(HOOD_V, [0.8, 0.84, 0.9, 0.96, 1.02, 1.03, 1.0, 1.0]);

export function buildDisciple(opts = {}) {
  const variant = ((opts.variant ?? 0) % 3 + 3) % 3;
  const rng = mulberry32(911 + variant * 7717);
  const wk = 1 + 0.05 * (variant - 1);  // 長袍寬度係數
  const hk = 1 + 0.04 * (1 - variant);  // 兜帽大小係數
  const ph = [rng() * TAU, rng() * TAU, rng() * TAU, rng() * TAU];
  // 幾道不對稱大褶（θ 位置、深度（正為凸）、寬度）
  const big = [0, 1, 2].map(() => [rng() * TAU, (rng() < 0.5 ? -1 : 1) * (0.03 + 0.03 * rng()), 0.22 + 0.2 * rng()]);
  const b = new Builder();

  // 長袍布褶：腰以下往袍襬加深並略斜，腰以上淺而密（被繩子束起）
  const fold = (th, y) => {
    const below = clamp01((WAIST - y) / WAIST), wAbove = smooth(WAIST - 0.06, WAIST + 0.06, y);
    const warp = 0.35 * Math.sin(2 * th + ph[2]) + 0.25 * y;
    const lo = (FOLD_WAIST + FOLD_HEM * Math.pow(below, 1.2)) * (0.65 * crease(7 * th + ph[0] + warp) + 0.35 * crease(12 * th + ph[1] - 1.3 * warp));
    let bg = 0;
    for (const [c, a, w] of big) { const d = Math.atan2(Math.sin(th - c), Math.cos(th - c)); bg += a * Math.exp(-(d * d) / (w * w)) * Math.pow(below, 0.8); }
    const up = (0.006 + 0.016 * (1 - smooth(WAIST, WAIST + 0.7, y))) * crease(10 * th + ph[3]);
    return (lo + bg) * (1 - wAbove) + up * wAbove;
  };
  const robe = (u, v) => {
    const th = u * TAU, y = v * ROBE_TOP, d = fold(th, y);
    return [(robeRX(y) * wk + d) * Math.cos(th) + robeXO(y), y, (robeRZ(y) * wk + d) * Math.sin(th)];
  };
  b.surface(robe, ROBE_SEG[0], ROBE_SEG[1], {
    part: PART.BODY, center: (p) => [robeXO(p[1]), p[1], 0],
    aux: (u, v) => {
      const th = u * TAU, y = v * ROBE_TOP, d = fold(th, y), below = clamp01((WAIST - y) / WAIST);
      const cav = clamp01(-d / 0.05) * 0.55 + 0.35 * smooth(CAPE_HEM - 0.25, CAPE_HEM + 0.1, y);
      return [cav, 0, 0.14 + 0.45 * below, th];
    },
  });

  // 腰繩：沿腰圍的圓管，繩紋（兩股螺旋）交給 shader 的細褶相位
  const ropeRX = robeRX(WAIST) * wk + 0.03, ropeRZ = robeRZ(WAIST) * wk + 0.03;
  const belt = (u, v) => {
    const th = v * TAU, phi = u * TAU;
    const c = [ropeRX * Math.cos(th) + robeXO(WAIST), WAIST, ropeRZ * Math.sin(th)];
    const out = norm([Math.cos(th) / ropeRX, 0, Math.sin(th) / ropeRZ]);
    return add(c, add(mul(out, ROPE_R * Math.cos(phi)), [0, ROPE_R * Math.sin(phi), 0]));
  };
  const beltAxis = (p) => { const th = Math.atan2(p[2] / ropeRZ, (p[0] - robeXO(WAIST)) / ropeRX); return [ropeRX * Math.cos(th) + robeXO(WAIST), WAIST, ropeRZ * Math.sin(th)]; };
  b.surface(belt, 4, 26, { part: PART.ROPE, center: beltAxis, aux: (u, v) => [0.1, 0, 0.45, v * TAU * 22 + u * TAU * 2] });
  // 垂下的兩條繩頭（前方偏一側），末端打結
  for (const [dth, len] of [[0.42, 0.95], [0.56, 0.78]]) {
    const th = Math.PI + dth * (variant === 1 ? -1 : 1);
    const at = (y, extra) => { const r = (k) => (k === 0 ? robeRX(y) : robeRZ(y)) * wk + extra; return [r(0) * Math.cos(th) + robeXO(y), y, r(1) * Math.sin(th)]; };
    const p0 = at(WAIST - 0.02, 0.05), p2 = at(WAIST - len, 0.085), p1 = add(at(WAIST - len * 0.5, 0.07), [-0.02, 0, 0]);
    const path = bez(p0, p1, p2);
    const rad = (t) => ROPE_R * 0.8 * (1 + 0.7 * Math.exp(-Math.pow((t - 0.9) / 0.05, 2)));
    b.surface(tube(path, rad, { ref: [-1, 0, 0] }), 4, 6, { part: PART.ROPE, aux: (u, v) => [0.15, 0, 0.45, v * TAU * 9 + u * TAU * 2] });
  }

  // 披肩：自頸部斜下覆肩，前襬較高，下襬波浪；末端向內翻一小段作為布邊厚度
  const capeHem = (th) => CAPE_HEM + 0.17 * Math.pow(Math.max(0, -Math.cos(th)), 1.5);
  const capeRX = spline([0, 0.25, 0.5, 0.75, 1], [0.16, 0.33, 0.43, 0.48, 0.5]);
  const capeRZ = spline([0, 0.25, 0.5, 0.75, 1], [0.17, 0.43, 0.6, 0.67, 0.69]);
  const cape = (u, v) => {
    const th = u * TAU, sv = Math.min(v / 0.9, 1), lip = Math.max(0, (v - 0.9) / 0.1);
    const hem = capeHem(th);
    let y = CAPE_TOP - (CAPE_TOP - hem) * (0.25 * sv + 0.75 * sv * sv);
    const d = 0.03 * sv * sv * crease(9 * th + ph[1]) + 0.015 * sv * Math.sin(4 * th + ph[3]);
    let k = 1;
    if (lip > 0) { k = 1 - 0.1 * lip; y += 0.05 * Math.sin(lip * Math.PI / 2); }
    return [((capeRX(sv) * wk + d) * k) * Math.cos(th) + 0.02, y, ((capeRZ(sv) * wk + d) * k) * Math.sin(th)];
  };
  b.surface(cape, CAPE_SEG[0], CAPE_SEG[1], {
    part: PART.HEAD,
    aux: (u, v) => [v > 0.9 ? 0.85 : clamp01(-crease(9 * u * TAU + ph[1])) * 0.3 * v, 0, 0.12 * v, u * TAU],
  });

  // 兜帽：以 -x 為軸的球座標；開口高於寬、頂緣前探遮住臉，下緣垂落到肩上並向兩側展開
  const hoodAt = (u, v) => {
    const be = u * TAU, cb = Math.cos(be);
    const a0 = 0.7 + 0.1 * Math.cos(2 * be) + 0.12 * Math.max(0, -cb); // 開口半角（上下較大、下緣最大）
    const al = spline(HOOD_V, [2.7, 1.7, a0 + 0.1, a0 - 0.03, a0 + 0.06, a0 + 0.45, 2.2, Math.PI])(v);
    const k = HOOD_K(v) * hk;
    const dx = -Math.cos(al), dy = Math.sin(al) * cb, dz = Math.sin(al) * Math.sin(be);
    const p = [HOOD_C[0] + HOOD_R[0] * dx * k, HOOD_C[1] + HOOD_R[1] * dy * k, HOOD_C[2] + HOOD_R[2] * dz * k];
    if (dy < 0) { const d = -dy; p[1] -= 0.22 * d * d * k; p[2] *= 1 + 0.4 * d * d; p[0] += 0.06 * d * Math.max(dx, 0); }
    p[0] -= 0.07 * Math.max(0, dy) * smooth(1.5, 0.6, al);                 // 帽簷前探
    const pk = Math.exp(-(Math.pow(dx - 0.45, 2) + Math.pow(dy - 0.89, 2) + dz * dz) / 0.12); // 後頂的尖
    p[0] += 0.07 * pk * k; p[1] += 0.1 * pk * k;
    const wr = 0.012 * crease(5 * be + ph[2]) * smooth(0.5, 0.8, v);         // 側面軟褶
    p[2] += wr * dz * 1.5;
    return p;
  };
  b.surface(hoodAt, HOOD_SEG[0], HOOD_SEG[1], {
    part: PART.HEAD,
    aux: (u, v, p) => [v < 0.42 ? 0.95 - 0.55 * smooth(0.15, 0.42, v) : 0, smooth(3.1, 3.45, p[1]), 0, 0],
  });

  // 臉：凹在兜帽陰影裡，只留鼻尖、顴骨與下巴被十字架微微照到
  const faceFn = (u, v) => {
    const th = u * TAU, phv = v * Math.PI, s = Math.sin(phv);
    const nose = 0.22 * Math.exp(-(Math.pow(Math.atan2(Math.sin(th - Math.PI), Math.cos(th - Math.PI)), 2) / 0.06 + Math.pow(phv - 1.62, 2) / 0.04));
    const chin = 0.08 * Math.exp(-(Math.pow(Math.atan2(Math.sin(th - Math.PI), Math.cos(th - Math.PI)), 2) / 0.4 + Math.pow(phv - 0.55, 2) / 0.08));
    const k = 1 + nose + chin;
    return [FACE_C[0] + FACE_R[0] * s * Math.cos(th) * k, FACE_C[1] - FACE_R[1] * Math.cos(phv), FACE_C[2] + FACE_R[2] * s * Math.sin(th) * k];
  };
  b.surface(faceFn, 8, 6, {
    part: PART.SKIN, center: () => FACE_C,
    aux: (u, v) => [0.78 + 0.2 * smooth(0.45, 0.8, v), 1, 0, 0], // 臉在兜帽陰影裡；上半臉被帽簷遮得更暗
  });

  // 寬袖與手：每側一條漸寬下垂的袖管（袖口內翻），手為扁橢球；pose2 = 舉手張掌
  const sleeveR = (t) => 0.125 + 0.015 * t + 0.1 * smooth(0.5, 1, t);
  for (const side of [-1, 1]) {
    const A = armPose(side, false), R = armPose(side, true);
    const ref = [0, 0, side];
    const sleeveA = tube(bez(A.S, A.E, A.W), sleeveR, { ref, sag: 0.9, cuff: true });
    // 舉手時袖口不外張（布料順著前臂垂落），手腕從袖口伸出
    const sleeveB = tube(bez(R.S, R.E, R.W), (t) => 0.125 + 0.035 * t, { ref, sag: 0.9, cuff: true, cuffDepth: 0.1 });
    b.surface(sleeveA, SLEEVE_SEG[0], SLEEVE_SEG[1], {
      part: PART.ARM, pose2: sleeveB,
      aux: (u, v) => [v > 0.86 ? 0.7 : 0.1, 0, 0.12, u * TAU],
    });
    const hA = handFrame(side, false, A), hB = handFrame(side, true, R);
    const handOf = (h) => ellipsoid(h.C, mul(h.W, h.lw), mul(h.F, h.lf), mul(h.Th, h.lt));
    b.surface(handOf(hA), HAND_SEG[0], HAND_SEG[1], {
      part: PART.SKIN, pose2: handOf(hB), center: () => hA.C, center2: () => hB.C,
      aux: () => [0.25, 0, 0, 0],
    });
    // 拇指：合掌時貼在雙手前緣，舉手時張向頭部一側，讓張開的手掌輪廓可辨
    const thumbOf = (h, dir, base) => {
      const c = add(add(h.C, mul(h.F, base)), mul(dir, 0.06));
      const ax = norm(add(mul(h.F, 0.55), dir)), side2 = norm(cross(ax, h.Th));
      return ellipsoid(add(c, mul(ax, 0.02)), mul(side2, 0.03), mul(ax, 0.075), mul(h.Th, 0.028));
    };
    const inner = norm(sub([0, 0, 0], mul(hB.W, Math.sign(dot(hB.W, [0, 0, side])) || 1)));
    b.surface(thumbOf(hA, mul(hA.Th, -0.4), -0.06), 5, 4, {
      part: PART.SKIN, pose2: thumbOf(hB, [inner[0] * 0.3, 0, inner[2]], -0.08),
      center: () => hA.C, center2: () => hB.C, aux: () => [0.3, 0, 0, 0],
    });
  }
  return b;
}

// 拉丁十字架：高 10、橫梁寬 6 於高度約 7，底座數層
export function buildCross() {
  const b = new Builder();
  b.box(0, 0.2, 0, 2.6, 0.4, 2.6, PART.BODY);
  b.box(0, 0.6, 0, 2.0, 0.4, 2.0, PART.BODY);
  b.box(0, 1.0, 0, 1.4, 0.4, 1.4, PART.BODY);
  b.box(0, 5.5, 0, 0.6, 9.0, 0.6, PART.EMISSIVE);   // 直柱 y 1.0 ~ 10
  b.box(0, 7.0, 0, 0.5, 0.6, 6.0, PART.EMISSIVE);   // 橫梁
  return b;
}

// 裝飾模組：w 為切線方向槽寬；以 rng 取代 Math.random
export function buildDecor(kind, w, rng) {
  const b = new Builder();
  const r = (lo, hi) => lo + (hi - lo) * rng();
  const bw = w * 0.9; // 模組實際寬度，留縫
  switch (kind) {
    case 'fin': { // 薄而高的片
      const h = r(2.5, 5), d = r(0.2, 0.5);
      b.box(0, h / 2, 0, d, h, bw * r(0.4, 0.8));
      b.box(0, 0.15, 0, d * 2.2, 0.3, bw * 0.9);
      break;
    }
    case 'comb': { // 底梁上排列齒
      const teeth = 3 + Math.floor(rng() * 4), th = r(1.2, 3);
      b.box(0, 0.15, 0, r(0.5, 1), 0.3, bw);
      const tw = bw / (teeth * 2 - 1);
      for (let i = 0; i < teeth; i++) b.box(0, 0.3 + th * (0.5 + 0.5 * rng()) / 2, -bw / 2 + tw / 2 + i * tw * 2, r(0.3, 0.6), th * (0.5 + 0.5 * rng()), tw);
      break;
    }
    case 'arch': { // 兩柱加楣
      const h = r(2, 4), pw = bw * r(0.12, 0.2), d = r(0.4, 0.9);
      b.box(0, h / 2, -bw / 2 + pw / 2, d, h, pw);
      b.box(0, h / 2, bw / 2 - pw / 2, d, h, pw);
      b.box(0, h + 0.2, 0, d * 1.2, 0.4, bw);
      break;
    }
    case 'tower': { // 向上收窄的疊塔
      const tiers = 3 + Math.floor(rng() * 3);
      let y = 0, ww = bw * r(0.7, 1), dd = r(0.8, 1.4);
      for (let i = 0; i < tiers; i++) {
        const h = r(0.6, 1.4);
        b.box(0, y + h / 2, 0, dd, h, ww);
        y += h; ww *= r(0.6, 0.85); dd *= r(0.6, 0.85);
      }
      break;
    }
    case 'lattice': { // 框內縱橫格
      const h = r(2, 3.5), bar = 0.16, d = r(0.3, 0.6), cols = 2 + Math.floor(rng() * 3), rows = 2 + Math.floor(rng() * 3);
      for (let i = 0; i <= cols; i++) b.box(0, h / 2, -bw / 2 + bar / 2 + i * (bw - bar) / cols, d, h, bar);
      for (let j = 0; j <= rows; j++) b.box(0, bar / 2 + j * (h - bar) / rows, 0, d, bar, bw);
      break;
    }
    default: throw new Error(`unknown decor kind: ${kind}`);
  }
  return b;
}

// 環配置常數
const DISCIPLE_RINGS = [ // [半徑, 人數, 自轉速度（弧度／秒）]
  [6.5, 3, 0.10], [10, 4, 0.07], [13.5, 5, 0.045],
];
const DECOR_Y = [2, 24];      // 裝飾環高度範圍（由低到高）
const DECOR_R = [20, 7];      // 裝飾環半徑範圍（向上收窄）
const DECOR_W_TARGET = 2.4;   // 裝飾模組槽寬目標
const DECOR_PALETTE = [[0.25, 0.06, 0.07], [0.45, 0.07, 0.1], [0.7, 0.64, 0.5]]; // 暗赭／暗紅／骨色
const DECOR_DIM = [1, 0.55, 0.4]; // 各色亮度（骨色壓得最暗）

export function planRings({ seed = 1, decorCount = 12 } = {}) {
  const rng = mulberry32(seed);
  const rings = [];
  DISCIPLE_RINGS.forEach(([R, N, spin], i) => {
    rings.push({
      id: `disciple-${i}`, role: 'disciple', kind: 'disciple', R, y: 0, N,
      w: TAU * R / N, spinSpeed: spin, dir: i % 2 === 0 ? 1 : -1,
      phase: rng() * TAU, color: [0.05, 0.045, 0.05], variantSeed: Math.floor(rng() * 1e6),
    });
  });
  const kindOffset = Math.floor(rng() * DECOR_KINDS.length);
  for (let i = 0; i < decorCount; i++) {
    const t = decorCount > 1 ? i / (decorCount - 1) : 0;
    const R = DECOR_R[0] + (DECOR_R[1] - DECOR_R[0]) * t;
    const N = Math.max(8, Math.round(TAU * R / DECOR_W_TARGET / 4) * 4);
    const pi = Math.floor(rng() * DECOR_PALETTE.length);
    const k = DECOR_DIM[pi] * (0.8 + 0.2 * rng());
    rings.push({
      id: `decor-${i}`, role: 'decor', kind: DECOR_KINDS[(i + kindOffset) % DECOR_KINDS.length],
      R, y: DECOR_Y[0] + (DECOR_Y[1] - DECOR_Y[0]) * t, N, w: TAU * R / N,
      spinSpeed: 0.02 + 0.03 * rng(), dir: i % 2 === 0 ? 1 : -1,
      phase: rng() * TAU, color: DECOR_PALETTE[pi].map(c => Math.min(1, c * k)),
      variantSeed: Math.floor(rng() * 1e6),
    });
  }
  const cross = { height: 10, beamWidth: 6, beamY: 7, glow: [1.0, 0.82, 0.45] };
  return { cross, rings };
}

export function buildRingGeometry(ring, rng) {
  const b = ring.role === 'disciple'
    ? buildDisciple({ variant: ring.variantSeed % 3 })
    : buildDecor(ring.kind, ring.w, rng);
  const instances = new Float32Array(ring.N * 2);
  for (let i = 0; i < ring.N; i++) { instances[i * 2] = i; instances[i * 2 + 1] = rng(); }
  return { ...b.toArrays(), instances };
}
