<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue';
import type { ViewName } from './types';
import {
  state,
  stateReady,
  stats,
  loadState,
  createDeck,
  deckCount,
  setActiveDeck,
  promoteMastered,
} from './store/vocab';
import { view, setView } from './store/ui';
import { session, reveal, grade, undoGrade, endSession } from './store/session';
import { toast, toastMessage } from './store/toast';
import { fmtDate, todayKey } from './lib/date';
import TodayView from './components/TodayView.vue';
import ReviewView from './components/ReviewView.vue';
import DeckListView from './components/DeckListView.vue';
import WordListView from './components/WordListView.vue';
import ImportView from './components/ImportView.vue';
import ReadingView from './components/ReadingView.vue';
import WritingView from './components/WritingView.vue';
import SettingsView from './components/SettingsView.vue';

const tabs: { key: ViewName; label: string }[] = [
  { key: 'today', label: '今日' },
  { key: 'review', label: '复习' },
  { key: 'reading', label: '阅读' },
  { key: 'decks', label: '词库' },
  { key: 'writing', label: '造句' },
  { key: 'import', label: '导入' },
  { key: 'settings', label: '设置' },
];

const subLabel = computed(() => {
  const deckName = state.decks.find((d) => d.id === state.activeDeckId)?.name ?? '词库';
  return `${fmtDate(todayKey())} · ${deckName} · ${stats.value.total} 个单词`;
});

/** 切换词库：结束当前一轮，避免把旧词库的卡片带到新词库 */
function onDeckChange(e: Event) {
  endSession();
  setActiveDeck((e.target as HTMLSelectElement).value);
}

function onNewDeck() {
  const name = window.prompt('新词库名称（例如：四级核心词）');
  if (!name || !name.trim()) return;
  endSession();
  const deck = createDeck(name);
  if (deck) toast(`已新建词库「${deck.name}」，导入的单词会进入这个词库`);
}

function onKeydown(e: KeyboardEvent) {
  const active =
    view.value === 'today' || view.value === 'review' || view.value === 'reading';
  if (!active || !session.current) return;
  // 听写模式用输入框作答，不响应翻面/评分快捷键
  if (session.current.mode === 'dictation') return;
  const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

  if (e.code === 'Space' || e.key === ' ') {
    e.preventDefault();
    if (!session.current.revealed) reveal();
  } else if (e.key === '1' && session.current.revealed) {
    e.preventDefault();
    grade('known');
  } else if (e.key === '2' && session.current.revealed) {
    e.preventDefault();
    grade('unknown');
  } else if (e.key === '3' && session.current.revealed) {
    e.preventDefault();
    grade('vague');
  } else if (e.key === 'u' || e.key === 'U') {
    e.preventDefault();
    undoGrade();
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown);
  void loadState().then(() => {
    // 已掌握且到期的单词自动进入复习队列
    promoteMastered();
    // 当前词库还没有单词时，直接落到导入页
    if (!stats.value.total) setView('import');
  });
});
onUnmounted(() => window.removeEventListener('keydown', onKeydown));
</script>

<template>
  <div class="app">
    <header class="topbar">
      <div class="brand">
        <div class="logo">W</div>
        <div class="brand-text">
          <h1>单词学习台</h1>
          <p class="sub">{{ subLabel }}</p>
        </div>
      </div>
      <nav class="tabs">
        <select
          class="deck-select"
          :value="state.activeDeckId"
          title="切换词库"
          @change="onDeckChange"
        >
          <option v-for="d in state.decks" :key="d.id" :value="d.id">
            {{ d.name }}（{{ deckCount(d.id) }}）
          </option>
        </select>
        <button class="tab deck-add" title="新建词库" @click="onNewDeck">＋</button>
        <button
          v-for="t in tabs"
          :key="t.key"
          class="tab"
          :class="{ active: view === t.key || (t.key === 'decks' && view === 'words') }"
          @click="setView(t.key)"
        >
          {{ t.label }}
        </button>
      </nav>
    </header>

    <main v-if="stateReady">
      <TodayView v-if="view === 'today'" />
      <ReviewView v-else-if="view === 'review'" />
      <DeckListView v-else-if="view === 'decks'" />
      <WordListView v-else-if="view === 'words'" />
      <ImportView v-else-if="view === 'import'" />
      <ReadingView v-else-if="view === 'reading'" />
      <WritingView v-else-if="view === 'writing'" />
      <SettingsView v-else />
    </main>
    <main v-else>
      <div class="panel"><div class="empty">正在载入本地数据…</div></div>
    </main>

    <div class="toast" :class="{ show: !!toastMessage }">{{ toastMessage }}</div>
  </div>
</template>
