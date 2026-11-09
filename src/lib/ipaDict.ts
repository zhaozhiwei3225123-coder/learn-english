/**
 * 基于 CMU 发音词典（ARPAbet）生成美式音标。
 * 词典里的发音自带音节和重音，比 espeak 更接近纸质词典；
 * 查不到的词（或英音）仍回退到 espeak。
 */
import { onsetStart } from './phonemes';

let dictPromise: Promise<typeof import('cmu-pronouncing-dictionary')> | null = null;
const lookupCache = new Map<string, string | null>();

const CONS: Record<string, string> = {
  B: 'b', C: 'k', CH: 'tʃ', D: 'd', DH: 'ð', F: 'f', G: 'ɡ', H: 'h', HH: 'h', JH: 'dʒ', J: 'dʒ',
  K: 'k', L: 'l', M: 'm', N: 'n', NG: 'ŋ', P: 'p', R: 'r', S: 's', SH: 'ʃ', T: 't', TH: 'θ',
  V: 'v', W: 'w', X: 'ks', Y: 'j', Z: 'z', ZH: 'ʒ',
};

function vowelIpa(base: string, stress: number | null): string {
  switch (base) {
    case 'AA': return 'ɑː';
    case 'AE': return 'æ';
    case 'AH': return stress === 0 ? 'ə' : 'ʌ';
    case 'AO': return 'ɔː';
    case 'AW': return 'aʊ';
    case 'AY': return 'aɪ';
    case 'EH': return 'e';
    case 'ER': return stress === 0 ? 'ər' : 'ɜːr';
    case 'EY': return 'eɪ';
    case 'IH': return 'ɪ';
    case 'IY': return stress === 0 ? 'i' : 'iː';
    case 'OW': return 'oʊ';
    case 'OY': return 'ɔɪ';
    case 'UH': return 'ʊ';
    case 'UW': return stress === 0 ? 'u' : 'uː';
    default: return '';
  }
}

/** ARPAbet（如 "P Y UW1 P AH0 L"）转成带重音符号的 IPA */
export function arpabetToIpa(arpabet: string): string {
  let out = '';
  let pending = '';
  for (const token of arpabet.trim().split(/\s+/)) {
    const m = /^([A-Z]+)([012])?$/.exec(token);
    if (!m) continue;
    const cons = CONS[m[1]];
    if (cons) {
      pending += cons;
      continue;
    }
    const stress = m[2] === undefined ? null : Number(m[2]);
    const vowel = vowelIpa(m[1], stress);
    if (!vowel) continue;
    if (stress === 1 || stress === 2) {
      const start = onsetStart(pending, 0, pending.length);
      out += pending.slice(0, start) + (stress === 1 ? 'ˈ' : 'ˌ') + pending.slice(start) + vowel;
    } else {
      out += pending + vowel;
    }
    pending = '';
  }
  return out + pending;
}

/** 复合词前一部分的主重音降为次重音 */
function demote(ipa: string): string {
  const idx = ipa.indexOf('ˈ');
  return idx >= 0 ? ipa.slice(0, idx) + 'ˌ' + ipa.slice(idx + 1) : ipa;
}

/** 词典一般不在主重音之后再标次重音（如 athlete /ˈæθliːt/） */
function dropLateSecondary(ipa: string): string {
  const idx = ipa.indexOf('ˈ');
  if (idx < 0) return ipa;
  return ipa.slice(0, idx) + ipa.slice(idx).replace(/ˌ/g, '');
}

function buildWord(dict: Record<string, string>, key: string): string | null {
  const direct = pickPronunciation(dict, key);
  if (direct) return dropLateSecondary(arpabetToIpa(direct));

  // 连字符 / 空格的复合词，逐段查词典再拼起来
  const parts = key.split(/[\s\-_]+/).filter(Boolean);
  if (parts.length > 1) {
    const ipas: string[] = [];
    for (const part of parts) {
      const value = pickPronunciation(dict, part);
      if (!value) return null;
      ipas.push(arpabetToIpa(value));
    }
    const joiner = /\s/.test(key) ? ' ' : '';
    return dropLateSecondary(ipas.map((ipa, i) => (i < ipas.length - 1 ? demote(ipa) : ipa)).join(joiner));
  }
  return null;
}

function countPhone(arpabet: string, phone: string): number {
  return arpabet.split(/\s+/).filter((t) => t === phone).length;
}

/**
 * 词典里同一个词可能有多个发音（word、word(2)…）。
 * 学习者词典通常把弱读的 ɪ 保留为 IH0，而 CMU 常写成 AH0（ə），
 * 所以优先选保留 IH0 更多的版本。
 */
function pickPronunciation(dict: Record<string, string>, key: string): string | null {
  let best = dict[key];
  if (!best) return null;
  let bestIh = countPhone(best, 'IH0');
  for (let i = 2; i <= 4; i++) {
    const alt = dict[`${key}(${i})`];
    if (!alt) continue;
    const ih = countPhone(alt, 'IH0');
    if (ih > bestIh) {
      best = alt;
      bestIh = ih;
    }
  }
  return best;
}

/** 查词典；查不到返回 null */
export async function dictIpa(word: string): Promise<string | null> {
  const key = String(word || '').trim().toLowerCase();
  if (!key) return null;
  if (lookupCache.has(key)) return lookupCache.get(key)!;
  if (!dictPromise) dictPromise = import('cmu-pronouncing-dictionary');
  const { dictionary } = await dictPromise;

  let result = buildWord(dictionary as Record<string, string>, key);
  if (result === null) {
    const cleaned = key.replace(/[.,!?;:"]/g, '').trim();
    if (cleaned && cleaned !== key) result = buildWord(dictionary as Record<string, string>, cleaned);
  }
  lookupCache.set(key, result);
  return result;
}
