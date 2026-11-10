import { computed, ref } from 'vue';
import type { Word } from '../types';
import { deckWords } from './vocab';
import { baseForms, splitArticle } from '../lib/lemmatize';
import { fetchNews, fetchWiki } from '../lib/articles';

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
}

export function clearArticle(): void {
  articleText.value = '';
  article.value = '';
  picked.value = null;
  saveText('');
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

function lookup(token: string): Word | null {
  const idx = index.value;
  for (const form of baseForms(token)) {
    const hit = idx.get(form);
    if (hit) return hit;
  }
  return null;
}

export const pieces = computed<ArticlePiece[]>(() =>
  splitArticle(article.value).map((s) => ({
    text: s.text,
    isWord: s.isWord,
    word: s.isWord ? lookup(s.text) : null,
  }))
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
