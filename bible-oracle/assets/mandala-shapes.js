// 曼陀羅場景的幾何純函式：方塊建構器、兜帽門徒、十字架、裝飾模組、環配置。
// 局部座標：+x 徑向向外、+y 向上、+z 切線方向；門徒面朝 -x（面向中心）。無 DOM、無全域副作用。
import { mulberry32 } from './mandala-math.js';

// 部位代碼（每頂點一個值，供 shader 判斷動畫與發光）
export const PART = Object.freeze({ BODY: 0, HEAD: 1, ARM: 2, EMISSIVE: 3 });
export const DECOR_KINDS = Object.freeze(['fin', 'comb', 'arch', 'tower', 'lattice']);

// 門徒的 shader 樞軸（局部座標）
export const SHOULDER = Object.freeze([0, 3.1, 0]); // 手臂繞此點擺動
export const HIP = Object.freeze([0, 1.6, 0]);      // 頭與上身前傾（鞠躬）的樞軸

const TAU = Math.PI * 2;

// 門徒比例（單位：與十字架高 10 成比例，身高約 4.4）。方塊以 [x0,x1, y0,y1, 半寬 z] 表示（z 對稱）
// 剪影：斗篷呈錐形（袍襬遠寬於肩）→ 斜披肩 → 圓兜帽；以多層小級差方塊近似錐面
const CLOAK_LAYERS = 10;         // 斗篷層數
const CLOAK_TOP = 3.16;          // 斗篷頂（肩）高度
const CLOAK_HEM = [-0.78, 0.84, 1.04]; // 袍襬 [前 x, 後 x, 半寬 z]
const CLOAK_SHOULDER = [-0.36, 0.44, 0.64]; // 肩 [前 x, 後 x, 半寬 z]
const MANTLE = [-0.34, 0.42, 3.1, 3.42, 0.5]; // 斜披肩（肩到兜帽的過渡）
const BACK_DRAPE = [0.40, 0.62, 1.60, 3.10, 0.46]; // 背後垂墜
const HOOD_Y = 3.32;            // 兜帽底緣高度
const HOOD_H = 1.0;             // 兜帽高度
const HOOD_HALF_W = 0.42;       // 兜帽半寬（z）
const FACE_RECESS = 0.24;       // 臉凹在兜帽開口內的深度（shader 將臉面塗黑）

export class Builder {
  constructor() {
    this.positions = []; this.normals = []; this.parts = [];
    this.o = [0, 0, 0]; // 位移
    this.s = 1;         // 縮放
  }
  get count() { return this.parts.length; }

  // 軸對齊方塊：6 面 × 2 三角形，逆時針繞向對應面法線
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
        for (const i of [0, 1, 2, 0, 2, 3]) {
          const p = quad[i];
          this.positions.push(p[0] * this.s + this.o[0], p[1] * this.s + this.o[1], p[2] * this.s + this.o[2]);
          this.normals.push(n[0], n[1], n[2]);
          this.parts.push(part);
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
    };
  }
}

// 兜帽長袍人形：高約 4.4，面朝 -x，腳底中央為原點。
// 剪影重點：錐形斗篷（袍襬遠寬於肩）、斜披肩、比頭大的圓兜帽、凹陷塗黑的臉、袖中合攏於胸前的雙手。
export function buildDisciple(opts = {}) {
  const variant = ((opts.variant ?? 0) % 3 + 3) % 3;
  const wk = 1 + 0.06 * variant;       // 長袍寬度係數
  const hk = 1 + 0.05 * (variant - 1); // 兜帽大小係數
  const b = new Builder();
  const ext = (x0, x1, y0, y1, hz, part, cz = 0) => b.box((x0 + x1) / 2, (y0 + y1) / 2, cz, x1 - x0, y1 - y0, hz * 2, part);

  // 長袍與背後垂墜（BODY）
  for (let i = 0; i < CLOAK_LAYERS; i++) {
    const t = i / (CLOAK_LAYERS - 1), ya = CLOAK_TOP * i / CLOAK_LAYERS, yb = CLOAK_TOP * (i + 1) / CLOAK_LAYERS;
    const L = (k) => CLOAK_HEM[k] + (CLOAK_SHOULDER[k] - CLOAK_HEM[k]) * t;
    ext(L(0) * wk, L(1) * wk, ya, yb, L(2) * wk, PART.BODY);
  }
  ext(MANTLE[0], MANTLE[1], MANTLE[2], MANTLE[3], MANTLE[4] * wk, PART.BODY);
  ext(BACK_DRAPE[0] * wk, BACK_DRAPE[1] * wk, BACK_DRAPE[2], BACK_DRAPE[3], BACK_DRAPE[4] * wk, PART.BODY);

  // 兜帽（HEAD）：後殼、頂蓋（兩級，讓頂部圓）、兩側罩片、前緣帽簷、垂到背上的帽尾；臉凹在開口內
  const y0 = HOOD_Y, y1 = HOOD_Y + HOOD_H * hk, hw = HOOD_HALF_W * hk, front = -0.5 * hk;
  ext(front + FACE_RECESS, 0.1, y0 + 0.1, y1 - 0.3, hw - 0.1, PART.HEAD);    // 臉（凹）
  ext(-0.08, 0.5 * hk, y0, y1 - 0.12, hw, PART.HEAD);                         // 後殼
  ext(front + 0.04, 0.42 * hk, y1 - 0.3, y1 - 0.08, hw - 0.03, PART.HEAD);    // 頂蓋
  ext(front + 0.14, 0.3 * hk, y1 - 0.1, y1, hw - 0.14, PART.HEAD);            // 頂蓋上層（收圓）
  for (const side of [-1, 1]) ext(front, 0.0, y0 + 0.02, y1 - 0.24, 0.07, PART.HEAD, side * (hw - 0.07)); // 側罩
  ext(front - 0.05, front + 0.1, y1 - 0.34, y1 - 0.14, hw - 0.04, PART.HEAD); // 帽簷
  ext(0.4 * hk, 0.64 * hk, 2.9, y0 + 0.5, 0.3 * hk, PART.HEAD);               // 帽尾

  // 雙臂（ARM）：寬袖自肩下垂，前臂向前向內，袖口合攏於胸前，雙手藏在袖中
  for (const side of [-1, 1]) {
    ext(-0.34, 0.14, 2.2, 3.12, 0.17, PART.ARM, side * 0.68 * wk); // 上臂（垂袖）
    ext(-0.86, -0.3, 2.18, 2.62, 0.19, PART.ARM, side * 0.44 * wk); // 前臂（袖）
    ext(-1.04, -0.78, 2.1, 2.7, 0.2, PART.ARM, side * 0.22);        // 喇叭袖口
    ext(-1.1, -0.98, 2.24, 2.52, 0.06, PART.ARM, side * 0.08);      // 手（左右各一，合於中線；shader 依 z 正負分左右臂）
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
