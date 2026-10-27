// 從 stdin 讀問題陣列，用前端既有的比對邏輯作答，輸出 JSON。
import fs from 'node:fs';
import { answer, buildTopicIndex } from '../assets/match.js';

const read = (name) => JSON.parse(fs.readFileSync(new URL(`../data/${name}`, import.meta.url), 'utf8'));
const topicsFile = read('topics.json');
// --extras：比照前端靜態模式，把 extra_topics.json 的日常主題接在後面；預設行為不變（B0）
const topics = process.argv.includes('--extras')
  ? [...topicsFile.topics, ...read('extra_topics.json').topics]
  : topicsFile.topics;
const data = {
  topics,
  wrappers: topicsFile.wrappers,
  fallback: read('fallback.json'),
  index: buildTopicIndex(topics),
};

const questions = JSON.parse(fs.readFileSync(0, 'utf8'));
const results = questions.map((q) => {
  const r = answer(q, data, 0);
  return { kind: r.kind, verseId: r.verseId, ref: r.ref, text: r.text, quip: r.quip };
});
console.log(JSON.stringify(results));
