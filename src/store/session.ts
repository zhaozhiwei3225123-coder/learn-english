import { computed, reactive, ref } from 'vue';
import type { StudyKind, StudyMode, StudySession, Word } from '../types';
import { state, save, promoteMastered } from './vocab';
import { addDays, todayKey } from '../lib/date';
import { intervalDays, isDue, nextStage, shuffle, type Recall } from '../lib/srs';
import { logResult, reviewDelayDays } from '../lib/persist';
import { speak } from '../lib/speech';

export const session = reactive<{ current: StudySession | null }>({ current: null });

export const currentItem = computed(() => {
  const s = session.current;
  if (!s) return null;
  return s.queue[s.idx] ?? null;
});

export const currentWord = computed<Word | null>(() => {
  const item = currentItem.value;
  if (!item) return null;
  return state.words.find((w) => w.id === item.id) ?? null;
});

export const isFinished = computed(() => {
  const s = session.current;
  return !!s && s.idx >= s.queue.length;
});

/** 跳过已被删除的词 */
export function skipMissing(): void {
  const s = session.current;
  if (!s) return;
  while (s.idx < s.queue.length && !state.words.some((w) => w.id === s.queue[s.idx].id)) {
    s.idx++;
  }
}

/** 组一轮学习：新词 + 到期复习，各自随机抽取后整体打乱 */
export function startSession(mode: StudyMode = 'full'): boolean {
  const st = state.settings;
  const today = todayKey();
  // 冷却期满的已掌握单词先转入复习队列
  promoteMastered();

  // 本轮只使用当前词库的单词
  const newPool = state.words.filter(
    (w) => w.deckId === state.activeDeckId && w.group === 'new'
  );
  const reviewPool = state.words.filter(
    (w) => w.deckId === state.activeDeckId && w.group === 'review'
  );

  const wantNew =
    mode === 'review-only' || mode === 'dictation' ? 0 : Math.max(0, Number(st.dailyNew) || 0);
  const wantReview =
    mode === 'new-only' ? 0 : Math.max(0, Number(st.dailyReview) || 0);

  const pickedNew = shuffle(newPool).slice(0, wantNew);

  // 只取今天进入复习队列（已到期）的词
  const pickedReview = shuffle(reviewPool.filter((w) => isDue(w, today))).slice(0, wantReview);

  const queue = shuffle([
    ...pickedNew.map((w) => ({ id: w.id, kind: 'new' as const, requeued: false })),
    ...pickedReview.map((w) => ({ id: w.id, kind: 'review' as const, requeued: false })),
  ]);

  undoStack.value = [];

  if (!queue.length) {
    session.current = null;
    return false;
  }

  session.current = {
    mode,
    queue,
    idx: 0,
    revealed: false,
    requeued: [],
    plannedNew: pickedNew.length,
    plannedReview: pickedReview.length,
    doneNew: 0,
    doneReview: 0,
    right: 0,
    wrong: 0,
    vague: 0,
  };
  return true;
}

export function reveal(): void {
  if (session.current) session.current.revealed = true;
}

/** 阅读学习集：按给定单词开一轮（不遵守每日配额，学完照常进入间隔复习） */
export function startReadingSession(ids: string[]): boolean {
  const set = new Set(ids);
  const words = state.words.filter((w) => set.has(w.id));
  undoStack.value = [];
  if (!words.length) {
    session.current = null;
    return false;
  }
  const queue = shuffle(words).map((w) => ({
    id: w.id,
    kind: (w.group === 'new' ? 'new' : 'review') as StudyKind,
    requeued: false,
  }));
  session.current = {
    mode: 'reading',
    queue,
    idx: 0,
    revealed: false,
    requeued: [],
    plannedNew: queue.filter((q) => q.kind === 'new').length,
    plannedReview: queue.filter((q) => q.kind === 'review').length,
    doneNew: 0,
    doneReview: 0,
    right: 0,
    wrong: 0,
    vague: 0,
  };
  return true;
}

/* ---------------------------------------------------------------- 撤销 */

interface UndoEntry {
  wordId: string;
  word: Pick<Word, 'group' | 'stage' | 'due' | 'seen' | 'right' | 'wrong' | 'lastAt'>;
  idx: number;
  revealed: boolean;
  queueLength: number;
  requeued: string[];
  doneNew: number;
  doneReview: number;
  right: number;
  wrong: number;
  vague: number;
  logCount: number;
}

const undoStack = ref<UndoEntry[]>([]);
export const canUndo = computed(() => !!session.current && undoStack.value.length > 0);

/**
 * 记录作答：
 * - 认识 → 已掌握，按间隔阶梯安排下次复习
 * - 模糊 → 留在复习队列，明天再来一次（阶段不前进）
 * - 不认识 → 回到复习队列，阶段回退两档，今天继续考
 */
export function grade(recall: Recall, requeue = true): void {
  const s = session.current;
  if (!s) return;
  skipMissing();
  const item = s.queue[s.idx];
  if (!item) return;
  const w = state.words.find((x) => x.id === item.id);
  if (!w) { s.idx++; s.revealed = false; return; }

  const today = todayKey();
  const firstDays = reviewDelayDays(state.settings);

  undoStack.value.push({
    wordId: w.id,
    word: {
      group: w.group,
      stage: w.stage,
      due: w.due,
      seen: w.seen,
      right: w.right,
      wrong: w.wrong,
      lastAt: w.lastAt,
    },
    idx: s.idx,
    revealed: s.revealed,
    queueLength: s.queue.length,
    requeued: s.requeued.slice(),
    doneNew: s.doneNew,
    doneReview: s.doneReview,
    right: s.right,
    wrong: s.wrong,
    vague: s.vague,
    logCount: state.logs.length,
  });

  const stage = nextStage(w.stage, recall);
  w.stage = stage;

  if (recall === 'known') {
    // 认识 → 进入冷却，按阶梯间隔安排下次复习
    w.group = 'mastered';
    w.due = addDays(today, intervalDays(stage, firstDays));
    w.right++;
    if (state.settings.autoSpeak) {
      void speak(w.word, {
        engine: state.settings.ttsEngine,
        voice: state.settings.kokoroVoice,
      });
    }
  } else if (recall === 'vague') {
    // 模糊 → 明天再来一次，阶段原地不动
    w.group = 'review';
    w.due = addDays(today, 1);
    w.wrong++;
  } else {
    // 不认识 → 今天继续考
    w.group = 'review';
    w.due = today;
    w.wrong++;
    if (requeue && !s.requeued.includes(w.id)) {
      s.requeued.push(w.id);
      s.queue.push({ id: w.id, kind: item.kind, requeued: true });
    }
  }

  // 本轮计数
  if (recall === 'known') s.right++;
  else if (recall === 'vague') s.vague++;
  else s.wrong++;

  w.seen++;
  w.lastAt = Date.now();

  if (!item.requeued) {
    if (item.kind === 'new') s.doneNew++;
    else s.doneReview++;
  }
  logResult(state, w.id, item.kind, recall === 'known', item.requeued);

  s.idx++;
  s.revealed = false;
  save();
}

/** 撤销上一次作答（快捷键 u），把卡片和计数还原回去 */
export function undoGrade(): boolean {
  const s = session.current;
  const entry = undoStack.value.pop();
  if (!s || !entry) return false;

  const w = state.words.find((x) => x.id === entry.wordId);
  if (w) Object.assign(w, entry.word);

  // 同时抹掉刚才写入的学习记录
  if (state.logs.length > entry.logCount) state.logs.length = entry.logCount;

  s.idx = entry.idx;
  s.revealed = entry.revealed;
  if (s.queue.length > entry.queueLength) s.queue.length = entry.queueLength;
  s.requeued = entry.requeued;
  s.doneNew = entry.doneNew;
  s.doneReview = entry.doneReview;
  s.right = entry.right;
  s.wrong = entry.wrong;
  s.vague = entry.vague;
  save();
  return true;
}

export function endSession(): void {
  undoStack.value = [];
  session.current = null;
}
