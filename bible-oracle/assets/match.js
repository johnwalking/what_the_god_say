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
 *
 * 已知盲區：兩字輸入只切得出 1 個 bigram，MIN_OVERLAP = 2 讓向量層
 * 對純兩字查詢永遠不可能開火（例如「戀愛」「孤單」）。這是刻意的
 * 取捨，不調這個門檻 —— 短詞要靠關鍵字層（見 pickTopic）接住。
 */
export const MIN_OVERLAP = 2;

/**
 * 最後一道防線：topics.json 或 fallback.json 若設定錯誤而讓某個經文池
 * 變成空陣列，取模會得到 NaN、取出 undefined，緊接著存取 .ref 就會
 * 拋錯讓全站白畫面。這節經文抄自 app.js 的緊急經文池第一筆，字一個
 * 沒改，只是在 match.js 內部再放一份，讓這個函式不必依賴 app.js。
 */
const 安全兜底經文 = { ref: '以弗所書 5:22', id: 'Eph5v22', text: '你們作妻子的、當順服自己的丈夫、如同順服主．' };

/** 空池時的安全回傳；kind 仍是 'fallback'、tier 是 null，形狀與正常兜底一致。 */
function 空池安全回傳(data, 位移) {
  const 有包裝詞 = Array.isArray(data.wrappers) && data.wrappers.length > 0;
  return {
    kind: 'fallback',
    topicId: null,
    tier: null,
    ref: 安全兜底經文.ref,
    verseId: 安全兜底經文.id,
    text: 安全兜底經文.text,
    quip: 有包裝詞 ? data.wrappers[位移 % data.wrappers.length] : '主的旨意暫時答不出來，但祂還在。',
    index: 位移,
    poolSize: 0,
  };
}

const 標點與空白 = /[\s、。，．！？；：「」『』〔〕（）(),.!?;:'"~～\-—]/g;

/** 正規化輸入：全形轉半形、去標點空白、轉小寫。中文不需要斷詞。 */
export function normalize(input) {
  return String(input ?? '')
    .replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(標點與空白, '')
    .toLowerCase();
}

/**
 * 安全閘：自傷相關輸入不走諷刺流程。
 * 這份清單與 server/safety.py 的 _PATTERNS 逐字相同（server/test_safety_parity.py 會比對），
 * 改一邊必須同步改另一邊。比對對象是 normalize 之後的文字。
 */
export const CARE_MESSAGE =
  '聽起來你現在很辛苦。這個網站只是在開玩笑，請不要把它當成答案。如果你有傷害自己的念頭，請現在撥打 1925（24 小時安心專線）或 1995（生命線）；若有立即的危險，請撥 119。你不需要一個人撐著。';

const 危機樣式 = [
  '想死(?!你)',
  '不想(再)?活',
  '自殺',
  '輕生',
  '尋死',
  '去死',
  '結束.{0,3}生命',
  '結束自己',
  '了結自己',
  '活不下去',
  '不想存在',
  '想消失',
  '割腕',
  '跳樓',
  '上吊',
  '燒炭',
  '吞藥',
  '死了算了',
  '死掉算了',
  '活著沒意思',
  '活著好累',
  '自我了[結斷结断]',
  '了[結斷结断]自己',
  '活不了了',
  '想不開',
  '(吃|吞|服|嗑|灌).{0,4}安眠藥',
  '傷害自己',
  '割自己',
  '(想|要|從|爬上).{0,6}跳下去(?!游泳)',
  '不如死',
  '活著沒(有)?意義',
  '自杀',
  '轻生',
  '寻死',
  '跳楼',
  '烧炭',
  '吞药',
  '结束.{0,3}生命',
  '结束自己',
  '了结自己',
  '想不开',
  '(吃|吞|服|嗑|灌).{0,4}安眠药',
  '伤害自己',
  '活着没(有)?意[义思]',
  '活着好累',
  'kill(ing)?myself',
  'suicid',
  'kms',
];
const 危機正規式 = new RegExp(危機樣式.join('|'));

export function isCrisis(text) {
  return 危機正規式.test(normalize(text));
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
 * @param {{topics: Array, fallback: Array, wrappers: string[], index: object|null}} data
 *   index 是 buildTopicIndex(topics) 建好的向量索引；省略或傳 null 時退化成純關鍵字比對
 * @param {number} n 「再求一次」的位移，同時也是網址上的 n 參數
 */
export function answer(question, data, n = 0) {
  // 任何呼叫端（含 API 失敗時的靜態退路）都不能繞過安全閘
  if (isCrisis(question)) {
    return {
      kind: 'crisis',
      topicId: null,
      tier: null,
      ref: '',
      verseId: '',
      text: CARE_MESSAGE,
      quip: '',
      index: 0,
      poolSize: 0,
    };
  }
  const normalized = normalize(question);
  const seed = hashFNV1a(normalized);
  // n 來自網址參數，使用者可竄改；非負整數以外一律當作 0
  const 位移 = Number.isInteger(n) && n >= 0 ? n : 0;
  const 命中 = pickTopic(normalized, data.topics, data.index ?? null);

  if (命中) {
    if (命中.topic.verses.length === 0) return 空池安全回傳(data, 位移);
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

  if (!data.fallback || data.fallback.length === 0) return 空池安全回傳(data, 位移);
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
