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
  /** AI 批改接口地址（OpenAI 兼容，默认 DeepSeek） */
  aiBaseUrl: string;
  /** 模型名 */
  aiModel: string;
}

/** 句子里的词组 / 固定搭配 / 句型标注 */
export interface PhraseNote {
  en: string;
  zh: string;
}

/** AI 指出的一个问题点 */
export interface SentenceIssue {
  /** 语法 / 搭配 / 用词 / 拼写 / 标点 */
  type: string;
  /** 原句里的错误片段 */
  bad: string;
  /** 建议改成的写法 */
  good: string;
  /** 中文说明 */
  why: string;
}

/** 造句练习难度 */
export type SentenceLevel = 'basic' | 'intermediate' | 'advanced';

/** 一次中译英练习：题面、参考译文、我的译文和批改结果都存在一起 */
export interface SentenceAttempt {
  id: string;
  /** 中文原句 */
  zh: string;
  /** AI 给的参考译文 */
  reference: string;
  /** 我写的英文 */
  text: string;
  /** AI 修正后的句子 */
  corrected: string;
  issues: SentenceIssue[];
  comment: string;
  score: number;
  theme: string;
  level: SentenceLevel;
  /** 练习形式：free = 整句自由写 AI 批改；fill = 逐词填空本地判分 */
  mode?: 'free' | 'fill';
  /** 这句话里的词组 / 句型（出题时由 AI 顺带给出） */
  phrases?: PhraseNote[];
  at: number;
}

/** 口语难度：轻松 / 日常 / 真实 */
export type TalkLevel = 'easy' | 'medium' | 'hard';

/** 剧本对话里的一句台词 */
export interface ScriptLine {
  /** 说话人名字（如 Mike / Waitress） */
  speaker: string;
  en: string;
  /** 这句的中文翻译 */
  zh: string;
  /** 这句里值得注意的表达，可空 */
  note?: string;
}

/** 一段可学习的对话范本（多人对话，逐句发音 + 翻译） */
export interface TalkScript {
  id: string;
  sceneId: string;
  sceneName: string;
  titleEn: string;
  titleZh: string;
  /** 中文场景设定：在哪、什么情况 */
  setting: string;
  /** 出场人物 */
  cast: { name: string; role: string }[];
  lines: ScriptLine[];
  /** 全篇重点表达 */
  phrases: { en: string; zh: string }[];
  level: TalkLevel;
  at: number;
}

/** 口语对话里的一句话 */
export interface TalkTurn {
  id: string;
  /** them = AI 扮演的角色；me = 我说的 */
  role: 'them' | 'me';
  en: string;
  /** 这句更地道的说法（只对 role=me，可能为空） */
  better?: string;
  /** 中文点评：为什么这么改（只对 role=me，可能为空） */
  tip?: string;
  /** 这句话用到的目标生词（只对 role=me） */
  used?: string[];
  at: number;
}

/** 对话结束后的复盘 */
export interface TalkReview {
  /** 0~100 的口语表现分 */
  score: number;
  /** 用上了的目标词 */
  usedTargets: string[];
  /** 没机会用上的目标词 */
  missedTargets: string[];
  issues: SentenceIssue[];
  /** 更地道的表达：我原来怎么说 → 母语者怎么说 */
  upgrades: { from: string; to: string; why: string }[];
  comment: string;
}

/** 一次情景对话（整轮存档） */
export interface TalkSession {
  id: string;
  /** 场景 id，对应 lib/talkScenes.ts */
  sceneId: string;
  sceneName: string;
  /** AI 扮演的角色（中文，展示用） */
  partner: string;
  /** 场景说明：我是谁、在哪、要干嘛 */
  setup: string;
  /** 本轮要求尽量用上的生词 */
  targets: { word: string; meaning: string }[];
  /** 这一局的随机设定（对方性格 + 情境变数），保证每次走向不同 */
  variation?: { persona: string; twists: string[] };
  turns: TalkTurn[];
  review?: TalkReview;
  startedAt: number;
  endedAt?: number;
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
  /** 造句练习记录（最新在前），与词库无关 */
  sentenceAttempts: SentenceAttempt[];
  /** 口语情景对话存档（最新在前） */
  talkSessions: TalkSession[];
  /** 口语对话范本（最新在前） */
  talkScripts: TalkScript[];
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

export type ViewName =
  | 'today'
  | 'review'
  | 'decks'
  | 'words'
  | 'import'
  | 'reading'
  | 'writing'
  | 'speaking'
  | 'settings';
export type WordFilter = 'all' | 'new' | 'review' | 'mastered' | 'wrong';
export type StudyMode = 'full' | 'new-only' | 'review-only' | 'dictation' | 'reading';
