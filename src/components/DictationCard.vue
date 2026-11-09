<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import type { Word } from '../types';
import { state } from '../store/vocab';
import { speak } from '../lib/speech';

const props = defineProps<{
  word: Word | null;
  remain: number;
  total: number;
}>();

const emit = defineEmits<{
  (e: 'speak'): void;
  (e: 'result', known: boolean): void;
  (e: 'finish'): void;
}>();

const MAX_TRIES = 3;

const input = ref('');
const inputEl = ref<HTMLInputElement | null>(null);
const tryCount = ref(0);
const revealed = ref(false);
const correct = ref(false);
const feedback = ref('');

const pct = computed(() =>
  props.total ? Math.round(((props.total - props.remain) / props.total) * 100) : 0
);

/** 比较时忽略大小写、首尾空格和标点符号 */
function normalize(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9' -]/g, '')
    .replace(/\s+/g, ' ');
}

function playWord() {
  const w = props.word;
  if (!w) return;
  void speak(w.word, {
    engine: state.settings.ttsEngine,
    voice: state.settings.kokoroVoice,
  });
}

function reset() {
  input.value = '';
  tryCount.value = 0;
  revealed.value = false;
  correct.value = false;
  feedback.value = '';
  void nextTick(() => inputEl.value?.focus());
  playWord();
}

watch(
  () => props.word?.id,
  () => reset(),
  { immediate: true }
);

/** 提交一次听写；写对或 3 次用完都会展示卡片 */
function submit() {
  const w = props.word;
  if (!w || revealed.value) return;
  const typed = normalize(input.value);
  if (!typed) return;

  tryCount.value++;
  if (typed === normalize(w.word)) {
    correct.value = true;
    revealed.value = true;
    feedback.value = '';
    return;
  }

  if (tryCount.value >= MAX_TRIES) {
    revealed.value = true;
    feedback.value = '';
  } else {
    feedback.value = `写错了，还有 ${MAX_TRIES - tryCount.value} 次机会`;
    input.value = '';
    void nextTick(() => inputEl.value?.focus());
  }
}

function next() {
  emit('result', correct.value);
}
</script>

<template>
  <div class="study">
    <div class="study-top">
      <div class="progress">
        <div class="bar"><span :style="{ width: pct + '%' }" /></div>
        <span class="num">剩 {{ remain }} 张</span>
      </div>
      <button class="btn ghost" @click="emit('finish')">结束本轮</button>
    </div>

    <div class="card dict">
      <span class="badge review">听写</span>
      <button class="icon-btn speak" title="再听一遍" @click="emit('speak')">🔊</button>

      <template v-if="word">
        <template v-if="!revealed">
          <div class="dict-main">
            <div class="dict-mean">{{ word.meaning || '（无释义）' }}</div>
            <div class="dict-title">听发音，把单词写出来</div>
            <input
              ref="inputEl"
              v-model="input"
              class="dict-input"
              placeholder="在这里输入单词"
              autocomplete="off"
              autocapitalize="off"
              spellcheck="false"
              @keydown.enter.prevent="submit"
            />
            <div v-if="feedback" class="dict-feedback bad">{{ feedback }}</div>
            <div class="dict-attempts">已用 {{ Math.min(tryCount, MAX_TRIES) }} / {{ MAX_TRIES }} 次机会</div>
          </div>
          <div class="actions">
            <button class="btn ghost" @click="playWord">再听一遍</button>
            <button class="btn primary" @click="submit">提交</button>
          </div>
        </template>

        <template v-else>
          <div class="dict-reveal">
            <div class="word">{{ word.word }}</div>
            <div v-if="word.ipa" class="ipa">/ {{ word.ipa }} /</div>
            <div class="mean">{{ word.meaning || '—' }}</div>
          </div>
          <div class="dict-result" :class="correct ? 'right' : 'wrong'">
            {{ correct ? '✅ 写对了' : '❌ 三次都没写对，已显示答案' }}
          </div>
          <div class="actions">
            <button class="btn ghost" @click="playWord">再听一遍</button>
            <button class="btn primary" @click="next">下一张</button>
          </div>
        </template>
      </template>
    </div>
  </div>
</template>
