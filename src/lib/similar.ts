import type { Word } from '../types';

/* ---------------------------------------------------------------- 编辑距离 */

/** Damerau-Levenshtein（含相邻字母换位），超过 max 直接放弃 */
function editDistance(a: string, b: string, max = 2): number {
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > max) return max + 1;

  let prev2: number[] = [];
  let prev: number[] = [];
  for (let j = 0; j <= lb; j++) prev[j] = j;

  for (let i = 1; i <= la; i++) {
    const cur: number[] = [i];
    let rowMin = i;
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      // 相邻换位：quite / quiet
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, prev2[j - 2] + 1);
      }
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev2 = prev;
    prev = cur;
  }
  return prev[lb];
}

/**
 * 共同前缀 / 共同后缀中较长的那段。
 * 词根和词缀都落在词首或词尾，比任意位置的公共子串精确得多：
 * inspect / suspect → "spect"，conclude / exclude → "clude"，economic / economy → "econom"。
 */
function commonEdge(a: string, b: string): { text: string; isHead: boolean } {
  const la = a.length;
  const lb = b.length;
  let head = 0;
  while (head < la && head < lb && a[head] === b[head]) head++;
  let tail = 0;
  while (
    tail < la &&
    tail < lb &&
    a[la - 1 - tail] === b[lb - 1 - tail] &&
    la - 1 - tail >= head &&
    lb - 1 - tail >= head
  ) {
    tail++;
  }
  return tail > head
    ? { text: a.slice(la - tail), isHead: false }
    : { text: a.slice(0, head), isHead: true };
}

/** 常见的 4 字母词根，允许它们按后缀成组（produce / reduce / induce） */
const ROOTS4 = new Set([
  'duce', 'ject', 'port', 'form', 'tain', 'tend', 'vent', 'sist', 'fect', 'spect',
  'tract', 'press', 'struct', 'flect', 'spond', 'solve', 'volve', 'claim', 'clude', 'cure',
]);

/** 这段公共部分够不够「像词根」 */
function isRootLike(edge: { text: string; isHead: boolean }): boolean {
  if (edge.text.length >= 5) return true;
  if (edge.text.length < 4) return false;
  return edge.isHead || ROOTS4.has(edge.text);
}

/* ---------------------------------------------------------------- 判定 */

/** 屈折变化后缀：ban / bans、work / worked 这种不算形近 */
const INFLECTION = /^(?:s|es|ed|d|ing|ly|er|est|ies|ied)$/;

function isInflectionOf(shortWord: string, longWord: string): boolean {
  if (!longWord.startsWith(shortWord)) return false;
  return INFLECTION.test(longWord.slice(shortWord.length));
}

export interface SimilarSets {
  /** 形近易混：拼写只差一两个字母 */
  confusable: Word[];
  /** 同词根 / 同词缀 */
  family: Word[];
}

const cache = new Map<string, SimilarSets>();

function compute(target: Word, pool: Word[]): SimilarSets {
  const base = target.word.toLowerCase().trim();
  const empty: SimilarSets = { confusable: [], family: [] };
  if (base.length < 3) return empty;

  const confusable: { w: Word; score: number }[] = [];
  const family: { w: Word; run: number }[] = [];

  for (const w of pool) {
    if (w.id === target.id) continue;
    const other = w.word.toLowerCase().trim();
    if (!other || other === base) continue;
    if (isInflectionOf(base, other) || isInflectionOf(other, base)) continue;

    const d = editDistance(base, other, 2);
    if (d > 0 && d <= 2) {
      const lenDiff = Math.abs(base.length - other.length);
      const sameHead = base[0] === other[0];
      // 差两个字母时要求更长、且首字母相同，避免 cat/cot 这种噪音
      const ok = d === 1 ? lenDiff <= 1 : lenDiff === 0 && sameHead && base.length >= 5;
      if (ok) {
        const score = d * 10 + lenDiff * 2 + (sameHead ? 0 : 3);
        confusable.push({ w, score });
        continue;
      }
    }

    const edge = commonEdge(base, other);
    if (
      edge.text.length &&
      edge.text.length < Math.min(base.length, other.length) &&
      isRootLike(edge)
    ) {
      family.push({ w, run: edge.text.length });
    }
  }

  confusable.sort((a, b) => a.score - b.score || a.w.word.localeCompare(b.w.word));
  family.sort((a, b) => b.run - a.run || a.w.word.localeCompare(b.w.word));

  return {
    confusable: confusable.slice(0, 4).map((x) => x.w),
    family: family.slice(0, 3).map((x) => x.w),
  };
}

/**
 * 找出某个词的形近词和同词族。
 * 只依赖词表本身，不需要联网；同一次学习里会命中缓存。
 */
export function similarBySpelling(target: Word, pool: Word[]): SimilarSets {
  const key = `${pool.length}|${target.id}|${target.word}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const res = compute(target, pool);
  if (cache.size > 300) cache.clear();
  cache.set(key, res);
  return res;
}
