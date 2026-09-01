/**
 * 字元 bigram 的 TF-IDF 餘弦相似度。純數學，與聖經無關。
 *
 * 刻意不使用 unigram：實測加入單字元特徵後，「我、的、很、每、天」這類
 * 高頻字會造成假相似 —— 「主管每天罵我」會因為與「每天都想死」共用字元
 * 而被判成憂鬱主題。
 */

/** 把已正規化的字串切成字元 bigram 的計數表。 */
export function bigramCounts(normalized) {
  const counts = {};
  for (let i = 0; i < normalized.length - 1; i += 1) {
    const gram = normalized.slice(i, i + 2);
    counts[gram] = (counts[gram] || 0) + 1;
  }
  return counts;
}

/** L2 正規化，之後算餘弦相似度只需要做點積。 */
function l2Normalize(vec) {
  let sum = 0;
  for (const gram in vec) sum += vec[gram] * vec[gram];
  const length = Math.sqrt(sum) || 1;
  const out = {};
  for (const gram in vec) out[gram] = vec[gram] / length;
  return out;
}

/** 用 idf 加權並正規化。不在 idf 表中的組合權重視為 0，直接略過。 */
function weigh(counts, idf) {
  const vec = {};
  for (const gram in counts) {
    const weight = idf[gram];
    if (weight) vec[gram] = counts[gram] * weight;
  }
  return l2Normalize(vec);
}

/**
 * 建索引。
 * @param {{id: string, texts: string[]}[]} docs
 *   texts 必須已經正規化過，且**逐句分開**傳入 —— 不要先串接再切，
 *   否則會生出跨句邊界的假組合（「我老婆」+「老闆很爛」會生出「婆老」）。
 */
export function buildIndex(docs) {
  const counted = docs.map((doc) => {
    const merged = {};
    for (const text of doc.texts) {
      const counts = bigramCounts(text);
      for (const gram in counts) merged[gram] = (merged[gram] || 0) + counts[gram];
    }
    return { id: doc.id, counts: merged };
  });

  const documentFrequency = {};
  for (const doc of counted) {
    for (const gram in doc.counts) {
      documentFrequency[gram] = (documentFrequency[gram] || 0) + 1;
    }
  }

  const total = counted.length;
  const idf = {};
  for (const gram in documentFrequency) {
    // 出現在每一份文件的組合會得到 0，等於自動被忽略
    idf[gram] = Math.log((total + 1) / (documentFrequency[gram] + 1));
  }

  return {
    idf,
    vectors: counted.map((doc) => ({ id: doc.id, vec: weigh(doc.counts, idf) })),
  };
}

function dot(a, b) {
  let sum = 0;
  let overlap = 0;
  for (const gram in a) {
    if (b[gram]) {
      sum += a[gram] * b[gram];
      overlap += 1;
    }
  }
  return { score: sum, overlap };
}

/**
 * 查詢，回傳依相似度由高到低排序的 [{id, score, overlap}]。
 * overlap 是查詢與該主題共同擁有的 bigram 數量 —— 呼叫端用它擋掉
 * 「只靠單一個罕見組合湊巧重疊」的假命中（那種組合 IDF 高，
 * 在短句上足以獨力把餘弦值推過門檻）。
 */
export function query(index, normalized) {
  const vec = weigh(bigramCounts(normalized), index.idf);
  return index.vectors
    .map((entry) => ({ id: entry.id, ...dot(vec, entry.vec) }))
    .sort((a, b) => b.score - a.score);
}
