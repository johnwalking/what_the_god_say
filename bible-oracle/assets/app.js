/**
 * 接線層：載資料、綁事件、渲染。
 * 這裡不放任何業務邏輯 —— 比對規則全在 match.js。
 */
import { answer, buildTopicIndex, isCrisis, CARE_MESSAGE } from './match.js';
import { downloadCard } from './card.js';
import { createSanctuary } from './sanctuary.js';
import { createAudio } from './audio.js';

/** topics.json 或 fallback.json 掛掉時的緊急經文池，確保網站永遠答得出來。 */
const 緊急經文池 = [
  { ref: '以弗所書 5:22', id: 'Eph5v22', text: '你們作妻子的、當順服自己的丈夫、如同順服主．' },
  { ref: '以弗所書 6:5', id: 'Eph6v5', text: '你們作僕人的、要懼怕戰兢、用誠實的心聽從你們肉身的主人、好像聽從基督一般。' },
  { ref: '歌羅西書 3:18', id: 'Col3v18', text: '你們作妻子的、當順服自己的丈夫、這在主裡面是相宜的。' },
  { ref: '歌羅西書 3:22', id: 'Col3v22', text: '你們作僕人的、要凡事聽從你們肉身的主人、不要只在眼前事奉、像是討人喜歡的、總要存心誠實敬畏主．' },
  { ref: '彼得前書 3:1', id: '1Pet3v1', text: '你們作妻子的、要順服自己的丈夫．這樣、若有不信從道理的丈夫、他們雖然不聽道、也可以因妻子的品行被感化過來．' },
  { ref: '彼得前書 2:18', id: '1Pet2v18', text: '你們作僕人的、凡事要存敬畏的心順服主人．不但順服那善良溫和的、就是那乖僻的也要順服。' },
  { ref: '箴言 21:9', id: 'Prov21v9', text: '寧可住在房頂的角上、不在寬闊的房屋、與爭吵的婦人同住。' },
  { ref: '箴言 27:15', id: 'Prov27v15', text: '大雨之日連連滴漏、和爭吵的婦人一樣．' },
  { ref: '箴言 22:7', id: 'Prov22v7', text: '富戶管轄窮人．欠債的是債主的僕人。' },
  { ref: '箴言 17:22', id: 'Prov17v22', text: '喜樂的心、乃是良藥．憂傷的靈、使骨枯乾。' },
  { ref: '箴言 13:24', id: 'Prov13v24', text: '不忍用杖打兒子的、是恨惡他．疼愛兒子的、隨時管教。' },
  { ref: '提摩太前書 2:12', id: '1Tim2v12', text: '我不許女人講道、也不許他轄管男人、只要沉靜。' },
  { ref: '提摩太前書 6:10', id: '1Tim6v10', text: '貪財是萬惡之根．有人貪戀錢財、就被引誘離了真道、用許多愁苦把自己刺透了。' },
  { ref: '提摩太前書 6:1', id: '1Tim6v1', text: '凡在軛下作僕人的、當以自己主人配受十分的恭敬、免得神的名和道理、被人褻瀆。' },
  { ref: '馬太福音 6:24', id: 'Matt6v24', text: '一個人不能事奉兩個主．不是惡這個愛那個、就是重這個輕那個．你們不能又事奉神、又事奉瑪門。〔瑪門是財利的意思〕' },
  { ref: '馬太福音 6:34', id: 'Matt6v34', text: '所以不要為明天憂慮．因為明天自有明天的憂慮．一天的難處一天當就夠了。' },
  { ref: '馬太福音 19:24', id: 'Matt19v24', text: '我又告訴你們、駱駝穿過鍼的眼、比財主進神的國還容易呢。' },
  { ref: '哥林多前書 14:34', id: '1Cor14v34', text: '婦女在會中要閉口不言、像在聖徒的眾教會一樣．因為不准他們說話．他們總要順服、正如律法所說的。' },
  { ref: '傳道書 1:2', id: 'Eccles1v2', text: '傳道者說、虛空的虛空、虛空的虛空．凡事都是虛空。' },
  { ref: '傳道書 1:18', id: 'Eccles1v18', text: '因為多有智慧、就多有愁煩．加增知識的、就加增憂傷。' },
];

const 緊急包裝詞 = [
  '神的意念高過你的意念。',
  '主已經回答了，是你還沒讀懂。',
  '你所求的，不一定是你所需的。',
];

const el = {
  form: document.querySelector('#ask-form'),
  input: document.querySelector('#question'),
  notice: document.querySelector('#notice'),
  answer: document.querySelector('#answer'),
  asked: document.querySelector('#asked-text'),
  verse: document.querySelector('#verse-text'),
  ref: document.querySelector('#verse-ref'),
  quip: document.querySelector('#quip'),
  again: document.querySelector('#again'),
  save: document.querySelector('#save'),
  gate: document.querySelector('#gate'),
  enterSound: document.querySelector('#enter-sound'),
  enterSilent: document.querySelector('#enter-silent'),
  mute: document.querySelector('#mute'),
};

/** 取 localStorage 本身就可能拋錯（禁用 cookie、隱私模式），所以包起來。 */
function 取儲存() {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

/**
 * 靜默進入只是「這次不放音樂」，不該蓋掉使用者存下的靜音偏好：
 * 暫停期間 setItem 不寫入，之後使用者自己按靜音鍵才會存。
 */
let 暫停寫入 = false;
const 底層儲存 = 取儲存();
const 儲存 = 底層儲存 && {
  getItem: (key) => 底層儲存.getItem(key),
  setItem: (key, value) => { if (!暫停寫入) 底層儲存.setItem(key, value); },
};

const sanctuary = createSanctuary({
  reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
});
const audio = createAudio({ storage: 儲存 });

let data = null;
let 目前的問題 = '';
let 目前的位移 = 0;
let 目前的答案 = null;
let 目前的池大小 = 0;

/** 伺服器接受的 n 上限（server/main.py）。 */
const API_N_MAX = 1000;

const API_TIMEOUT_MS = 8000;
let 請求序號 = 0;

/** 呼叫後端；逾時、網路錯誤或非 2xx 一律拋錯，由呼叫端退回靜態比對。 */
async function fetchOracle(question, n) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    const response = await fetch('/api/oracle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: question, n }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`api ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function loadJSON(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`${path} ${response.status}`);
  return response.json();
}

/** 載入資料；任何一份掛掉就退到緊急池，網站仍然可用。 */
async function loadData() {
  try {
    const [topicsFile, fallback] = await Promise.all([
      loadJSON('data/topics.json'),
      loadJSON('data/fallback.json'),
    ]);
    const topics = topicsFile.topics;
    return { topics, wrappers: topicsFile.wrappers, fallback, index: buildTopicIndex(topics) };
  } catch (error) {
    console.warn('資料載入失敗，改用緊急經文池：', error);
    return { topics: [], wrappers: 緊急包裝詞, fallback: 緊急經文池, index: null };
  }
}

function showNotice(message) {
  el.notice.textContent = message;
  el.notice.hidden = false;
  el.answer.hidden = true;
}

function render(result, question) {
  // 縱深防禦：危機結果永遠不能被當成經文顯示
  if (result.kind === 'crisis') {
    目前的答案 = null;
    showCare(CARE_MESSAGE);
    return;
  }
  el.notice.hidden = true;
  el.asked.textContent = question.length > 100 ? `${question.slice(0, 100)}⋯` : question;
  el.ref.textContent = `—— ${result.ref}`;
  el.quip.textContent = result.quip;
  el.answer.hidden = false;
  el.again.hidden = result.poolSize <= 1;
  // 經文文字交給儀式逐字浮現；一併響鐘
  sanctuary.reveal({ verseEl: el.verse, refEl: el.ref, quipEl: el.quip, text: result.text, kind: result.kind });
  audio.bell();
}

/** 危機訊息：只留關懷文字，儀式全停、配樂收到近乎無聲。 */
function showCare(message) {
  sanctuary.setBusy(false);
  sanctuary.calm();
  audio.hush(true);
  showNotice(message);
}

/** 控制字元不該出現在網址參數裡，一律濾掉。 */
const 控制字元 = /[\u0000-\u001f\u007f]/g;

/** 從網址讀出問題與位移；參數不合法時當作沒有。 */
function readURL() {
  const params = new URLSearchParams(window.location.search);
  const question = (params.get('q') ?? '').replace(控制字元, '').trim().slice(0, 100);
  const n = Number.parseInt(params.get('n') ?? '0', 10);
  return { question, n: Number.isInteger(n) && n >= 0 ? n : 0 };
}

/** 把目前的問題與位移寫回網址，讓使用者看到什麼、複製出去就是什麼。 */
function writeURL(question, n) {
  const params = new URLSearchParams({ q: question });
  if (n > 0) params.set('n', String(n));
  window.history.replaceState(null, '', `?${params.toString()}`);
}

async function ask(question, n) {
  const 序號 = ++請求序號;
  if (question !== 目前的問題) 目前的池大小 = 0;
  目前的問題 = question;
  目前的位移 = n;

  // 安全閘放在任何網路請求之前：API 失敗、逾時、被限流時也一樣會擋下
  if (isCrisis(question)) {
    目前的答案 = null;
    writeURL(question, n);
    showCare(CARE_MESSAGE);
    return;
  }
  // 此時還不知道後端會不會判定為危機，儀式（閃光、配樂回升）等結果出來再開始
  sanctuary.setBusy(true);
  showNotice('求問中⋯');

  try {
    let result;
    try {
      // 伺服器端是 order[n % 池大小]，所以已知池大小時先取模，結果完全相同，
      // 又不會讓無限點「再求一次」超過伺服器的 n 上限（1000）而被 422 拒絕；
      // 池大小未知（例如直接開帶 n 的連結）就只能封頂在 1000。
      const apiN = 目前的池大小 > 0 ? n % 目前的池大小 : Math.min(n, API_N_MAX);
      const body = await fetchOracle(question, apiN);
      if (序號 !== 請求序號) return;
      if (body.kind === 'crisis') {
        目前的答案 = null;
        writeURL(question, n);
        showCare(body.text);
        return;
      }
      result = { ref: body.ref, text: body.text, quip: body.quip, poolSize: body.pool_size };
      目前的池大小 = body.pool_size;
    } catch (error) {
      console.warn('API 無法使用，改用靜態比對：', error);
      if (序號 !== 請求序號) return;
      result = answer(question, data, n);
      目前的池大小 = result.poolSize;
    }

    目前的答案 = result;
    writeURL(question, n);
    sanctuary.setBusy(false);
    audio.hush(false);
    sanctuary.pulse();
    render(result, question);
  } catch (error) {
    console.warn('顯示答案時出錯：', error);
    if (序號 === 請求序號) {
      sanctuary.setBusy(false);
      showNotice('出了點問題，請再試一次。');
    }
  }
}

el.form.addEventListener('submit', (event) => {
  event.preventDefault();
  const question = el.input.value.trim();
  if (!question) {
    showNotice('你的問題呢？「你們祈求、就給你們」');
    return;
  }
  ask(question, 0);
});

el.again.addEventListener('click', () => {
  ask(目前的問題, 目前的位移 + 1);
});

el.save.addEventListener('click', async () => {
  if (!目前的答案) return;
  try {
    await downloadCard(目前的答案, 目前的問題);
  } catch (error) {
    console.warn('產圖失敗，改為複製文字：', error);
    const 文字 = `${目前的答案.text}\n—— ${目前的答案.ref}\n\n${目前的答案.quip}`;

    // 嘗試複製文字到剪貼簿
    if (navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(文字);
        showNotice('產圖失敗，已改為複製文字到剪貼簿。');
      } catch (clipboardError) {
        console.warn('複製到剪貼簿失敗：', clipboardError);
        // 剪貼簿無法使用，顯示經文讓使用者自己複製
        showNotice(`產圖失敗，無法複製，請自行複製下列經文：\n\n${目前的答案.text}\n\n—— ${目前的答案.ref}\n\n${目前的答案.quip}`);
      }
    } else {
      // navigator.clipboard 不存在（非 HTTPS 環境等），顯示經文讓使用者自己複製
      showNotice(`產圖失敗，無法存取剪貼簿，請自行複製下列經文：\n\n${目前的答案.text}\n\n—— ${目前的答案.ref}\n\n${目前的答案.quip}`);
    }
  }
});

/** 靜音鍵的外觀跟著 audio 狀態走。 */
function syncMute() {
  const muted = audio.isMuted();
  el.mute.setAttribute('aria-pressed', String(muted));
  el.mute.setAttribute('aria-label', muted ? '開啟聲音' : '靜音');
}

/** 帶 ?q= 的分享連結：入口開了才作答。 */
let 待答 = null;
let 已入場 = false;

function enter() {
  if (已入場) return;
  已入場 = true;
  // 待答的提問要等 main 解除 inert 後才送，live region 與焦點才會正確
  sanctuary.openGate(() => {
    if (!待答) return;
    const { question, n } = 待答;
    待答 = null;
    ask(question, n);
  });
  syncMute();
}

el.enterSound.addEventListener('click', () => {
  audio.start(); // 必須在使用者手勢內同步呼叫，否則瀏覽器不放行
  enter();
});

el.enterSilent.addEventListener('click', () => {
  // 不啟動音樂；靜音只對這次有效，不覆寫存下的偏好
  暫停寫入 = true;
  try { audio.setMuted(true); } finally { 暫停寫入 = false; }
  enter();
});

el.mute.addEventListener('click', () => {
  const muted = !audio.isMuted();
  audio.setMuted(muted);
  // 靜默進入後第一次取消靜音：這是使用者手勢，此時才啟動音樂
  // start() 冪等且會恢復被暫停的 context，失敗後也能重試
  if (!muted) audio.start();
  syncMute();
});

window.__sanctuaryReady = true; // index.html 的後備腳本據此判斷 app.js 有沒有跑起來
sanctuary.mountWindow();
sanctuary.startDust();
sanctuary.focusGate();

data = await loadData();

const 來自網址 = readURL();
if (來自網址.question) {
  el.input.value = 來自網址.question;
  if (已入場) ask(來自網址.question, 來自網址.n);
  else 待答 = { question: 來自網址.question, n: 來自網址.n };
}
