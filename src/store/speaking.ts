import { computed, reactive, ref } from 'vue';
import type { TalkScript, TalkSession, TalkTurn, Word } from '../types';
import { state, save, deckWords } from './vocab';
import {
  generateScript,
  startTalk,
  replyTalk,
  reviewTalk,
  translateTalkLines,
  type AiConfig,
  type TalkTarget,
  type TalkVariation,
} from '../lib/ai';
import {
  findScene,
  groupOf,
  rollVariation,
  type TalkScene,
} from '../lib/talkScenes';
import { isDue } from '../lib/srs';
import { todayKey } from '../lib/date';

/**
 * 口语模块，两种玩法：
 *
 * 1. 对话范本（learn）：模型一次写完整段多人对话，逐句带中英对照和发音，
 *    用来听、读、跟读——输入。
 * 2. 情景实战（talk）：模型只给开场白，然后一来一回现场长——输出。
 *
 * 两者刻意不互相引用：范本不喂给实战，实战每一局还会掷一次随机变数
 * （对方性格 + 情境意外），所以同一场景也不会聊出同一段对话。
 */

/** 当前模式：看范本 / 打实战 / 翻记录 */
export const talkMode = ref<'learn' | 'talk' | 'records'>('learn');

/** 当前选中的场景 */
export const sceneId = ref('cafe');
/** 是否把今日要复习的生词掺进对话 */
export const useTargets = ref(true);
/** 对方的话是否自动朗读 */
export const autoSpeak = ref(true);

/** 正在进行的会话 id（null = 没在对话） */
export const activeId = ref<string | null>(null);
export const starting = ref(false);
export const replying = ref(false);
export const reviewing = ref(false);
export const talkError = ref('');
/** 刚复盘完的会话 id，供界面自动跳到复盘页 */
export const lastReviewedId = ref<string | null>(null);
/** 开局给的中文提示：可以从哪句话开始说（只说一次，不进对话记录） */
export const talkHint = ref('');

/**
 * 展开了中文的句子 id；换会话时清空。
 * 用普通对象而不是 Set：Set 的增删在 Vue 里要额外依赖 `has()` 的追踪，
 * 换会话时还得分清「同一引用」和「新引用」，一不小心就渲染不更新。
 */
export const zhOpen = reactive<Record<string, boolean>>({});
/** 一键显示整段中文 */
export const showZhAll = ref(false);
/** 正在补翻译的句子（旧存档没有译文时才需要） */
export const zhLoading = reactive<Record<string, boolean>>({});

/**
 * 这句现在要不要显示中文。
 * 只在 store 内部做逻辑判断用；模板里请直接写
 * `t.zh && (showZhAll || zhOpen[t.id])`——包成函数调用时
 * Vue 收不到 zhOpen 新增 key 的依赖，展开后不会重渲染。
 */
function zhShown(turn: TalkTurn): boolean {
  return turn.role === 'them' && !!turn.zh && (showZhAll.value || !!zhOpen[turn.id]);
}

export const active = computed<TalkSession | null>(
  () => state.talkSessions.find((s) => s.id === activeId.value) ?? null
);

/** 已结束的会话（最新在前） */
export const history = computed(() => state.talkSessions.filter((s) => s.endedAt));

/** 全部对话，含还没聊完的（记录页用） */
export const allSessions = computed(() => state.talkSessions);

/** 全部范本，跨场景（记录页用） */
export const allScripts = computed(() => state.talkScripts);

export const currentScene = computed<TalkScene | undefined>(() => findScene(sceneId.value));

export const talkStats = computed(() => {
  const list = state.talkSessions;
  const today = todayKey();
  const done = list.filter((s) => s.endedAt);
  const dayKey = (at: number) => {
    const d = new Date(at);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
      d.getDate()
    ).padStart(2, '0')}`;
  };
  const myTurns = list.reduce((n, s) => n + s.turns.filter((t) => t.role === 'me').length, 0);
  const used = new Set<string>();
  for (const s of done) for (const w of s.review?.usedTargets ?? []) used.add(w.toLowerCase());
  const scored = done.filter((s) => s.review);
  return {
    total: done.length,
    today: done.filter((s) => dayKey(s.startedAt) === today).length,
    turns: myTurns,
    words: used.size,
    avg: scored.length
      ? Math.round(scored.reduce((sum, s) => sum + (s.review?.score ?? 0), 0) / scored.length)
      : 0,
  };
});

let seq = 0;
function uid(prefix: string): string {
  seq = (seq + 1) % 1000;
  return `${prefix}-${Date.now().toString(36)}-${seq.toString(36)}`;
}

/**
 * 从当前词库抽几个"该复习了"的词，掺进对话里。
 * 优先到期的复习词，其次新词，最后拿已掌握的凑数；同一个词只出现一次。
 */
export function pickTargets(limit = 5): TalkTarget[] {
  const today = todayKey();
  const pool = deckWords.value.filter((w) => w.group !== 'mastered');
  const due = pool.filter((w) => w.group === 'review' && isDue(w, today));
  const fresh = pool.filter((w) => w.group === 'new');
  const rest = pool.filter((w) => !due.includes(w) && !fresh.includes(w));

  const shuffle = (arr: Word[]) => {
    const copy = [...arr];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  };

  const picked: Word[] = [];
  for (const bucket of [shuffle(due), shuffle(fresh), shuffle(rest)]) {
    for (const w of bucket) {
      if (picked.length >= limit) break;
      if (picked.some((p) => p.word.toLowerCase() === w.word.toLowerCase())) continue;
      picked.push(w);
    }
    if (picked.length >= limit) break;
  }

  return picked.map((w) => ({ word: w.word, meaning: w.meaning }));
}

function sceneSpec(scene: TalkScene) {
  return { name: scene.name, role: scene.role, goal: scene.goal, level: scene.level };
}

/* ---------------------------------------------------------------- 对话范本 */

export const scripting = ref(false);
export const scriptError = ref('');
/** 当前正在看的范本 id（null = 还没生成） */
export const currentScriptId = ref<string | null>(null);

export const scripts = computed(() => state.talkScripts);

export const currentScript = computed<TalkScript | null>(
  () => state.talkScripts.find((s) => s.id === currentScriptId.value) ?? null
);

/** 生成一篇新的对话范本（当前场景 + 当前难度） */
export async function makeScript(config: AiConfig): Promise<boolean> {
  const scene = currentScene.value;
  if (!scene || scripting.value) return false;
  scripting.value = true;
  scriptError.value = '';

  try {
    const variation = rollVariation();
    const res = await generateScript({
      scene: sceneSpec(scene),
      targets: useTargets.value ? pickTargets(3) : [],
      variation,
      config,
    });

    const script: TalkScript = {
      id: uid('script'),
      sceneId: scene.id,
      sceneName: scene.name,
      titleEn: res.titleEn,
      titleZh: res.titleZh,
      setting: res.setting,
      cast: res.cast,
      lines: res.lines,
      phrases: res.phrases,
      level: scene.level,
      at: Date.now(),
    };
    state.talkScripts.unshift(script);
    if (state.talkScripts.length > 200) state.talkScripts = state.talkScripts.slice(0, 200);
    currentScriptId.value = script.id;
    save();
    return true;
  } catch (err) {
    scriptError.value = (err as Error).message || '生成范本失败，请重试';
    return false;
  } finally {
    scripting.value = false;
  }
}

export function openScript(id: string): void {
  currentScriptId.value = id;
}

export function removeScript(id: string): void {
  state.talkScripts = state.talkScripts.filter((s) => s.id !== id);
  if (currentScriptId.value === id) {
    currentScriptId.value = state.talkScripts[0]?.id ?? null;
  }
  save();
}

export function clearScripts(): void {
  state.talkScripts = [];
  currentScriptId.value = null;
  save();
}

/** 进页面时接上次的进度：优先接着看的范本，其次最新一篇 */
export function initSpeaking(): boolean {
  if (!currentScriptId.value) {
    currentScriptId.value = state.talkScripts[0]?.id ?? null;
  }
  return !!currentScriptId.value;
}

/* ---------------------------------------------------------------- 实战 */

/** 丢掉没聊几句就放弃的空会话，避免历史里塞一堆垃圾 */
function pruneEmpty(): void {
  state.talkSessions = state.talkSessions.filter(
    (s) => s.endedAt || s.turns.some((t) => t.role === 'me')
  );
}

/** 开一个新场景 */
export async function startSession(config: AiConfig): Promise<boolean> {
  const scene = currentScene.value;
  if (!scene || starting.value) return false;
  starting.value = true;
  talkError.value = '';
  lastReviewedId.value = null;
  resetZh(false);

  try {
    pruneEmpty();
    const targets = useTargets.value ? pickTargets() : [];
    // 掷一次随机变数：同一个场景，每次的人物脾气和突发状况都不一样
    const variation = rollVariation();
    const open = await startTalk({ scene: sceneSpec(scene), targets, variation, config });

    const session: TalkSession = {
      id: uid('talk'),
      sceneId: scene.id,
      sceneName: scene.name,
      partner: scene.partner,
      setup: open.setup,
      targets,
      variation: { persona: variation.persona, twists: variation.twists },
      turns: [
        { id: uid('t'), role: 'them', en: open.opener, zh: open.zh || undefined, at: Date.now() },
      ],
      startedAt: Date.now(),
    };
    // 开场提示单独挂在会话上，不进消息流（避免当成对方说的话被朗读）
    state.talkSessions.unshift(session);
    if (state.talkSessions.length > 300) state.talkSessions = state.talkSessions.slice(0, 300);
    activeId.value = session.id;
    if (open.hint) talkHint.value = open.hint;
    save();
    return true;
  } catch (err) {
    talkError.value = (err as Error).message || '开局失败，请重试';
    return false;
  } finally {
    starting.value = false;
  }
}

/** 我说一句，等对方回应 */
export async function sendMessage(text: string, config: AiConfig): Promise<TalkTurn | null> {
  const session = active.value;
  const scene = session ? findScene(session.sceneId) : undefined;
  const content = text.trim();
  if (!session || !scene || replying.value || !content) return null;

  replying.value = true;
  talkError.value = '';
  talkHint.value = '';

  const mine: TalkTurn = { id: uid('t'), role: 'me', en: content, at: Date.now() };
  session.turns.push(mine);
  save();

  try {
    const history: { role: 'them' | 'me'; en: string }[] = session.turns.map((t) => ({
      role: t.role,
      en: t.en,
    }));

    const res = await replyTalk({
      scene: sceneSpec(scene),
      setup: session.setup,
      targets: session.targets,
      history,
      variation: session.variation,
      config,
    });

    // 点评补在我说的那句上
    if (res.better && res.better.toLowerCase().trim() !== content.toLowerCase().trim()) {
      mine.better = res.better;
    }
    if (res.tip) mine.tip = res.tip;
    if (res.used.length) mine.used = res.used;

    const theirs: TalkTurn = {
      id: uid('t'),
      role: 'them',
      en: res.reply,
      zh: res.zh || undefined,
      at: Date.now(),
    };
    session.turns.push(theirs);
    save();
    if (res.done) void finishSession(config);
    return theirs;
  } catch (err) {
    // 我的那句话保留，对方没接上不算脏数据，重试即可
    talkError.value = (err as Error).message || '对方没接上话，再发一次';
    return null;
  } finally {
    replying.value = false;
  }
}

/** 结束并复盘；没有复盘结果也照样留档。成功返回会话 id */
export async function finishSession(config: AiConfig): Promise<string | null> {
  const session = active.value;
  const scene = session ? findScene(session.sceneId) : undefined;
  if (!session || !scene || reviewing.value) return null;

  const mine = session.turns.filter((t) => t.role === 'me');
  if (!mine.length) {
    talkError.value = '还没说话呢，先聊两句再结束';
    return null;
  }

  reviewing.value = true;
  talkError.value = '';
  try {
    const res = await reviewTalk({
      scene: sceneSpec(scene),
      setup: session.setup,
      targets: session.targets,
      history: session.turns.map((t) => ({ role: t.role, en: t.en })),
      variation: session.variation,
      config,
    });
    session.review = res;
    session.endedAt = Date.now();
    activeId.value = null;
    lastReviewedId.value = session.id;
    resetZh(true);
    save();
    return session.id;
  } catch (err) {
    talkError.value = (err as Error).message || '复盘失败，再试一次';
    return null;
  } finally {
    reviewing.value = false;
  }
}

/**
 * 结束这轮但不出复盘：记录照样留着，历史里标「未复盘」。
 * 只有一句都没说的空会话才丢掉——那种连记录都算不上。
 */
export function abandonSession(): void {
  const session = active.value;
  activeId.value = null;
  talkHint.value = '';
  lastReviewedId.value = null;
  resetZh(false);
  if (!session) return;
  if (!session.turns.some((t) => t.role === 'me')) {
    state.talkSessions = state.talkSessions.filter((s) => s.id !== session.id);
  } else {
    session.endedAt = Date.now();
  }
  save();
}

export function removeSession(id: string): void {
  state.talkSessions = state.talkSessions.filter((s) => s.id !== id);
  if (activeId.value === id) activeId.value = null;
  save();
}

export function clearSessions(): void {
  state.talkSessions = [];
  activeId.value = null;
  save();
}

/** 接着聊某一条没结束的对话 */
export function resumeSession(id: string): boolean {
  const s = state.talkSessions.find((x) => x.id === id && !x.endedAt);
  if (!s) return false;
  activeId.value = s.id;
  sceneId.value = s.sceneId;
  lastReviewedId.value = null;
  resetZh(!!s.review);
  return true;
}

/** 换一轮对话时清掉中文展开状态；复盘过的记录默认整段中文可见 */
function resetZh(reviewed: boolean): void {
  for (const k of Object.keys(zhOpen)) delete zhOpen[k];
  for (const k of Object.keys(zhLoading)) delete zhLoading[k];
  // 是否显示中文属于个人偏好：用户开着就一直开着，只有看复盘时强制打开
  if (reviewed) showZhAll.value = true;
}

/**
 * 点某句的「中文」：有译文就展开 / 收起；
 * 只有早先存档的对话没有译文，这时候才补发一次翻译请求。
 */
export async function toggleTalkZh(turnId: string, config: AiConfig): Promise<void> {
  const turn = active.value?.turns.find((t) => t.id === turnId);
  if (!turn || turn.role !== 'them') return;

  if (zhShown(turn)) {
    // 从「整段全显」退回单句控制时，先把已经可见的收进来，只收起点的这一句
    if (showZhAll.value) {
      showZhAll.value = false;
      for (const t of active.value?.turns ?? []) {
        if (t.role === 'them' && t.zh) zhOpen[t.id] = true;
      }
    }
    delete zhOpen[turnId];
    return;
  }
  if (turn.zh) {
    zhOpen[turnId] = true;
    return;
  }
  if (zhLoading[turnId]) return;

  zhLoading[turnId] = true;
  try {
    const [zh] = await translateTalkLines([turn.en], config);
    turn.zh = zh;
    zhOpen[turnId] = true;
    save();
  } catch (err) {
    talkError.value = (err as Error).message || '这句没译出来，再点一次';
  } finally {
    delete zhLoading[turnId];
  }
}

/** 一键显示 / 收起整段中文，顺手补齐缺译文的旧句子 */
export async function toggleTalkZhAll(config: AiConfig): Promise<void> {
  if (showZhAll.value) {
    showZhAll.value = false;
    return;
  }
  showZhAll.value = true;

  const session = active.value;
  if (!session) return;
  const missing = session.turns.filter((t) => t.role === 'them' && !t.zh && t.en);
  if (!missing.length) return;

  try {
    const zh = await translateTalkLines(missing.map((t) => t.en), config);
    missing.forEach((t, i) => {
      if (zh[i]) t.zh = zh[i];
    });
    save();
  } catch (err) {
    talkError.value = (err as Error).message || '整段翻译失败，可以单句点开';
  }
}

/** 继续最近一条没聊完的对话 */
export function resumeLast(): boolean {
  const last = state.talkSessions.find((s) => !s.endedAt);
  return last ? resumeSession(last.id) : false;
}

/** 场景标签（历史记录里显示） */
export function sceneLabel(id: string): string {
  const s = findScene(id);
  return s ? `${s.icon} ${s.name}` : '情景对话';
}

export function sceneGroupName(id: string): string {
  return groupOf(id)?.name ?? '';
}
