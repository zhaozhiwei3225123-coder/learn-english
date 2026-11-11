import { computed, ref } from 'vue';
import type { Word } from '../types';
import { state, deckWords } from './vocab';
import { baseForms, splitArticle } from '../lib/lemmatize';
import {
  resolveConfig,
  translateParas,
  translateWord,
  generateQuiz,
  generatePassage,
  type ArticleNote,
  type CetLevel,
  type QuizQuestion,
  type WordGloss,
} from '../lib/ai';

/**
 * 阅读：每天一篇四六级仿真阅读（AI 命题，自带 5 道题）→
 * 标出词库里出现过的词 → 用这些词开一轮学习。全部本地判分，不联网。
 */

/** 当前打开的文章正文 */
export const article = ref<string>('');
export const analyzed = computed(() => article.value.trim().length > 0);
/** 生成学习集时是否包含已掌握的词 */
export const includeMastered = ref(false);
/** 当前点开的词 */
export const picked = ref<{ surface: string; word: Word | null } | null>(null);

/** 打开一篇文章（抓取 / 往期都走这里） */
export function analyze(text: string): void {
  const t = text.trim();
  article.value = t;
  picked.value = null;
  hydrate(t);
}

/** 打开一篇文章时，把往期里存过的精读 / 译文 / 题目一起还原 */
function hydrate(text: string): void {
  const it = dailyList.value.find((x) => x.text === text);

  const n = it?.note ?? notes.get(text) ?? null;
  note.value = n;
  if (n) notes.set(text, n);

  const zh = it?.zh ?? zhCache.get(text) ?? [];
  paraZh.value = zh.slice();
  if (zh.length) zhCache.set(text, zh.slice());
  // 从往期翻出来、并且存过译文时，直接展开成中英对照，省得再逐段点
  zhOpen.value = it?.zh?.length ? it.zh.map(() => true) : [];

  const qs = it?.quiz ?? null;
  quiz.value = qs;
  quizPicks.value = qs ? qs.map((_, i) => it?.quizPicks?.[i] ?? -1) : [];
}

/* ------------------------------------------------------- AI 精读 */

/** 精读结果按正文缓存在内存，切回同一篇不用再花 token（落盘的是往期条目里的 note） */
const notes = new Map<string, ArticleNote>();

export const note = ref<ArticleNote | null>(null);
export const noteLoading = ref(false);

export function setNote(n: ArticleNote | null): void {
  note.value = n;
  if (!n) return;
  if (article.value) notes.set(article.value, n);
  patchHistory({
    note: n,
    ...(n.titleZh ? { titleZh: n.titleZh } : {}),
  });
}

/* ---------------------------------------------------------------- 匹配 */

/** 小写词形 → 词库词（同词只留第一个） */
const index = computed(() => {
  const m = new Map<string, Word>();
  for (const w of deckWords.value) {
    const key = w.word.toLowerCase().trim();
    if (key && !m.has(key)) m.set(key, w);
  }
  return m;
});

export interface ArticlePiece {
  text: string;
  isWord: boolean;
  /** 命中的词库词（变形也能命中） */
  word: Word | null;
}

/** 一个自然段落：正文原文 + 这一段里的分词结果 */
export interface ParaGroup {
  para: string;
  pieces: ArticlePiece[];
}

function lookup(token: string): Word | null {
  const idx = index.value;
  for (const form of baseForms(token)) {
    const hit = idx.get(form);
    if (hit) return hit;
  }
  return null;
}

function buildPieces(text: string): ArticlePiece[] {
  return splitArticle(text).map((s) => ({
    text: s.text,
    isWord: s.isWord,
    word: s.isWord ? lookup(s.text) : null,
  }));
}

/** 按换行切自然段，一段一张卡片 */
export const paraGroups = computed<ParaGroup[]>(() =>
  article.value
    .split(/\n+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((para) => ({ para, pieces: buildPieces(para) }))
);

export const pieces = computed<ArticlePiece[]>(() =>
  paraGroups.value.flatMap((g) => g.pieces)
);

export const readingStats = computed(() => {
  let total = 0;
  const matched = new Map<string, Word>();
  let notInDeck = 0;
  for (const p of pieces.value) {
    if (!p.isWord) continue;
    total++;
    if (p.word) matched.set(p.word.id, p.word);
    else notInDeck++;
  }
  const list = [...matched.values()];
  const unmastered = list.filter((w) => w.group !== 'mastered');
  return {
    total,
    matched: list.length,
    unmastered: unmastered.length,
    mastered: list.length - unmastered.length,
    notInDeck,
  };
});

/** 可生成学习集的词：默认只取未掌握的，按「新词优先 → 错得多的优先」排序 */
export const studyWords = computed<Word[]>(() => {
  const seen = new Map<string, Word>();
  for (const p of pieces.value) {
    if (p.word) seen.set(p.word.id, p.word);
  }
  const list = [...seen.values()].filter((w) => includeMastered.value || w.group !== 'mastered');
  return list.sort((a, b) => {
    const rank = (w: Word) => (w.group === 'new' ? 0 : 1);
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    return b.wrong - a.wrong;
  });
});

/* ------------------------------------------------------- 点词 / 选中取词 */

/** 查词结果按小写词形缓存在内存，同一个词不重复花钱 */
const glossCache = new Map<string, WordGloss>();

/** 当前词的 AI 释义（词库里的词直接用词库释义，这里多半为空） */
export const gloss = ref<WordGloss | null>(null);
export const glossLoading = ref(false);
export const glossError = ref('');

export function pickPiece(p: ArticlePiece): void {
  if (!p.isWord) return;
  select(p.text, p.word);
}

/**
 * 选中一段文字（可能不止一个词）时取词：能对上词库就直接用词库释义，
 * 对不上就让 AI 结合这句话翻译。
 */
export function pickSelection(text: string): void {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return;
  select(t, lookup(t));
}

function select(surface: string, word: Word | null): void {
  picked.value = { surface, word };
  glossError.value = '';
  gloss.value = glossCache.get(keyOf(surface)) ?? null;
  // 词库外、或词库里这个词没填释义，都去问 AI
  if ((!word || !word.meaning) && !gloss.value) void loadGloss(surface);
}

function keyOf(s: string): string {
  return s.trim().toLowerCase();
}

/** 取词在文中的上下文：找到这个词所在的段落，截词前后各 120 字 */
function contextOf(surface: string): string {
  const key = keyOf(surface);
  for (const g of paraGroups.value) {
    const i = g.para.toLowerCase().indexOf(key);
    if (i < 0) continue;
    const start = Math.max(0, i - 120);
    const end = Math.min(g.para.length, i + surface.length + 120);
    return g.para.slice(start, end).trim();
  }
  return '';
}

async function loadGloss(surface: string): Promise<void> {
  const key = keyOf(surface);
  glossLoading.value = true;
  glossError.value = '';
  try {
    const g = await translateWord({
      word: surface,
      context: contextOf(surface),
      config: ensureConfig(),
    });
    glossCache.set(key, g);
    // 用户可能已经点了别的词，只有还停在这个词上才回填
    if (picked.value && keyOf(picked.value.surface) === key) gloss.value = g;
  } catch (err) {
    if (picked.value && keyOf(picked.value.surface) === key) {
      glossError.value = err instanceof Error ? err.message : '查词失败，再点一次';
    }
  } finally {
    glossLoading.value = false;
  }
}

/** 重新查一次当前词（上一次失败时用） */
export function retryGloss(): void {
  const p = picked.value;
  if (!p) return;
  glossCache.delete(keyOf(p.surface));
  gloss.value = null;
  void loadGloss(p.surface);
}

/** 词被加进词库后，把点词面板里的引用换成新词，标签会从「词库外」变成「新词」 */
export function refreshPicked(): void {
  const p = picked.value;
  if (!p) return;
  const w = lookup(p.surface);
  if (w) picked.value = { surface: p.surface, word: w };
}

export function closePick(): void {
  picked.value = null;
  gloss.value = null;
  glossError.value = '';
}

/* ------------------------------------------------------- 今日一篇 */

export interface DailyItem {
  /** `${日期}|${来源}|${难度}`；自己粘的文章是 `paste|时间戳` */
  key: string;
  date: string;
  title: string;
  /** AI 起的中文标题（有就优先显示） */
  titleZh?: string;
  text: string;
  source: string;
  url: string;
  words: number;
  ts: number;
  /** 存下来的 AI 精读（中文标题、导读、生词、长难句） */
  note?: ArticleNote;
  /** 存下来的逐段中文译文，与自然段一一对应 */
  zh?: string[];
  /** 存下来的阅读理解题目与作答（-1 = 未答） */
  quiz?: QuizQuestion[];
  quizPicks?: number[];
}

const DAILY_KEY = 'vocab-app.reading.daily';

function readDaily(): DailyItem[] {
  try {
    const raw = localStorage.getItem(DAILY_KEY);
    const list = raw ? (JSON.parse(raw) as DailyItem[]) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/** 往期文章，新的在前，最多留 40 篇 */
export const dailyList = ref<DailyItem[]>(readDaily());

function saveDaily(): void {
  try {
    localStorage.setItem(DAILY_KEY, JSON.stringify(dailyList.value));
  } catch (err) {
    // 多半是译文 / 题目把 localStorage 塞满了：先砍一半再试一次
    try {
      dailyList.value = dailyList.value.slice(0, 20);
      localStorage.setItem(DAILY_KEY, JSON.stringify(dailyList.value));
      console.warn('[reading] 存储空间不足，往期已精简为最近 20 篇');
    } catch {
      console.warn('[reading] 保存往期文章失败', err);
    }
  }
}

function today(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * 找当前文章对应的往期条目。create = true 时，如果这篇是自己粘的（往期里没有）
 * 就顺手建一条，这样 AI 解析、译文、题目都有地方存，历史里能翻回来。
 */
function historyEntry(create = false): DailyItem | null {
  const text = article.value;
  if (!text) return null;

  const found = dailyList.value.find((it) => it.text === text);
  if (found) return found;
  if (!create) return null;

  const plain = text.replace(/\s+/g, ' ').trim();
  const item: DailyItem = {
    key: `paste|${Date.now()}`,
    date: today(),
    title: plain.length > 24 ? `${plain.slice(0, 24)}…` : plain,
    text,
    source: '自选文章',
    url: '',
    words: text.split(/\s+/).filter(Boolean).length,
    ts: Date.now(),
  };
  dailyList.value = [item, ...dailyList.value].slice(0, 40);
  saveDaily();
  return item;
}

/** 把 AI 产物写回往期条目（没有就新建） */
function patchHistory(patch: Partial<DailyItem>): void {
  const it = historyEntry(true);
  if (!it) return;
  Object.assign(it, patch);
  saveDaily();
}

/** 把一篇「不是今日一篇」的文章（百科搜索 / 自己粘贴）也收进往期，方便以后查阅 */
export function archiveArticle(a: {
  title: string;
  text: string;
  source: string;
  url: string;
}): void {
  const text = a.text.trim();
  if (!text) return;
  if (dailyList.value.some((it) => it.text === text)) return;

  const plain = (a.title || text).replace(/\s+/g, ' ').trim();
  const item: DailyItem = {
    key: `pick|${Date.now()}`,
    date: today(),
    title: plain.length > 40 ? `${plain.slice(0, 40)}…` : plain,
    text,
    source: a.source,
    url: a.url,
    words: text.split(/\s+/).filter(Boolean).length,
    ts: Date.now(),
  };
  dailyList.value = [item, ...dailyList.value].slice(0, 40);
  saveDaily();
}

/** 今日一篇的难度：四级 / 六级 */
export const cetLevel = ref<CetLevel>('cet4');

/** 主题（可选）：留空由模型自己挑，避免篇篇一个调子 */
export const cetTopic = ref('');

function dailyKey(): string {
  return `${today()}|cet|${cetLevel.value}`;
}

export function findDaily(): DailyItem | undefined {
  const key = dailyKey();
  return dailyList.value.find((it) => it.key === key);
}

/**
 * 取「今日一篇」：当天 + 当前难度已经有就直接返回，
 * 没有（或 force）就让模型现场写一篇，连同 5 道题一起存进往期。
 */
export async function ensureDaily(force = false): Promise<DailyItem> {
  const key = dailyKey();
  if (!force) {
    const found = dailyList.value.find((it) => it.key === key);
    if (found) return found;
  }

  const cfg = ensureConfig();
  const p = await generatePassage({
    level: cetLevel.value,
    topic: cetTopic.value,
    config: cfg,
  });

  const text = p.paras.join('\n\n');
  const item: DailyItem = {
    key,
    date: today(),
    title: p.title,
    titleZh: p.titleZh,
    text,
    source: `AI 仿真题 · ${cetLevel.value === 'cet4' ? 'CET-4' : 'CET-6'}${p.topic ? ` · ${p.topic}` : ''}`,
    url: '',
    words: text.split(/\s+/).filter(Boolean).length,
    ts: Date.now(),
    // 自带的题目直接落盘，打开就能做，不用再点一次「阅读理解」
    quiz: p.questions,
    quizPicks: p.questions.map(() => -1),
  };
  dailyList.value = [item, ...dailyList.value.filter((it) => it.key !== key)].slice(0, 40);
  saveDaily();
  return item;
}

/* ------------------------------------------------------- 段落翻译 */

/** 与 paraGroups 对齐的段落译文；空数组 = 还没翻译 */
export const paraZh = ref<string[]>([]);
/** 每段译文是否展开 */
export const zhOpen = ref<boolean[]>([]);
export const zhLoading = ref(false);

/** 译文按正文整篇缓存，同一篇不用再花 token */
const zhCache = new Map<string, string[]>();

function ensureConfig() {
  const cfg = resolveConfig(state.settings);
  if (!cfg) throw new Error('先到「设置 → AI 造句练习」填 DeepSeek API Key');
  return cfg;
}

/** 确保全文译文已就位（有缓存直接用，没有就一次请求翻完全部段落） */
async function ensureParaZh(): Promise<void> {
  const paras = paraGroups.value.map((g) => g.para);
  if (!paras.length) return;
  if (paraZh.value.length === paras.length) return;

  const cached = zhCache.get(article.value);
  if (cached && cached.length === paras.length) {
    paraZh.value = cached.slice();
    return;
  }

  zhLoading.value = true;
  try {
    const out = await translateParas(paras, ensureConfig());
    paraZh.value = out;
    zhCache.set(article.value, out.slice());
    patchHistory({ zh: out.slice() });
  } finally {
    zhLoading.value = false;
  }
}

/** 点某一段的「译」：第一次会顺带把整篇都翻了（一次请求），然后只展开这一段 */
export async function toggleParaZh(i: number): Promise<void> {
  if (zhOpen.value[i]) {
    zhOpen.value[i] = false;
    return;
  }
  try {
    await ensureParaZh();
  } catch (err) {
    throw err instanceof Error ? err : new Error('翻译失败，请重试');
  }
  while (zhOpen.value.length < paraZh.value.length) zhOpen.value.push(false);
  zhOpen.value[i] = true;
}

/** 展开全部段落译文 */
export async function translateAllPara(): Promise<void> {
  await ensureParaZh();
  while (zhOpen.value.length < paraZh.value.length) zhOpen.value.push(false);
  zhOpen.value = paraZh.value.map(() => true);
}

/* ------------------------------------------------------- 阅读理解 */

export const quiz = ref<QuizQuestion[] | null>(null);
/** 每题已选的下标，-1 = 未作答 */
export const quizPicks = ref<number[]>([]);
export const quizLoading = ref(false);

export const quizScore = computed(() => {
  if (!quiz.value) return 0;
  return quiz.value.reduce((n, q, i) => (quizPicks.value[i] === q.answer ? n + 1 : n), 0);
});

export const quizDone = computed(
  () => !!quiz.value && quizPicks.value.length === quiz.value.length && quizPicks.value.every((p) => p >= 0)
);

export async function makeQuiz(): Promise<void> {
  if (quizLoading.value || !article.value.trim()) return;
  quizLoading.value = true;
  try {
    const qs = await generateQuiz({ text: article.value, config: ensureConfig() });
    quiz.value = qs;
    quizPicks.value = qs.map(() => -1);
    patchHistory({ quiz: qs, quizPicks: quizPicks.value.slice() });
  } finally {
    quizLoading.value = false;
  }
}

export function pickQuizOption(qi: number, oi: number): void {
  if (!quiz.value || quizPicks.value[qi] >= 0) return;
  quizPicks.value[qi] = oi;
  patchHistory({ quizPicks: quizPicks.value.slice() });
}

export function resetQuiz(): void {
  if (!quiz.value) return;
  quizPicks.value = quiz.value.map(() => -1);
  patchHistory({ quizPicks: quizPicks.value.slice() });
}
