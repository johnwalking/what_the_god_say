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

// 門徒比例（單位：與十字架高 10 成比例，身高約 4.3）
const ROBE_LAYERS = [           // [y 底, 高, x 深, z 寬]，下寬上窄（五層）
  [0.00, 0.70, 1.55, 1.95],     // 袍襬
  [0.70, 0.70, 1.30, 1.60],
  [1.40, 0.70, 1.12, 1.35],
  [2.10, 0.70, 1.00, 1.15],
  [2.80, 0.30, 0.92, 1.05],     // 胸
];
const SHOULDER_BOX = [2.95, 0.35, 0.85, 1.40]; // 略凸的肩線 [y 底, 高, x 深, z 寬]
const HEAD_SIZE = 0.5;          // 頭方塊邊長（被兜帽包住、凹在罩內）
const HOOD_SIZE = [1.0, 0.9, 0.95]; // 兜帽主體 x/y/z（比頭大）
const HOOD_Y = 3.7;           // 兜帽中心高度
const COWL_DEPTH = 0.4;         // 深色兜帽罩向前（-x）突出的長度

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

// 兜帽長袍人形：高約 4.3，面朝 -x，腳底中央為原點
export function buildDisciple(opts = {}) {
  const variant = ((opts.variant ?? 0) % 3 + 3) % 3;
  const wk = 1 + 0.07 * variant;       // 長袍寬度係數
  const hk = 1 + 0.06 * (variant - 1); // 兜帽大小係數
  const b = new Builder();

  // 長袍：疊放方塊，下寬上窄
  for (const [y, h, dx, dz] of ROBE_LAYERS) b.box(0.05, y + h / 2, 0, dx * wk, h, dz * wk, PART.BODY);
  // 後擺（長袍後方較長的垂墜，讓側影下寬）
  b.box(0.55 * wk, 0.9, 0, 0.5, 1.8, 1.3 * wk, PART.BODY);
  // 肩線
  const [sy, sh, sdx, sdz] = SHOULDER_BOX;
  b.box(0.08, sy + sh / 2, 0, sdx, sh, sdz * wk, PART.BODY);
  // 頸（被兜帽遮住，僅填縫）
  b.box(0.05, 3.5, 0, 0.5, 0.2, 0.55, PART.BODY);

  // 兜帽：凹陷的頭 + 較大的兜帽主體 + 向前突出的深色罩 + 後傾的階梯尖頂 + 披肩領與背後垂尾
  const [hx, hy, hz] = HOOD_SIZE;
  const top = HOOD_Y + hy * hk / 2;
  b.box(0.02, HOOD_Y - 0.05, 0, HEAD_SIZE, HEAD_SIZE, HEAD_SIZE, PART.HEAD);
  b.box(0.12, HOOD_Y, 0, hx * hk, hy * hk, hz * hk, PART.HEAD);
  b.box(0.12 - hx * hk / 2 - COWL_DEPTH / 2 + 0.12, HOOD_Y - 0.08, 0, COWL_DEPTH, hy * hk * 0.8, hz * hk * 0.86, PART.HEAD);
  b.box(0.22, top + 0.08, 0, hx * hk * 0.7, 0.16, hz * hk * 0.7, PART.HEAD);
  b.box(0.32, top + 0.2, 0, hx * hk * 0.4, 0.12, hz * hk * 0.4, PART.HEAD);
  b.box(0.1, 3.33, 0, 1.15, 0.3, 1.25 * wk, PART.HEAD);
  b.box(0.52, HOOD_Y - 0.6 * hk, 0, 0.4, 1.0, 0.8 * hz * hk, PART.HEAD);

  // 雙臂：寬袖上臂自肩下垂，前臂向前向內，雙手於胸前相合
  for (const side of [-1, 1]) {
    b.box(-0.1, 2.65, side * 0.74 * wk, 0.38, 1.0, 0.4, PART.ARM);        // 上臂（袖）
    b.box(-0.58, 2.3, side * 0.3, 0.9, 0.3, 0.32, PART.ARM);                 // 前臂（朝 -x，漸向中線）
  }
  b.box(-1.08, 2.3, 0, 0.2, 0.32, 0.3, PART.ARM);                            // 相合的雙手
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
