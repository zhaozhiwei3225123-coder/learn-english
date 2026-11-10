<script setup lang="ts">
import { onBeforeUnmount, watch } from 'vue';
import { state } from '../store/vocab';
import {
  session,
  currentItem,
  currentWord,
  reveal,
  grade,
  undoGrade,
  canUndo,
  startSession,
  endSession,
  skipMissing,
} from '../store/session';
import { toast } from '../store/toast';
import { setView } from '../store/ui';
import { speak } from '../lib/speech';
import { prefetchKokoro } from '../lib/kokoro';
import StudyCard from './StudyCard.vue';
import DictationCard from './DictationCard.vue';

/* 删除单词后自动跳过无效卡片 */
watch(
  () => [session.current?.idx, session.current?.queue.length],
  () => skipMissing()
);

/* 卡片出现时提前合成发音，点击 🔊 时直接命中本地缓存，不用再等推理 */
function prefetchNextWord(startIdx: number, voice: string) {
  const s = session.current;
  if (!s || s.idx !== startIdx) return; // 已经翻页，交给新卡片的预生成
  const next = s.queue[startIdx + 1];
  const nextWord = next ? state.words.find((w) => w.id === next.id) : null;
  if (nextWord) void prefetchKokoro(nextWord.word, voice);
}

let prefetchTimer: number | undefined;
watch(
  () => [
    currentWord.value?.word ?? '',
    state.settings.ttsEngine,
    state.settings.kokoroVoice,
  ] as const,
  ([word, engine, voice]) => {
    window.clearTimeout(prefetchTimer);
    if (!word || engine !== 'kokoro') return;
    prefetchTimer = window.setTimeout(() => {
      const startIdx = session.current?.idx ?? 0;
      // 当前单词合成完再预生成下一张卡，孰先孰后都命中缓存
      void prefetchKokoro(word, voice).then(() => prefetchNextWord(startIdx, voice));
    }, 60);
  },
  { immediate: true }
);
onBeforeUnmount(() => window.clearTimeout(prefetchTimer));

function onSpeak() {
  const w = currentWord.value;
  if (w) {
    void speak(w.word, {
      engine: state.settings.ttsEngine,
      voice: state.settings.kokoroVoice,
    });
  }
}

function nextRound() {
  const mode = session.current?.mode ?? 'full';
  if (mode === 'reading') {
    endSession();
    setView('reading');
    toast('这篇的学习集已完成');
    return;
  }
  if (!startSession(mode)) toast('没有可学的单词，先导入词库吧');
}

function back() {
  const mode = session.current?.mode;
  endSession();
  setView(mode === 'reading' ? 'reading' : 'today');
}

/** 听写结果：直接记账，不把错词再塞回本轮队列（它仍留在今日复习队列） */
function onDictationResult(known: boolean) {
  grade(known ? 'known' : 'unknown', false);
}
</script>

<template>
  <DictationCard
    v-if="
      session.current &&
      session.current.mode === 'dictation' &&
      session.current.idx < session.current.queue.length
    "
    :word="currentWord"
    :remain="session.current.queue.length - session.current.idx"
    :total="session.current.queue.length"
    @speak="onSpeak"
    @result="onDictationResult"
    @finish="endSession"
  />

  <StudyCard
    v-else-if="session.current && session.current.idx < session.current.queue.length"
    :word="currentWord"
    :item="currentItem"
    :revealed="session.current.revealed"
    :done-new="session.current.doneNew"
    :done-review="session.current.doneReview"
    :planned-new="session.current.plannedNew"
    :planned-review="session.current.plannedReview"
    :right="session.current.right"
    :wrong="session.current.wrong"
    :vague="session.current.vague"
    :can-undo="canUndo"
    :remain="session.current.queue.length - session.current.idx"
    :direction="state.settings.direction"
    @reveal="reveal"
    @grade="grade"
    @undo="undoGrade"
    @speak="onSpeak"
    @finish="endSession"
  />

  <div v-else-if="session.current" class="done-box">
    <div class="big">🎉</div>
    <h3>这一轮完成啦</h3>
    <p>
      新学 <b>{{ session.current.doneNew }}</b> 个 · 复习
      <b>{{ session.current.doneReview }}</b> 个 · 认识
      <b>{{ session.current.right }}</b> · 模糊 <b>{{ session.current.vague }}</b> · 不认识
      <b>{{ session.current.wrong }}</b>
    </p>
    <div class="btn-row" style="justify-content: center">
      <button class="btn primary" @click="nextRound">
        {{ session.current.mode === 'reading' ? '完成 · 回到阅读' : '再来一轮' }}
      </button>
      <button class="btn ghost" @click="back">
        {{ session.current.mode === 'reading' ? '回到阅读' : '回到今日' }}
      </button>
    </div>
  </div>
</template>
