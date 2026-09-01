/**
 * 比對邏輯：把使用者的問題對應到一節經文。
 * 純函式，不碰 DOM、不讀檔，所以可以直接在 node 下測試。
 */
import { buildIndex, query } from './vector.js';

/** 主題命中門檻：至少一個核心詞（3 分），或三個邊緣詞。 */
export const THRESHOLD = 3;

/** 向量層的餘弦相似度門檻。實測 0.02–0.10 對負面案例都無誤判，取中間值。 */
export const COSINE_THRESHOLD = 0.05;

/**
 * 向量層最少要重疊幾個 bigram 才採信。
 * 只重疊一個時，若那個組合恰好罕見（IDF 高），在短句上足以獨力
 * 把餘弦值推過門檻 ——「我家的貓不吃飯」就是靠單一個「我家」
 * 命中管教小孩，得分 0.11。要求兩個以上可擋掉這類巧合。
 */
export const MIN_OVERLAP = 2;

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

/**
 * 由主題的 phrases 建向量索引。呼叫端建一次，之後每次查詢重複使用。
 * 例句逐句傳入，不要先串接 —— 否則會生出跨句邊界的假組合。
 */
export function buildTopicIndex(topics) {
  return buildIndex(
    topics.map((topic) => ({
      id: topic.id,
      texts: (topic.phrases ?? []).map((phrase) => normalize(phrase)),
    })),
  );
}

/**
 * 選主題。兩層：先精準的加權關鍵字，落空才用寬鬆的向量相似度。
 * @returns {{topic: object, tier: 'keyword'|'vector'} | null}
 */
export function pickTopic(normalized, topics, index = null) {
  const ranked = topics
    .map((topic) => ({ topic, score: scoreTopic(normalized, topic) }))
    .filter((entry) => entry.score >= THRESHOLD)
    .sort((a, b) => b.score - a.score || b.topic.keywords.length - a.topic.keywords.length);
  if (ranked.length > 0) return { topic: ranked[0].topic, tier: 'keyword' };

  if (!index) return null;
  const [best] = query(index, normalized);
  if (!best || best.score < COSINE_THRESHOLD || best.overlap < MIN_OVERLAP) return null;
  const topic = topics.find((entry) => entry.id === best.id);
  return topic ? { topic, tier: 'vector' } : null;
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
  // n 來自網址參數，使用者可竄改；非負整數以外一律當作 0
  const 位移 = Number.isInteger(n) && n >= 0 ? n : 0;
  const 命中 = pickTopic(normalized, data.topics, data.index ?? null);

  if (命中) {
    const verse = 命中.topic.verses[(seed + 位移) % 命中.topic.verses.length];
    return {
      kind: 'topic',
      topicId: 命中.topic.id,
      tier: 命中.tier,
      ref: verse.ref,
      verseId: verse.id,
      text: verse.text,
      quip: verse.quip,
      index: 位移,
      poolSize: 命中.topic.verses.length,
    };
  }

  const verse = data.fallback[(seed + 位移) % data.fallback.length];
  return {
    kind: 'fallback',
    topicId: null,
    tier: null,
    ref: verse.ref,
    verseId: verse.id,
    text: verse.text,
    quip: data.wrappers[(seed + 位移) % data.wrappers.length],
    index: 位移,
    poolSize: data.fallback.length,
  };
}
