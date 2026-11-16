import type { PhraseNote, SentenceIssue, SentenceLevel, Settings } from '../types';

/**
 * AI 造句练习：调用 OpenAI 兼容接口（默认 DeepSeek）。
 * 纯前端直连——DeepSeek 的 CORS 允许浏览器请求，静态站点也能用，不需要后端。
 * 不预置题库：每道题实时向模型要，做完的句子才存进本地记录。
 * API Key 只存在本机 localStorage，不进 IndexedDB 状态，也不会被「导出备份」带走。
 */

const KEY_STORAGE = 'vocab-app.ai.key';
const TIMEOUT_MS = 60_000;

export const AI_DEFAULT_BASE = 'https://api.deepseek.com';
export const AI_DEFAULT_MODEL = 'deepseek-chat';

export function getApiKey(): string {
  try {
    return localStorage.getItem(KEY_STORAGE) || '';
  } catch {
    return '';
  }
}

export function setApiKey(key: string): void {
  try {
    const v = key.trim();
    if (v) localStorage.setItem(KEY_STORAGE, v);
    else localStorage.removeItem(KEY_STORAGE);
  } catch (err) {
    console.warn('[ai] 保存 API Key 失败', err);
  }
}

export function hasApiKey(): boolean {
  return !!getApiKey();
}

export interface AiConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
}

/** 从设置里取接口配置；没填 Key 时返回 null */
export function resolveConfig(settings: Settings, key = getApiKey()): AiConfig | null {
  const apiKey = key.trim();
  if (!apiKey) return null;
  return {
    baseUrl: (settings.aiBaseUrl || AI_DEFAULT_BASE).trim().replace(/\/+$/, ''),
    model: (settings.aiModel || AI_DEFAULT_MODEL).trim(),
    apiKey,
  };
}

export class AiError extends Error {
  status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.name = 'AiError';
    this.status = status;
  }
}

const SYSTEM_PROMPT = [
  '你是英语教学助手，服务对象是中文母语的英语学习者。',
  '严格只输出一个 JSON 对象，不要 markdown 代码块，不要任何解释性文字。',
].join('\n');

export const SENTENCE_THEMES = [
  '日常',
  '工作',
  '学习',
  '旅行',
  '观点',
  '情绪',
  '社交',
  '科技',
] as const;

export const SENTENCE_LEVELS: { key: SentenceLevel; label: string; hint: string }[] = [
  { key: 'basic', label: '入门', hint: '8~12 词，简单句和常见连词' },
  { key: 'intermediate', label: '进阶', hint: '12~18 词，含从句或非谓语' },
  { key: 'advanced', label: '挑战', hint: '16~25 词，含倒装、虚拟或复杂从句' },
];

function endpoint(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${path}`;
}

/** 从可能带 ``` 围栏或前后说明文字的内容里抠出 JSON */
function extractJson(raw: string): unknown {
  const text = String(raw || '').trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) throw new AiError('模型返回的内容不是 JSON，请重试');
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    throw new AiError('模型返回的 JSON 解析失败，请重试');
  }
}

function str(v: unknown, max = 600): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

/** 把 HTTP 状态码翻译成能看懂的提示 */
function httpError(status: number, detail: string): AiError {
  const tail = detail ? `：${detail.slice(0, 160)}` : '';
  if (status === 401) return new AiError('API Key 无效或已失效，请到设置里重新填写', status);
  if (status === 402) return new AiError('账户余额不足，请先充值', status);
  if (status === 403) return new AiError('接口拒绝访问（403），请检查 Key 权限', status);
  if (status === 404) return new AiError('接口地址不存在，请检查「接口地址」是否填对', status);
  if (status === 429) return new AiError('请求太频繁或已达限额，稍等一会儿再试', status);
  if (status >= 500) return new AiError(`模型服务暂时不可用（${status}），稍后再试`, status);
  return new AiError(`请求失败（${status}）${tail}`, status);
}

interface ChatResult {
  /** 模型正文（content 为空时退回 reasoning_content，比如误用了 R1 类模型） */
  text: string;
  finish: string;
}

async function chatOnce(
  cfg: AiConfig,
  payload: Record<string, unknown>,
  signal?: AbortSignal,
  timeoutMs = TIMEOUT_MS
): Promise<ChatResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const onAbort = () => ctrl.abort();

  // R1 / reasoner 类模型不支持 response_format 和 temperature，带上会被 400 拒掉
  const body: Record<string, unknown> = { model: cfg.model, ...payload };
  if (/reasoner|r1/i.test(cfg.model)) {
    delete body.response_format;
    delete body.temperature;
  }

  try {
    const res = await fetch(endpoint(cfg.baseUrl, '/chat/completions'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });

    if (!res.ok) {
      let detail = '';
      try {
        const j = (await res.json()) as { error?: { message?: string } };
        detail = j?.error?.message || JSON.stringify(j);
      } catch {
        detail = await res.text().catch(() => '');
      }
      throw httpError(res.status, detail);
    }

    const data = (await res.json()) as {
      choices?: { message?: { content?: string; reasoning_content?: string }; finish_reason?: string }[];
    };
    const msg = data?.choices?.[0]?.message ?? {};
    const finish = data?.choices?.[0]?.finish_reason || '';
    const content = (msg.content || '').trim();
    // 兼容 R1：正文为空但思考过程里有内容时，从思考文本里碰运气抠 JSON
    const text = content || (msg.reasoning_content || '').trim();
    if (!text) {
      throw new AiError(
        finish === 'length'
          ? '模型没有返回内容（回答被长度截断），请重试'
          : /reasoner|r1/i.test(cfg.model)
            ? '这个模型把额度都花在「思考」上了，建议到设置里把模型改成 deepseek-chat'
            : '模型没有返回内容，请重试'
      );
    }
    return { text, finish };
  } catch (err) {
    if (err instanceof AiError) throw err;
    if ((err as Error)?.name === 'AbortError') {
      throw new AiError(signal?.aborted ? '已取消' : '请求超时，请检查网络后重试');
    }
    throw new AiError('网络请求失败，可能是网络不通或接口地址有误');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

async function chat(
  cfg: AiConfig,
  payload: Record<string, unknown>,
  signal?: AbortSignal,
  timeoutMs = TIMEOUT_MS
): Promise<string> {
  return (await chatOnce(cfg, payload, signal, timeoutMs)).text;
}

/** 值得自动重试的错误：网络抖动、超时、限流、服务端 5xx、模型空返回 / JSON 不完整 */
function worthRetry(err: unknown): boolean {
  if (!(err instanceof AiError)) return false;
  if (err.message === '已取消') return false;
  if ([400, 401, 402, 403, 404].includes(err.status)) return false;
  return true;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * 请求并解析 JSON，带自动重试。
 * 模型偶发的空返回、JSON 不完整（多因 max_tokens 截断）、超时、429/5xx
 * 都在这里消化掉：截断就把 max_tokens 翻倍再试，其它错误退避后重试，
 * 重试仍失败才把最后的错误抛给界面——用户就不用自己一遍遍点「重试」了。
 */
async function chatJson(
  cfg: AiConfig,
  payload: Record<string, unknown>,
  opts: { signal?: AbortSignal; timeoutMs?: number; attempts?: number } = {}
): Promise<unknown> {
  const attempts = opts.attempts ?? 3;
  let body = payload;
  let last: unknown = null;

  for (let i = 0; i < attempts; i++) {
    if (i > 0 && !opts.signal?.aborted) await sleep(500 * i);
    try {
      const r = await chatOnce(cfg, body, opts.signal, opts.timeoutMs);
      const parsed = extractJson(r.text);
      // 长度截断但恰好解析成功：结果可能不完整，照样翻倍重试一次求稳
      if (r.finish === 'length' && i < attempts - 1) {
        body = { ...body, max_tokens: Math.min((Number(body.max_tokens) || 1024) * 2, 8192) };
        continue;
      }
      return parsed;
    } catch (err) {
      last = err;
      if (!opts.signal?.aborted && worthRetry(err) && i < attempts - 1) {
        const msg = err instanceof Error ? err.message : '';
        // 截断导致的空返回 / JSON 不完整：提高上限再战
        if (/截断|JSON|没有返回内容/.test(msg)) {
          body = { ...body, max_tokens: Math.min((Number(body.max_tokens) || 1024) * 2, 8192) };
        }
        continue;
      }
      throw err;
    }
  }
  throw last instanceof Error ? last : new AiError('模型没有返回内容，请重试');
}

/* ---------------------------------------------------------------- 出题 */

export interface GenerateOptions {
  theme: string;
  level: SentenceLevel;
  config: AiConfig;
  /** 最近做过的中文句子，避免重复出题 */
  recent?: string[];
  signal?: AbortSignal;
}

export interface GeneratedSentence {
  zh: string;
  en: string;
  /** 这句话里的词组 / 固定搭配 / 句型（0~3 个） */
  phrases: PhraseNote[];
}

/** 实时向模型要一道中译英题（中文提示 + 参考译文） */
export async function generateSentence(opts: GenerateOptions): Promise<GeneratedSentence> {
  const { theme, level, config, recent = [], signal } = opts;
  const levelMeta = SENTENCE_LEVELS.find((x) => x.key === level) || SENTENCE_LEVELS[1];
  const avoid = recent
    .slice(0, 40)
    .map((zh) => `- ${zh}`)
    .join('\n');

  const prompt = [
    `请出 1 道中译英练习题，主题「${theme}」，难度「${levelMeta.label}」（${levelMeta.hint}）。`,
    '',
    '要求：',
    '1. 中文是日常真的会说出口或写出来的话，不要生硬拼凑，不要出现人名以外的专有名词。',
    '2. 英文译文地道自然，是母语者会写的版本，不要逐字直译。',
    '3. 译文里最好包含 1~2 个值得记的词组、固定搭配或句型（如 do the dishes 洗碗、look forward to 期待、',
    '   not only...but also 不仅…而且），把它们单独列出来。',
    avoid ? `4. 不要和下面这些做过的题重复：\n${avoid}` : '',
    '',
    '输出 JSON：',
    '{"zh":"中文原句","en":"参考英文译文","phrases":[{"en":"do the dishes","zh":"洗碗"}]}',
    'phrases 给 0~3 个，是译文里真实出现的词组/搭配/句型，en 原样截取译文片段（可与译文形式略有差异，',
    '如译文是 doing the dishes，词组按词典形 do the dishes），zh 给简短中文意思。',
  ]
    .filter(Boolean)
    .join('\n');

  const o = (await chatJson(
    config,
    {
      temperature: 1.0,
      max_tokens: 800,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
    },
    { signal }
  )) as Record<string, unknown>;
  const zh = str(o.zh, 200);
  const en = str(o.en, 300);
  if (!zh || !en) throw new AiError('模型没有返回可用的题目，请重试');

  const phrases: PhraseNote[] = Array.isArray(o.phrases)
    ? o.phrases
        .map((p) => {
          const x = (p || {}) as Record<string, unknown>;
          return { en: str(x.en, 80), zh: str(x.zh, 60) };
        })
        .filter((p) => p.en && p.zh)
        .slice(0, 3)
    : [];

  return { zh, en, phrases };
}

/* ---------------------------------------------------------------- 批改 */

export interface GradeOptions {
  zh: string;
  /** 参考译文，作为意思是否译全的基准 */
  reference: string;
  /** 学生的英文 */
  answer: string;
  config: AiConfig;
  signal?: AbortSignal;
}

export interface GradeResult {
  score: number;
  corrected: string;
  issues: SentenceIssue[];
  comment: string;
}

/** 批改一句中译英 */
export async function gradeTranslation(opts: GradeOptions): Promise<GradeResult> {
  const { zh, reference, answer, config, signal } = opts;

  const prompt = [
    `中文原句：${zh}`,
    `参考译文：${reference}`,
    `学生译文：${answer}`,
    '',
    '批改标准：',
    '1. 意思准确性 60 分：信息是否译全，有没有漏译、误译、多余添加。',
    '2. 语法 25 分：时态、单复数、冠词、介词、词性、句子结构。',
    '3. 地道程度 15 分：是否符合英语习惯，而不是中文直译。',
    '',
    'corrected 要在学生译文基础上做最小必要修改，保留学生自己的用词习惯，不要直接照抄参考译文。',
    'score 是 0~100 的整数。',
    '',
    '输出 JSON：',
    '{',
    '  "score": 83,',
    '  "corrected": "修改后的完整英文句子",',
    '  "issues": [{"type": "漏译|语法|用词|搭配|拼写", "bad": "学生译文里的问题片段", "good": "建议写法", "why": "中文一句话说明"}],',
    '  "comment": "35 字以内的中文总评，指出最值得改进的一点"',
    '}',
    'issues 最多 3 条；没有明显问题就给空数组，不要为了凑数编造问题。',
  ].join('\n');

  const o = (await chatJson(
    config,
    {
      temperature: 0.2,
      max_tokens: 1200,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
    },
    { signal }
  )) as Record<string, unknown>;
  const corrected = str(o.corrected);
  if (!corrected) throw new AiError('模型没有返回批改结果，请重试');

  const issues: SentenceIssue[] = Array.isArray(o.issues)
    ? o.issues
        .map((it) => {
          const x = (it || {}) as Record<string, unknown>;
          return {
            type: str(x.type, 12) || '问题',
            bad: str(x.bad, 200),
            good: str(x.good, 200),
            why: str(x.why, 200),
          };
        })
        .filter((x) => x.bad || x.good || x.why)
        .slice(0, 3)
    : [];

  const scoreRaw = Number(o.score);
  return {
    score: Number.isFinite(scoreRaw) ? Math.max(0, Math.min(100, Math.round(scoreRaw))) : 0,
    corrected,
    issues,
    comment: str(o.comment, 200),
  };
}

/* ---------------------------------------------------------------- 精读导读 */

export interface ArticleWord {
  word: string;
  ipa: string;
  zh: string;
}

export interface ArticleNote {
  /** 中文标题，像杂志标题 */
  titleZh: string;
  /** 主题标签：时事 / 科技 / 自然… */
  topic: string;
  /** 一句话中文导读 */
  summary: string;
  /** 值得记的生词 */
  words: ArticleWord[];
  /** 长难句解析，短文可能没有 */
  sentence: { en: string; zh: string; note: string } | null;
}

export interface AnnotateOptions {
  text: string;
  config: AiConfig;
  signal?: AbortSignal;
}

/**
 * 给一篇文章写中文标题 / 主题 / 导读 / 生词 / 长难句，
 * 相当于把抓来的生文章加工成「外刊精读」的样子。
 */
export async function annotateArticle(opts: AnnotateOptions): Promise<ArticleNote> {
  const { text, config, signal } = opts;
  const body = text.trim().slice(0, 4000);

  const prompt = [
    '下面是一篇英语短文。请以中文英语学习刊物的编辑身份，为它写一段精读导读。',
    '',
    '要求：',
    '1. titleZh：中文标题，10~18 字，像杂志标题，准确不夸张。',
    '2. topic：2~4 字的主题标签，如 时事 / 科技 / 自然 / 健康 / 文化 / 商业 / 生活。',
    '3. summary：一句话中文导读，40 字以内，讲清这篇写了什么、为什么值得读。',
    '4. words：从原文里挑 3~6 个对中文中级学习者有价值的词。不要挑人名、地名、机构名，',
    '   不要挑 the / of / is 这类功能词。每项给：word（原文中的词典形，小写）、',
    '   ipa（美式音标，只写符号，不要斜杠）、zh（10 字以内中文释义）。',
    '5. sentence：挑原文里信息量最大或结构最绕的一句，给 en（原句照抄，不改写）、',
    '   zh（中文翻译）、note（50 字以内的结构或用法提示）。原文太短就返回 null。',
    '',
    '只输出 JSON：',
    '{"titleZh":"","topic":"","summary":"","words":[{"word":"","ipa":"","zh":""}],"sentence":{"en":"","zh":"","note":""}}',
    '',
    '原文：',
    body,
  ].join('\n');

  const o = (await chatJson(
    config,
    {
      temperature: 0.4,
      max_tokens: 1500,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
    },
    { signal }
  )) as Record<string, unknown>;

  const words: ArticleWord[] = Array.isArray(o.words)
    ? o.words
        .map((it) => {
          const x = (it || {}) as Record<string, unknown>;
          return {
            word: str(x.word, 40).toLowerCase(),
            ipa: str(x.ipa, 40).replace(/^\/+|\/+$/g, ''),
            zh: str(x.zh, 40),
          };
        })
        .filter((w) => w.word && w.zh)
        .slice(0, 6)
    : [];

  const rawSentence = o.sentence as Record<string, unknown> | null | undefined;
  const sentence =
    rawSentence && str(rawSentence.en)
      ? {
          en: str(rawSentence.en, 400),
          zh: str(rawSentence.zh, 400),
          note: str(rawSentence.note, 200),
        }
      : null;

  const titleZh = str(o.titleZh, 40);
  if (!titleZh && !words.length) throw new AiError('模型没有返回可用的导读，请重试');

  return { titleZh, topic: str(o.topic, 8), summary: str(o.summary, 120), words, sentence };
}

/* ---------------------------------------------------------------- 段落翻译 */

/**
 * 逐段把英语文章翻成中文。一次请求翻完所有段落，比每段单发省 token 也更快。
 * texts 的顺序就是返回译文的顺序。
 */
export async function translateParas(
  texts: string[],
  config: AiConfig,
  signal?: AbortSignal
): Promise<string[]> {
  if (!texts.length) return [];
  const numbered = texts.map((t, i) => `[${i + 1}] ${t}`).join('\n\n');

  const prompt = [
    `把下面的 ${texts.length} 个英语段落逐段翻译成自然、地道的简体中文。`,
    '',
    '要求：',
    '1. 意译为主，读起来像中文原本就这么写，不要逐词直译。',
    '2. 人名、地名等专有名词保留英文。',
    `3. 输出的 t 数组长度必须正好是 ${texts.length}，顺序与输入段落一一对应。`,
    '',
    '只输出 JSON：{"t":["第1段译文","第2段译文"]}',
    '',
    numbered,
  ].join('\n');

  const o = (await chatJson(
    config,
    {
      temperature: 0.3,
      max_tokens: 3500,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
    },
    { signal }
  )) as { t?: unknown };
  const arr = Array.isArray(o.t) ? o.t : [];
  const out = arr.map((x) => str(x, 1500));
  if (out.length < texts.length || out.slice(0, texts.length).some((t) => !t)) {
    throw new AiError('模型没有译全所有段落，请再试一次');
  }
  return out.slice(0, texts.length);
}

/* ---------------------------------------------------------------- 对白翻译 */

/**
 * 补翻对白。新对话的翻译是随回复一起给的（不再多发请求），
 * 这里只服务两种场景：旧存档没存译文、或者模型那次漏给了 zh。
 * 一次翻多句比逐句请求省 token。
 */
export async function translateTalkLines(
  lines: string[],
  config: AiConfig,
  signal?: AbortSignal
): Promise<string[]> {
  if (!lines.length) return [];
  const numbered = lines.map((t, i) => `[${i + 1}] ${t}`).join('\n');

  const prompt = [
    `把下面 ${lines.length} 句英语日常对话翻成简体中文。`,
    '',
    '要求：',
    '1. 口语化，像字幕，读起来就是中国人平时会说的话，不要书面腔。',
    '2. 保留原句的语气（抱怨、客气、为难、催促），不要统一成四平八稳的陈述。',
    '3. 人名保留英文，不加解释、不加引号。',
    `4. 输出的 t 数组长度必须正好是 ${lines.length}，顺序与输入一一对应。`,
    '',
    '只输出 JSON：{"t":["第1句译文","第2句译文"]}',
    '',
    numbered,
  ].join('\n');

  const o = (await chatJson(
    config,
    {
      temperature: 0.3,
      max_tokens: 1200,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
    },
    { signal }
  )) as { t?: unknown };

  const arr = Array.isArray(o.t) ? o.t : [];
  const out = arr.map((x) => str(x, 600));
  if (out.length < lines.length || out.slice(0, lines.length).some((t) => !t)) {
    throw new AiError('模型没有译全这几句，请再试一次');
  }
  return out.slice(0, lines.length);
}

/* ---------------------------------------------------------------- 阅读理解 */

export interface QuizQuestion {
  q: string;
  options: string[];
  /** 正确选项下标 0~3 */
  answer: number;
  explain: string;
}

/** 按一篇文章出 5 道阅读理解选择题，判分在本地做，不额外花 token */
export async function generateQuiz(
  opts: { text: string; config: AiConfig; signal?: AbortSignal },
  count = 5
): Promise<QuizQuestion[]> {
  const { text, config, signal } = opts;
  const body = text.trim().slice(0, 4000);

  const prompt = [
    `根据下面这篇英语短文，出 ${count} 道英文阅读理解选择题，类似英语考试的阅读理解题。`,
    '',
    '要求：',
    '1. 题干和选项全用英文，只考察原文里的细节、主旨、词义或推理，不要考文章之外的常识。',
    '2. 每题正好 4 个选项，只有 1 个正确；干扰项要有迷惑性但明确错误。',
    '3. answer 是正确选项的下标（0~3），几道题的正确答案不要都落在同一个位置。',
    '4. explain 用中文，40 字以内，说明为什么选它、对应原文哪句。',
    '5. 题干一行以内，每个选项不超过 15 个词。',
    '',
    '只输出 JSON：',
    '{"qs":[{"q":"...","options":["A内容","B内容","C内容","D内容"],"answer":0,"explain":"..."}]}',
    `qs 必须正好 ${count} 个。`,
    '',
    '原文：',
    body,
  ].join('\n');

  const o = (await chatJson(
    config,
    {
      temperature: 0.5,
      max_tokens: 2500,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
    },
    { signal }
  )) as { qs?: unknown };
  const qs: QuizQuestion[] = (Array.isArray(o.qs) ? o.qs : [])
    .map((it) => {
      const x = (it || {}) as Record<string, unknown>;
      const options = (Array.isArray(x.options) ? x.options : [])
        .map((op) => str(op, 120))
        .filter(Boolean)
        .slice(0, 4);
      const ans = Number(x.answer);
      return {
        q: str(x.q, 300),
        options,
        answer: Number.isInteger(ans) && ans >= 0 && ans < options.length ? ans : -1,
        explain: str(x.explain, 200),
      };
    })
    .filter((q) => q.q && q.options.length === 4 && q.answer >= 0)
    .slice(0, count);

  if (qs.length < Math.min(3, count)) {
    throw new AiError('模型没有出够可用的题目，请再试一次');
  }
  return qs;
}

/* ---------------------------------------------------------------- 文章取词 */

export interface WordGloss {
  /** 词典形（复数/过去式会还原；短语保持原样） */
  word: string;
  /** 美式音标，不带斜杠；短语可能为空 */
  ipa: string;
  /** 词性 + 中文释义 */
  zh: string;
  /** 这个词在本文句子里的用法提示，可空 */
  note: string;
}

/**
 * 查一个词（或短语）在文中的意思。
 *
 * 带上所在句子，模型才知道该给哪个义项——比如 article 在新闻里是「文章」，
 * 在法律语境里是「条款」。结果由调用方缓存，同一个词不会重复花钱。
 */
export async function translateWord(opts: {
  word: string;
  context?: string;
  config: AiConfig;
  signal?: AbortSignal;
}): Promise<WordGloss> {
  const { config, signal } = opts;
  const word = opts.word.trim().slice(0, 60);
  const ctx = (opts.context || '').trim().slice(0, 400);

  const prompt = [
    '你在给中文母语的英语学习者查词。',
    '',
    `单词或短语：${word}`,
    ctx ? `它所在的句子：${ctx}` : '',
    '',
    '要求：',
    '1. zh：先给词性缩写（n. / v. / adj. / adv. / phr. 等），再给中文释义；多义用「；」分隔，总共不超过 40 字。',
    '2. 如果给了句子，优先给**这个语境下**的意思，而不是词典里第一个义项。',
    '3. ipa：美式音标，不带斜杠，例如 ˈkɒfi；短语可以留空。',
    '4. word：词典形。复数还原成单数、动词变形还原原形；短语原样返回。',
    '5. note：如果这个词在句中容易被误解（熟词僻义、固定搭配、俚语），用 30 字以内中文点一句；否则空字符串。',
    '',
    '输出 JSON：',
    '{"word":"...","ipa":"...","zh":"...","note":"..."}',
  ]
    .filter(Boolean)
    .join('\n');

  const o = (await chatJson(
    config,
    {
      temperature: 0.2,
      max_tokens: 500,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
    },
    { signal, timeoutMs: 30_000, attempts: 2 }
  )) as Record<string, unknown>;
  const zh = str(o.zh, 120);
  if (!zh) throw new AiError('没查到释义，换一个词试试');

  return {
    word: str(o.word, 60) || word,
    ipa: str(o.ipa, 60).replace(/^\/+|\/+$/g, ''),
    zh,
    note: str(o.note, 120),
  };
}

/* ---------------------------------------------------------------- 四六级仿真阅读 */

export type CetLevel = 'cet4' | 'cet6';

export const CET_LEVELS: { key: CetLevel; label: string; hint: string; words: number }[] = [
  { key: 'cet4', label: '四级 CET-4', hint: '约 300 词，句子中等长度', words: 300 },
  { key: 'cet6', label: '六级 CET-6', hint: '约 400 词，长句和抽象词更多', words: 400 },
];

export interface GeneratedPassage {
  /** 英文标题 */
  title: string;
  /** 中文标题 */
  titleZh: string;
  topic: string;
  /** 按自然段切好的正文 */
  paras: string[];
  questions: QuizQuestion[];
}

/** 题材：不填就让模型自己轮换，避免篇篇都是同一个调子 */
export const CET_TOPICS = [
  '科普',
  '教育',
  '心理',
  '环境',
  '科技',
  '商业',
  '健康',
  '文化',
];

/**
 * 生成一篇四六级真题风格的阅读理解（文章 + 5 道题，一次请求搞定）。
 *
 * 和抓百科的区别：百科是「定义式」的词条，句子短、没有论点，读起来不像考试；
 * 这里直接让模型按命题思路写——先抛现象或研究，再给论据，最后收束，并配上
 * 主旨 / 细节 / 词义 / 推断 / 态度五类题，和四六级阅读的套路一致。
 */
export async function generatePassage(opts: {
  level: CetLevel;
  topic?: string;
  config: AiConfig;
  count?: number;
  signal?: AbortSignal;
}): Promise<GeneratedPassage> {
  const { level, config, signal } = opts;
  const count = opts.count ?? 5;
  const spec = CET_LEVELS.find((l) => l.key === level) ?? CET_LEVELS[0];
  const topic = (opts.topic || '').trim();

  const prompt = [
    `你是中国大学英语四六级考试的命题老师，现在要写一篇仿真阅读理解（${spec.label}）。`,
    '',
    '文章要求：',
    `1. 长度约 ${spec.words} 词，分 3~5 个自然段。`,
    level === 'cet4'
      ? '2. 词汇以四级大纲词为主，可含极少量六级词；句子中等长度，不要通篇长难句。'
      : '2. 可用六级大纲词汇；句子里有明显的长句、插入语、抽象名词，接近六级真题的密度。',
    '3. 结构要像真题：开头引入一个现象、研究或争议，中间给论据或例子，结尾收束到作者观点。',
    '4. 不要写成百科词条式的定义罗列，不要分点，不要小标题，不要出现中文。',
    '5. 允许引用虚构的研究或专家说法，但读起来要自然可信。',
    topic
      ? `6. 主题：${topic}。`
      : '6. 主题：从科普、教育、心理、环境、科技、商业、健康、文化里挑一个，不要每次都是同一个。',
    '',
    `题目要求（共 ${count} 道，四选一）：`,
    '1. 题干和选项全英文，只考这篇文章，不能靠常识答对。',
    `2. 题型要有区分度：至少各一道主旨题、细节题、词义猜测题、推断题，其余的考作者态度或段落作用。`,
    '3. 干扰项要像真题那样「看似对但细节错」，不要明显荒谬。',
    '4. answer 是正确选项下标 0~3，正确答案不要都落在同一位置。',
    '5. explain 用中文，40 字以内，说清依据原文哪一句。',
    '6. 题干一行以内，每个选项不超过 15 个词。',
    '',
    '输出 JSON（正文按自然段放进 paras 数组，不要用换行符）：',
    '{"title":"英文标题","titleZh":"中文标题","topic":"主题","paras":["第一段","第二段"],',
    `"qs":[{"q":"...","options":["A内容","B内容","C内容","D内容"],"answer":0,"explain":"..."}]}`,
    `qs 必须正好 ${count} 个。`,
  ].join('\n');

  const o = (await chatJson(
    config,
    {
      temperature: 0.9,
      max_tokens: 4000,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
    },
    { signal, timeoutMs: 120_000 }
  )) as Record<string, unknown>;

  const paras = (Array.isArray(o.paras) ? o.paras : [])
    .map((p) => str(p, 2000))
    .filter((p) => p.length > 0)
    .slice(0, 8);

  // 有的模型会把整篇塞进一个字符串，这里兼容一下
  const fallback = str(o.text, 8000);
  const body = paras.length >= 2 ? paras : fallback.split(/\n{2,}/).map((s) => s.trim()).filter(Boolean);

  const words = body.join(' ').split(/\s+/).filter(Boolean).length;
  if (words < 120) throw new AiError('模型这次写的文章太短，再试一次');

  const questions: QuizQuestion[] = (Array.isArray(o.qs) ? o.qs : [])
    .map((it) => {
      const x = (it || {}) as Record<string, unknown>;
      const options = (Array.isArray(x.options) ? x.options : [])
        .map((op) => str(op, 120))
        .filter(Boolean)
        .slice(0, 4);
      const ans = Number(x.answer);
      return {
        q: str(x.q, 300),
        options,
        answer: Number.isInteger(ans) && ans >= 0 && ans < options.length ? ans : -1,
        explain: str(x.explain, 200),
      };
    })
    .filter((q) => q.q && q.options.length === 4 && q.answer >= 0)
    .slice(0, count);

  if (questions.length < Math.min(3, count)) {
    throw new AiError('题目没生成全，再点一次换一篇');
  }

  const title = str(o.title, 120);
  return {
    title,
    titleZh: str(o.titleZh, 60),
    topic: str(o.topic, 20),
    paras: body,
    questions,
  };
}

/* ---------------------------------------------------------------- 口语情景对话 */

export interface TalkTarget {
  word: string;
  meaning: string;
}

export interface TalkOpener {
  /** 中文场景说明：我是谁、在哪、要干嘛 */
  setup: string;
  /** 对方说的第一句英文 */
  opener: string;
  /** opener 的中文翻译 */
  zh: string;
  /** 中文提示：可以从哪句话开始说 */
  hint: string;
}

export interface TalkReply {
  /** 对方的回应（英文，1~3 句口语） */
  reply: string;
  /** reply 的中文翻译 */
  zh: string;
  /** 我这句更地道的说法，空表示没什么可改 */
  better: string;
  /** 中文点评，空表示不说 */
  tip: string;
  /** 用上的目标生词 */
  used: string[];
  /** 这轮对话是否已经自然结束 */
  done: boolean;
}

export interface TalkReviewResult {
  score: number;
  usedTargets: string[];
  missedTargets: string[];
  issues: SentenceIssue[];
  upgrades: { from: string; to: string; why: string }[];
  comment: string;
}

/** 对话双方的消息（喂给模型的多轮上下文） */
export interface TalkMessage {
  role: 'them' | 'me';
  en: string;
}

const LEVEL_HINT: Record<string, string> = {
  easy: '你说得慢一些，句子短，词汇基础，耐心等对方说完。',
  medium: '正常语速和真实生活用语，偶尔追问细节。',
  hard: '说话带省略和口语词（gonna / kinda / you know），有时会抢话、绕话题或反问，像真实场景里那样。',
};

/** 一局对话的随机设定：对方性格 + 情境变数，用来打破「教科书对话」的套路 */
export interface TalkVariation {
  persona: string;
  twists: string[];
}

function talkSystem(
  scene: { name: string; role: string; goal: string; level: string },
  variation?: TalkVariation
): string {
  const lines = [
    '你在一款英语口语练习 App 里扮演对话角色，对方是中文母语的英语学习者。',
    '',
    `你的角色：${scene.role}`,
    `场景：${scene.name}。学习者想办成的事：${scene.goal}。`,
    `说话风格：${LEVEL_HINT[scene.level] || LEVEL_HINT.medium}`,
  ];

  if (variation) {
    lines.push(
      '',
      '这一局的额外设定（必须用上，它决定了这次对话和常见范本不一样）：',
      `- 对方的性格：${variation.persona}`,
      ...variation.twists.map((t) => `- 情境变数：${t}`),
      '',
      '这是一次全新的相遇。不要复述任何现成的对话范本、教科书例句或你之前写过的台词，',
      '按上面的变数自己发挥，让对方的态度和遇到的麻烦都具体、有生活感。'
    );
  }

  lines.push(
    '',
    '规则：',
    '1. 始终待在角色里，reply 必须是英文口语，1~3 句，不要旁白、不要括号动作、不要中文。',
    '2. reply 结尾要自然地把话递回去（提个问题、等对方做决定、或表示为难），让对方有话说。',
    '3. 对方说的英文可能有语法错误，你按意思自然回应，不要在 reply 里纠正或点评。',
    '4. 纠正放在 better / tip 里：better 是对方那句话的地道说法（改最小必要处，保留原意），',
    '   差不多就不用给；tip 用中文一句话说清为什么，25 字以内。',
    '5. used 从【目标生词】里挑出对方这句真的用上了的（只填原词，没有就空数组）。',
    '6. done：场景目标已经达成（钱付完了、事情定了、对方给了明确答复）时为 true，否则 false。',
    '7. 严格只输出一个 JSON 对象，不要 markdown 代码块，不要解释文字。'
  );

  return lines.join('\n');
}

/** 目标生词约束：给模型看，也用来校验 used 的合法性 */
function targetsBlock(targets: TalkTarget[]): string {
  if (!targets.length) return '【目标生词】本轮没有指定，忽略即可。';
  return [
    '【目标生词】下面这些词学习者最近在背，请设计对话时主动创造机会让他用上，但不要生硬点名：',
    targets.map((t) => `- ${t.word}${t.meaning ? `（${t.meaning}）` : ''}`).join('\n'),
  ].join('\n');
}

function talkMessages(
  scene: { name: string; role: string; goal: string; level: string },
  setup: string,
  targets: TalkTarget[],
  history: TalkMessage[],
  tail: string,
  variation?: TalkVariation
): { role: string; content: string }[] {
  const head = [
    talkSystem(scene, variation),
    '',
    `场景背景（中文，仅你理解用，不要念出来）：${setup}`,
    '',
    targetsBlock(targets),
  ].join('\n');

  const msgs: { role: string; content: string }[] = [{ role: 'system', content: head }];
  for (const m of history) {
    msgs.push({ role: m.role === 'them' ? 'assistant' : 'user', content: m.en });
  }
  if (tail) {
    // 最后一条 user 消息末尾挂上输出要求；若最后一条恰好是 assistant，就补一条 user
    const last = msgs[msgs.length - 1];
    if (last && last.role === 'user') last.content = `${last.content}\n\n${tail}`;
    else msgs.push({ role: 'user', content: tail });
  }
  return msgs;
}

export interface GeneratedScript {
  titleEn: string;
  titleZh: string;
  setting: string;
  cast: { name: string; role: string }[];
  lines: { speaker: string; en: string; zh: string; note?: string }[];
  phrases: { en: string; zh: string }[];
}

/**
 * 生成一段可学习的对话范本（多人、逐句中英对照）。
 *
 * 和 startTalk 的区别：这里产出的是**完整范文**，给用户看、听、跟读用的，
 * 一次写完 8~14 轮并带中文翻译；实战那边只给开场白，剧情现场长出来。
 * 两边都不互相引用，避免用户照着范本「背答案」。
 */
export async function generateScript(opts: {
  scene: { name: string; role: string; goal: string; level: string };
  targets: TalkTarget[];
  variation?: TalkVariation;
  config: AiConfig;
  signal?: AbortSignal;
}): Promise<GeneratedScript> {
  const { scene, targets, variation, config, signal } = opts;

  const prompt = [
    `写一段${scene.name}场景下的真实英文对话范本，给中文母语的英语学习者看。`,
    '',
    '内容要求：',
    '1. 8~14 轮对话，2~3 个说话人。其中一个是学习者本人（给他一个常见英文名），另外 1~2 个是对方。',
    '2. 剧情要有推进：开口 → 出现一个小麻烦或分歧 → 商量、澄清 → 事情办成或没办成，结尾自然收住。',
    '3. 必须是真人会说出口的口语：有 yeah / well / I mean / just 这类词，有省略和半截话，',
    '   不要用 How do you do、I would like to purchase 这种教科书腔。',
    '4. 每句英文都给中文翻译，翻译要是自然的中文口语，不要逐字硬译。',
    '5. 每人一次说 1~3 句，不要一个人连着说一大段。',
    targets.length
      ? `6. 把下面这些词自然地用掉 2~3 个（用得上才用，别硬塞）：${targets
          .map((t) => t.word)
          .join('、')}。`
      : '',
    variation
      ? `7. 这一篇的设定：${variation.persona}${variation.twists
          .map((t) => ` ${t}`)
          .join('')} 让它和常见的同类范文不一样。`
      : '',
    '',
    '输出 JSON：',
    '{',
    '  "titleEn": "英文小标题（3~6 词）",',
    '  "titleZh": "中文标题",',
    '  "setting": "中文，30~50 字，交代场景和当下的情况",',
    '  "cast": [{"name":"Mike","role":"中文说明这个人的身份"}],',
    '  "lines": [{"speaker":"Mike","en":"台词","zh":"中文翻译","note":"可选：这句里值得学的表达，中文 20 字内"}],',
    '  "phrases": [{"en":"地道表达","zh":"中文意思"}]',
    '}',
    'lines 里 speaker 必须是 cast 里出现过的 name。',
    'note 只给其中 2~3 句最值得讲的，其余留空字符串。',
    'phrases 给 3~5 个，是对话里真实出现的词组、搭配或句型。',
  ]
    .filter(Boolean)
    .join('\n');

  const o = (await chatJson(
    config,
    {
      temperature: 0.95,
      max_tokens: 4000,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
    },
    { signal, timeoutMs: 120_000 }
  )) as Record<string, unknown>;

  const cast = (Array.isArray(o.cast) ? o.cast : [])
    .map((c) => {
      const x = (c || {}) as Record<string, unknown>;
      return { name: str(x.name, 30), role: str(x.role, 80) };
    })
    .filter((c) => c.name)
    .slice(0, 4);

  const lines = (Array.isArray(o.lines) ? o.lines : [])
    .map((l) => {
      const x = (l || {}) as Record<string, unknown>;
      return {
        speaker: str(x.speaker, 30),
        en: str(x.en, 400),
        zh: str(x.zh, 400),
        note: str(x.note, 120),
      };
    })
    .filter((l) => l.en && l.zh)
    .slice(0, 20);

  if (lines.length < 5) throw new AiError('模型这次没写出完整对话，再试一次');

  // speaker 兜底：模型偶尔会写 cast 里没有的名字
  const names = cast.map((c) => c.name);
  for (const l of lines) {
    if (!l.speaker || !names.includes(l.speaker)) l.speaker = names[0] || 'A';
  }

  const phrases = (Array.isArray(o.phrases) ? o.phrases : [])
    .map((p) => {
      const x = (p || {}) as Record<string, unknown>;
      return { en: str(x.en, 80), zh: str(x.zh, 80) };
    })
    .filter((p) => p.en && p.zh)
    .slice(0, 6);

  return {
    titleEn: str(o.titleEn, 120) || scene.name,
    titleZh: str(o.titleZh, 60) || scene.name,
    setting: str(o.setting, 300) || scene.goal,
    cast,
    lines,
    phrases,
  };
}

/** 开一个新场景：生成中文背景 + 对方的第一句话 */export async function startTalk(opts: {
  scene: { name: string; role: string; goal: string; level: string };
  targets: TalkTarget[];
  variation?: TalkVariation;
  config: AiConfig;
  signal?: AbortSignal;
}): Promise<TalkOpener> {
  const { scene, targets, variation, config, signal } = opts;

  const prompt = [
    '现在请开始这个场景。',
    '',
    '输出 JSON：',
    '{',
    '  "setup": "中文，40~70 字。用第二人称交代我是谁、现在在哪、面对谁、想办成什么，让人一眼进入情境",',
    '  "opener": "你作为角色说的第一句英文，1~2 句，口语，要能直接引出我的回应",',
    '  "openerZh": "opener 的简体中文翻译，口语化、像字幕，不要加解释",',
    '  "hint": "中文，30 字以内，提示我可以怎么开口（给个话头，不要替我写完整句子）"',
    '}',
  ].join('\n');

  const o = (await chatJson(
    config,
    {
      temperature: 0.95,
      max_tokens: 900,
      response_format: { type: 'json_object' },
      messages: talkMessages(scene, '', targets, [], prompt, variation),
    },
    { signal, timeoutMs: 60_000 }
  )) as Record<string, unknown>;

  const opener = str(o.opener, 400);
  if (!opener) throw new AiError('模型没有给出开场白，再试一次');

  return {
    setup: str(o.setup, 300) || scene.goal,
    opener,
    zh: str(o.openerZh, 500),
    hint: str(o.hint, 120),
  };
}

const REPLY_TAIL = [
  '请回应我这句话，输出 JSON：',
  '{"reply":"你的英文回应","zh":"reply 的简体中文翻译（口语化、像字幕，不加解释）",',
  ' "better":"我更地道的说法（没得改就给空字符串）",',
  ' "tip":"中文一句话点评（没有就给空字符串）","used":["用上的目标生词"],"done":false}',
].join('\n');

/** 我说一句，对方回应 + 顺手给一句点评 */
export async function replyTalk(opts: {
  scene: { name: string; role: string; goal: string; level: string };
  setup: string;
  targets: TalkTarget[];
  history: TalkMessage[];
  variation?: TalkVariation;
  config: AiConfig;
  signal?: AbortSignal;
}): Promise<TalkReply> {
  const { scene, setup, targets, history, variation, config, signal } = opts;

  const o = (await chatJson(
    config,
    {
      temperature: 0.9,
      max_tokens: 700,
      response_format: { type: 'json_object' },
      messages: talkMessages(scene, setup, targets, history, REPLY_TAIL, variation),
    },
    { signal, timeoutMs: 60_000 }
  )) as Record<string, unknown>;

  const reply = str(o.reply, 500);
  if (!reply) throw new AiError('模型没有接话，再试一次');

  // used 只保留真的在目标词里的，防止模型自己编
  const allowed = new Map(targets.map((t) => [t.word.toLowerCase(), t.word]));
  const used = (Array.isArray(o.used) ? o.used : [])
    .map((w) => allowed.get(str(w, 40).toLowerCase()))
    .filter((w): w is string => !!w);

  return {
    reply,
    zh: str(o.zh, 500),
    better: str(o.better, 400),
    tip: str(o.tip, 160),
    used: [...new Set(used)],
    done: o.done === true,
  };
}

/** 结束对话，给出整轮复盘 */
export async function reviewTalk(opts: {
  scene: { name: string; role: string; goal: string; level: string };
  setup: string;
  targets: TalkTarget[];
  history: TalkMessage[];
  variation?: TalkVariation;
  config: AiConfig;
  signal?: AbortSignal;
}): Promise<TalkReviewResult> {
  const { scene, setup, targets, history, variation, config, signal } = opts;

  const mine = history.filter((m) => m.role === 'me').map((m) => `- ${m.en}`).join('\n');

  const prompt = [
    '对话结束了，请给这位学习者做一次复盘。',
    '',
    mine ? `他说过的句子：\n${mine}` : '他一句都没说就结束了。',
    '',
    '评分标准（0~100，别虚高，70 分 = 能把事情说清楚但表达平淡）：',
    '- 40 分：目标是否达成，事情办成了没有。',
    '- 35 分：表达是否清楚、对方是否需要反复确认。',
    '- 25 分：语法和用词的地道程度。',
    '',
    '输出 JSON：',
    '{',
    '  "score": 78,',
    `  "usedTargets": ["真正用上的目标生词"],`,
    `  "missedTargets": ["目标生词里没机会用的"],`,
    '  "issues": [{"type":"语法|用词|搭配|发音要点","bad":"他说的原文片段","good":"应该怎么说","why":"中文一句话"}],',
    '  "upgrades": [{"from":"他的原话","to":"母语者的说法","why":"中文说明差别"}],',
    '  "comment": "60 字以内中文总评，点出最该改的一个地方"',
    '}',
    'issues 最多 5 条，upgrades 2~3 条，只挑最值得改的，不要为凑数编。',
    'usedTargets / missedTargets 只从【目标生词】里选；没有目标词就都给空数组。',
  ].join('\n');

  const o = (await chatJson(
    config,
    {
      temperature: 0.3,
      max_tokens: 1800,
      response_format: { type: 'json_object' },
      messages: talkMessages(scene, setup, targets, history, prompt, variation),
    },
    { signal, timeoutMs: 90_000 }
  )) as Record<string, unknown>;

  const allowed = new Map(targets.map((t) => [t.word.toLowerCase(), t.word]));
  const pick = (v: unknown) =>
    (Array.isArray(v) ? v : [])
      .map((w) => allowed.get(str(w, 40).toLowerCase()))
      .filter((w): w is string => !!w);

  const used = pick(o.usedTargets);
  const missed = pick(o.missedTargets).filter((w) => !used.includes(w));
  // 模型漏报的补上，保证两者加起来是所有目标词
  for (const t of targets) {
    if (!used.includes(t.word) && !missed.includes(t.word)) missed.push(t.word);
  }

  const issues: SentenceIssue[] = (Array.isArray(o.issues) ? o.issues : [])
    .map((it) => {
      const x = (it || {}) as Record<string, unknown>;
      return {
        type: str(x.type, 12) || '问题',
        bad: str(x.bad, 200),
        good: str(x.good, 200),
        why: str(x.why, 200),
      };
    })
    .filter((x) => x.bad || x.good)
    .slice(0, 5);

  const upgrades = (Array.isArray(o.upgrades) ? o.upgrades : [])
    .map((it) => {
      const x = (it || {}) as Record<string, unknown>;
      return { from: str(x.from, 200), to: str(x.to, 200), why: str(x.why, 200) };
    })
    .filter((x) => x.from && x.to)
    .slice(0, 3);

  const score = Math.max(0, Math.min(100, Math.round(Number(o.score) || 0)));

  return {
    score,
    usedTargets: used,
    missedTargets: missed,
    issues,
    upgrades,
    comment: str(o.comment, 200),
  };
}

/* ---------------------------------------------------------------- 连接测试 */

/** 测试配置是否可用：先查 /models（不消耗 token），不行再用一次极小的对话 */
export async function testConnection(config: AiConfig): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const res = await fetch(endpoint(config.baseUrl, '/models'), {
      headers: { Authorization: `Bearer ${config.apiKey}` },
      signal: ctrl.signal,
    });
    if (res.ok) {
      const d = (await res.json()) as { data?: { id?: string }[] };
      const ids = (d?.data || []).map((m) => m.id).filter(Boolean) as string[];
      if (ids.length && !ids.includes(config.model)) {
        throw new AiError(
          `Key 可用，但接口里没有模型「${config.model}」，可用：${ids.slice(0, 4).join('、')}`
        );
      }
      return '连接正常';
    }
    if (res.status === 401) throw new AiError('API Key 无效或已失效', 401);
    if (res.status === 404) throw new AiError('接口地址不存在，请检查「接口地址」', 404);
    if (res.status >= 400) {
      await chat(config, {
        max_tokens: 4,
        messages: [{ role: 'user', content: 'ping' }],
      });
      return '连接正常';
    }
    return '连接正常';
  } catch (err) {
    if (err instanceof AiError) throw err;
    if ((err as Error)?.name === 'AbortError') throw new AiError('连接超时，请检查网络');
    throw new AiError('网络请求失败，请检查网络或接口地址');
  } finally {
    clearTimeout(timer);
  }
}
