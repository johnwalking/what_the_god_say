/**
 * 把答案畫成一張 840×1200 的直式卡，供分享用。
 * 中文沒有詞界，換行只能逐字量寬度，不能靠空白切。
 */
const 寬 = 840;
const 高 = 1200;
const 邊距 = 90;
const 紙色 = '#0b0907';
const 墨色 = '#e9dfc7';
const 金色 = '#d8b45a';
const 淡色 = '#a8957a';
const 字體 = '"Noto Serif TC", "Songti TC", "PMingLiU", serif';

/** 逐字累加量寬，超過就換行。回傳每一行的字串。 */
function wrapCJK(ctx, text, maxWidth) {
  const lines = [];
  let line = '';
  for (const ch of text) {
    const 試 = line + ch;
    if (ctx.measureText(試).width > maxWidth && line !== '') {
      lines.push(line);
      line = ch;
    } else {
      line = 試;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** 畫出多行文字，回傳畫完之後的 y 座標。 */
function drawLines(ctx, lines, x, y, lineHeight) {
  let cursor = y;
  for (const line of lines) {
    ctx.fillText(line, x, cursor);
    cursor += lineHeight;
  }
  return cursor;
}

export async function drawCard(result, question) {
  const canvas = document.createElement('canvas');
  canvas.width = 寬;
  canvas.height = 高;
  const ctx = canvas.getContext('2d');

  // 字型要先確定載好，否則會用預設字型畫出來
  if (document.fonts && document.fonts.ready) {
    await document.fonts.ready;
  }

  ctx.fillStyle = 紙色;
  ctx.fillRect(0, 0, 寬, 高);

  // 上下金線
  ctx.fillStyle = 金色;
  ctx.globalAlpha = 0.55;
  ctx.fillRect(邊距, 120, 寬 - 邊距 * 2, 1);
  ctx.fillRect(邊距, 高 - 150, 寬 - 邊距 * 2, 1);
  ctx.globalAlpha = 1;

  // 站名
  ctx.fillStyle = 墨色;
  ctx.font = `36px ${字體}`;
  ctx.textAlign = 'center';
  ctx.fillText('主 的 旨 意', 寬 / 2, 90);

  ctx.textAlign = 'left';
  const 內寬 = 寬 - 邊距 * 2;
  let y = 210;

  // 問題
  ctx.fillStyle = 淡色;
  ctx.font = `26px ${字體}`;
  const 問 = question.length > 40 ? `${question.slice(0, 40)}⋯` : question;
  y = drawLines(ctx, wrapCJK(ctx, `你問：${問}`, 內寬), 邊距, y, 44) + 60;

  // 經文
  ctx.fillStyle = 墨色;
  ctx.font = `40px ${字體}`;
  y = drawLines(ctx, wrapCJK(ctx, result.text, 內寬), 邊距, y, 72) + 30;

  // 出處
  ctx.fillStyle = 金色;
  ctx.font = `26px ${字體}`;
  ctx.textAlign = 'right';
  ctx.fillText(`—— ${result.ref}`, 寬 - 邊距, y);
  ctx.textAlign = 'left';
  y += 90;

  // 補刀（上方一條淡金分隔線）
  ctx.fillStyle = 金色;
  ctx.globalAlpha = 0.35;
  ctx.fillRect(邊距, y - 40, 內寬, 1);
  ctx.globalAlpha = 1;
  ctx.fillStyle = 淡色;
  ctx.font = `28px ${字體}`;
  drawLines(ctx, wrapCJK(ctx, result.quip, 內寬), 邊距, y, 48);

  // 頁腳
  ctx.fillStyle = 淡色;
  ctx.font = `22px ${字體}`;
  ctx.textAlign = 'center';
  ctx.fillText('經文引自和合本，一字未改。', 寬 / 2, 高 - 100);

  return canvas;
}

export async function downloadCard(result, question) {
  const canvas = await drawCard(result, question);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('產圖失敗');
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `主的旨意-${result.ref.replace(/[\s:]/g, '')}.png`;
  // 部分瀏覽器要求觸發下載的 <a> 已掛在 DOM 上，且過早 revokeObjectURL
  // 會在下載真的開始前就把 blob 吊銷，所以先掛上、點擊、移除，
  // revokeObjectURL 延後到下一輪事件迴圈之後再做。
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
