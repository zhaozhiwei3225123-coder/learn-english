import { computed, reactive, ref, watch } from 'vue';
import type { AppState, Deck, LogEntry, ParsedEntry, Word } from '../types';
import * as persist from '../lib/persist';
import { todayKey } from '../lib/date';
import { isDue, isMastered } from '../lib/srs';

/** 全局唯一状态（IndexedDB 持久化），启动时异步载入 */
export const state = reactive<AppState>(persist.emptyState());
/** IndexedDB 里的数据是否已载入完成 */
export const stateReady = ref(false);

let hydrating = true;
watch(
  state,
  () => {
    if (!hydrating) persist.saveState(state);
  },
  { deep: true, flush: 'sync' }
);

/** 载入本地数据；App 启动时调用一次 */
export async function loadState(): Promise<void> {
  try {
    Object.assign(state, await persist.loadState());
  } finally {
    hydrating = false;
    stateReady.value = true;
  }
}

export function save(): void {
  persist.saveState(state);
}

/* ---------------------------------------------------------------- 词库 */

/** 当前选中的词库 */
export const activeDeck = computed<Deck | undefined>(
  () => state.decks.find((d) => d.id === state.activeDeckId) ?? state.decks[0]
);

/** 当前词库里的单词 */
export const deckWords = computed(() =>
  state.words.filter((w) => w.deckId === state.activeDeckId)
);

export function deckCount(deckId: string): number {
  return state.words.filter((w) => w.deckId === deckId).length;
}

export function setActiveDeck(id: string): void {
  if (state.activeDeckId === id) return;
  if (!state.decks.some((d) => d.id === id)) return;
  state.activeDeckId = id;
  save();
}

export function createDeck(name: string): Deck | null {
  const n = name.trim();
  if (!n) return null;
  const deck: Deck = {
    id: `deck-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    name: n,
    createdAt: Date.now(),
  };
  state.decks.push(deck);
  state.activeDeckId = deck.id;
  save();
  return deck;
}

export function renameDeck(id: string, name: string): void {
  const deck = state.decks.find((d) => d.id === id);
  const n = name.trim();
  if (!deck || !n) return;
  deck.name = n;
  save();
}

/** 删除词库及其单词、学习记录；至少保留一个词库 */
export function removeDeck(id: string): boolean {
  if (state.decks.length <= 1) return false;
  const idx = state.decks.findIndex((d) => d.id === id);
  if (idx < 0) return false;
  const ids = new Set(state.words.filter((w) => w.deckId === id).map((w) => w.id));
  state.words = state.words.filter((w) => w.deckId !== id);
  state.logs = state.logs.filter((l) => !ids.has(l.id));
  state.decks = state.decks.filter((d) => d.id !== id);
  if (state.activeDeckId === id) state.activeDeckId = state.decks[0].id;
  save();
  return true;
}

/** 已掌握的词到了约定天数后，自动进入复习队列（stage 保留，间隔阶梯才能往上走） */
export function promoteMastered(): void {
  const today = todayKey();
  let changed = false;
  for (const w of state.words) {
    if (w.group === 'mastered' && isDue(w, today)) {
      w.group = 'review';
      changed = true;
    }
  }
  if (changed) save();
}

/* ---------------------------------------------------------------- 统计 */

export const stats = computed(() => {
  const today = todayKey();
  const words = deckWords.value;
  const ids = new Set(words.map((w) => w.id));
  const reviewWords = words.filter((w) => w.group === 'review');
  const logs = state.logs.filter((l) => l.date === today && ids.has(l.id));
  const unique = (kind: 'new' | 'review') =>
    new Set(logs.filter((l) => l.kind === kind && !l.requeued).map((l) => l.id)).size;

  // 每个单词最早的一条学习记录（只看当前词库）
  const firstLogs = new Map<string, LogEntry>();
  for (const l of state.logs) {
    if (!ids.has(l.id)) continue;
    const prev = firstLogs.get(l.id);
    if (!prev || l.at < prev.at) firstLogs.set(l.id, l);
  }
  // 今日新学 = 今天第一次学习的单词（此前从未学过），不含复习
  const learnedToday = [...firstLogs.values()].filter(
    (l) => l.date === today && l.kind === 'new' && !l.requeued
  ).length;

  return {
    today,
    total: words.length,
    newCount: words.filter((w) => w.group === 'new').length,
    dueCount: reviewWords.filter((w) => isDue(w, today)).length,
    masteredCount: words.filter(isMastered).length,
    learnedToday,
    reviewedToday: unique('review'),
  };
});

/* ---------------------------------------------------------------- 相近词 */

/** 释义里的分隔符（中英文标点、斜杠、括号、空白、省略号） */
const MEANING_SPLIT = /[;；,，、/|\\()（）\[\]【】{}…·\s]+/;
/** 词性标注：不能当释义参与比较 */
const POS_MARK = /\b(?:adj|adv|n|v|vt|vi|prep|conj|pron|num|art|int|interj|aux|phr|abbr|pl|sing|suffix|prefix)\./gi;
const POS_ZH = /(形容词|副词|名词|动词|及物动词|不及物动词|介词|连词|代词|数词|冠词|感叹词|短语|缩写)/g;
/** 太泛的词元，不算「相近」 */
const MEANING_STOP = new Set([
  '的', '地', '得', '了', '是', '一个', '一种', '某人', '某物', '某事', '使', '把', '或', '和', '等',
  '通常', '常', '尤指', '指', '表示', '用于', '进行', 'the', 'a', 'an', 'to', 'of', 'and', 'or', 'sb', 'sth',
]);

function meaningTokens(meaning: string): Set<string> {
  const tokens = String(meaning || '')
    .replace(POS_MARK, ' ')
    .replace(POS_ZH, ' ')
    .toLowerCase()
    .split(MEANING_SPLIT)
    // 去掉「值得的」这种尾缀「的/地」，但保留「目的」「值得」这类本身以「的/得」结尾的词
    .map((t) => (t.length >= 3 ? t.replace(/[的地]+$/, '') : t).trim())
    // 只保留真正带字/数字的词元（丢掉「...」「……」「—」这类纯符号），单字太泛也不要
    .filter((t) => t.length >= 2 && /[\p{L}\p{N}]/u.test(t) && !MEANING_STOP.has(t));
  return new Set(tokens);
}

/** 当前词库里释义相同/相近的其它单词（按重合词元数排序） */
export function similarWords(wordId: string, limit = 5): Word[] {
  const target = state.words.find((w) => w.id === wordId);
  if (!target) return [];
  const base = meaningTokens(target.meaning);
  if (!base.size) return [];

  const scored: { word: Word; shared: number; size: number }[] = [];
  for (const w of deckWords.value) {
    if (w.id === target.id) continue;
    const tokens = meaningTokens(w.meaning);
    let shared = 0;
    for (const t of tokens) if (base.has(t)) shared++;
    if (!shared) continue;
    scored.push({ word: w, shared, size: tokens.size });
  }

  scored.sort(
    (a, b) =>
      b.shared - a.shared ||
      a.size - b.size ||
      a.word.word.localeCompare(b.word.word)
  );
  return scored.slice(0, limit).map((s) => s.word);
}

/* ---------------------------------------------------------------- 操作 */

export function addEntries(entries: ParsedEntry[], source: string) {
  const res = persist.importEntries(
    state,
    entries,
    source,
    state.activeDeckId,
    activeDeck.value?.name
  );
  save();
  return res;
}

export function findWord(id: string): Word | undefined {
  return state.words.find((w) => w.id === id);
}

export function resetWord(word: Word): void {
  word.group = 'new';
  word.stage = 0;
  word.due = todayKey();
  word.seen = 0;
  word.right = 0;
  word.wrong = 0;
  word.lastAt = null;
  save();
}

export function removeWord(id: string): void {
  state.words = state.words.filter((w) => w.id !== id);
  save();
}

/** 手动修改 / 补充音标 */
export function setWordIpa(id: string, ipa: string): void {
  const w = state.words.find((x) => x.id === id);
  if (!w || w.ipa === ipa) return;
  w.ipa = ipa;
  save();
}

export function resetAllProgress(): void {
  const today = todayKey();
  for (const w of state.words) {
    w.group = 'new';
    w.stage = 0;
    w.due = today;
    w.seen = 0;
    w.right = 0;
    w.wrong = 0;
    w.lastAt = null;
  }
  state.logs = [];
  save();
}

export function clearAll(settings: AppState['settings']): void {
  state.words = [];
  state.logs = [];
  state.imports = [];
  state.decks = [persist.defaultDeck()];
  state.activeDeckId = persist.DEFAULT_DECK_ID;
  state.settings = { ...settings };
  save();
}

export async function replaceAll(raw: unknown): Promise<void> {
  const next = await persist.replaceState(raw);
  state.settings = next.settings;
  state.decks = next.decks;
  state.activeDeckId = next.activeDeckId;
  state.words = next.words;
  state.logs = next.logs;
  state.imports = next.imports;
  state.createdAt = next.createdAt;
}
