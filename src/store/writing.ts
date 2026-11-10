import { computed, ref } from 'vue';
import type { SentenceAttempt, SentenceLevel } from '../types';
import { state, save } from './vocab';
import {
  generateSentence,
  gradeTranslation,
  type AiConfig,
} from '../lib/ai';
import { todayKey } from '../lib/date';

/** 造句练习：不预置题库，每道题实时向模型要；做完的句子进 state.sentenceAttempts */

export const writingTheme = ref<string>('日常');
export const writingLevel = ref<SentenceLevel>('intermediate');

/** 当前这道题（切到别的页签再回来还在） */
export const currentPrompt = ref<{ zh: string; en: string } | null>(null);
export const generating = ref(false);
export const grading = ref(false);
export const writingError = ref('');
/** 刚批改完的结果 */
export const lastResult = ref<SentenceAttempt | null>(null);

export const attempts = computed(() => state.sentenceAttempts);

export const writingStats = computed(() => {
  const list = state.sentenceAttempts;
  const today = todayKey();
  const todayList = list.filter((a) => {
    const d = new Date(a.at);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
      d.getDate()
    ).padStart(2, '0')}`;
    return key === today;
  });
  const recent = list.slice(0, 20);
  const avg = recent.length
    ? Math.round(recent.reduce((sum, a) => sum + a.score, 0) / recent.length)
    : 0;
  return {
    total: list.length,
    today: todayList.length,
    avg,
    best: list.reduce((max, a) => Math.max(max, a.score), 0),
  };
});

/** 最近做过的题面，出题时去重 */
function recentPrompts(limit = 40): string[] {
  return state.sentenceAttempts.slice(0, limit).map((a) => a.zh);
}

/** 向模型要一道新题 */
export async function nextPrompt(config: AiConfig): Promise<void> {
  if (generating.value) return;
  generating.value = true;
  writingError.value = '';
  try {
    const res = await generateSentence({
      theme: writingTheme.value,
      level: writingLevel.value,
      config,
      recent: recentPrompts(),
    });
    currentPrompt.value = res;
    lastResult.value = null;
  } catch (err) {
    writingError.value = (err as Error).message || '出题失败，请重试';
  } finally {
    generating.value = false;
  }
}

/** 提交一版译文，返回批改结果 */
export async function submitAnswer(
  answer: string,
  config: AiConfig
): Promise<SentenceAttempt | null> {
  const prompt = currentPrompt.value;
  if (!prompt || grading.value) return null;
  const text = answer.trim();
  if (!text) {
    writingError.value = '先写一句英文再提交';
    return null;
  }

  grading.value = true;
  writingError.value = '';
  try {
    const g = await gradeTranslation({
      zh: prompt.zh,
      reference: prompt.en,
      answer: text,
      config,
    });
    const record: SentenceAttempt = {
      id: `sent-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      zh: prompt.zh,
      reference: prompt.en,
      text,
      corrected: g.corrected,
      issues: g.issues,
      comment: g.comment,
      score: g.score,
      theme: writingTheme.value,
      level: writingLevel.value,
      at: Date.now(),
    };
    state.sentenceAttempts.unshift(record);
    if (state.sentenceAttempts.length > 2000) {
      state.sentenceAttempts = state.sentenceAttempts.slice(0, 2000);
    }
    lastResult.value = record;
    save();
    return record;
  } catch (err) {
    writingError.value = (err as Error).message || '批改失败，请重试';
    return null;
  } finally {
    grading.value = false;
  }
}

export function removeAttempt(id: string): void {
  state.sentenceAttempts = state.sentenceAttempts.filter((a) => a.id !== id);
  if (lastResult.value?.id === id) lastResult.value = null;
  save();
}

export function clearAttempts(): void {
  state.sentenceAttempts = [];
  lastResult.value = null;
  save();
}

/** 同一道题重写（不换题） */
export function retryCurrent(): void {
  lastResult.value = null;
  writingError.value = '';
}
