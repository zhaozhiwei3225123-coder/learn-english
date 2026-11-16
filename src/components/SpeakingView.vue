<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { state } from '../store/vocab';
import { setView } from '../store/ui';
import { toast } from '../store/toast';
import { hasApiKey, resolveConfig } from '../lib/ai';
import { TALK_GROUPS, TALK_LEVELS, findScene } from '../lib/talkScenes';
import { speak } from '../lib/speech';
import { micSupported, startMic, type MicHandle } from '../lib/mic';
import {
  talkMode,
  sceneId,
  useTargets,
  autoSpeak,
  active,
  activeId,
  starting,
  replying,
  reviewing,
  talkError,
  talkHint,
  lastReviewedId,
  currentScene,
  talkStats,
  scripts,
  currentScript,
  currentScriptId,
  scripting,
  scriptError,
  makeScript,
  removeScript,
  clearScripts,
  startSession,
  sendMessage,
  finishSession,
  dropSession,
  removeSession,
  clearSessions,
  resumeLast,
  initSpeaking,
  pickTargets,
  history as talkHistory,
  sceneLabel,
} from '../store/speaking';
import type { TalkSession } from '../types';
import TalkReviewCard from './TalkReviewCard.vue';

const keyReady = ref(hasApiKey());
const cfg = computed(() => resolveConfig(state.settings));

const groupKey = ref(TALK_GROUPS[0].key);
const draft = ref('');
const inputEl = ref<HTMLTextAreaElement | null>(null);
const scroller = ref<HTMLElement | null>(null);

/** 范本：全部显示中文 / 单句展开 */
const showAllZh = ref(false);
const openedZh = ref<Set<number>>(new Set());
const speakingLine = ref<number | null>(null);

/** 正在看的复盘 */
const reviewId = ref<string | null>(null);

const listening = ref(false);
let mic: MicHandle | null = null;

const scenes = computed(
  () => TALK_GROUPS.find((g) => g.key === groupKey.value)?.scenes ?? []
);

const scene = computed(() => currentScene.value);

const sceneScripts = computed(() =>
  state.talkScripts.filter((s) => s.sceneId === sceneId.value)
);

const unfinished = computed(() => state.talkSessions.find((s) => !s.endedAt) ?? null);

const reviewSession = computed<TalkSession | null>(
  () => state.talkSessions.find((s) => s.id === reviewId.value) ?? null
);

const targetHint = computed(() => (useTargets.value ? pickTargets().length : 0));

const myTurns = computed(() => active.value?.turns.filter((t) => t.role === 'me') ?? []);

const usedWords = computed(() => {
  const set = new Set<string>();
  for (const t of myTurns.value) for (const w of t.used ?? []) set.add(w);
  return set;
});

function levelLabel(level: string): string {
  return TALK_LEVELS.find((l) => l.key === level)?.label ?? level;
}

function fmtDate(at: number): string {
  const d = new Date(at);
  return `${d.getMonth() + 1}-${String(d.getDate()).padStart(2, '0')} ${String(
    d.getHours()
  ).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function say(text: string): Promise<void> {
  return speak(text, {
    engine: state.settings.ttsEngine,
    voice: state.settings.kokoroVoice,
  });
}

function focusInput(): void {
  void nextTick(() => inputEl.value?.focus());
}

async function scrollBottom(): Promise<void> {
  await nextTick();
  const el = scroller.value;
  if (el) el.scrollTop = el.scrollHeight;
}

/* ---------------------------------------------------------------- 范本 */

function speakerTone(name: string): string {
  const cast = currentScript.value?.cast ?? [];
  const idx = cast.findIndex((c) => c.name === name);
  return `tone-${((idx < 0 ? 0 : idx) % 4) + 1}`;
}

function isMe(name: string): boolean {
  return currentScript.value?.cast[0]?.name === name;
}

function zhVisible(i: number): boolean {
  return showAllZh.value || openedZh.value.has(i);
}

function toggleZh(i: number): void {
  const next = new Set(openedZh.value);
  if (next.has(i)) next.delete(i);
  else next.add(i);
  openedZh.value = next;
}

async function onLineSpeak(i: number, text: string): Promise<void> {
  speakingLine.value = i;
  try {
    await say(text);
  } finally {
    speakingLine.value = null;
  }
}

async function onMakeScript(): Promise<void> {
  const c = cfg.value;
  if (!c) {
    keyReady.value = false;
    return;
  }
  openedZh.value = new Set();
  const ok = await makeScript(c);
  if (ok) toast('范本写好了，点句子听发音');
}

function onPickScript(id: string): void {
  currentScriptId.value = id;
  openedZh.value = new Set();
}

/** 看完范本直接上场：切到实战并开一轮，不用再点一次 */
async function onScriptToTalk(): Promise<void> {
  talkMode.value = 'talk';
  await onStartTalk();
}

function onRemoveScript(id: string): void {
  removeScript(id);
  toast('已删除这篇范本');
}

function onClearScripts(): void {
  if (!scripts.value.length) return;
  if (!confirm(`清空全部 ${scripts.value.length} 篇范本？`)) return;
  clearScripts();
  toast('范本已清空');
}

/* ---------------------------------------------------------------- 实战 */

async function onStartTalk(): Promise<void> {
  const c = cfg.value;
  if (!c) {
    keyReady.value = false;
    return;
  }
  reviewId.value = null;
  draft.value = '';
  const ok = await startSession(c);
  if (!ok) return;
  const first = active.value?.turns[0];
  if (autoSpeak.value && first) void say(first.en);
  focusInput();
  void scrollBottom();
}

async function onResume(): Promise<void> {
  if (!resumeLast()) return;
  reviewId.value = null;
  toast('接着上次聊');
  focusInput();
  void scrollBottom();
}

async function onSend(): Promise<void> {
  const c = cfg.value;
  if (!c || replying.value) return;
  const text = draft.value.trim();
  if (!text) return;

  draft.value = '';
  const turn = await sendMessage(text, c);
  if (turn) {
    if (autoSpeak.value) void say(turn.en);
    void scrollBottom();
  } else if (talkError.value) {
    draft.value = text;
  }
}

async function onFinish(): Promise<void> {
  const c = cfg.value;
  if (!c) return;
  await finishSession(c);
}

function onDrop(): void {
  if (!confirm('放弃这轮对话？没聊完的内容不会保留。')) return;
  dropSession();
  draft.value = '';
  toast('已放弃这轮对话');
}

function onMic(): void {
  if (listening.value) {
    mic?.stop();
    mic = null;
    listening.value = false;
    return;
  }
  if (!micSupported()) {
    toast('这个浏览器不支持语音输入，先打字吧');
    return;
  }
  const handle = startMic({
    lang: 'en-US',
    onResult: (text) => {
      draft.value = text;
    },
    onError: (msg) => toast(msg),
    onEnd: () => {
      listening.value = false;
      mic = null;
    },
  });
  if (!handle) {
    toast('麦克风没启动起来，检查一下权限');
    return;
  }
  mic = handle;
  listening.value = true;
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    void onSend();
  }
}

function onRemoveSession(id: string): void {
  removeSession(id);
  if (reviewId.value === id) reviewId.value = null;
  toast('已删除这轮记录');
}

function onClearSessions(): void {
  const n = talkHistory.value.length;
  if (!n) return;
  if (!confirm(`清空全部 ${n} 轮对话记录？`)) return;
  clearSessions();
  reviewId.value = null;
  toast('对话记录已清空');
}

/* ---------------------------------------------------------------- 生命周期 */

watch(activeId, (id) => {
  // 场景目标达成时模型会返回 done，自动复盘后跳过来
  if (!id && lastReviewedId.value) reviewId.value = lastReviewedId.value;
});

watch(
  () => active.value?.turns.length,
  () => void scrollBottom()
);

watch(sceneId, () => {
  openedZh.value = new Set();
  const first = state.talkScripts.find((s) => s.sceneId === sceneId.value);
  currentScriptId.value = first?.id ?? null;
});

onMounted(() => {
  keyReady.value = hasApiKey();
  const had = initSpeaking();
  const c = cfg.value;
  // 第一次进来还没有任何范本，直接把当前场景写一篇，省一次点击
  if (keyReady.value && c && !had) void onMakeScript();
});
</script>

<template>
  <div class="stat-row">
    <div class="stat brand">
      <div class="k">对话范本</div>
      <div class="v">{{ scripts.length }}</div>
      <div class="stat-sub">看别人怎么聊</div>
    </div>
    <div class="stat">
      <div class="k">实战</div>
      <div class="v">{{ talkStats.total }}</div>
      <div class="stat-sub">聊完 {{ talkStats.turns }} 句</div>
    </div>
    <div class="stat">
      <div class="k">用上生词</div>
      <div class="v">{{ talkStats.words }}</div>
      <div class="stat-sub">在对话里说过</div>
    </div>
    <div class="stat">
      <div class="k">平均分</div>
      <div class="v">{{ talkStats.avg }}</div>
      <div class="stat-sub">实战复盘</div>
    </div>
  </div>

  <!-- 未配置 Key -->
  <div v-if="!keyReady" class="panel">
    <h2>先配置 AI 接口</h2>
    <p class="hint">
      口语模块要现场生成对话和范本，需要一个 API Key。Key 只保存在本机浏览器，
      不会写进备份文件。发音用本机语音模型，离线也能读。
    </p>
    <button class="btn primary" @click="setView('settings')">去设置里填写 Key</button>
  </div>

  <template v-else>
    <!-- 复盘视图 -->
    <div v-if="reviewSession" class="panel">
      <div class="panel-head">
        <h2>{{ sceneLabel(reviewSession.sceneId) }} · 复盘</h2>
        <button class="btn ghost" @click="reviewId = null">返回</button>
      </div>
      <TalkReviewCard
        :session="reviewSession"
        @close="reviewId = null"
        @again="reviewId = null"
      />
    </div>

    <template v-else>
      <!-- 模式切换 -->
      <div class="panel">
        <div class="panel-head">
          <h2>情景口语</h2>
          <div class="mode-seg">
            <button :class="{ active: talkMode === 'learn' }" @click="talkMode = 'learn'">
              📖 对话范本 · 学
            </button>
            <button :class="{ active: talkMode === 'talk' }" @click="talkMode = 'talk'">
              🎭 情景实战 · 说
            </button>
          </div>
        </div>

        <p class="hint talk-intro">
          <template v-if="talkMode === 'learn'">
            一段完整的真人对话，逐句标好谁在说、念什么、什么意思。先听懂、跟着读，
            再去实战。范本只是参考——实战每次都会换人物脾气和突发状况，不会让你背台词。
          </template>
          <template v-else>
            你演自己，AI 演对方。它只给一句开场白，后面的走向由你们现场聊出来。
            说错了不影响它接话，点评会悄悄记在旁边，聊完再一起复盘。
          </template>
        </p>

        <div class="chips talk-groups">
          <button
            v-for="g in TALK_GROUPS"
            :key="g.key"
            class="chip"
            :class="{ active: groupKey === g.key }"
            @click="groupKey = g.key"
          >
            {{ g.icon }} {{ g.name }}
          </button>
        </div>

        <div class="scene-grid">
          <button
            v-for="s in scenes"
            :key="s.id"
            class="scene-card"
            :class="{ active: sceneId === s.id }"
            @click="sceneId = s.id"
          >
            <span class="scene-icon">{{ s.icon }}</span>
            <span class="scene-name">{{ s.name }}</span>
            <span class="scene-meta">{{ s.partner }} · {{ levelLabel(s.level) }}</span>
          </button>
        </div>
      </div>

      <!-- ==================== 对话范本 ==================== -->
      <div v-if="talkMode === 'learn'" class="panel">
        <div class="panel-head">
          <h2>
            {{ scene?.icon }} {{ scene?.name || '选一个场景' }}
            <span v-if="scene" class="talk-level-tag">{{ levelLabel(scene.level) }}</span>
          </h2>
          <div class="btn-row">
            <button
              class="btn primary"
              :disabled="scripting || !scene"
              @click="onMakeScript"
            >
              {{ scripting ? '正在写…' : scripts.length ? '换一篇' : '写一篇范本' }}
            </button>
          </div>
        </div>

        <p v-if="scene" class="hint talk-goal">这次要办成的事：{{ scene.goal }}</p>
        <p v-if="scriptError" class="coach-error">{{ scriptError }}</p>

        <div v-if="scripting" class="empty">正在按场景写对话，一会儿就好…</div>

        <div v-else-if="!currentScript" class="empty">
          这个场景还没有范本。点「写一篇范本」，让 AI 按这个情境写一段多人对话。
        </div>

        <div v-else class="script-card">
          <div class="script-head">
            <div>
              <h3 class="script-title">{{ currentScript.titleEn }}</h3>
              <p class="script-sub">{{ currentScript.titleZh }} · {{ currentScript.setting }}</p>
            </div>
            <div class="btn-row">
              <button
                class="btn ghost"
                :class="{ active: showAllZh }"
                @click="showAllZh = !showAllZh"
              >
                {{ showAllZh ? '隐藏中文' : '显示全部中文' }}
              </button>
            </div>
          </div>

          <div class="chips script-cast">
            <span
              v-for="(c, i) in currentScript.cast"
              :key="c.name"
              class="chip cast-chip"
              :class="[`tone-${(i % 4) + 1}`, { me: i === 0 }]"
            >
              <b>{{ c.name }}</b>
              <span v-if="i === 0" class="cast-you">（你）</span>
              <span class="cast-role">{{ c.role }}</span>
            </span>
          </div>

          <div class="script-lines">
            <div
              v-for="(l, i) in currentScript.lines"
              :key="i"
              class="script-line"
              :class="[speakerTone(l.speaker), { me: isMe(l.speaker), playing: speakingLine === i }]"
            >
              <div class="script-who">{{ l.speaker }}</div>
              <div class="script-body">
                <p class="script-en">{{ l.en }}</p>
                <p v-if="zhVisible(i) && l.zh" class="script-zh">{{ l.zh }}</p>
                <p v-if="l.note" class="script-note">💡 {{ l.note }}</p>
                <div class="script-tools">
                  <button
                    class="link-btn"
                    :disabled="speakingLine === i"
                    @click="onLineSpeak(i, l.en)"
                  >
                    {{ speakingLine === i ? '朗读中…' : '🔊 发音' }}
                  </button>
                  <button class="link-btn" @click="toggleZh(i)">
                    {{ zhVisible(i) ? '收起中文' : '中文' }}
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div v-if="currentScript.phrases.length" class="script-phrases">
            <div class="res-label">值得记的表达</div>
            <ul class="phrase-list">
              <li v-for="(p, i) in currentScript.phrases" :key="i" class="phrase-item">
                <span class="phrase-en">{{ p.en }}</span>
                <span class="phrase-zh">{{ p.zh }}</span>
                <button class="talk-say" @click="say(p.en)">🔊</button>
              </li>
            </ul>
          </div>

          <div class="coach-again">
            <button class="btn ghost" :disabled="scripting" @click="onMakeScript">
              同场景再写一篇
            </button>
            <button class="btn primary" :disabled="starting" @click="onScriptToTalk">
              {{ starting ? '对方正在过来…' : '直接上场聊这个场景 →' }}
            </button>
          </div>
        </div>

        <details v-if="sceneScripts.length > 1" class="script-archive">
          <summary>这个场景的其它 {{ sceneScripts.length - 1 }} 篇</summary>
          <div class="history-list">
            <div v-for="s in sceneScripts" :key="s.id" class="archive-row">
              <button class="link-btn archive-open" @click="onPickScript(s.id)">
                {{ s.titleZh || s.titleEn }}
                <span class="archive-meta">{{ fmtDate(s.at) }} · {{ s.lines.length }} 句</span>
              </button>
              <button class="link-btn" @click="onRemoveScript(s.id)">删除</button>
            </div>
          </div>
        </details>
      </div>

      <!-- ==================== 情景实战 ==================== -->
      <div v-else class="panel">
        <!-- 没在对话：开始 -->
        <template v-if="!active">
          <div class="panel-head">
            <h2>{{ scene?.icon }} {{ scene?.name || '选一个场景' }}</h2>
            <div class="btn-row">
              <button
                v-if="unfinished"
                class="btn ghost"
                :disabled="starting"
                @click="onResume"
              >
                继续上次（{{ unfinished.turns.filter((t) => t.role === 'me').length }} 句）
              </button>
              <button class="btn primary" :disabled="starting || !scene" @click="onStartTalk">
                {{ starting ? '对方正在过来…' : '开始对话' }}
              </button>
            </div>
          </div>

          <p v-if="scene" class="hint talk-goal">
            你要办成的事：{{ scene.goal }}
          </p>
          <p class="hint">
            对方每次的性格和遇到的小麻烦都不一样，所以别想着套模板——听清对方说什么，再回。
          </p>

          <div class="talk-opts">
            <label class="switch-row">
              <input v-model="useTargets" type="checkbox" />
              <span>掺入今日生词（约 {{ targetHint }} 个）</span>
            </label>
            <label class="switch-row">
              <input v-model="autoSpeak" type="checkbox" />
              <span>自动朗读对方的话</span>
            </label>
          </div>

          <p v-if="talkError" class="coach-error">{{ talkError }}</p>
        </template>

        <!-- 对话中 -->
        <template v-else>
          <div class="talk-stage">
            <div class="talk-stage-head">
              <div>
                <b>{{ scene?.icon }} {{ active.sceneName }}</b>
                <span class="talk-partner">对方：{{ active.partner }}</span>
                <span v-if="active.variation" class="talk-twist" :title="active.variation.twists.join(' / ')">
                  🎲 {{ active.variation.persona }}
                </span>
              </div>
              <div class="btn-row">
                <button class="btn ghost" :disabled="reviewing" @click="onDrop">放弃</button>
                <button
                  class="btn primary"
                  :disabled="reviewing || replying"
                  @click="onFinish"
                >
                  {{ reviewing ? '复盘生成中…' : '结束并复盘' }}
                </button>
              </div>
            </div>

            <p class="talk-setup">{{ active.setup }}</p>

            <div v-if="active.targets.length" class="chips talk-targets">
              <span class="talk-targets-label">尽量用上：</span>
              <span
                v-for="t in active.targets"
                :key="t.word"
                class="chip talk-word"
                :class="{ hit: usedWords.has(t.word) }"
                :title="t.meaning"
              >
                {{ usedWords.has(t.word) ? '✓' : '○' }} {{ t.word }}
              </span>
            </div>

            <div ref="scroller" class="talk-scroll">
              <div
                v-for="t in active.turns"
                :key="t.id"
                class="bubble-row"
                :class="t.role"
              >
                <div class="bubble-col">
                  <div class="bubble">
                    <span v-if="t.role === 'them'" class="bubble-who">{{ active.partner }}</span>
                    <p class="bubble-en">{{ t.en }}</p>
                    <button
                      v-if="t.role === 'them'"
                      class="bubble-say"
                      title="朗读"
                      @click="say(t.en)"
                    >
                      🔊
                    </button>
                  </div>
                  <div v-if="t.role === 'me' && (t.better || t.tip)" class="talk-fix">
                    <p v-if="t.better" class="fix-better">
                      <span class="fix-mark">更地道</span>{{ t.better }}
                      <button class="talk-say" @click="say(t.better!)">🔊</button>
                    </p>
                    <p v-if="t.tip" class="fix-tip">{{ t.tip }}</p>
                  </div>
                  <div v-if="t.role === 'me' && t.used?.length" class="talk-used">
                    用上了 {{ t.used.join('、') }}
                  </div>
                </div>
              </div>

              <div v-if="replying" class="bubble-row them">
                <div class="bubble typing"><span></span><span></span><span></span></div>
              </div>
            </div>

            <p v-if="talkHint" class="talk-start-hint">可以从这句开始：{{ talkHint }}</p>
            <p v-if="talkError" class="coach-error">{{ talkError }}</p>

            <div class="talk-input">
              <textarea
                ref="inputEl"
                v-model="draft"
                class="talk-textarea"
                rows="2"
                maxlength="400"
                placeholder="用英文回一句…（Enter 发送，Shift+Enter 换行）"
                :disabled="replying"
                @keydown="onKeydown"
              />
              <div class="talk-input-btns">
                <button
                  class="btn ghost mic-btn"
                  :class="{ listening }"
                  :title="micSupported() ? '语音输入' : '当前浏览器不支持语音输入'"
                  @click="onMic"
                >
                  {{ listening ? '● 收音中' : '🎤' }}
                </button>
                <button
                  class="btn primary"
                  :disabled="replying || !draft.trim()"
                  @click="onSend"
                >
                  {{ replying ? '…' : '发送' }}
                </button>
              </div>
            </div>
          </div>
        </template>
      </div>

      <!-- 对话历史 -->
      <div v-if="talkMode === 'talk'" class="panel">
        <div class="panel-head">
          <h2>聊过的场景</h2>
          <div class="btn-row">
            <span class="pager-info">共 {{ talkHistory.length }} 轮</span>
            <button class="btn ghost" :disabled="!talkHistory.length" @click="onClearSessions">
              清空
            </button>
          </div>
        </div>

        <div v-if="!talkHistory.length" class="empty">还没有记录，聊完一轮就会出现在这里</div>

        <div v-else class="history-list">
          <details v-for="s in talkHistory" :key="s.id" class="write-history">
            <summary>
              <span class="hi-score" :class="(s.review?.score ?? 0) >= 80 ? 'good' : (s.review?.score ?? 0) >= 60 ? 'mid' : 'bad'">
                {{ s.review?.score ?? '—' }}
              </span>
              <span class="hi-mode">{{ sceneLabel(s.sceneId) }}</span>
              <span class="wh-zh">{{ s.review?.comment || s.setup }}</span>
              <span class="wh-meta">
                {{ s.turns.filter((t) => t.role === 'me').length }} 句 · {{ fmtDate(s.startedAt) }}
              </span>
            </summary>
            <div class="wh-body">
              <div class="btn-row">
                <button class="btn ghost" @click="reviewId = s.id">看复盘</button>
                <button class="link-btn" @click="onRemoveSession(s.id)">删除这轮</button>
              </div>
            </div>
          </details>
        </div>
      </div>
    </template>
  </template>
</template>
