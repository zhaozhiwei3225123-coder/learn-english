/**
 * 逐词填空：把参考译文拆成「单词空格 + 标点提示」，并在提交时本地判分。
 * 纯函数、无依赖，方便单测。
 */

export interface FillToken {
  kind: 'word' | 'punct';
  text: string;
}

/** 单词 = 字母/数字/撇号（含弯撇号），其余连续非空白都按标点原样显示 */
const IS_WORD_RE = /^[A-Za-z0-9'’]+$/;
const SEG_RE = /(\s+|[A-Za-z0-9'’]+|[^A-Za-z0-9'’\s]+)/g;

export function tokenizeFill(en: string): FillToken[] {
  const parts = en.trim().match(SEG_RE) || [];
  return parts
    .filter((p) => p.trim().length > 0)
    .map((p) => ({ kind: IS_WORD_RE.test(p) ? 'word' : 'punct', text: p } as FillToken));
}

/** 判分前的归一化：统一弯撇号、转小写、去掉首尾标点 */
export function normalizeWord(w: string): string {
  return w
    .replace(/’/g, "'")
    .trim()
    .toLowerCase()
    .replace(/^[^\w']+|[^\w']+$/g, '');
}

export interface FillBlankResult {
  /** 用户输入（trim 后） */
  input: string;
  /** 该空的正确单词（原样，含大小写） */
  expected: string;
  ok: boolean;
}

/** 对照参考答案逐空判分 */
export function judgeFill(expected: string[], inputs: string[]): FillBlankResult[] {
  return expected.map((exp, i) => {
    const input = (inputs[i] || '').trim();
    return { input, expected: exp, ok: !!input && normalizeWord(input) === normalizeWord(exp) };
  });
}
