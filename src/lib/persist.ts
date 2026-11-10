import type {
  AppState,
  Deck,
  ImportRecord,
  LogEntry,
  ParsedEntry,
  SentenceAttempt,
  Settings,
  StudyKind,
  Word,
} from '../types';
import { todayKey } from './date';
import { idbGet, idbSet } from './idb';

/** IndexedDB 里的键 */
const DB_KEY = 'state';
/** 旧版本用 localStorage 存，保留这个键用于首次迁移 */
const LEGACY_KEY = 'vocab-app.state.v1';

/** 旧数据迁移后所在的默认词库 */
export const DEFAULT_DECK_ID = 'default';

export function defaultDeck(): Deck {
  return { id: DEFAULT_DECK_ID, name: '默认词库', createdAt: Date.now() };
}

export const DEFAULT_SETTINGS: Settings = {
  dailyNew: 20,
  dailyReview: 30,
  direction: 'en2zh',
  autoSpeak: false,
  reviewDelayDays: 2,
  ttsEngine: 'kokoro',
  kokoroVoice: 'af_heart',
  aiBaseUrl: 'https://api.deepseek.com',
  aiModel: 'deepseek-chat',
};

/** 学完的新词进入复习队列的间隔天数（默认 2 天，限制 1~60） */
export function reviewDelayDays(settings: Settings): number {
  const n = Math.round(Number(settings.reviewDelayDays));
  if (!Number.isFinite(n) || n < 1) return DEFAULT_SETTINGS.reviewDelayDays;
  return Math.min(60, n);
}

export function makeId(word: string): string {
  return String(word || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function emptyState(): AppState {
  return {
    version: 1,
    settings: { ...DEFAULT_SETTINGS },
    decks: [defaultDeck()],
    activeDeckId: DEFAULT_DECK_ID,
    words: [],
    logs: [],
    imports: [],
    sentenceAttempts: [],
    createdAt: Date.now(),
  };
}

function normalizeWord(w: Partial<Word>): Word | null {
  if (!w || !w.word) return null;
  const id = w.id || makeId(String(w.word));
  if (!id) return null;
  return {
    id,
    deckId: String(w.deckId ?? DEFAULT_DECK_ID),
    word: String(w.word).trim(),
    meaning: String(w.meaning ?? '').trim(),
    ipa: String(w.ipa ?? '').trim(),
    group:
      w.group === 'review' ? 'review' : w.group === 'mastered' ? 'mastered' : 'new',
    stage: Number.isFinite(w.stage) ? Number(w.stage) : 0,
    due: w.due || todayKey(),
    addedAt: w.addedAt || Date.now(),
    seen: w.seen || 0,
    right: w.right || 0,
    wrong: w.wrong || 0,
    lastAt: w.lastAt ?? null,
  };
}

export function normalizeState(raw: unknown): AppState {
  const base = emptyState();
  if (!raw || typeof raw !== 'object') return base;
  const s = raw as Partial<AppState>;

  const rawDecks = Array.isArray(s.decks) ? s.decks : [];
  let decks: Deck[] = rawDecks
    .filter((d) => d && d.id && d.name)
    .map((d) => ({
      id: String(d.id),
      name: String(d.name).trim() || '未命名词库',
      createdAt: Number(d.createdAt) || Date.now(),
    }));
  if (!decks.length) decks = [defaultDeck()];

  const deckIds = new Set(decks.map((d) => d.id));
  const words = Array.isArray(s.words)
    ? (s.words.map(normalizeWord).filter(Boolean) as Word[])
    : [];
  // 旧数据（没有词库字段）统一归到第一个词库
  for (const w of words) {
    if (!deckIds.has(w.deckId)) w.deckId = decks[0].id;
  }

  const activeDeckId = deckIds.has(String(s.activeDeckId))
    ? String(s.activeDeckId)
    : decks[0].id;

  return {
    version: 1,
    settings: { ...DEFAULT_SETTINGS, ...(s.settings || {}) },
    decks,
    activeDeckId,
    words,
    logs: Array.isArray(s.logs) ? (s.logs as LogEntry[]) : [],
    imports: Array.isArray(s.imports) ? (s.imports as ImportRecord[]) : [],
    sentenceAttempts: Array.isArray(s.sentenceAttempts)
      ? (s.sentenceAttempts as SentenceAttempt[]).filter((x) => x && x.zh && x.text).slice(0, 2000)
      : [],
    createdAt: s.createdAt || Date.now(),
  };
}

/** 从 IndexedDB 读取；首次运行会把旧版 localStorage 数据迁移过来 */
export async function loadState(): Promise<AppState> {
  try {
    const saved = await idbGet(DB_KEY);
    if (saved) return normalizeState(saved);
  } catch (err) {
    console.warn('[persist] 读取 IndexedDB 失败', err);
  }

  try {
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (!legacy) return emptyState();
    const migrated = normalizeState(JSON.parse(legacy));
    try {
      await idbSet(DB_KEY, snapshot(migrated));
      localStorage.removeItem(LEGACY_KEY);
    } catch (err) {
      console.warn('[persist] 迁移到 IndexedDB 失败，暂时保留 localStorage', err);
    }
    return migrated;
  } catch (err) {
    console.warn('[persist] 读取旧数据失败，使用空状态', err);
    return emptyState();
  }
}

/** 结构化快照：Vue 的 reactive 代理不能直接写进 IndexedDB */
function snapshot(state: AppState): AppState {
  return JSON.parse(JSON.stringify(state)) as AppState;
}

let queued: AppState | null = null;
let writing = false;

/** 排队写入 IndexedDB；连续修改会合并成一次写入 */
export function saveState(state: AppState): void {
  queued = state;
  if (writing) return;
  writing = true;
  void flushWrites();
}

async function flushWrites(): Promise<void> {
  while (queued) {
    const target = queued;
    queued = null;
    try {
      await idbSet(DB_KEY, snapshot(target));
    } catch (err) {
      console.error('[persist] 写入 IndexedDB 失败，回退 localStorage', err);
      try {
        localStorage.setItem(LEGACY_KEY, JSON.stringify(target));
      } catch (e) {
        console.error('[persist] localStorage 兜底也失败', e);
      }
    }
  }
  writing = false;
}

export async function replaceState(raw: unknown): Promise<AppState> {
  const next = normalizeState(raw);
  try {
    await idbSet(DB_KEY, snapshot(next));
  } catch (err) {
    console.error('[persist] 恢复备份写入 IndexedDB 失败', err);
  }
  return next;
}

/** 词库内的单词 id：默认词库沿用旧格式，其它词库加前缀避免跨词库冲突 */
export function wordId(deckId: string, word: string): string {
  const slug = makeId(word);
  return deckId === DEFAULT_DECK_ID ? slug : `${deckId}:${slug}`;
}

/** 导入词条到指定词库：新词新增；该词库已有但缺音标的会补上音标 */
export function importEntries(
  state: AppState,
  entries: ParsedEntry[],
  source = '导入',
  deckId = state.activeDeckId,
  deckName?: string
): { added: number; updated: number; skipped: number } {
  const existing = new Map(
    state.words.filter((w) => w.deckId === deckId).map((w) => [makeId(w.word), w])
  );
  const today = todayKey();
  let added = 0;
  let updated = 0;
  let skipped = 0;

  for (const e of entries) {
    const word = String(e.word || '').trim();
    const meaning = String(e.meaning || '').trim();
    const ipa = String(e.ipa || '').trim();
    if (!word) { skipped++; continue; }
    const key = makeId(word);
    const id = wordId(deckId, word);
    if (!key || !id) { skipped++; continue; }

    const found = existing.get(key);
    if (found) {
      // 该词库已有：只补充缺失的音标，不重复新增
      if (ipa && !found.ipa) {
        found.ipa = ipa;
        updated++;
      } else {
        skipped++;
      }
      continue;
    }

    const fresh: Word = {
      id,
      deckId,
      word,
      meaning,
      ipa,
      group: 'new',
      stage: 0,
      due: today,
      addedAt: Date.now(),
      seen: 0,
      right: 0,
      wrong: 0,
      lastAt: null,
    };
    state.words.push(fresh);
    existing.set(key, fresh);
    added++;
  }

  state.imports.unshift({
    source,
    deck: deckName,
    total: entries.length,
    added,
    updated,
    skipped,
    at: Date.now(),
  });
  state.imports = state.imports.slice(0, 30);
  return { added, updated, skipped };
}

export function logResult(
  state: AppState,
  wordId: string,
  kind: StudyKind,
  known: boolean,
  requeued: boolean
): void {
  state.logs.push({ date: todayKey(), id: wordId, kind, known, requeued, at: Date.now() });
  if (state.logs.length > 5000) state.logs = state.logs.slice(-5000);
}
