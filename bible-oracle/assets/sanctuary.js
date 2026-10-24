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
