// WebGL2 曼陀羅漏斗：中央發光十字架、三圈兜帽門徒、向上收窄的裝飾環穹頂。
// 渲染：場景 pass（每圈一次 instanced draw）→ FBO（color／normal+自發光旗標／depth 紋理）
//       → 後製 pass（輪廓線、SSAO、霧、十字架光暈與光柱、暗角）→ 螢幕。
// 零依賴；import 時不存取 window／document；熱路徑重用預先配置的陣列。
import {
  clamp, mulberry32, mat4Perspective, mat4LookAt, mat4Multiply, mat4TransformPoint,
  orbitEye, createOrbit, stepOrbit, ORBIT_DEFAULTS,
} from './mandala-math.js';
import { Builder, PART, HIP, NECK, buildCross, planRings, buildRingGeometry } from './mandala-shapes.js';

// ── 可調常數 ────────────────────────────────────────────────
const CAM_TARGET = [0, 6.2, 0];          // 相機注視點（十字架中段略上）
const CAM_MIN_EYE_Y = 1.2;               // 相機高度下限（不鑽到地板下）
const FOV_Y = 0.80;                      // 垂直視角（弧度，橫向畫面）
const FOV_H_MIN = 0.95;                  // 直向手機時保留的最小水平視角（弧度）
const FOV_Y_MAX = 1.25;                  // 直向時垂直視角上限
const NEAR = 0.5, FAR = 220;             // 投影近／遠平面
const DPR_MOBILE = 1.5, DPR_DESKTOP = 2; // devicePixelRatio 上限（寬 ≥ 900px 視為桌面）

const LIGHT_POS = [0, 7.6, 0];           // 十字架點光位置（橫梁交會處）
const LIGHT_COLOR = [1.0, 0.74, 0.42];   // 點光顏色（暖金）
const LIGHT_STRENGTH = 14.0;             // 點光強度（再乘以狀態 glow）
const LIGHT_FALLOFF = 0.012;             // 距離平方衰減係數
const AMBIENT_SKY = [0.030, 0.026, 0.030];   // 上方環境光（極低）
const HEAVEN_COLOR = [0.55, 0.5, 0.48];  // 自穹頂向下的微弱頂光（讓兜帽與肩的頂面可辨）
const AMBIENT_GROUND = [0.012, 0.006, 0.006];// 下方環境光（暗紅反光）
const CROSS_EMISSIVE = [1.0, 0.82, 0.45];// 十字架自發光色
// 門徒長袍色（每位依實例亂數取一：炭黑／暗赭褐／灰燼／褪色牛血紅；皆暗而去飽和）
const ROBE_TINTS = [[0.085, 0.08, 0.078], [0.11, 0.08, 0.058], [0.13, 0.125, 0.118], [0.12, 0.06, 0.055]];
const HOOD_SHADE = 0.82;                 // 兜帽與披肩相對長袍的明度
const SKIN_COLOR = [0.17, 0.115, 0.085]; // 臉與手（多半藏在陰影裡）
const ROPE_COLOR = [0.15, 0.12, 0.085];  // 腰繩（麻色，壓暗）
const CLOTH_WRAP = 0.55;                 // 布料包覆光（half-Lambert 類）的包覆量
const CLOTH_RIM = 0.1;                   // 面向十字架一側的暖色邊緣光強度
const CLOTH_SHEEN = 0.35;                // 布料掠角光澤
const CLOTH_BOUNCE = 0.03;               // 地面光池反射到袍子上的暖色補光（乘以 glow）
const CLOTH_AMB = 3.0;                   // 環境光倍率
const CLOTH_HEAVEN = 0.35;               // 頂光倍率
const CAVITY = 0.88;                     // 布褶谷底、兜帽內、袖內的壓暗量
const CONTACT_MIN = 0.4, CONTACT_H = 0.8;// 袍腳接地處的壓暗（最暗倍率、漸層高度）
const SHADOW_LEN = 1.2;                  // 門徒在地面上的長影長度（乘以門徒到十字架的距離）
const SHADOW_STRENGTH = 0.75;            // 長影遮去十字架直射光的比例
const FLOOR_CONTACT = 0.6;               // 門徒腳下的接觸陰影強度
const POOL_STRENGTH = 0.05, POOL_R = 9;  // 十字架下方地面的暖色光池（強度乘以 glow、半徑）
const FLOOR_COLOR = [0.045, 0.036, 0.034];// 地面石色
const FLOOR_RING_COLOR = [0.42, 0.32, 0.14]; // 地面刻紋（門徒環）的暗金
const BASE_COLOR = [0.09, 0.07, 0.05];   // 十字架底座

const OUTLINE_PX = 1.15;                 // 輪廓取樣偏移（CSS 像素，乘以 dpr）
const OUTLINE_STRENGTH = 0.8;            // 輪廓強度（剪影）
const CREASE_STRENGTH = 0.45;            // 折角（同物體內法線變化）線相對剪影的強度
const DECOR_LINE = 0.55;                 // 裝飾環輪廓線相對強度
const DECOR_DIM = 0.7;                   // 裝飾環顏色亮度倍率
const DECOR_LIGHT = 0.4;                 // 裝飾環受十字架點光的比例（避免高 glow 時整圈過曝）
const DISCIPLE_CREASE = 0.0;             // 門徒身上折角線相對強度（平滑布料不描折角）
const DISCIPLE_LINE = 0.3;               // 門徒剪影線相對強度（細而淡，避免方塊感的硬邊）
const OUTLINE_COLOR = [0.72, 0.58, 0.25];// 輪廓金色
const OUTLINE_DEPTH_K = 18.0;            // 深度不連續的敏感度
const OUTLINE_NORMAL_K = 1.6;            // 法線不連續的敏感度
const AO_RADIUS = 0.9;                   // SSAO 取樣半徑（世界單位）
const AO_STRENGTH = 0.55;                // SSAO 壓暗強度
const FOG_START = 26;                    // 霧起始距離
const FOG_DENSITY = 0.028;               // 霧濃度（指數）
const FOG_COLOR = [0.030, 0.016, 0.016]; // 霧色（暗紅褐）
const BG_TOP = [0.020, 0.016, 0.012];    // 背景頂部（#050403 附近）
const BG_BOTTOM = [0.051, 0.020, 0.024]; // 背景底部（#0d0506 附近）
const VIGNETTE = 0.62;                   // 暗角強度
const HALO_STRENGTH = 0.8;               // 十字架光暈強度（乘以 glow）
const SHAFT_STRENGTH = 0.22;             // 自穹頂落下的光柱強度（乘以 glow）
const CUTAWAY_COS = 0.42;                // 面向相機那側的裝飾環剖開範圍（cos 角；模組在其內縮小消失）
const CUTAWAY_SOFT = 0.22;               // 剖開邊緣的縮放過渡寬度
const SHAFT_EL = [0.45, 0.9];            // 相機仰角在此區間內光柱淡出（俯視時螢幕上的垂直光柱不合理）
const DECOR_COUNT = 12;                  // 裝飾環數
const DECOR_SCALE_JITTER = 0.45;         // 裝飾模組高度隨機變化幅度

const BOW_ANGLE = 0.62;                  // 鞠躬時上身前傾角（弧度）
const BOW_NOD = 0.3;                     // 鞠躬時兜帽額外低頭角（弧度）
const RAISE_LOOK_UP = 0.35;              // 舉手時抬頭角（弧度）
const IDLE_LEAN = 0.1;                   // 平時頭與上身的微微前傾（弧度）
const IDLE_NOD = 0.12;                   // 平時兜帽的低頭角（弧度）
const POSTURE_JITTER = 0.1;              // 每位門徒前傾角的隨機差（弧度）
const HEAD_JITTER = 0.3;                 // 每位門徒點頭／歪頭的隨機差（弧度）
const HEIGHT_JITTER = 0.08;              // 身高 ±8%
const GIRTH_JITTER = 0.05;               // 胖瘦 ±5%
const BREATH_AMP = 0.014;                // 呼吸起伏幅度
const POSE_RATE = 2.0;                   // 姿勢過渡速率（每秒指數）
const SPEED_RATE = 1.2;                  // 環轉速過渡速率
const GLOW_RATE = 1.8;                   // 光強過渡速率
const PULSE_DECAY = 2.4;                 // pulse 閃光衰減速率
const PULSE_AMOUNT = 0.9;                // pulse 閃光疊加量
const MAX_DT = 0.1;                      // 單幀時間上限（秒）

// 狀態 → 目標值：sceneSpeed（環轉速倍率）、glow、bow、raise、breath
const STATES = Object.freeze({
  idle:  { speed: 1.0,  glow: 0.6,  bow: 0,   raise: 0, breath: 1 },
  bow:   { speed: 0.25, glow: 0.45, bow: 1,   raise: 0, breath: 0.6 },
  raise: { speed: 1.8,  glow: 1.4,  bow: 0,   raise: 1, breath: 1 },
  still: { speed: 0,    glow: 0.25, bow: 0.7, raise: 0, breath: 0 },
});

function smoothstep(a, b, x) { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }

const KIND_DECOR = 0, KIND_DISCIPLE = 1;

// ── Shaders ─────────────────────────────────────────────────
// 場景 shader 以 PASS 巨集編成三支程式（0 裝飾環、1 門徒、2 十字架與地面）：
// 軟體光柵（SwiftShader 等）會對每個片段執行所有分支，分開編譯可避免為裝飾環付出布料與地面陰影的成本。
const PASS_DECOR = 0, PASS_DISCIPLE = 1, PASS_CROSS = 2;
const g3 = (v) => `vec3(${v.map(x => x.toFixed(4)).join(',')})`;
const withPass = (src, pass) => src.replace('#version 300 es\n', `#version 300 es\n#define PASS ${pass}\n`);
const SCENE_VS = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNor;
layout(location=2) in float aPart;
layout(location=3) in vec2 aInst;      // [slot, random]
layout(location=4) in vec3 aPos2;      // 舉手姿勢的變形目標
layout(location=5) in vec3 aNor2;
layout(location=6) in vec4 aAux;       // 凹處遮蔽、頭部權重、細褶振幅、細褶相位
uniform mat4 uViewProj;
uniform vec4 uRing;                    // R, y, spin, N
uniform vec4 uPose;                    // bow, raise, time, breath
uniform vec3 uNeck, uHip;
uniform vec2 uCut;                     // 相機水平方向（剖開方向）
uniform vec3 uCutParams;               // cos 閾值, 過渡寬度, 高度隨機幅度
uniform vec3 uColor;
uniform vec3 uTints[4];                // 門徒袍色
out vec3 vNor;
out vec3 vWorld;
flat out float vPart;
flat out vec3 vAlbedo;
#if PASS == 1
out vec4 vAux;                         // 凹處遮蔽、局部高度、細褶振幅、細褶相位
#endif

mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }

void main() {
  vec3 p = aPos, n = aNor;
  float rnd = aInst.y;
  float scale = 1.0;
  vec3 albedo = uColor;
#if PASS == 1
  float r2 = fract(rnd * 7.31 + 0.13), r3 = fract(rnd * 13.7 + 0.71);
  // 舉手：合掌姿勢與舉手張掌姿勢之間平滑變形（只有袖與手的兩組位置不同）
  p = mix(aPos, aPos2, uPose.y);
  n = mix(aNor, aNor2, uPose.y);
  // 兜帽點頭／歪頭：以頭部權重平滑混合，兜帽垂到肩上的部分不動，不會撕裂
  float hw = aAux.y;
  float nod = (${IDLE_NOD.toFixed(3)} + (r2 - 0.5) * ${HEAD_JITTER.toFixed(3)} + uPose.x * ${BOW_NOD.toFixed(3)} - uPose.y * ${RAISE_LOOK_UP.toFixed(3)}) * hw;
  float tilt = (r3 - 0.5) * ${HEAD_JITTER.toFixed(3)} * (1.0 - 0.6 * uPose.y) * hw;
  p.xy = uNeck.xy + rot(nod) * (p.xy - uNeck.xy);
  n.xy = rot(nod) * n.xy;
  p.zy = uNeck.zy + rot(tilt) * (p.zy - uNeck.zy);
  n.zy = rot(tilt) * n.zy;
  // 上身繞髖前傾（鞠躬）；權重沿高度平滑
  float w = smoothstep(uHip.y - 0.4, uHip.y + 1.4, p.y);
  float lean = (${IDLE_LEAN.toFixed(3)} + uPose.x * ${BOW_ANGLE.toFixed(3)} - uPose.y * 0.22 + (rnd - 0.5) * ${POSTURE_JITTER.toFixed(3)}) * w;
  p.xy = uHip.xy + rot(lean) * (p.xy - uHip.xy);
  n.xy = rot(lean) * n.xy;
  p.y *= 1.0 + uPose.w * ${BREATH_AMP.toFixed(4)} * sin(uPose.z * 1.1 + rnd * 6.2832) * w;
  // 每位的身高與胖瘦
  p.y *= 1.0 + (rnd * 2.0 - 1.0) * ${HEIGHT_JITTER.toFixed(3)};
  p.xz *= 1.0 + (r2 * 2.0 - 1.0) * ${GIRTH_JITTER.toFixed(3)};
  int ti = int(floor(fract(rnd * 3.71 + aInst.x * 0.29 + uRing.x * 0.173) * 4.0));
  albedo = uTints[ti] * (0.9 + 0.2 * r3);
  vAux = vec4(aAux.x, aPos.y, aAux.z, aAux.w);
#elif PASS == 0
  p.y *= 1.0 - uCutParams.z * 0.5 + uCutParams.z * rnd;
#endif
  float th = uRing.z + 6.2831853 * aInst.x / uRing.w;
  float c = cos(th), s = sin(th);
#if PASS == 0
  // 面向相機那側的裝飾模組縮小消失（剖面），讓十字架與門徒不被遮住
  float facing = dot(vec2(c, s), uCut);
  scale *= smoothstep(uCutParams.x + uCutParams.y, uCutParams.x, facing);
#endif
  p *= scale;
  vec3 wp = vec3(uRing.x * c + p.x * c - p.z * s, uRing.y + p.y, uRing.x * s + p.x * s + p.z * c);
  vNor = vec3(n.x * c - n.z * s, n.y, n.x * s + n.z * c);
  vWorld = wp;
  vPart = aPart;
  vAlbedo = albedo;
  gl_Position = uViewProj * vec4(wp, 1.0);
}`;

const SCENE_FS = `#version 300 es
precision highp float;
in vec3 vNor;
in vec3 vWorld;
flat in float vPart;
flat in vec3 vAlbedo;
#if PASS == 1
in vec4 vAux;
#endif
uniform vec3 uBaseColor, uEye;
uniform vec3 uLightPos, uLightColor;
uniform float uLightStrength, uGlow;
uniform vec3 uAmbSky, uAmbGround, uEmissive, uHeaven;
uniform vec3 uFloorColor, uFloorRing;
uniform vec3 uDiscipleR;               // 三圈門徒半徑（地面刻紋）
uniform vec3 uDiscRing[3];             // 三圈門徒 (半徑, 自轉角, 人數)：每圈只取角度最近的一位算長影
uniform int uDiscRingN;
layout(location=0) out vec4 oColor;
layout(location=1) out vec4 oNormal;

void main() {
  vec3 n = normalize(vNor);
  vec3 albedo = vAlbedo;
  vec3 L = uLightPos - vWorld;
  float d = length(L);
  L /= d;
  float att = uLightStrength / (1.0 + ${LIGHT_FALLOFF} * d * d);
  vec3 col;
  float flag;                          // a：1 自發光、0.5 地面、0.25 裝飾環、0.125 十字架底座、0 門徒
#if PASS == 1
  // 布料：包覆光 + 面向十字架的暖色邊緣光 + 掠角光澤 + 凹處與接地壓暗
  if (vPart > 0.5 && vPart < 1.5) albedo *= ${HOOD_SHADE.toFixed(3)};
  else if (vPart > 3.5 && vPart < 4.5) albedo = ${g3(SKIN_COLOR)};
  else if (vPart > 4.5) albedo = ${g3(ROPE_COLOR)};
  float localY = vAux.y;
  if (vAux.z > 0.0) {
    // 細褶法線：沿水平切線擾動（相位為繞身體的角度，整數頻率不會在接縫斷開）
    vec3 T = cross(vec3(0.0, 1.0, 0.0), n);
    float tl = length(T);
    if (tl > 0.05) {
      float a = vAux.w;
      float f = vPart > 4.5 ? sin(a)
        : 0.6 * sin(13.0 * a + 0.9 * sin(localY * 1.7 + a * 2.0)) + 0.4 * sin(22.0 * a - 1.1 * localY);
      n = normalize(n + (T / tl) * f * vAux.z);
    }
  }
  vec3 V = normalize(uEye - vWorld);
  float ndl = dot(n, L);
  float wrap = clamp((ndl + ${CLOTH_WRAP.toFixed(2)}) / ${(1 + CLOTH_WRAP).toFixed(2)}, 0.0, 1.0);
  wrap *= wrap;
  float ndv = clamp(dot(n, V), 0.0, 1.0);
  float fres = (1.0 - ndv) * (1.0 - ndv) * (1.0 - ndv);
  float behind = clamp(dot(-V, L) * 0.5 + 0.5, 0.0, 1.0);   // 光在物體後方（逆光）時邊緣更亮
  float rim = fres * smoothstep(-0.25, 0.4, ndl) * (0.35 + 0.65 * behind);
  float sheen = (1.0 - ndv) * (1.0 - ndv) * wrap;
  float cav = 1.0 - ${CAVITY.toFixed(2)} * vAux.x;
  float contact = mix(${CONTACT_MIN.toFixed(2)}, 1.0, smoothstep(0.0, ${CONTACT_H.toFixed(2)}, localY));
  vec3 Lc = uLightColor * att;
  vec3 amb = mix(uAmbGround, uAmbSky, n.y * 0.5 + 0.5);
  vec3 bounce = uLightColor * uGlow * ${CLOTH_BOUNCE.toFixed(3)} * (0.6 + 0.4 * max(-n.y, 0.0));
  col = albedo * (amb * ${CLOTH_AMB.toFixed(2)} + uHeaven * max(n.y, 0.0) * ${CLOTH_HEAVEN.toFixed(2)}
                  + Lc * (wrap + ${CLOTH_SHEEN.toFixed(2)} * sheen) + bounce) * cav * contact;
  col += Lc * rim * ${CLOTH_RIM.toFixed(3)} * mix(1.0, cav, 0.7) * contact;
  flag = 0.0;
#else
  bool emissive = vPart > 2.5 && vPart < 3.5;
#if PASS == 2
  bool isFloor = vWorld.y < 0.005 && n.y > 0.5 && !emissive;
  if (!emissive) albedo = uBaseColor;
#else
  bool isFloor = false;
#endif
  if (emissive) {
    vec3 hot = mix(uEmissive, vec3(1.0, 0.95, 0.85), clamp(uGlow - 0.6, 0.0, 1.0) * 0.6);
    // 縱向略有明暗，讓十字架有體積感
    float shade = 0.72 + 0.28 * abs(n.x) + 0.12 * n.y;
    col = hot * (0.55 + 0.45 * clamp(uGlow, 0.0, 1.6)) * shade;
  } else {
    float lam = max(dot(n, L), 0.0);
    float wrap = max(dot(n, L) * 0.5 + 0.5, 0.0);
    vec3 amb = mix(uAmbGround, uAmbSky, n.y * 0.5 + 0.5);
#if PASS == 0
    vec3 direct = uLightColor * att * ${DECOR_LIGHT.toFixed(2)} * (lam * 0.85 + wrap * 0.15);
    col = albedo * (amb * 3.0 + uHeaven * max(n.y, 0.0) + direct);
#else
    vec3 direct = uLightColor * att * (lam * 0.85 + wrap * 0.15);
    if (isFloor) {
      albedo = uFloorColor;
      float r = length(vWorld.xz);
      float ring = 0.0;
      for (int i = 0; i < 3; i++) ring = max(ring, 1.0 - smoothstep(0.03, 0.09, abs(r - uDiscipleR[i] - 1.35)));
      ring = max(ring, 1.0 - smoothstep(0.03, 0.09, abs(r - 3.2)));
      // 石板接縫：同心環
      float seam = smoothstep(0.93, 0.99, abs(fract(r / 3.4) - 0.5) * 2.0);
      albedo *= 1.0 - 0.35 * seam;
      // 門徒擋住十字架光的長影（自十字架向外放射）與腳下的接觸陰影；每圈只取角度最近的一位
      float sh = 0.0, ao = 0.0;
      float phi = atan(vWorld.z, vWorld.x);
      for (int i = 0; i < 3; i++) {
        if (i >= uDiscRingN) break;
        vec3 dr = uDiscRing[i];
        float stp = 6.2831853 / dr.z;
        float th = dr.y + stp * floor((phi - dr.y) / stp + 0.5);
        vec2 u = vec2(cos(th), sin(th)), q = vWorld.xz - u * dr.x;
        float along = dot(q, u), perp = abs(q.x * u.y - q.y * u.x);
        float w = 0.5 + 0.05 * max(along, 0.0);
        float s = smoothstep(-0.6, 0.2, along) * (1.0 - smoothstep(0.0, dr.x * ${SHADOW_LEN.toFixed(2)}, along)) * (1.0 - smoothstep(w * 0.45, w, perp));
        sh = max(sh, s);
        ao = max(ao, exp(-dot(q, q) * 1.4));
      }
      float lit = 1.0 - ${SHADOW_STRENGTH.toFixed(2)} * sh;
      col = albedo * (amb * 3.0 + uHeaven + direct * lit);
      // 十字架下方的暖色光池（被長影切開）
      col += uLightColor * uGlow * ${POOL_STRENGTH.toFixed(3)} * exp(-r * r / ${(POOL_R * POOL_R).toFixed(1)}) * lit;
      col += uFloorRing * ring * (0.35 + 0.65 * clamp(att / 6.0, 0.0, 1.0)) * (1.0 - 0.6 * sh);
      col *= 1.0 - ${FLOOR_CONTACT.toFixed(2)} * ao;
    } else {
      col = albedo * (amb * 3.0 + uHeaven * max(n.y, 0.0) + direct);
    }
#endif
  }
  flag = emissive ? 1.0 : (isFloor ? 0.5 : (PASS == 0 ? 0.25 : 0.125));
#endif
  oColor = vec4(col, 1.0);
  oNormal = vec4(n * 0.5 + 0.5, flag);
}`;

const POST_VS = `#version 300 es
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const POST_FS = `#version 300 es
precision highp float;
uniform sampler2D uColorTex, uNormalTex, uDepthTex;
uniform vec2 uRes;
uniform float uDpr, uProjY, uTime;
uniform float uGlow, uPulse;
uniform vec4 uCrossV, uCrossH;         // 十字架直柱與橫梁的螢幕端點（像素）
uniform float uCrossZ;                 // 十字架的線性深度
uniform float uShaft;                  // 光柱強度（依相機仰角）
out vec4 outColor;

const float NEAR = ${NEAR.toFixed(2)}, FAR = ${FAR.toFixed(2)};
const vec3 BG_TOP = vec3(${BG_TOP.join(',')});
const vec3 BG_BOTTOM = vec3(${BG_BOTTOM.join(',')});
const vec3 FOG_COLOR = vec3(${FOG_COLOR.join(',')});
const vec3 LINE_COLOR = vec3(${OUTLINE_COLOR.join(',')});
const vec3 HALO_COLOR = vec3(1.0, 0.72, 0.36);

float linZ(ivec2 q) {
  q = clamp(q, ivec2(0), ivec2(uRes) - 1);
  float d = texelFetch(uDepthTex, q, 0).r * 2.0 - 1.0;
  return 2.0 * NEAR * FAR / (FAR + NEAR - d * (FAR - NEAR));
}
vec4 nrm(ivec2 q) {
  q = clamp(q, ivec2(0), ivec2(uRes) - 1);
  vec4 t = texelFetch(uNormalTex, q, 0);
  return vec4(t.xyz * 2.0 - 1.0, t.w);
}
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float segDist(vec2 p, vec2 a, vec2 b) {
  vec2 ab = b - a, ap = p - a;
  float t = clamp(dot(ap, ab) / max(dot(ab, ab), 1e-4), 0.0, 1.0);
  return length(ap - ab * t);
}

void main() {
  ivec2 q = ivec2(gl_FragCoord.xy);
  vec2 uv = gl_FragCoord.xy / uRes;
  vec3 bg = mix(BG_BOTTOM, BG_TOP, smoothstep(0.0, 1.0, uv.y));
  float zc = linZ(q);
  bool sky = zc > FAR * 0.98;
  vec3 col = texelFetch(uColorTex, q, 0).rgb;
  vec4 nc = nrm(q);

  // 輪廓線：以 1/z 的二階差分（平面上為零）偵測深度不連續，鄰域法線差偵測折角
  float off = max(1.0, ${OUTLINE_PX.toFixed(2)} * uDpr * mix(1.0, 0.6, clamp(zc / 60.0, 0.0, 1.0)));
  int o = int(floor(off + 0.5));
  float il = 1.0 / linZ(q + ivec2(-o, 0)), ir = 1.0 / linZ(q + ivec2(o, 0));
  float id = 1.0 / linZ(q + ivec2(0, -o)), iu = 1.0 / linZ(q + ivec2(0, o));
  float ic = 1.0 / zc;
  float dEdge = (abs(il + ir - 2.0 * ic) + abs(id + iu - 2.0 * ic)) / ic;
  vec4 nl = nrm(q + ivec2(-o, 0)), nr = nrm(q + ivec2(o, 0));
  vec4 nd = nrm(q + ivec2(0, -o)), nu = nrm(q + ivec2(0, o));
  float nEdge = (1.0 - dot(nc.xyz, nl.xyz)) + (1.0 - dot(nc.xyz, nr.xyz))
              + (1.0 - dot(nc.xyz, nd.xyz)) + (1.0 - dot(nc.xyz, nu.xyz));
  bool discPx = nc.w < 0.06;
  float crease = discPx ? ${DISCIPLE_CREASE.toFixed(2)} : 1.0;
  // 門徒是平滑布料：只留淡淡的剪影線（布褶本身的深度起伏不描邊）
  float dK = discPx ? 0.5 : 1.0;
  float edge = clamp(max(smoothstep(0.02, 0.12, dEdge * dK * ${OUTLINE_DEPTH_K.toFixed(1)} * 0.01),
                         crease * ${CREASE_STRENGTH.toFixed(2)} * smoothstep(0.15, 0.6, nEdge * ${OUTLINE_NORMAL_K.toFixed(2)} * 0.5)), 0.0, 1.0);
  if (abs(nc.w - 0.25) < 0.06) edge *= ${DECOR_LINE.toFixed(2)};
  if (discPx) edge *= ${DISCIPLE_LINE.toFixed(2)};
  // 地面刻紋自身不描邊；遠處淡出
  float floorMask = (abs(nc.w - 0.5) < 0.1) ? 0.0 : 1.0;
  edge *= mix(1.0, floorMask, 1.0 - step(0.5, dEdge * 10.0));

  if (!sky) {
    // SSAO：8 個螺旋鄰點的深度比較
    float rad = ${AO_RADIUS.toFixed(2)} * uProjY * 0.5 * uRes.y / zc;
    rad = clamp(rad, 2.0, 40.0 * uDpr);
    float occ = 0.0;
    float a0 = hash(gl_FragCoord.xy) * 6.2831853;
    for (int i = 0; i < 8; i++) {
      float fi = float(i);
      float a = a0 + fi * 2.39996;
      float r = rad * (0.25 + 0.75 * (fi + 0.5) / 8.0);
      ivec2 sq = q + ivec2(vec2(cos(a), sin(a)) * r);
      float dz = zc - linZ(sq);
      occ += smoothstep(0.04, 0.3, dz) * (1.0 - smoothstep(${AO_RADIUS.toFixed(2)} * 2.5, ${AO_RADIUS.toFixed(2)} * 5.0, dz));
    }
    if (nc.w < 0.75) col *= 1.0 - ${AO_STRENGTH.toFixed(2)} * occ / 8.0;
    // 金色輪廓（十字架自身的邊用更亮的金白）
    vec3 lc = nc.w > 0.75 ? vec3(1.0, 0.9, 0.7) : LINE_COLOR;
    col = mix(col, lc * (0.35 + 0.4 * clamp(uGlow, 0.0, 1.5)), edge * ${OUTLINE_STRENGTH.toFixed(2)});
    // 距離霧：混入背景
    float fog = 1.0 - exp(-max(zc - ${FOG_START.toFixed(1)}, 0.0) * ${FOG_DENSITY.toFixed(3)});
    vec3 fogCol = mix(FOG_COLOR, bg, 0.5);
    col = mix(col, fogCol, fog);
  } else {
    col = bg;
  }

  // 十字架光暈：到直柱／橫梁螢幕線段的距離，以十字架螢幕高度正規化
  vec2 px = gl_FragCoord.xy;
  float hgt = max(length(uCrossV.zw - uCrossV.xy), 8.0);
  float dc = min(segDist(px, uCrossV.xy, uCrossV.zw), segDist(px, uCrossH.xy, uCrossH.zw)) / hgt;
  float g = clamp(uGlow, 0.0, 2.0) + uPulse;
  float halo = exp(-dc * 14.0) * 0.55 + exp(-dc * 4.0) * 0.3 + exp(-dc * 1.4) * 0.1;
  // 前景物體遮住十字架處光暈減弱
  if (!sky && zc < uCrossZ - 3.0) halo *= 0.35;
  col += HALO_COLOR * halo * g * ${HALO_STRENGTH.toFixed(2)};
  // 自上方落下的光柱（穿過穹頂開口照在十字架上）
  float topY = max(uCrossV.y, uCrossV.w);
  float sx = abs(px.x - uCrossV.x) / hgt;
  float above = smoothstep(topY - hgt * 0.4, topY + hgt * 0.2, px.y);
  float shaft = exp(-sx * 7.0) * above * (0.6 + 0.4 * smoothstep(uRes.y, topY, px.y));
  col += HALO_COLOR * shaft * g * uShaft;
  // pulse 閃光：整體暖色微亮
  col += vec3(0.10, 0.07, 0.03) * uPulse * ${PULSE_AMOUNT.toFixed(2)} * (0.4 + halo);

  // 暗角
  vec2 v = uv - 0.5;
  v.x *= uRes.x / uRes.y;
  col *= 1.0 - ${VIGNETTE.toFixed(2)} * smoothstep(0.25, 1.05, length(v));
  // 抖動消除暗部色帶
  col += (hash(gl_FragCoord.xy + fract(uTime)) - 0.5) / 255.0;
  outColor = vec4(max(col, 0.0), 1.0);
}`;

// ── 公開介面 ─────────────────────────────────────────────────
export function createMandala(canvas, { reducedMotion = false, seed = 1, onFrame = null, onFail = null } = {}) {
  const fail = (reason) => {
    try { if (typeof onFail === 'function') onFail(String(reason)); } catch { /* 呼叫端錯誤不外拋 */ }
    return null;
  };
  let gl = null;
  try {
    gl = canvas && typeof canvas.getContext === 'function'
      ? canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false, premultipliedAlpha: false, powerPreference: 'high-performance' })
      : null;
  } catch (e) {
    return fail(`webgl2 getContext threw: ${e && e.message ? e.message : e}`);
  }
  if (!gl) return fail('webgl2 unavailable');
  try {
    return setup(canvas, gl, { reducedMotion, seed, onFrame, onFail: fail });
  } catch (e) {
    return fail(e && e.message ? e.message : e);
  }
}

function compile(gl, type, src, label) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS) && !gl.isContextLost()) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(`${label} shader compile failed: ${log}`);
  }
  return sh;
}

function link(gl, vsSrc, fsSrc, label) {
  const vs = compile(gl, gl.VERTEX_SHADER, vsSrc, `${label} vertex`);
  let fs;
  try { fs = compile(gl, gl.FRAGMENT_SHADER, fsSrc, `${label} fragment`); } catch (e) { gl.deleteShader(vs); throw e; }
  const prog = gl.createProgram();
  gl.attachShader(prog, vs); gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  gl.deleteShader(vs); gl.deleteShader(fs);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS) && !gl.isContextLost()) {
    const log = gl.getProgramInfoLog(prog);
    gl.deleteProgram(prog);
    throw new Error(`${label} program link failed: ${log}`);
  }
  return prog;
}

function uniforms(gl, prog, names) {
  const u = {};
  for (const n of names) u[n] = gl.getUniformLocation(prog, n);
  return u;
}

function setup(canvas, gl, { reducedMotion, seed, onFrame, onFail }) {
  const win = typeof window !== 'undefined' ? window : null;
  const doc = typeof document !== 'undefined' ? document : null;
  const raf = win && win.requestAnimationFrame ? win.requestAnimationFrame.bind(win) : null;
  const caf = win && win.cancelAnimationFrame ? win.cancelAnimationFrame.bind(win) : null;

  const res = { programs: [], buffers: [], vaos: [] };
  let fbo = null, texColor = null, texNormal = null, texDepth = null;
  const freeAll = () => {
    if (gl.isContextLost()) return;
    res.programs.forEach(p => gl.deleteProgram(p));
    res.buffers.forEach(b => gl.deleteBuffer(b));
    res.vaos.forEach(v => gl.deleteVertexArray(v));
    freeTargets();
  };

  const scenes = [];
  let post;
  try {
    for (const pass of [PASS_DECOR, PASS_DISCIPLE, PASS_CROSS]) {
      const p = link(gl, withPass(SCENE_VS, pass), withPass(SCENE_FS, pass), 'scene');
      res.programs.push(p); scenes.push(p);
    }
    post = link(gl, POST_VS, POST_FS, 'post'); res.programs.push(post);
  } catch (e) { freeAll(); throw e; }
  const sus = scenes.map(p => uniforms(gl, p, ['uViewProj', 'uRing', 'uPose', 'uNeck', 'uHip', 'uCut', 'uCutParams',
    'uColor', 'uTints', 'uBaseColor', 'uEye', 'uDiscRing', 'uDiscRingN', 'uLightPos', 'uLightColor', 'uLightStrength', 'uGlow',
    'uAmbSky', 'uAmbGround', 'uHeaven', 'uEmissive', 'uFloorColor', 'uFloorRing', 'uDiscipleR']));
  const pu = uniforms(gl, post, ['uColorTex', 'uNormalTex', 'uDepthTex', 'uRes', 'uDpr', 'uProjY', 'uTime',
    'uGlow', 'uPulse', 'uCrossV', 'uCrossH', 'uCrossZ', 'uShaft']);

  // ── 幾何：每圈一個 VAO（模組幾何 + 每實例 [slot, rnd]） ──
  const plan = planRings({ seed, decorCount: DECOR_COUNT });
  const rng = mulberry32((seed * 7919 + 13) >>> 0);
  const makeVao = ({ positions, normals, parts, positions2, normals2, aux, instances }) => {
    const vao = gl.createVertexArray(); res.vaos.push(vao);
    gl.bindVertexArray(vao);
    const attr = (data, loc, size, divisor) => {
      const buf = gl.createBuffer(); res.buffers.push(buf);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
      gl.vertexAttribDivisor(loc, divisor);
    };
    attr(positions, 0, 3, 0); attr(normals, 1, 3, 0); attr(parts, 2, 1, 0); attr(instances, 3, 2, 1);
    attr(positions2, 4, 3, 0); attr(normals2, 5, 3, 0); attr(aux, 6, 4, 0);
    gl.bindVertexArray(null);
    return { vao, count: positions.length / 3, instances: instances.length / 2 };
  };
  const rings = plan.rings.map(ring => {
    const geo = makeVao(buildRingGeometry(ring, rng));
    return {
      ...geo, kind: ring.role === 'disciple' ? KIND_DISCIPLE : KIND_DECOR,
      pass: ring.role === 'disciple' ? PASS_DISCIPLE : PASS_DECOR,
      R: ring.R, y: ring.y, N: ring.N, spinSpeed: ring.spinSpeed, dir: ring.dir,
      spin: ring.phase, color: ring.role === 'disciple' ? ROBE_TINTS[0] : ring.color.map(c => c * DECOR_DIM),
    };
  });
  // 十字架 + 地面（同一次 draw）
  const cb = buildCross();
  const floor = new Builder();
  floor.box(0, -0.15, 0, 160, 0.3, 160, PART.BODY);
  const crossArr = cb.toArrays(), floorArr = floor.toArrays();
  const cat = (a, b) => { const r = new Float32Array(a.length + b.length); r.set(a); r.set(b, a.length); return r; };
  const crossGeo = makeVao({
    positions: cat(crossArr.positions, floorArr.positions),
    normals: cat(crossArr.normals, floorArr.normals),
    parts: cat(crossArr.parts, floorArr.parts),
    positions2: cat(crossArr.positions2, floorArr.positions2),
    normals2: cat(crossArr.normals2, floorArr.normals2),
    aux: cat(crossArr.aux, floorArr.aux),
    instances: new Float32Array([0, 0.5]),
  });
  const discipleR = plan.rings.filter(r => r.role === 'disciple').map(r => r.R);
  const discRings = rings.filter(r => r.kind === KIND_DISCIPLE);
  const discRingBuf = new Float32Array(9); // 每幀重填（不配置）
  const tints = new Float32Array(ROBE_TINTS.flat());
  const emptyVao = gl.createVertexArray(); res.vaos.push(emptyVao);

  // ── FBO ──
  function freeTargets() {
    if (fbo) gl.deleteFramebuffer(fbo);
    [texColor, texNormal, texDepth].forEach(t => t && gl.deleteTexture(t));
    fbo = texColor = texNormal = texDepth = null;
  }
  const makeTex = (w, h, internal, format, type) => {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texStorage2D(gl.TEXTURE_2D, 1, internal, w, h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  };
  let W = 0, H = 0, dpr = 1, cssW = 0, cssH = 0;
  function buildTargets() {
    freeTargets();
    texColor = makeTex(W, H, gl.RGBA8);
    texNormal = makeTex(W, H, gl.RGBA8);
    texDepth = makeTex(W, H, gl.DEPTH_COMPONENT24);
    fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texColor, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, texNormal, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, texDepth, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (status !== gl.FRAMEBUFFER_COMPLETE) throw new Error(`framebuffer incomplete: 0x${status.toString(16)}`);
  }
  function measure() {
    cssW = Math.max(1, canvas.clientWidth || canvas.width || 1);
    cssH = Math.max(1, canvas.clientHeight || canvas.height || 1);
    const cap = cssW >= 900 ? DPR_DESKTOP : DPR_MOBILE;
    dpr = Math.min((win && win.devicePixelRatio) || 1, cap);
    return [Math.max(1, Math.round(cssW * dpr)), Math.max(1, Math.round(cssH * dpr))];
  }
  function resize() {
    const [w, h] = measure();
    if (w === W && h === H && fbo) return;
    W = w; H = h;
    canvas.width = W; canvas.height = H;
    buildTargets();
  }
  try {
    resize();
    if (!raf) throw new Error('requestAnimationFrame unavailable');
  } catch (e) { freeAll(); throw e; }

  // ── 狀態（熱路徑重用） ──
  let orbit = createOrbit();
  const orbitParams = ORBIT_DEFAULTS;
  const input = { dragDAz: 0, dragDEl: 0, zoomFactor: 1, held: false, autoOrbit: !reducedMotion, paused: false };
  let pendAz = 0, pendEl = 0, pendZoom = 1, held = false, paused = false;
  let stateName = 'idle';
  let target = STATES.idle;
  let sceneSpeed = target.speed, glow = target.glow, bowBlend = 0, raiseBlend = 0, breath = target.breath, pulseAmt = 0;
  let time = 0, frames = 0, lastT = -1, rafId = 0, running = false, dead = false, frameMs = 0;

  const eye = [0, 0, 0], up = [0, 1, 0];
  const view = new Float32Array(16), proj = new Float32Array(16), viewProj = new Float32Array(16);
  const tmp4 = [0, 0, 0, 0];
  const P_BOTTOM = [0, 1.2, 0], P_TOP = [0, 10, 0], P_MID = [0, 5.5, 0], P_LEFT = [0, 7, 0], P_RIGHT = [0, 7, 0];
  let crossYaw = 0; // 十字架繞 Y 軸轉向相機，橫梁永遠與視線垂直（不會側看成一根柱）
  const scr = new Float32Array(10); // 5 點 × (x, y) 的 CSS 像素
  const frameInfo = { cross: { x: 0, y: 0, topY: 0, bottomY: 0, width: 0, visible: false } };
  let crossZ = 30, crossVisible = false;

  const project = (p, i) => {
    mat4TransformPoint(viewProj, p, tmp4);
    const w = tmp4[3];
    const nx = w > 1e-6 ? tmp4[0] / w : 0, ny = w > 1e-6 ? tmp4[1] / w : 0;
    scr[i * 2] = (nx * 0.5 + 0.5) * cssW;
    scr[i * 2 + 1] = (1 - (ny * 0.5 + 0.5)) * cssH;
    return w > 0 && Math.abs(nx) <= 1.2 && Math.abs(ny) <= 1.2;
  };

  function update(dt) {
    input.dragDAz = pendAz; input.dragDEl = pendEl; input.zoomFactor = pendZoom;
    input.held = held; input.paused = paused;
    pendAz = 0; pendEl = 0; pendZoom = 1;
    orbit = stepOrbit(orbit, dt, input, orbitParams);
    if (reducedMotion && !held) { orbit.vAz = 0; orbit.vEl = 0; }

    const kPose = reducedMotion ? 1 : 1 - Math.exp(-dt * POSE_RATE);
    const kGlow = reducedMotion ? 1 : 1 - Math.exp(-dt * GLOW_RATE);
    sceneSpeed += (target.speed - sceneSpeed) * (1 - Math.exp(-dt * SPEED_RATE));
    glow += (target.glow - glow) * kGlow;
    bowBlend += (target.bow - bowBlend) * kPose;
    raiseBlend += (target.raise - raiseBlend) * kPose;
    breath += (target.breath - breath) * kPose;
    pulseAmt *= Math.exp(-dt * PULSE_DECAY);
    if (!reducedMotion && !paused) {
      for (let i = 0; i < rings.length; i++) {
        const r = rings[i];
        r.spin += r.spinSpeed * r.dir * sceneSpeed * dt;
        if (r.spin > 1e4 || r.spin < -1e4) r.spin %= Math.PI * 2;
      }
      time += dt;
    }

    // 相機
    const aspect = W / H;
    let fov = FOV_Y;
    if (aspect < 1) fov = clamp(2 * Math.atan(Math.tan(FOV_H_MIN / 2) / aspect), FOV_Y, FOV_Y_MAX);
    orbitEye(CAM_TARGET, orbit.az, orbit.el, orbit.dist, eye);
    if (eye[1] < CAM_MIN_EYE_Y) eye[1] = CAM_MIN_EYE_Y;
    mat4Perspective(fov, aspect, NEAR, FAR, proj);
    mat4LookAt(eye, CAM_TARGET, up, view);
    mat4Multiply(proj, view, viewProj);
    crossYaw = Math.atan2(eye[2], eye[0]);
    const half = 3; // 橫梁半寬（局部 z ±3 轉到世界）
    P_LEFT[0] = Math.sin(crossYaw) * half; P_LEFT[2] = -Math.cos(crossYaw) * half;
    P_RIGHT[0] = -P_LEFT[0]; P_RIGHT[2] = -P_LEFT[2];

    // 十字架螢幕位置
    crossVisible = project(P_MID, 0);
    project(P_TOP, 1); project(P_BOTTOM, 2); project(P_LEFT, 3); project(P_RIGHT, 4);
    mat4TransformPoint(view, P_MID, tmp4);
    crossZ = -tmp4[2];
    const c = frameInfo.cross;
    c.x = scr[0]; c.y = scr[1]; c.topY = scr[3]; c.bottomY = scr[5];
    c.width = Math.hypot(scr[8] - scr[6], scr[9] - scr[7]);
    c.visible = crossVisible;
  }

  function render() {
    // 場景 pass
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, W, H);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.disable(gl.BLEND);
    gl.clearBufferfv(gl.COLOR, 0, CLEAR_COLOR);
    gl.clearBufferfv(gl.COLOR, 1, CLEAR_NORMAL);
    gl.clearBufferfv(gl.DEPTH, 0, CLEAR_DEPTH);
    const nr = Math.min(3, discRings.length);
    for (let i = 0; i < nr; i++) {
      const r = discRings[i];
      discRingBuf[i * 3] = r.R; discRingBuf[i * 3 + 1] = r.spin % (Math.PI * 2); discRingBuf[i * 3 + 2] = r.N;
    }
    const ex = eye[0], ez = eye[2], el = Math.hypot(ex, ez) || 1;
    const g = glow + pulseAmt * PULSE_AMOUNT;
    for (let pass = 0; pass < 3; pass++) {
      const su = sus[pass];
      gl.useProgram(scenes[pass]);
      gl.uniformMatrix4fv(su.uViewProj, false, viewProj);
      gl.uniform4f(su.uPose, bowBlend, raiseBlend, time, breath);
      gl.uniform3f(su.uNeck, NECK[0], NECK[1], NECK[2]);
      gl.uniform3f(su.uHip, HIP[0], HIP[1], HIP[2]);
      gl.uniform3f(su.uEye, eye[0], eye[1], eye[2]);
      gl.uniform3fv(su.uTints, tints);
      gl.uniform3fv(su.uDiscRing, discRingBuf);
      gl.uniform1i(su.uDiscRingN, nr);
      gl.uniform2f(su.uCut, ex / el, ez / el);
      gl.uniform3f(su.uCutParams, CUTAWAY_COS, CUTAWAY_SOFT, DECOR_SCALE_JITTER);
      gl.uniform3f(su.uLightPos, LIGHT_POS[0], LIGHT_POS[1], LIGHT_POS[2]);
      gl.uniform3f(su.uLightColor, LIGHT_COLOR[0], LIGHT_COLOR[1], LIGHT_COLOR[2]);
      gl.uniform1f(su.uLightStrength, LIGHT_STRENGTH * g);
      gl.uniform1f(su.uGlow, g);
      gl.uniform3f(su.uAmbSky, AMBIENT_SKY[0], AMBIENT_SKY[1], AMBIENT_SKY[2]);
      gl.uniform3f(su.uHeaven, HEAVEN_COLOR[0], HEAVEN_COLOR[1], HEAVEN_COLOR[2]);
      gl.uniform3f(su.uAmbGround, AMBIENT_GROUND[0], AMBIENT_GROUND[1], AMBIENT_GROUND[2]);
      gl.uniform3f(su.uEmissive, CROSS_EMISSIVE[0], CROSS_EMISSIVE[1], CROSS_EMISSIVE[2]);
      gl.uniform3f(su.uBaseColor, BASE_COLOR[0], BASE_COLOR[1], BASE_COLOR[2]);
      gl.uniform3f(su.uFloorColor, FLOOR_COLOR[0], FLOOR_COLOR[1], FLOOR_COLOR[2]);
      gl.uniform3f(su.uFloorRing, FLOOR_RING_COLOR[0], FLOOR_RING_COLOR[1], FLOOR_RING_COLOR[2]);
      gl.uniform3f(su.uDiscipleR, discipleR[0], discipleR[1], discipleR[2]);
      if (pass === PASS_CROSS) {
        gl.uniform4f(su.uRing, 0, 0, crossYaw, 1);
        gl.uniform3f(su.uColor, BASE_COLOR[0], BASE_COLOR[1], BASE_COLOR[2]);
        gl.bindVertexArray(crossGeo.vao);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, crossGeo.count, 1);
        continue;
      }
      for (let i = 0; i < rings.length; i++) {
        const r = rings[i];
        if (r.pass !== pass) continue;
        gl.uniform4f(su.uRing, r.R, r.y, r.spin, r.N);
        gl.uniform3f(su.uColor, r.color[0], r.color[1], r.color[2]);
        gl.bindVertexArray(r.vao);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, r.count, r.instances);
      }
    }

    // 後製 pass
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.useProgram(post);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texColor);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, texNormal);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, texDepth);
    gl.uniform1i(pu.uColorTex, 0); gl.uniform1i(pu.uNormalTex, 1); gl.uniform1i(pu.uDepthTex, 2);
    gl.uniform2f(pu.uRes, W, H);
    gl.uniform1f(pu.uDpr, dpr);
    gl.uniform1f(pu.uProjY, proj[5]);
    gl.uniform1f(pu.uTime, time);
    gl.uniform1f(pu.uGlow, glow);
    gl.uniform1f(pu.uPulse, pulseAmt);
    // 端點轉為 drawing-buffer 像素（原點左下）
    const sx = W / cssW, sy = H / cssH;
    gl.uniform4f(pu.uCrossV, scr[4] * sx, H - scr[5] * sy, scr[2] * sx, H - scr[3] * sy);
    gl.uniform4f(pu.uCrossH, scr[6] * sx, H - scr[7] * sy, scr[8] * sx, H - scr[9] * sy);
    gl.uniform1f(pu.uCrossZ, crossZ);
    gl.uniform1f(pu.uShaft, SHAFT_STRENGTH * (1 - smoothstep(SHAFT_EL[0], SHAFT_EL[1], orbit.el)));
    gl.bindVertexArray(emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  function frame(now) {
    rafId = 0;
    if (dead || !running) return;
    const t0 = now;
    const dt = lastT < 0 ? 1 / 60 : clamp((now - lastT) / 1000, 0, MAX_DT);
    lastT = now;
    if ((canvas.clientWidth && Math.round(canvas.clientWidth * dpr) !== W) ||
        (canvas.clientHeight && Math.round(canvas.clientHeight * dpr) !== H)) {
      try { resize(); } catch (e) { die(e.message); return; }
    }
    update(dt);
    render();
    frames++;
    if (onFrame) { try { onFrame(frameInfo); } catch { /* 呼叫端錯誤不中斷渲染 */ } }
    const perf = win && win.performance;
    if (perf) frameMs = frameMs * 0.9 + (perf.now() - t0) * 0.1;
    rafId = raf(frame);
  }

  function start() {
    if (dead || running) return;
    running = true; lastT = -1;
    rafId = raf(frame);
  }
  function stop() {
    running = false;
    if (rafId && caf) caf(rafId);
    rafId = 0;
  }
  function die(reason) {
    if (dead) return;
    stop();
    dead = true;
    detach();
    onFail(reason);
  }

  const onVis = () => { if (doc.hidden) stop(); else start(); };
  const onLost = (e) => { e.preventDefault(); die('webgl context lost'); };
  if (doc) doc.addEventListener('visibilitychange', onVis);
  if (canvas.addEventListener) canvas.addEventListener('webglcontextlost', onLost);
  function detach() {
    if (doc) doc.removeEventListener('visibilitychange', onVis);
    if (canvas.removeEventListener) canvas.removeEventListener('webglcontextlost', onLost);
  }

  if (!(doc && doc.hidden)) start();

  return {
    setState(name) {
      if (!STATES[name]) return;
      stateName = name;
      target = STATES[name];
      if (name === 'still') pulseAmt = 0; // 危機：不得有閃光
      if (reducedMotion) { glow = target.glow; bowBlend = target.bow; raiseBlend = target.raise; breath = target.breath; sceneSpeed = target.speed; }
    },
    pulse() {
      if (reducedMotion || stateName === 'still') return;
      pulseAmt = 1;
    },
    setPaused(b) { paused = !!b; },
    isPaused() { return paused; },
    orbitInput(dAz, dEl) { pendAz += +dAz || 0; pendEl += +dEl || 0; },
    zoomBy(factor) { const f = +factor; if (f > 0 && Number.isFinite(f)) pendZoom *= f; },
    setHeld(b) { held = !!b; },
    resize() { if (!dead) { try { resize(); } catch (e) { die(e.message); } } },
    destroy() {
      if (dead) return;
      stop();
      dead = true;
      detach();
      freeAll();
    },
    getDebug() {
      return {
        frames, state: stateName, orbit: { az: orbit.az, el: orbit.el, dist: orbit.dist, autoBlend: orbit.autoBlend },
        rings: rings.length, draws: rings.length + 1, glow, bowBlend, raiseBlend, sceneSpeed, paused,
        size: [W, H], dpr, frameMs, running, dead,
      };
    },
  };
}

const CLEAR_COLOR = new Float32Array([0, 0, 0, 1]);
const CLEAR_NORMAL = new Float32Array([0.5, 0.5, 1, 0]);
const CLEAR_DEPTH = new Float32Array([1]);
