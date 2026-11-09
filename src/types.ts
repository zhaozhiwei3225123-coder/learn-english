/** new=待学；mastered=学过且认识、等待进入复习队列；review=复习队列中 */
export type WordGroup = 'new' | 'mastered' | 'review';
export type CardDirection = 'en2zh' | 'zh2en';
export type StudyKind = 'new' | 'review';
/** 发音引擎：浏览器系统语音 / Kokoro 本地神经网络语音 */
export type TtsEngine = 'system' | 'kokoro';

/** 一个词库（如「四级核心词」「雅思词汇」），学习进度互相独立 */
export interface Deck {
  id: string;
  name: string;
  createdAt: number;
}

export interface Word {
  id: string;
  /** 所属词库 */
  deckId: string;
  word: string;
  meaning: string;
  /** 音标（来自导入的第三列，展示时外层加 /…/） */
  ipa: string;
  group: WordGroup;
  /** 复习阶段（保留字段，当前规则不再推进） */
  stage: number;
  /** 下次复习日期 yyyy-mm-dd */
  due: string;
  addedAt: number;
  seen: number;
  right: number;
  wrong: number;
  lastAt: number | null;
}

export interface LogEntry {
  date: string;
  id: string;
  kind: StudyKind;
  known: boolean;
  requeued: boolean;
  at: number;
}

export interface ImportRecord {
  source: string;
  /** 导入到的词库名称 */
  deck?: string;
  total: number;
  added: number;
  /** 已存在但补上了音标的数量 */
  updated?: number;
  skipped: number;
  at: number;
}

export interface Settings {
  dailyNew: number;
  dailyReview: number;
  direction: CardDirection;
  autoSpeak: boolean;
  /** 学完（标记认识）的新词，过几天进入复习队列，默认 2 天 */
  reviewDelayDays: number;
  ttsEngine: TtsEngine;
  kokoroVoice: string;
}

export interface AppState {
  version: number;
  settings: Settings;
  decks: Deck[];
  /** 当前选中的词库 */
  activeDeckId: string;
  words: Word[];
  logs: LogEntry[];
  imports: ImportRecord[];
  createdAt: number;
}

/** Excel / CSV 解析出的词条 */
export interface ParsedEntry {
  no?: number;
  word: string;
  meaning: string;
  ipa: string;
}

export interface QueueItem {
  id: string;
  kind: StudyKind;
  requeued: boolean;
}

export interface StudySession {
  mode: StudyMode;
  queue: QueueItem[];
  idx: number;
  revealed: boolean;
  requeued: string[];
  plannedNew: number;
  plannedReview: number;
  doneNew: number;
  doneReview: number;
  right: number;
  wrong: number;
  vague: number;
}

export type ViewName = 'today' | 'review' | 'decks' | 'words' | 'import' | 'settings';
export type WordFilter = 'all' | 'new' | 'review' | 'mastered' | 'wrong';
export type StudyMode = 'full' | 'new-only' | 'review-only' | 'dictation';
