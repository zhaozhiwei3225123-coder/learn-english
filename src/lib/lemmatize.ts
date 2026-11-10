/**
 * 极简词形还原：把 running / studies / suggested 这类变形还原成可能的原形，
 * 用来在文章里匹配词库中的词。不追求语言学正确，只求「够用且不误伤」。
 */

/** 生成一个词的候选原形（含自身），用于查表 */
export function baseForms(token: string): string[] {
  const w = token
    .toLowerCase()
    .replace(/[’']s$/, '')
    .replace(/[^a-z-]/g, '');
  if (!w) return [];

  const out = new Set<string>([w]);
  const add = (s: string) => {
    if (s.length > 1) out.add(s);
  };

  // 复数 / 第三人称：studies / boxes / books
  if (w.endsWith('ies') && w.length > 4) add(`${w.slice(0, -3)}y`);
  if (w.endsWith('ves') && w.length > 4) {
    add(`${w.slice(0, -3)}f`);
    add(`${w.slice(0, -3)}fe`);
  }
  if (w.endsWith('es') && w.length > 3) add(w.slice(0, -2));
  if (w.endsWith('s') && !w.endsWith('ss') && w.length > 3) add(w.slice(0, -1));

  // 过去式 / 过去分词：tried / liked / stopped
  if (w.endsWith('ied') && w.length > 4) add(`${w.slice(0, -3)}y`);
  if (w.endsWith('ed') && w.length > 4) {
    const stem = w.slice(0, -2);
    add(stem);
    add(w.slice(0, -1));
    if (/([bcdfghjklmnpqrstvwxz])\1$/.test(stem)) add(stem.slice(0, -1));
  }

  // 进行式：making / running / lying
  if (w.endsWith('ing') && w.length > 5) {
    const stem = w.slice(0, -3);
    add(stem);
    add(`${stem}e`);
    if (/([bcdfghjklmnpqrstvwxz])\1$/.test(stem)) add(stem.slice(0, -1));
    if (stem.endsWith('y')) add(`${stem.slice(0, -1)}ie`);
  }

  // 比较级 / 最高级 / 副词
  if (w.endsWith('est') && w.length > 5) add(w.slice(0, -3));
  if (w.endsWith('er') && w.length > 4) add(w.slice(0, -2));
  if (w.endsWith('ly') && w.length > 4) add(w.slice(0, -2));

  return [...out];
}

/** 文章切分：单词（含连字符/撇号）与非单词片段分开，便于按原样渲染 */
const SEG_RE = /([A-Za-z][A-Za-z'’-]*)|([^A-Za-z]+)/g;

export interface RawSegment {
  text: string;
  isWord: boolean;
}

export function splitArticle(text: string): RawSegment[] {
  const out: RawSegment[] = [];
  let m: RegExpExecArray | null;
  SEG_RE.lastIndex = 0;
  while ((m = SEG_RE.exec(text))) {
    if (m[1] !== undefined) out.push({ text: m[1], isWord: true });
    else if (m[2] !== undefined) out.push({ text: m[2], isWord: false });
  }
  return out;
}
