/** IPA 音素相关的小工具，供 espeak 规范化和 CMU 词典转换共用 */

export const VOWELS = new Set([...'aeiouɑæʌəɛɜɪɔʊɐɚɝɵʉɨɯyøœɶɤɒɘɞ']);

/** 英语允许的音节起始辅音（含常见复辅音） */
export const ONSETS = new Set([
  'p', 'b', 't', 'd', 'k', 'g', 'ɡ', 'f', 'v', 'θ', 'ð', 's', 'z', 'ʃ', 'ʒ', 'h', 'm', 'n', 'l', 'r', 'w', 'j',
  'tʃ', 'dʒ', 'pr', 'br', 'tr', 'dr', 'kr', 'ɡr', 'gr', 'fr', 'θr', 'ʃr', 'pl', 'bl', 'kl', 'gl', 'ɡl', 'fl',
  'sl', 'sw', 'tw', 'dw', 'kw', 'gw', 'ɡw', 'sp', 'st', 'sk', 'sm', 'sn', 'sf', 'spr', 'str', 'skr', 'spl',
  'skw', 'pj', 'bj', 'kj', 'ɡj', 'gj', 'mj', 'fj', 'vj', 'tj', 'dj',
]);

export function isVowel(ch: string): boolean {
  return VOWELS.has(ch) || ch === 'ː';
}

/** 在辅音簇 [j, i) 中找最长、且能作音节起始的后缀；找不到时返回 i */
export function onsetStart(s: string, j: number, i: number): number {
  for (let start = j; start < i; start++) {
    if (ONSETS.has(s.slice(start, i))) return start;
  }
  return i;
}
