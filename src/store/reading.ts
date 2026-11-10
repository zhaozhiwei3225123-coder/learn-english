import { computed, ref } from 'vue';
import type { Word } from '../types';
import { state, deckWords } from './vocab';
import { baseForms, splitArticle } from '../lib/lemmatize';
import { fetchNews, fetchWiki } from '../lib/articles';
import { resolveConfig, translateParas, generateQuiz, type ArticleNote, type QuizQuestion } from '../lib/ai';

/**
 * 阅读：粘贴一段英文 → 标出词库里出现过的词 → 用这些词开一轮学习。
 * 全部本地计算，不联网；文章存 localStorage，刷新后还在。
 */

const TEXT_KEY = 'vocab-app.reading.text';

function readSaved(): string {
  try {
    return localStorage.getItem(TEXT_KEY) || '';
  } catch {
    return '';
  }
}

export const articleText = ref<string>(readSaved());
/** 点「分析」后才渲染高亮，避免边打字边闪 */
export const article = ref<string>('');
export const analyzed = computed(() => article.value.trim().length > 0);
/** 生成学习集时是否包含已掌握的词 */
export const includeMastered = ref(false);
/** 当前点开的词 */
export const picked = ref<{ surface: string; word: Word | null } | null>(null);

function saveText(text: string): void {
  try {
    localStorage.setItem(TEXT_KEY, text);
  } catch (err) {
    console.warn('[reading] 保存文章失败', err);
  }
}

export function analyze(text = articleText.value): void {
  const t = text.trim();
  article.value = t;
  picked.value = null;
  saveText(t);
  note.value = notes.get(t) ?? null;
  paraZh.value = [];
  zhOpen.value = [];
  quiz.value = null;
  quizPicks.value = [];
}

export function clearArticle(): void {
  articleText.value = '';
  article.value = '';
  picked.value = null;
  note.value = null;
  paraZh.value = [];
  zhOpen.value = [];
  quiz.value = null;
  quizPicks.value = [];
  saveText('');
}

/* ------------------------------------------------------- AI 精读 */

/** 精读结果只在内存里按正文缓存，切回同一篇不用再花 token */
const notes = new Map<string, ArticleNote>();

export const note = ref<ArticleNote | null>(null);
export const noteLoading = ref(false);

export function setNote(n: ArticleNote | null): void {
  note.value = n;
  if (n && article.value) notes.set(article.value, n);
  if (n?.titleZh) attachTitleZh(article.value, n.titleZh);
}

/** 把 AI 起的中文标题写回往期条目，卡片上就能显示中文标题 */
function attachTitleZh(text: string, titleZh: string): void {
  const hit = dailyList.value.find((it) => it.text === text);
  if (!hit || hit.titleZh === titleZh) return;
  hit.titleZh = titleZh;
  saveDaily();
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

export function pickPiece(p: ArticlePiece): void {
  if (!p.isWord) return;
  picked.value = { surface: p.text, word: p.word };
}

export function closePick(): void {
  picked.value = null;
}

/* ------------------------------------------------------- 今日一篇 */

export interface DailyItem {
  /** `${日期}|${来源}|${难度}`，同一天同难度只保留一篇 */
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
    console.warn('[reading] 保存往期文章失败', err);
  }
}

function today(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 今日一篇的来源与难度（参考百词斩 MintDaily：一天一篇，难度可选） */
export const dailySource = ref<'news' | 'wiki'>('news');
export const newsLevel = ref<1 | 2 | 3>(1);
export const wikiSimple = ref(true);

function dailyKey(): string {
  const lv =
    dailySource.value === 'news'
      ? `L${newsLevel.value}`
      : wikiSimple.value
        ? 'S'
        : 'E';
  return `${today()}|${dailySource.value}|${lv}`;
}

export function findDaily(): DailyItem | undefined {
  const key = dailyKey();
  return dailyList.value.find((it) => it.key === key);
}

/**
 * 取「今日一篇」：当天 + 当前来源/难度已经有就直接返回，
 * 没有（或 force）就现场抓一篇存进往期。
 */
export async function ensureDaily(force = false): Promise<DailyItem> {
  const key = dailyKey();
  if (!force) {
    const found = dailyList.value.find((it) => it.key === key);
    if (found) return found;
  }

  const a =
    dailySource.value === 'news'
      ? await fetchNews(newsLevel.value)
      : await fetchWiki(wikiSimple.value);

  const item: DailyItem = {
    key,
    date: today(),
    title: a.title,
    text: a.text,
    source: a.source,
    url: a.url,
    words: a.text.split(/\s+/).filter(Boolean).length,
    ts: Date.now(),
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
  } finally {
    quizLoading.value = false;
  }
}

export function pickQuizOption(qi: number, oi: number): void {
  if (!quiz.value || quizPicks.value[qi] >= 0) return;
  quizPicks.value[qi] = oi;
}

export function resetQuiz(): void {
  if (!quiz.value) return;
  quizPicks.value = quiz.value.map(() => -1);
}
