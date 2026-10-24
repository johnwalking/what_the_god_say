/**
 * 聖殿的視覺：純函式（可在 node 下測試）加 DOM 控制器。
 * 這個檔案的上半部不碰 DOM。
 */

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

// ---------------------------------------------------------------------------
// 教徒：兩排跪拜剪影。以下皆為純函式，不碰 DOM。
// ---------------------------------------------------------------------------

/** 簡單 LCG（Numerical Recipes 參數），回傳 [0,1) 的確定性亂數產生器。 */
function lcg(seed) {
  let state = (Number(seed) >>> 0) || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * 排出教徒的位置：x（0–100 的百分比）沿畫面均分成 count 個槽再加確定性抖動，
 * 抖動幅度受限，使任兩人相鄰 x 差 ≥ 4；奇偶交錯前後排（後排 row=0 較小、前排 row=1 較大）。
 */
export function worshipLayout({ count = 11, seed = 7 } = {}) {
  const rand = lcg(seed);
  const n = Math.max(0, Math.floor(count));
  const slot = n > 0 ? 100 / n : 0;
  const jitter = Math.max(0, Math.min(2.5, (slot - 4.2) / 2));
  const list = [];
  for (let i = 0; i < n; i += 1) {
    const row = i % 2 === 0 ? 0 : 1;
    const x = (i + 0.5) * slot + (rand() * 2 - 1) * jitter;
    const scale = row === 0 ? 0.8 + rand() * 0.15 : 0.97 + rand() * 0.18;
    list.push({
      x: round2(Math.min(100, Math.max(0, x))),
      scale: round2(Math.min(1.15, scale)),
      row,
      delay: round2(rand() * 6),
      flip: rand() < 0.5,
    });
  }
  return list;
}

/**
 * 單一教徒（面向右的側影，跪坐）。viewBox 100×100，地面在 y≈97，髖部約 (40,64)。
 * 巢狀結構：w-torso 內含身體、w-head、兩組手臂，所以 CSS 旋轉/呼吸 w-torso 時整個上半身一起動。
 * 純色，繼承 currentColor。
 */
export function worshipperSVG() {
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="currentColor" stroke="currentColor" aria-hidden="true" focusable="false">'
    // 小腿貼地、大腿由膝蓋斜上至髖部
    + '<g class="w-legs" fill="none" stroke-linecap="round" stroke-linejoin="round">'
    + '<path d="M16 91.5H61" stroke-width="11"/>'
    + '<path d="M59 86L41 63" stroke-width="15"/>'
    + '</g>'
    + '<g class="w-torso">'
    // 駝背的上身
    + '<path class="w-back" d="M34 68C27 52 33 35 46 32C54 31 56 40 53 52C51 60 49 66 47 71Z" stroke="none"/>'
    + '<g class="w-head">'
    + '<path d="M49 33L52 27" fill="none" stroke-width="5.5" stroke-linecap="round"/>'
    + '<circle cx="53" cy="21" r="7.4" stroke="none"/>'
    + '</g>'
    // 雙手合十，低垂於身前
    + '<g class="w-arms-down" fill="none" stroke-linecap="round">'
    + '<path d="M47 40L55 57L67 46" stroke-width="5.5" stroke-linejoin="round"/>'
    + '<ellipse cx="68" cy="45" rx="4.6" ry="3.4" transform="rotate(-35 68 45)" stroke="none" fill="currentColor"/>'
    + '</g>'
    // 雙手高舉
    + '<g class="w-arms-up" fill="none" stroke-linecap="round">'
    + '<path d="M49 38Q72 34 78 6" stroke-width="6.5"/>'
    + '<path d="M52 42Q80 40 86 12" stroke-width="5" opacity="0.85"/>'
    + '<circle cx="78.5" cy="4.5" r="4.2" stroke="none" fill="currentColor"/>'
    + '<circle cx="86.5" cy="9.5" r="3.6" stroke="none" fill="currentColor"/>'
    + '</g>'
    + '</g>'
    + '</svg>';
}

/** 把 layout 轉成 DOM 字串；位置/縮放/呼吸延遲走 CSS 自訂屬性。 */
export function congregationHTML(layout) {
  const svg = worshipperSVG();
  return (layout ?? [])
    .map((w) => `<div class="worshipper${w.flip ? ' flip' : ''}" style="--x:${w.x}%;--s:${w.scale};--d:${w.delay}s" data-row="${w.row}">${svg}</div>`)
    .join('');
}

const 教徒狀態 = { load: 'idle', ask: 'bow', reveal: 'raise', crisis: 'still', reset: 'idle' };

/** 事件 → 教徒姿勢（未知事件一律回到 idle）。 */
export function worshipState(event) {
  return Object.hasOwn(教徒狀態, event) ? 教徒狀態[event] : 'idle';
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

  function mountCongregation() {
    const el = $('congregation');
    if (el) el.innerHTML = congregationHTML(worshipLayout());
  }

  /** 設定教徒姿勢；光柱（#beams）跟著同一個狀態，reducedMotion 時 CSS 不做過渡。 */
  function setWorship(event) {
    const state = worshipState(event);
    $('congregation')?.setAttribute('data-state', state);
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
    if (!el || reduced) return;
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

  return { mountCongregation, setWorship, startDust, stopDust, pulse, setBusy, reveal, calm };
}
