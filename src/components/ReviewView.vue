<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { state, stats, deckWords } from '../store/vocab';
import { session, startSession } from '../store/session';
import { toast } from '../store/toast';
import { speak } from '../lib/speech';
import StudySession from './StudySession.vue';

const PAGE_SIZE = 10;
const page = ref(1);

/** 只展示当前词库里今天进入复习队列（已到期）的单词 */
const list = computed(() =>
  deckWords.value
    .filter((w) => w.group === 'review' && (!w.due || w.due <= stats.value.today))
    .slice()
    .sort((a, b) => a.word.localeCompare(b.word))
);

const pageCount = computed(() => Math.max(1, Math.ceil(list.value.length / PAGE_SIZE)));
const curPage = computed(() => Math.min(page.value, pageCount.value));
const paged = computed(() =>
  list.value.slice((curPage.value - 1) * PAGE_SIZE, curPage.value * PAGE_SIZE)
);

watch(list, () => {
  page.value = 1;
});

function startReview() {
  if (!startSession('review-only')) toast('今天没有需要复习的单词');
}

/** 听写模式：先听发音，再把单词写出来，每词 3 次机会 */
function startDictation() {
  if (!startSession('dictation')) toast('今天没有需要复习的单词');
}

function onSpeak(word: string) {
  void speak(word, {
    engine: state.settings.ttsEngine,
    voice: state.settings.kokoroVoice,
  });
}
</script>

<template>
  <!-- 复习中 -->
  <StudySession v-if="session.current" />

  <template v-else>
    <div class="panel">
      <div class="hero">
        <div class="hero-title">
          今日复习队列：<b>{{ list.length }}</b> 个单词
        </div>
        <div class="hero-sub">
          复习时标记「认识」的单词会转为「已掌握」，<b>{{ state.settings.reviewDelayDays }}</b>
          天后自动回到复习队列；标记「不认识」的会继续留在今日复习队列里，再考一次。今天已复习
          <strong>{{ stats.reviewedToday }}/{{ state.settings.dailyReview }}</strong>，当前已掌握
          <strong>{{ stats.masteredCount }}</strong> 个。
        </div>
        <div class="btn-row">
          <button class="btn primary lg" :disabled="!list.length" @click="startReview">
            {{ list.length ? `开始复习（${list.length} 个）` : '今天没有复习任务' }}
          </button>
          <button class="btn ghost lg" :disabled="!list.length" @click="startDictation">
            听写模式（{{ list.length }} 个）
          </button>
        </div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-head">
        <h2>今日进入复习队列</h2>
        <span class="pager-info">共 {{ list.length }} 个</span>
      </div>

      <div v-if="!list.length" class="empty">今天还没有单词进入复习队列，明天再来吧</div>
      <div v-else class="history">
        <div v-for="w in paged" :key="w.id" class="item">
          <span>
            <b>{{ w.word }}</b>
            <span v-if="w.ipa" class="ipa">/ {{ w.ipa }} /</span>
            <span class="mean">{{ w.meaning || '—' }}</span>
          </span>
          <button class="icon-btn" title="朗读" @click="onSpeak(w.word)">🔊</button>
        </div>
      </div>

      <div v-if="pageCount > 1" class="pager">
        <button class="btn ghost" :disabled="curPage <= 1" @click="page = curPage - 1">
          上一页
        </button>
        <span class="pager-info">第 {{ curPage }} / {{ pageCount }} 页 · 共 {{ list.length }} 个</span>
        <button class="btn ghost" :disabled="curPage >= pageCount" @click="page = curPage + 1">
          下一页
        </button>
      </div>
    </div>
  </template>
</template>
