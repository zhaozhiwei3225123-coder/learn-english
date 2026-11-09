<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { StudyKind } from '../types';
import { state, stats, deckWords, deckCount, setActiveDeck } from '../store/vocab';
import { session, startSession, endSession } from '../store/session';
import { toast } from '../store/toast';
import { setView, openWords } from '../store/ui';
import { speak } from '../lib/speech';
import StudySession from './StudySession.vue';

/** 今日待办 = 每日计划里还没完成的部分（已学/已复习过的会从计划中扣掉） */
const plan = computed(() => {
  const newQuota = Math.max(0, state.settings.dailyNew - stats.value.learnedToday);
  const reviewQuota = Math.max(0, state.settings.dailyReview - stats.value.reviewedToday);
  return {
    newPlan: Math.min(newQuota, stats.value.newCount),
    reviewPlan: Math.min(reviewQuota, stats.value.dueCount),
  };
});

/** 今日计划完成但仍想继续学时，按钮保持可点 */
const nothingToDo = computed(
  () => !session.current && stats.value.newCount === 0 && stats.value.dueCount === 0
);

function start(mode: 'full' | 'new-only' | 'review-only') {
  if (!startSession(mode)) toast('没有可学的单词，先导入词库吧');
}

/** 在今日页直接切换学习词库（会结束当前这一轮） */
function onDeckChange(e: Event) {
  endSession();
  setActiveDeck((e.target as HTMLSelectElement).value);
  toast('已切换词库');
}

/* ---------------------------------------------------------- 今日记录 */

const LOG_PAGE_SIZE = 8;
const logTab = ref<StudyKind>('new');
const page = ref(1);

const deckIds = computed(() => new Set(deckWords.value.map((w) => w.id)));

const logCounts = computed(() => {
  const c = { new: 0, review: 0 };
  for (const l of state.logs) {
    if (l.date === stats.value.today && deckIds.value.has(l.id)) c[l.kind]++;
  }
  return c;
});

const logsOfTab = computed(() =>
  state.logs
    .filter(
      (l) =>
        l.date === stats.value.today && l.kind === logTab.value && deckIds.value.has(l.id)
    )
    .slice()
    .sort((a, b) => b.at - a.at)
    .map((l) => ({
      ...l,
      word: state.words.find((w) => w.id === l.id),
      time: fmtTime(l.at),
    }))
);

const pageCount = computed(() =>
  Math.max(1, Math.ceil(logsOfTab.value.length / LOG_PAGE_SIZE))
);
const curPage = computed(() => Math.min(page.value, pageCount.value));
const pagedLogs = computed(() =>
  logsOfTab.value.slice((curPage.value - 1) * LOG_PAGE_SIZE, curPage.value * LOG_PAGE_SIZE)
);

watch(logTab, () => {
  page.value = 1;
});

function fmtTime(at: number): string {
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** 今日记录里点击朗读 */
function speakWord(word: string) {
  void speak(word, {
    engine: state.settings.ttsEngine,
    voice: state.settings.kokoroVoice,
  });
}
</script>

<template>
  <div class="stat-row">
    <div class="stat brand">
      <div class="k">今日新学（从未学过）</div>
      <div class="v">{{ stats.learnedToday }}<small>/ {{ state.settings.dailyNew }}</small></div>
    </div>
    <button class="stat clickable" title="进入复习模块" @click="setView('review')">
      <div class="k">复习 · 今日队列</div>
      <div class="v">{{ stats.dueCount }}</div>
      <div class="stat-sub">
        今日已复习 {{ stats.reviewedToday }}/{{ state.settings.dailyReview }} · 点击进入 ›
      </div>
    </button>
    <div class="stat">
      <div class="k">新词库 · 待学</div>
      <div class="v">{{ stats.newCount }}</div>
    </div>
    <button class="stat clickable" title="查看已掌握单词" @click="openWords('mastered')">
      <div class="k">已掌握</div>
      <div class="v">{{ stats.masteredCount }}</div>
      <div class="stat-sub">点击查看掌握单词 ›</div>
    </button>
  </div>

  <div class="panel">
    <!-- 空词库 -->
    <div v-if="stats.total === 0" class="empty">
      当前词库还是空的，先去「导入」页面把 Excel 单词表拖进来吧。
      <div style="margin-top: 14px">
        <button class="btn primary" @click="setView('import')">去导入</button>
      </div>
    </div>

    <!-- 学习中 / 一轮结束 -->
    <StudySession v-else-if="session.current" />

    <!-- 今日仪表盘 -->
    <div v-else class="hero">
      <div class="hero-head">
        <div class="hero-title">
          今天待办：<b>{{ plan.newPlan }}</b> 个新词 · <b>{{ plan.reviewPlan }}</b> 个复习
        </div>
        <label class="hero-deck">
          <span>学习词库</span>
          <select class="deck-select" :value="state.activeDeckId" @change="onDeckChange">
            <option v-for="d in state.decks" :key="d.id" :value="d.id">
              {{ d.name }}（{{ deckCount(d.id) }}）
            </option>
          </select>
        </label>
      </div>
      <div class="hero-sub">
        标记「认识」的单词计入「已掌握」，等
        <b>{{ state.settings.reviewDelayDays }}</b> 天后自动进入复习队列；标记「不认识」的直接进入今日复习队列，当天再考一次。
      </div>
      <div class="btn-row">
        <button class="btn primary lg" :disabled="nothingToDo" @click="start('full')">
          {{ nothingToDo ? '今天已完成 🎉' : '开始今日学习' }}
        </button>
        <button class="btn ghost" :disabled="stats.dueCount === 0" @click="start('review-only')">
          只复习（跳过新词）
        </button>
        <button class="btn ghost" :disabled="stats.newCount === 0" @click="start('new-only')">
          只学新词
        </button>
      </div>
    </div>

    <div class="study-meta">
      <span>新词库 <b>{{ stats.newCount }}</b></span>
      <span>今日复习队列 <b>{{ stats.dueCount }}</b></span>
      <span>已掌握 <b>{{ stats.masteredCount }}</b></span>
      <span>总词数 <b>{{ stats.total }}</b></span>
    </div>
  </div>

  <div class="panel">
    <div class="panel-head">
      <h2>今日记录</h2>
      <div class="chips">
        <button
          class="chip"
          :class="{ active: logTab === 'new' }"
          @click="logTab = 'new'"
        >
          新学<span class="n">{{ logCounts.new }}</span>
        </button>
        <button
          class="chip"
          :class="{ active: logTab === 'review' }"
          @click="logTab = 'review'"
        >
          复习<span class="n">{{ logCounts.review }}</span>
        </button>
      </div>
    </div>

    <div v-if="!logsOfTab.length" class="empty">
      今天还没有{{ logTab === 'new' ? '新学' : '复习' }}记录
    </div>
    <div v-else class="history">
      <div v-for="l in pagedLogs" :key="l.at" class="item">
        <span>
          <b>{{ l.word?.word ?? l.id }}</b>
          <span v-if="l.word?.ipa" class="ipa">/ {{ l.word.ipa }} /</span>
          <span class="mean">{{ l.word?.meaning }}</span>
        </span>
        <span class="meta">
          <button
            v-if="l.word"
            class="icon-btn log-speak"
            title="朗读"
            @click="speakWord(l.word.word)"
          >
            🔊
          </button>
          <span v-if="l.requeued" class="requeued">重来 · </span>{{ l.time }}
          <span :style="{ color: l.known ? 'var(--green)' : 'var(--red)', marginLeft: '8px' }">
            {{ l.known ? '认识' : '不认识' }}
          </span>
        </span>
      </div>
    </div>

    <div v-if="pageCount > 1" class="pager">
      <button class="btn ghost" :disabled="curPage <= 1" @click="page = curPage - 1">
        上一页
      </button>
      <span class="pager-info">第 {{ curPage }} / {{ pageCount }} 页 · 共 {{ logsOfTab.length }} 条</span>
      <button class="btn ghost" :disabled="curPage >= pageCount" @click="page = curPage + 1">
        下一页
      </button>
    </div>
  </div>
</template>
