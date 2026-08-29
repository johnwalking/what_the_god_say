/**
 * 比對邏輯：把使用者的問題對應到一節經文。
 * 純函式，不碰 DOM、不讀檔，所以可以直接在 node 下測試。
 */

/** 主題命中門檻：至少一個核心詞（3 分），或三個邊緣詞。 */
export const THRESHOLD = 3;

const 標點與空白 = /[\s、。，．！？；：「」『』〔〕（）(),.!?;:'"~～\-—]/g;

/** 正規化輸入：全形轉半形、去標點空白、轉小寫。中文不需要斷詞。 */
export function normalize(input) {
  return String(input ?? '')
    .replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(標點與空白, '')
    .toLowerCase();
}

/** FNV-1a 32-bit。用來把問題字串轉成穩定的亂數種子，確保分享出去的連結重現同一張卡。 */
export function hashFNV1a(str) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** 主題分數 = 所有命中關鍵字的權重總和。 */
export function scoreTopic(normalized, topic) {
  let score = 0;
  for (const keyword of topic.keywords) {
    if (normalized.includes(keyword.w)) score += keyword.s;
  }
  return score;
}

/** 取分數最高且達門檻的主題；同分時取關鍵字表較長者（較具體）。 */
export function pickTopic(normalized, topics) {
  const ranked = topics
    .map((topic) => ({ topic, score: scoreTopic(normalized, topic) }))
    .filter((entry) => entry.score >= THRESHOLD)
    .sort((a, b) => b.score - a.score || b.topic.keywords.length - a.topic.keywords.length);
  return ranked.length > 0 ? ranked[0].topic : null;
}

/**
 * 回答一個問題。
 * @param {string} question 使用者原始輸入
 * @param {{topics: Array, fallback: Array, wrappers: string[]}} data
 * @param {number} n 「再求一次」的位移，同時也是網址上的 n 參數
 */
export function answer(question, data, n = 0) {
  const normalized = normalize(question);
  const seed = hashFNV1a(normalized);
  const topic = pickTopic(normalized, data.topics);

  if (topic) {
    const verse = topic.verses[(seed + n) % topic.verses.length];
    return {
      kind: 'topic',
      topicId: topic.id,
      ref: verse.ref,
      verseId: verse.id,
      text: verse.text,
      quip: verse.quip,
      index: n,
      poolSize: topic.verses.length,
    };
  }

  const verse = data.fallback[(seed + n) % data.fallback.length];
  return {
    kind: 'fallback',
    topicId: null,
    ref: verse.ref,
    verseId: verse.id,
    text: verse.text,
    quip: data.wrappers[(seed + n) % data.wrappers.length],
    index: n,
    poolSize: data.fallback.length,
  };
}
