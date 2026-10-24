/**
 * 聖殿的視覺：純函式（可在 node 下測試）加 DOM 控制器（Task 3 加入）。
 * 這個檔案的上半部不碰 DOM。
 */

/** 逐碼點拆字，讓罕用字（surrogate pair）不會被切成兩半。 */
export function splitGraphemes(text) {
  return Array.from(String(text ?? ''));
}

const round3 = (n) => Math.round(n * 1000) / 1000;

/** 經文逐字浮現的排程：每字一個延遲秒數，總長被壓在 maxTotal 以內。 */
export function revealSchedule(text, { startDelay = 0.2, perChar = 0.06, maxTotal = 4.5 } = {}) {
  const chars = splitGraphemes(text);
  if (chars.length === 0) return { chars, delays: [], total: 0 };
  const step = Math.min(perChar, (maxTotal - startDelay) / chars.length);
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

const 玻璃色 = ['#7a1f2b', '#1f3a6b', '#c8a13a', '#2c6b4a', '#5b2a6b', '#a8432a'];

function polar(c, r, a) {
  return [c + r * Math.cos(a), c + r * Math.sin(a)];
}

/** 環形扇面：外弧順時針、內弧逆時針封閉。 */
function wedge(c, r0, r1, a0, a1) {
  const f = (n) => n.toFixed(2);
  const [x0, y0] = polar(c, r1, a0);
  const [x1, y1] = polar(c, r1, a1);
  const [x2, y2] = polar(c, r0, a1);
  const [x3, y3] = polar(c, r0, a0);
  return `M${f(x0)} ${f(y0)} A${f(r1)} ${f(r1)} 0 0 1 ${f(x1)} ${f(y1)} L${f(x2)} ${f(y2)} A${f(r0)} ${f(r0)} 0 0 0 ${f(x3)} ${f(y3)} Z`;
}

/** 玫瑰窗：外圈大花瓣、內圈小花瓣、三道金環與中心圓。純字串，方便測試。 */
export function roseWindowSVG({ petals = 12, size = 400 } = {}) {
  const c = size / 2;
  const step = (Math.PI * 2) / petals;
  const gap = step * 0.06;
  const paths = [];
  for (let i = 0; i < petals; i += 1) {
    const a0 = i * step + gap;
    const a1 = (i + 1) * step - gap;
    paths.push(`<path d="${wedge(c, c * 0.42, c * 0.92, a0, a1)}" fill="${玻璃色[i % 玻璃色.length]}"/>`);
    paths.push(`<path d="${wedge(c, c * 0.12, c * 0.38, a0, a1)}" fill="${玻璃色[(i + 3) % 玻璃色.length]}"/>`);
  }
  const ring = (r) => `<circle cx="${c}" cy="${c}" r="${(c * r).toFixed(2)}" fill="none" stroke="#d8b45a" stroke-width="2"/>`;
  const core = `<circle cx="${c}" cy="${c}" r="${(c * 0.1).toFixed(2)}" fill="#d8b45a"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" role="img" aria-label="玫瑰窗">${paths.join('')}${ring(0.95)}${ring(0.4)}${ring(0.12)}${core}</svg>`;
}

// ---------------------------------------------------------------------------
// DOM 控制器：以注入的 root 查詢元素，缺少的元素一律略過，不丟錯。
// ---------------------------------------------------------------------------

const 粒子數 = 60;
const 入口動畫毫秒 = 2400 + 300; // 與 style.css 的 --gate-open 對齊再加一點餘裕
const 光環毫秒 = 1600 + 200;

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
  const doc = root.ownerDocument ?? (root.nodeType === 9 ? root : globalThis.document);
  const win = doc?.defaultView ?? globalThis;

  let dustTimer = null; // requestAnimationFrame id
  let dustCleanup = null;
  let pulseTimer = null;
  let gateTimer = null;

  function mountWindow() {
    const el = $('rose-window');
    if (el) el.innerHTML = roseWindowSVG();
  }

  function startDust() {
    const canvas = $('dust');
    if (reduced || !canvas || dustCleanup || !canvas.getContext) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let w = 0;
    let h = 0;
    const resize = () => {
      const dpr = Math.min(win.devicePixelRatio || 1, 2);
      w = win.innerWidth;
      h = win.innerHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const motes = Array.from({ length: 粒子數 }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      r: 0.6 + Math.random() * 1.6,
      vx: (Math.random() - 0.5) * 0.12,
      vy: -0.05 - Math.random() * 0.18,
      a: 0.2 + Math.random() * 0.5,
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
        ctx.fillStyle = `rgba(232, 200, 120, ${(m.a * twinkle).toFixed(3)})`;
        ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2);
        ctx.fill();
      }
    };
    const onVisibility = () => {
      if (doc.hidden) {
        if (dustTimer !== null) { win.cancelAnimationFrame(dustTimer); dustTimer = null; }
      } else if (dustTimer === null) {
        dustTimer = win.requestAnimationFrame(frame);
      }
    };
    win.addEventListener('resize', resize);
    doc.addEventListener('visibilitychange', onVisibility);
    dustCleanup = () => {
      win.removeEventListener('resize', resize);
      doc.removeEventListener('visibilitychange', onVisibility);
      ctx.clearRect(0, 0, w, h);
    };
    // 分頁一開始就隱藏時不排程，等 visibilitychange 再啟動；cleanup 已登記，stopDust 仍可收拾。
    if (!doc.hidden) dustTimer = win.requestAnimationFrame(frame);
  }

  function stopDust() {
    if (dustTimer !== null) win.cancelAnimationFrame(dustTimer);
    dustTimer = null;
    dustCleanup?.();
    dustCleanup = null;
  }

  function openGate() {
    const gate = $('gate');
    const main = root.querySelector?.('main.page') ?? root.querySelector?.('.page');
    doc?.body?.classList.add('entered');
    const finish = () => {
      clearTimeout(gateTimer);
      gateTimer = null;
      if (gate) gate.hidden = true;
      main?.removeAttribute('inert');
      $('mute')?.removeAttribute('hidden');
    };
    if (!gate) { finish(); return; }
    gate.classList.add('open');
    clearTimeout(gateTimer);
    gateTimer = setTimeout(finish, reduced ? 1000 : 入口動畫毫秒);
  }

  function pulse() {
    const el = $('rose-window');
    if (!el || reduced) return;
    restartClass(el, 'pulse');
    clearTimeout(pulseTimer);
    pulseTimer = setTimeout(() => el.classList.remove('pulse'), 光環毫秒);
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
      if (verseEl) {
        verseEl.textContent = verse;
        verseEl.removeAttribute('aria-label');
      }
      return { total: 0 };
    }
    const { chars, delays, total } = revealSchedule(verse);
    if (verseEl) {
      verseEl.textContent = '';
      verseEl.setAttribute('aria-label', verse);
      const frag = (verseEl.ownerDocument ?? doc).createDocumentFragment();
      chars.forEach((c, i) => {
        const span = (verseEl.ownerDocument ?? doc).createElement('span');
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
    $('rose-window')?.classList.remove('pulse');
    $('notice')?.classList.remove('busy');
    for (const el of root.querySelectorAll?.('.reveal-late, .ch') ?? []) {
      el.classList.remove('reveal-late');
      if (el.classList.contains('ch')) el.classList.remove('ch');
    }
  }

  return { mountWindow, startDust, stopDust, openGate, pulse, setBusy, reveal, calm };
}
