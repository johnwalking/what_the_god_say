/**
 * 聖殿的視覺：純函式（可在 node 下測試）加 DOM 控制器。
 * 這個檔案的上半部不碰 DOM。
 */

// ---- 場景旋鈕（皆可調）----
const IDLE_DELAY_SEC = 4; // 使用者停止操作多久後，自動環繞恢復
const AUTO_YAW_SPEED = 0.05; // 自動環繞的視角角速度（rad/s）
const AUTO_EASE = 0.8; // 自動環繞「平順恢復」的趨近速率（越大越快）
const SWIRL = 0.06; // 旋渦感：軌道半徑隨相位起伏的相對幅度（0.04–0.08）
const FOG = 1.15; // 霧距：遠處衰減強度（1 = 依 depth 公式，越大遠處越暗）
const SPEED_EASE = 2.5; // 軌道速度（idle/bow/raise/still 之間）的趨近速率
const POSE_EASE = 3; // 姿勢過渡速率（reducedMotion 時無過渡）
const GLOW_EASE = 2; // 十字架光暈亮度的趨近速率
const INERTIA_DECAY = 2.2; // 放開後 yaw 慣性的衰減（1/s）
const DRAG_THRESHOLD_PX = 6; // 拖曳超過此距離就不算點擊
const YAW_PER_PX = 0.008; // 拖曳 1px 轉動的 yaw（rad）
const PITCH_PER_PX = 0.005; // 拖曳 1px 改變的 pitch（rad）
const WHEEL_ZOOM = 0.0012; // 滾輪縮放靈敏度
const INITIAL_YAW = 0.35; // 初始視角 yaw（rad）
const INITIAL_PITCH = 0.6; // 初始視角 pitch（rad）
const RIG_CY = 0.6; // 十字架底部／軌道中心的垂直位置（視窗高度比例）
const RIG_CY_MOBILE = 0.5; // 同上，<600px 寬時
const CROSS_SIZE = 0.37; // 十字架高度 = min(寬, 高) × 此值（上限 300px）
const FIGURE_SIZE = 0.15; // 門徒基準身高 = min(寬, 高) × 此值（再乘透視 scale）
const CROSS_HIT_MIN_W = 56; // 十字架按鈕最小寬（px）
const CROSS_HIT_MIN_H = 96; // 十字架按鈕最小高（px）

/** 逐碼點拆字，讓罕用字（surrogate pair）不會被切成兩半。 */
export function splitGraphemes(text) {
  return Array.from(String(text ?? ''));
}

const round3 = (n) => Math.round(n * 1000) / 1000;

/**
 * 經文逐字浮現的排程：每字一個延遲秒數。
 * 保證：total（最後一字延遲 + 0.6 淡入）不超過 maxTotal；但 maxTotal 小到容納不下時，
 * 間隔以 0.005 秒為下限（維持嚴格遞增），此時 total 會略超過 maxTotal。
 */
export function revealSchedule(text, { startDelay = 0.2, perChar = 0.06, maxTotal = 4.5 } = {}) {
  const chars = splitGraphemes(text);
  if (chars.length === 0) return { chars, delays: [], total: 0 };
  const step = Math.max(0.005, Math.min(perChar, (maxTotal - startDelay - 0.6) / chars.length));
  const delays = chars.map((_, i) => round3(startDelay + i * step));
  return { chars, delays, total: round3(delays[delays.length - 1] + 0.6) };
}

/** 「屬靈解讀」晚一點才出現，補刀才有喜劇節奏。 */
export function quipDelay(total) {
  return round3(total + 1.5);
}

/** 危機訊息不能被包裝成神蹟：沒有動畫、沒有鐘聲，音樂降為近乎無聲。 */
export function ceremonyFor(kind) {
  if (kind === 'crisis') return { animate: false, bell: false, hush: true };
  return { animate: true, bell: true, hush: false };
}

const 教徒狀態 = { load: 'idle', ask: 'bow', reveal: 'raise', crisis: 'still', reset: 'idle' };

/** 事件 → 教徒姿勢（未知事件一律回到 idle）。 */
export function worshipState(event) {
  return Object.hasOwn(教徒狀態, event) ? 教徒狀態[event] : 'idle';
}

// ---------------------------------------------------------------------------
// 十二門徒：軌道配置與偽 3D 透視投影。以下皆為純函式，不碰 DOM。
// ---------------------------------------------------------------------------

const TAU = Math.PI * 2;
const 層半徑 = [0.38, 0.62, 0.88]; // 內、中、外的相對半徑
const 層速度 = [1.5, 1, 0.7]; // 內層較快
const 層錯開 = [0.35, 1.05, 0.12]; // 層間 phase 錯開（rad），避免三層門徒排成放射線

/** 把 count 位分到三層：內約 25%、中約 33%、外為其餘；12 位 → 3 / 4 / 5。 */
function ringSizes(count) {
  const n = Math.max(0, Math.floor(count));
  const inner = Math.round(n * 0.25);
  const mid = Math.round(n * 0.33);
  return [inner, mid, n - inner - mid];
}

/** 確定性：三層軌道，同層等角均分並加層間錯開，方向逐層交替。 */
export function discipleRings(count = 12) {
  const out = [];
  ringSizes(count).forEach((size, ring) => {
    for (let index = 0; index < size; index += 1) {
      const raw = (index / size) * TAU + 層錯開[ring];
      out.push({
        ring,
        index,
        phase: raw % TAU,
        radius: 層半徑[ring],
        dir: ring % 2 === 0 ? 1 : -1,
        speed: 層速度[ring],
      });
    }
  });
  return out;
}

/**
 * 偽 3D 投影。θ = phase + dir*speed*baseSpeed*t + yaw；z3 > 0 為近（畫面下方）。
 * swirl（相對幅度）讓半徑隨相位小幅起伏，軌跡略呈螺旋；預設 0 為正圓。
 */
export function projectDisciple(d, { t, yaw, pitch, zoom, width, height, baseSpeed = 0.04, cx = 0.5, cy = 0.5, swirl = 0 }) {
  const theta = d.phase + d.dir * d.speed * baseSpeed * t + yaw;
  const wobble = swirl ? 1 + swirl * Math.sin(theta * 2 + d.ring * 1.7) : 1;
  const R = d.radius * Math.min(width, height) * 0.42 * zoom * wobble;
  const x3 = R * Math.cos(theta);
  const z3 = R * Math.sin(theta);
  const depth = R > 0 ? (z3 / R + 1) / 2 : 0.5;
  return {
    x: cx * width + x3,
    y: cy * height + z3 * Math.sin(pitch),
    scale: (0.55 + 0.6 * depth) * Math.sqrt(zoom),
    alpha: 0.3 + 0.7 * depth,
    depth,
    z: z3,
  };
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const clampPitch = (p) => clamp(p, 0.15, 1.0);
export const clampZoom = (z) => clamp(z, 0.6, 1.8);

const 場景速度 = { idle: 1, bow: 0.25, raise: 1.8, still: 0 };
/** 場景狀態 → 軌道速度倍率（未知回 1）。 */
export function sceneSpeed(state) {
  return Object.hasOwn(場景速度, state) ? 場景速度[state] : 1;
}

// ---------------------------------------------------------------------------
// 繪製（DOM / canvas 部分，不在 node 測試）
// ---------------------------------------------------------------------------

const GOLD = '184, 153, 90';

/** 金色拉丁十字（橫梁在上三分之一）與柔和光暈。cy 為十字架「底部」，size 為總高，glow 0–1。 */
export function drawCross(ctx, cx, baseY, size, glow = 0.3) {
  const top = baseY - size;
  const bw = size * 0.075; // 直柱寬
  const barY = top + size * 0.3; // 橫梁中心
  const barHalf = size * 0.27;
  const mid = barY;
  ctx.save();
  // 地面光池
  const pool = ctx.createRadialGradient(cx, baseY, 0, cx, baseY, size * 0.9);
  pool.addColorStop(0, `rgba(210, 160, 80, ${0.16 + 0.22 * glow})`);
  pool.addColorStop(1, 'rgba(210, 160, 80, 0)');
  ctx.save();
  ctx.translate(0, baseY);
  ctx.scale(1, 0.32);
  ctx.translate(0, -baseY);
  ctx.fillStyle = pool;
  ctx.fillRect(cx - size, baseY - size, size * 2, size * 2);
  ctx.restore();
  // 大光暈（疊加）
  ctx.globalCompositeOperation = 'lighter';
  const halo = ctx.createRadialGradient(cx, mid, 0, cx, mid, size * (0.75 + 0.35 * glow));
  halo.addColorStop(0, `rgba(255, 220, 140, ${0.22 + 0.4 * glow})`);
  halo.addColorStop(0.35, `rgba(214, 160, 80, ${0.1 + 0.2 * glow})`);
  halo.addColorStop(1, 'rgba(214, 160, 80, 0)');
  ctx.fillStyle = halo;
  ctx.fillRect(cx - size * 1.2, mid - size * 1.2, size * 2.4, size * 2.4);
  ctx.globalCompositeOperation = 'source-over';
  // 十字本體
  const body = ctx.createLinearGradient(cx, top, cx, baseY);
  body.addColorStop(0, '#f6e3ad');
  body.addColorStop(0.35, '#d9b86c');
  body.addColorStop(1, '#8a6a30');
  ctx.fillStyle = body;
  ctx.shadowColor = `rgba(255, 210, 120, ${0.5 + 0.4 * glow})`;
  ctx.shadowBlur = size * (0.05 + 0.05 * glow);
  ctx.fillRect(cx - bw / 2, top, bw, size);
  ctx.fillRect(cx - barHalf, barY - bw / 2, barHalf * 2, bw);
  ctx.shadowBlur = 0;
  // 中軸高光
  ctx.fillStyle = `rgba(255, 244, 214, ${0.5 + 0.3 * glow})`;
  ctx.fillRect(cx - bw * 0.12, top, bw * 0.24, size);
  ctx.fillRect(cx - barHalf, barY - bw * 0.12, barHalf * 2, bw * 0.24);
  ctx.restore();
}

/**
 * 兜帽長袍剪影。p 為 projectDisciple 的結果，(p.x, p.y) 為腳下；height 為像素高度。
 * pose = { bow, raise, sway } 皆 0–1（sway 為 -1..1 的呼吸相位）。tint = { alpha, rim }。
 */
export function drawDisciple(ctx, p, pose, tint = {}) {
  const H = tint.height ?? 100 * p.scale;
  const alpha = tint.alpha ?? p.alpha;
  const rim = tint.rim ?? alpha * 0.5;
  const bow = pose.bow ?? 0;
  const raise = pose.raise ?? 0;
  const bob = (pose.sway ?? 0) * 0.012;
  const lit = `rgba(${GOLD}, ${Math.min(1, rim).toFixed(3)})`;
  const lw = Math.max(1, H * 0.012);
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.scale(H, H); // 之後座標單位 = 身高
  ctx.translate(0, bob);
  ctx.globalAlpha = Math.min(1, alpha);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const robe = ctx.createLinearGradient(-0.27, 0, 0.27, 0);
  robe.addColorStop(0, '#120c09');
  robe.addColorStop(0.55, '#050303');
  robe.addColorStop(1, '#0c0807');
  ctx.fillStyle = robe;
  ctx.strokeStyle = lit;
  ctx.lineWidth = lw / H;

  // 袍身：肩線 → 梯形下襬
  const sh = -0.72 + bow * 0.07; // 肩的高度（低頭時微降）
  ctx.beginPath();
  ctx.moveTo(-0.1, sh - 0.06);
  ctx.quadraticCurveTo(-0.2, sh - 0.01, -0.215, sh + 0.1);
  ctx.lineTo(-0.285, -0.01);
  ctx.quadraticCurveTo(0, 0.02, 0.285, -0.01);
  ctx.lineTo(0.215, sh + 0.1);
  ctx.quadraticCurveTo(0.2, sh - 0.01, 0.1, sh - 0.06);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // 腰帶
  ctx.beginPath();
  ctx.moveTo(-0.16, -0.38);
  ctx.quadraticCurveTo(0, -0.34, 0.16, -0.38);
  ctx.strokeStyle = `rgba(${GOLD}, ${(rim * 0.55).toFixed(3)})`;
  ctx.stroke();
  ctx.strokeStyle = lit;

  // 手臂：由肩到手；idle 垂下合十於胸前，raise 高舉過頭
  const armPts = (side) => {
    const sx = side * 0.185;
    const sy = sh + 0.09;
    const hx = side * (0.025 + 0.3 * raise);
    const hy = -0.46 - 0.62 * raise + 0.04 * bow;
    const ex = side * (0.22 + 0.1 * raise - 0.04 * (1 - raise));
    const ey = -0.52 - 0.28 * raise;
    return { sx, sy, hx, hy, ex, ey };
  };
  for (const side of [-1, 1]) {
    const a = armPts(side);
    ctx.beginPath();
    ctx.moveTo(a.sx, a.sy);
    ctx.quadraticCurveTo(a.ex, a.ey, a.hx, a.hy);
    ctx.strokeStyle = lit;
    ctx.lineWidth = 0.082 + lw / H;
    ctx.stroke();
    ctx.strokeStyle = '#060404';
    ctx.lineWidth = 0.082;
    ctx.stroke();
  }
  // 手（小圓）
  ctx.fillStyle = '#070505';
  ctx.strokeStyle = lit;
  ctx.lineWidth = lw / H;
  for (const side of [-1, 1]) {
    const a = armPts(side);
    ctx.beginPath();
    ctx.arc(a.hx, a.hy, 0.036, 0, TAU);
    ctx.fill();
    ctx.stroke();
  }

  // 兜帽（低頭時下沉並前傾，臉整個沒入陰影）
  const hy = -0.86 + bow * 0.17;
  ctx.fillStyle = robe;
  ctx.beginPath();
  ctx.moveTo(-0.125, hy + 0.1);
  ctx.quadraticCurveTo(-0.14, hy - 0.04, -0.045, hy - 0.115);
  ctx.quadraticCurveTo(0, hy - 0.15, 0.045, hy - 0.115);
  ctx.quadraticCurveTo(0.14, hy - 0.04, 0.125, hy + 0.1);
  ctx.quadraticCurveTo(0, hy + 0.14, -0.125, hy + 0.1);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = lit;
  ctx.stroke();
  // 臉：兜帽內的深洞，低頭時縮小變成頭頂
  const faceRy = 0.07 * (1 - bow * 1.3);
  if (faceRy > 0.006) {
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(0, hy + 0.01 + bow * 0.03, 0.058, faceRy, 0, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// DOM 控制器：以注入的 root 查詢元素，缺少的元素一律略過，不丟錯。
// ---------------------------------------------------------------------------

const 粒子數 = 40;
const 閃光毫秒 = 1600 + 200; // 與 style.css 的 --pulse-time 對齊再加一點餘裕

function detectReducedMotion() {
  try {
    return Boolean(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  } catch {
    return false;
  }
}

/** 重新觸發 CSS 動畫：先拿掉 class、強制重排、再加回。 */
function restartClass(el, name) {
  el.classList.remove(name);
  void el.offsetWidth;
  el.classList.add(name);
}

export function createSanctuary({ root = document, reducedMotion } = {}) {
  const reduced = reducedMotion ?? detectReducedMotion();
  const $ = (id) => root.getElementById?.(id) ?? root.querySelector?.(`#${id}`) ?? null;
  const doc = root.ownerDocument ?? (root.nodeType === 9 ? root : (typeof document !== 'undefined' ? document : undefined));
  const win = doc?.defaultView ?? globalThis;

  let dustTimer = null; // requestAnimationFrame id
  let dustCleanup = null;
  let pulseTimer = null;

  // ---- 場景（Canvas 2D 偽 3D）----
  const sceneApi = { cleanup: null, view: null };

  function setSceneState(state) {
    $('scene')?.setAttribute('data-state', state);
    if (sceneApi.view) sceneApi.view.state = state;
  }

  function mountScene() {
    const canvas = $('scene');
    if (!canvas || sceneApi.cleanup || !canvas.getContext) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const crossBtn = $('cross');
    const discs = discipleRings(12);
    const view = {
      state: canvas.getAttribute('data-state') || 'idle',
      t: 0, yaw: INITIAL_YAW, pitch: INITIAL_PITCH, zoom: 1,
      vyaw: 0, dragging: false, speed: 1, paused: false, idleFor: 0, autoRamp: 0,
      pose: { bow: 0, raise: 0 }, glow: 0.3, kick: 0, hover: 0,
      w: 0, h: 0, dirty: true,
    };
    sceneApi.view = view;
    let raf = null;
    let last = 0;
    let dpr = 1;
    let layout = null;

    const resize = () => {
      dpr = Math.min(win.devicePixelRatio || 1, 2);
      view.w = win.innerWidth;
      view.h = win.innerHeight;
      canvas.width = Math.round(view.w * dpr);
      canvas.height = Math.round(view.h * dpr);
      const u = Math.min(view.w, view.h);
      const baseY = view.h * (view.w < 600 ? RIG_CY_MOBILE : RIG_CY);
      const size = Math.min(u * CROSS_SIZE, 300);
      layout = { u, baseY, size, figH: u * FIGURE_SIZE };
      const st = doc?.documentElement?.style;
      if (st) {
        const btnW = Math.max(CROSS_HIT_MIN_W, size * 0.5);
        const btnH = Math.max(CROSS_HIT_MIN_H, size * 1.05);
        st.setProperty('--cross-x', `${view.w / 2}px`);
        st.setProperty('--cross-cy', `${baseY - size * 0.5}px`);
        st.setProperty('--cross-top', `${baseY - size - 10}px`);
        st.setProperty('--cross-w', `${btnW}px`);
        st.setProperty('--cross-h', `${btnH}px`);
      }
      view.dirty = true;
    };

    const poseTarget = () => {
      switch (view.state) {
        case 'bow': return { bow: 0.7, raise: 0 };
        case 'raise': return { bow: 0, raise: 1 };
        case 'still': return { bow: 1, raise: 0 };
        default: return { bow: 0, raise: 0 };
      }
    };
    const glowTarget = (time) => {
      if (view.state === 'raise') return 1;
      if (view.state === 'still') return 0.12;
      const breath = reduced ? 0 : 0.5 + 0.5 * Math.sin(time * 0.0012);
      return (view.state === 'bow' ? 0.4 : 0.3 + 0.12 * breath) + view.hover * 0.25;
    };

    const draw = (time) => {
      const { w, h } = view;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const { baseY, size, figH, u } = layout;
      const cyRel = baseY / h;
      const proj = discs.map((d) => ({
        d,
        p: projectDisciple(d, { t: view.t, yaw: view.yaw, pitch: view.pitch, zoom: view.zoom, width: w, height: h, cx: 0.5, cy: cyRel, swirl: SWIRL }),
      })).sort((a, b) => a.p.z - b.p.z);
      // 地面軌道環（極淡）
      ctx.lineWidth = 1;
      for (const r of [0.38, 0.62, 0.88]) {
        const R = r * u * 0.42 * view.zoom;
        ctx.strokeStyle = `rgba(${GOLD}, ${(0.05 + 0.04 * (1 - r)).toFixed(3)})`;
        ctx.beginPath();
        ctx.ellipse(w / 2, baseY, R, R * Math.sin(view.pitch), 0, 0, TAU);
        ctx.stroke();
      }
      const still = view.state === 'still';
      const drawOne = ({ d, p }) => {
        const alpha = clamp(1 - FOG * (1 - p.alpha), 0.05, 1);
        const sway = still || reduced ? 0 : Math.sin(time * 0.0015 + d.phase * 3);
        drawDisciple(ctx, p, { bow: view.pose.bow, raise: view.pose.raise, sway }, {
          height: figH * p.scale, alpha, rim: clamp(0.25 + 0.75 * alpha, 0, 1) * 0.55,
        });
      };
      let i = 0;
      for (; i < proj.length && proj[i].p.z < 0; i += 1) drawOne(proj[i]);
      drawCross(ctx, w / 2, baseY, size, clamp(view.glow + view.kick, 0, 1));
      for (; i < proj.length; i += 1) drawOne(proj[i]);
    };

    const step = (dt, time) => {
      // 軌道速度平滑趨近目標；暫停或 still 為 0
      const target = view.paused ? 0 : sceneSpeed(view.state);
      view.speed += (target - view.speed) * Math.min(1, dt * SPEED_EASE);
      if (Math.abs(target - view.speed) < 1e-3) view.speed = target;
      if (!reduced) {
        view.t += dt * view.speed;
        // 自動環繞：閒置 IDLE_DELAY_SEC 後平順恢復
        view.idleFor += dt;
        const wantAuto = view.idleFor > IDLE_DELAY_SEC && !view.dragging ? 1 : 0;
        view.autoRamp += (wantAuto - view.autoRamp) * Math.min(1, dt * AUTO_EASE);
        view.yaw += AUTO_YAW_SPEED * view.autoRamp * Math.min(1, view.speed) * dt;
        // 放開後的慣性
        if (!view.dragging && Math.abs(view.vyaw) > 1e-4) {
          view.yaw += view.vyaw * dt;
          view.vyaw *= Math.exp(-INERTIA_DECAY * dt);
        } else if (!view.dragging) view.vyaw = 0;
      }
      // 姿勢與光暈
      const pt = poseTarget();
      const k = reduced ? 1 : Math.min(1, dt * POSE_EASE);
      view.pose.bow += (pt.bow - view.pose.bow) * k;
      view.pose.raise += (pt.raise - view.pose.raise) * k;
      const gk = reduced ? 1 : Math.min(1, dt * GLOW_EASE);
      view.glow += (glowTarget(time) - view.glow) * gk;
      view.kick = reduced ? 0 : Math.max(0, view.kick - dt * 0.7);
    };

    const frame = (time) => {
      raf = win.requestAnimationFrame(frame);
      const dt = last ? Math.min(0.1, (time - last) / 1000) : 0;
      last = time;
      step(dt, time);
      if (!reduced || view.dirty) { draw(time); view.dirty = false; }
    };
    const onVisibility = () => {
      if (doc?.hidden) {
        if (raf !== null) { win.cancelAnimationFrame(raf); raf = null; }
      } else if (raf === null) { last = 0; raf = win.requestAnimationFrame(frame); }
    };

    // ---- 互動：拖曳（Pointer Events）、滾輪、雙指縮放、空白鍵 ----
    const pointers = new Map();
    let pinchDist = 0;
    let moved = 0;
    let suppressClick = false;
    let lastMoveT = 0;
    const touch = () => { view.idleFor = 0; view.dirty = true; };

    const onDown = (e) => {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      suppressClick = false;
      if (pointers.size === 1) { moved = 0; view.dragging = true; view.vyaw = 0; }
      else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
        suppressClick = true;
      }
      try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* 略 */ }
      touch();
    };
    const onMove = (e) => {
      const prev = pointers.get(e.pointerId);
      if (!prev) return;
      const cur = { x: e.clientX, y: e.clientY };
      pointers.set(e.pointerId, cur);
      if (pointers.size >= 2) {
        const [a, b] = [...pointers.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinchDist > 0 && dist > 0) view.zoom = clampZoom(view.zoom * (dist / pinchDist));
        pinchDist = dist;
        touch();
        return;
      }
      const dx = cur.x - prev.x;
      const dy = cur.y - prev.y;
      moved += Math.abs(dx) + Math.abs(dy);
      if (moved > DRAG_THRESHOLD_PX) {
        suppressClick = true;
        view.yaw += dx * YAW_PER_PX;
        view.pitch = clampPitch(view.pitch + dy * PITCH_PER_PX);
        const now = e.timeStamp || 0;
        const dtm = Math.max(8, now - lastMoveT) / 1000;
        lastMoveT = now;
        view.vyaw = clamp((dx * YAW_PER_PX) / dtm, -2, 2);
      }
      touch();
    };
    const onUp = (e) => {
      if (!pointers.delete(e.pointerId)) return;
      if (pointers.size < 2) pinchDist = 0;
      if (pointers.size === 0) {
        view.dragging = false;
        if (reduced || moved <= DRAG_THRESHOLD_PX) view.vyaw = 0;
        // 拖曳後那一下 click 要吃掉；用計時器清掉旗標以免影響之後的真點擊
        if (suppressClick) setTimeout(() => { suppressClick = false; }, 60);
      }
    };
    const onWheel = (e) => {
      if (e.target?.closest?.('dialog')) return;
      e.preventDefault();
      view.zoom = clampZoom(view.zoom * Math.exp(-e.deltaY * WHEEL_ZOOM));
      touch();
    };
    const interactive = /^(INPUT|TEXTAREA|SELECT|BUTTON|A|SUMMARY)$/;
    const onKey = (e) => {
      if (e.key !== ' ' && e.code !== 'Space') return;
      const t = e.target;
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      if (t && (interactive.test(t.tagName) || t.isContentEditable || t.closest?.('dialog'))) return;
      if (doc?.querySelector?.('dialog[open]')) return;
      e.preventDefault();
      view.paused = !view.paused;
    };
    const guardClick = (e) => {
      if (suppressClick) { e.preventDefault(); e.stopImmediatePropagation(); }
    };
    const hoverOn = () => { view.hover = 1; view.dirty = true; };
    const hoverOff = () => { view.hover = 0; view.dirty = true; };

    const targets = [canvas, crossBtn].filter(Boolean);
    for (const el of targets) {
      el.addEventListener('pointerdown', onDown);
      el.addEventListener('pointermove', onMove);
      el.addEventListener('pointerup', onUp);
      el.addEventListener('pointercancel', onUp);
    }
    crossBtn?.addEventListener('click', guardClick, true);
    crossBtn?.addEventListener('pointerenter', hoverOn);
    crossBtn?.addEventListener('pointerleave', hoverOff);
    crossBtn?.addEventListener('focus', hoverOn);
    crossBtn?.addEventListener('blur', hoverOff);
    win.addEventListener('wheel', onWheel, { passive: false });
    win.addEventListener('keydown', onKey);
    win.addEventListener('resize', resize);
    doc?.addEventListener?.('visibilitychange', onVisibility);

    resize();
    if (!doc?.hidden) raf = win.requestAnimationFrame(frame);
    sceneApi.cleanup = () => {
      if (raf !== null) win.cancelAnimationFrame(raf);
      raf = null;
      for (const el of targets) {
        el.removeEventListener('pointerdown', onDown);
        el.removeEventListener('pointermove', onMove);
        el.removeEventListener('pointerup', onUp);
        el.removeEventListener('pointercancel', onUp);
      }
      crossBtn?.removeEventListener('click', guardClick, true);
      crossBtn?.removeEventListener('pointerenter', hoverOn);
      crossBtn?.removeEventListener('pointerleave', hoverOff);
      crossBtn?.removeEventListener('focus', hoverOn);
      crossBtn?.removeEventListener('blur', hoverOff);
      win.removeEventListener('wheel', onWheel);
      win.removeEventListener('keydown', onKey);
      win.removeEventListener('resize', resize);
      doc?.removeEventListener?.('visibilitychange', onVisibility);
      sceneApi.view = null;
    };
  }

  function unmountScene() {
    sceneApi.cleanup?.();
    sceneApi.cleanup = null;
  }

  /** 場景目前的視角與狀態（驗證與除錯用）；未掛載回 null。 */
  function getSceneState() {
    const v = sceneApi.view;
    return v ? { state: v.state, yaw: v.yaw, pitch: v.pitch, zoom: v.zoom, t: v.t, paused: v.paused, speed: v.speed, glow: v.glow + v.kick, pose: { ...v.pose } } : null;
  }

  function getCrossRect() {
    return $('cross')?.getBoundingClientRect?.() ?? null;
  }

  /** 設定場景與光束的姿勢狀態。 */
  function setWorship(event) {
    const state = worshipState(event);
    setSceneState(state);
    $('beams')?.setAttribute('data-state', state);
    return state;
  }

  function startDust() {
    const canvas = $('dust');
    if (reduced || !canvas || dustCleanup || !canvas.getContext) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let w = 0;
    let h = 0;
    let motes = [];
    const resize = () => {
      const dpr = Math.min(win.devicePixelRatio || 1, 2);
      const ow = w;
      const oh = h;
      w = win.innerWidth;
      h = win.innerHeight;
      if (ow > 0 && oh > 0) {
        for (const m of motes) { m.x = (m.x / ow) * w; m.y = (m.y / oh) * h; }
      }
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    motes = Array.from({ length: 粒子數 }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      r: 0.6 + Math.random() * 1.6,
      vx: (Math.random() - 0.5) * 0.12,
      vy: -0.05 - Math.random() * 0.18,
      a: 0.12 + Math.random() * 0.3,
      ph: Math.random() * Math.PI * 2,
    }));
    const frame = (t) => {
      dustTimer = win.requestAnimationFrame(frame);
      ctx.clearRect(0, 0, w, h);
      for (const m of motes) {
        m.x += m.vx + Math.sin(t / 2500 + m.ph) * 0.08;
        m.y += m.vy;
        if (m.y < -4) { m.y = h + 4; m.x = Math.random() * w; }
        if (m.x < -4) m.x = w + 4;
        if (m.x > w + 4) m.x = -4;
        const twinkle = 0.65 + 0.35 * Math.sin(t / 1400 + m.ph);
        ctx.beginPath();
        ctx.fillStyle = `rgba(200, 170, 105, ${(m.a * twinkle).toFixed(3)})`;
        ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2);
        ctx.fill();
      }
    };
    const onVisibility = () => {
      if (doc?.hidden) {
        if (dustTimer !== null) { win.cancelAnimationFrame(dustTimer); dustTimer = null; }
      } else if (dustTimer === null) {
        dustTimer = win.requestAnimationFrame(frame);
      }
    };
    win.addEventListener('resize', resize);
    doc?.addEventListener?.('visibilitychange', onVisibility);
    dustCleanup = () => {
      win.removeEventListener('resize', resize);
      doc?.removeEventListener?.('visibilitychange', onVisibility);
      ctx.clearRect(0, 0, w, h);
    };
    // 分頁一開始就隱藏時不排程，等 visibilitychange 再啟動；cleanup 已登記，stopDust 仍可收拾。
    if (!doc?.hidden) dustTimer = win.requestAnimationFrame(frame);
  }

  function stopDust() {
    if (dustTimer !== null) win.cancelAnimationFrame(dustTimer);
    dustTimer = null;
    dustCleanup?.();
    dustCleanup = null;
  }

  /** 頂部光線一閃，暗角瞬間收緊（body.pulsing 驅動 ::after）。 */
  function pulse() {
    const el = $('beams');
    if (reduced) return;
    if (sceneApi.view) sceneApi.view.kick = 1;
    if (!el) return;
    restartClass(el, 'pulse');
    doc?.body && restartClass(doc.body, 'pulsing');
    clearTimeout(pulseTimer);
    pulseTimer = setTimeout(() => {
      el.classList.remove('pulse');
      doc?.body?.classList.remove('pulsing');
    }, 閃光毫秒);
  }

  function setBusy(on) {
    $('notice')?.classList.toggle('busy', Boolean(on));
  }

  function reveal({ verseEl, refEl, quipEl, text, kind } = {}) {
    const plan = ceremonyFor(kind);
    const verse = String(text ?? '');
    const late = [refEl, quipEl];
    for (const el of late) el?.classList.remove('reveal-late');
    if (!plan.animate || reduced) {
      if (verseEl) verseEl.textContent = verse;
      return { total: 0 };
    }
    const { chars, delays, total } = revealSchedule(verse);
    if (verseEl) {
      verseEl.textContent = '';
      const d = verseEl.ownerDocument ?? doc;
      const frag = d.createDocumentFragment();
      const full = d.createElement('span');
      full.className = 'visually-hidden';
      full.textContent = verse;
      frag.appendChild(full);
      chars.forEach((c, i) => {
        const span = d.createElement('span');
        span.className = 'ch';
        span.style.setProperty('--d', `${delays[i]}s`);
        span.setAttribute('aria-hidden', 'true');
        span.textContent = c;
        frag.appendChild(span);
      });
      verseEl.appendChild(frag);
    }
    const lateAt = [total, quipDelay(total)];
    late.forEach((el, i) => {
      if (!el) return;
      el.style.setProperty('--d', `${lateAt[i]}s`);
      restartClass(el, 'reveal-late');
    });
    return { total };
  }

  function calm() {
    clearTimeout(pulseTimer);
    pulseTimer = null;
    $('beams')?.classList.remove('pulse');
    doc?.body?.classList.remove('pulsing');
    setWorship('crisis');
    $('notice')?.classList.remove('busy');
    for (const el of root.querySelectorAll?.('.reveal-late, .ch') ?? []) {
      el.classList.remove('reveal-late');
      if (el.classList.contains('ch')) el.classList.remove('ch');
    }
  }

  return { mountScene, unmountScene, getSceneState, getCrossRect, setWorship, startDust, stopDust, pulse, setBusy, reveal, calm };
}
