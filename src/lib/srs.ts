import type { Word } from '../types';

/** 已掌握：学过且认识，还没进入复习队列 */
export const isMastered = (w: Word): boolean => w.group === 'mastered';

/** 已到达复习日 */
export const isDue = (w: Word, today: string): boolean => !w.due || w.due <= today;

/**
 * 回答质量：
 * - known   认识（能独立回忆出来）
 * - vague   模糊（想起来了但不确定）→ 明天再来一次，阶段不前进
 * - unknown 不认识 → 阶段回退
 */
export type Recall = 'known' | 'vague' | 'unknown';

/** 间隔阶梯（天）：首次之后依次 4、7、15、30、60、90 天 */
export const REVIEW_STEPS = [2, 4, 7, 15, 30, 60, 90];
/** stage 的上限，等于「最高一档」的序号 */
export const MAX_STAGE = REVIEW_STEPS.length;
export const MAX_INTERVAL = REVIEW_STEPS[REVIEW_STEPS.length - 1];

/** 答对一次就前进一档；模糊原地不动；不认识回退两档（重新走一遍阶梯） */
export function nextStage(stage: number, recall: Recall): number {
  if (recall === 'known') return Math.min(stage + 1, MAX_STAGE);
  if (recall === 'vague') return Math.max(0, Math.min(stage, MAX_STAGE));
  return Math.max(0, stage - 2);
}

/**
 * 成功回忆后距离下次复习的天数。
 * stage=1（第一次答对）用设置里的「首次间隔」，之后按阶梯递增。
 */
export function intervalDays(stage: number, firstDays = 2): number {
  const s = Math.max(1, Math.round(Number(stage) || 1));
  if (s <= 1) {
    const n = Math.round(Number(firstDays));
    return Number.isFinite(n) && n >= 1 ? Math.min(30, n) : 2;
  }
  return REVIEW_STEPS[Math.min(s, MAX_STAGE) - 1];
}

/** 卡片上展示的「下次复习」提示文案 */
export function intervalLabel(days: number): string {
  return days >= 1 ? `${days} 天后` : '今天';
}

export function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
