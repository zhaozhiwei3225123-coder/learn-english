/**
 * IPA 音标：优先查 CMU 发音词典（美式，接近纸质词典写法）；
 * 查不到或英音时，用 espeak-ng 音素器离线生成（与 Kokoro TTS 内部同一个音素器）。
 * 首次调用按需加载，之后全部走内存缓存。
 */
import { isVowel, onsetStart } from './phonemes';
import { dictIpa } from './ipaDict';

export type IpaLang = 'en-us' | 'en-gb';

const cache = new Map<string, string>();
let modulePromise: Promise<typeof import('phonemizer')> | null = null;
/** 串行执行，避免多个组件同时初始化 espeak 引擎 */
let queue: Promise<unknown> = Promise.resolve();

const STRESS = new Set(['ˈ', 'ˌ']);
/** espeak 使用的一些少见音标字符，统一成词典常见写法 */
const CHAR_MAP: Record<string, string> = {
  'ᵻ': 'ɪ', // 弱化的 i
  'ᵿ': 'ʊ', // 弱化的 u
  'ᵊ': 'ə',
  'ɘ': 'ə',
  'ɛ': 'e', // 词典里通常写作 e
};

/**
 * espeak 的重音符号放在重读元音前，这里挪到音节起始，贴近词典写法。
 * codaR 记录属于上一个音节（儿化元音）的 r，不再前移。
 */
function moveStress(raw: string, codaR: Set<number>): string {
  let s = raw;
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (!STRESS.has(ch)) {
      i++;
      continue;
    }
    let j = i;
    while (j > 0) {
      const prev = s[j - 1];
      if (prev === ' ' || isVowel(prev) || STRESS.has(prev)) break;
      if (prev === 'r' && codaR.has(j - 1)) break;
      j--;
    }
    const start = onsetStart(s, j, i);
    if (start < i) {
      s = s.slice(0, start) + ch + s.slice(start, i) + s.slice(i + 1);
      i = start + 1;
    } else {
      i++;
    }
  }
  return s;
}

/** 把 espeak 的 IPA 调整成词典里常见的写法 */
export function normalizeIpa(raw: string): string {
  // espeak 把 /ɔː/（如 more、sport、important）写成 oː
  const text = raw.replace(/oː/g, 'ɔː');
  let out = '';
  const codaR = new Set<number>();
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === 'ɚ' || ch === 'ɝ') {
      out += ch === 'ɚ' ? 'ər' : 'ɜr';
      // 词首的 ɚɹ（如 arrive/around）里 r 是下一音节的起始；词中的才视为儿化音
      if (out.length > 2) codaR.add(out.length - 1);
      if (text[i + 1] === 'ɹ') i++;
    } else if (ch === 'ɹ') {
      out += 'r';
    } else if (ch === 'ɾ') {
      out += 't';
    } else if (CHAR_MAP[ch]) {
      out += CHAR_MAP[ch];
    } else {
      out += ch;
    }
  }
  return moveStress(out.trim(), codaR);
}

function loadPhonemizer() {
  if (!modulePromise) modulePromise = import('phonemizer');
  return modulePromise;
}

function serial<T>(task: () => Promise<T>): Promise<T> {
  const result = queue.then(task, task);
  queue = result.catch(() => undefined);
  return result;
}

/** 根据 Kokoro 音色判断英语口音：bf_/bm_ 为英音，其余按美音 */
export function voiceLang(voice: string): IpaLang {
  return /^b/i.test(voice || '') ? 'en-gb' : 'en-us';
}

/** 生成单词的 IPA（不带斜杠）；失败或空词返回空字符串 */
export async function getIpa(word: string, lang: IpaLang = 'en-us'): Promise<string> {
  const text = String(word || '').trim();
  if (!text) return '';
  const key = `${lang}:${text.toLowerCase()}`;
  const hit = cache.get(key);
  if (hit) return hit;

  if (lang === 'en-us') {
    try {
      const fromDict = await dictIpa(text);
      if (fromDict) {
        cache.set(key, fromDict);
        return fromDict;
      }
    } catch (err) {
      console.warn('[ipa] 词典查询失败，回退 espeak', err);
    }
  }

  const ipa = await serial(async () => {
    const { phonemize } = await loadPhonemizer();
    const parts = await phonemize(text, lang);
    return parts
      .map((p) => normalizeIpa(p))
      .filter(Boolean)
      .join(' ');
  });

  if (ipa) cache.set(key, ipa);
  return ipa;
}
