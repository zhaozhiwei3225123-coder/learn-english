<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { judgeFill, normalizeWord, tokenizeFill, type FillBlankResult } from '../lib/fillJudge';
import { recordFillAttempt } from '../store/writing';
import { toast } from '../store/toast';

const props = defineProps<{
  zh: string;
  /** 参考英文译文（挖空依据） */
  en: string;
}>();

const emit = defineEmits<{
  /** 要下一题 */
  (e: 'next'): void;
  /** 跳过本题 */
  (e: 'skip'): void;
}>();

type Phase = 'typing' | 'checked' | 'revealed';

const tokens = computed(() => tokenizeFill(props.en));
const blanks = computed(() => tokens.value.filter((t) => t.kind === 'word'));

const inputs = ref<string[]>([]);
const results = ref<FillBlankResult[] | null>(null);
const phase = ref<Phase>('typing');
const boxEls = ref<HTMLInputElement[]>([]);

function setBox(el: unknown, i: number): void {
  if (el instanceof HTMLInputElement) boxEls.value[i] = el;
}

const blankWidth = (expected: string): string => `${Math.max(expected.length + 1, 4)}ch`;

/** 第 ti 个 token 前面有几个单词空格（word token 的序号） */
function blankIndex(ti: number): number {
  let n = 0;
  for (let k = 0; k < ti; k++) if (tokens.value[k]?.kind === 'word') n++;
  return n;
}

function focusBlank(i: number): void {
  void nextTick(() => boxEls.value[Math.max(0, Math.min(i, blanks.value.length - 1))]?.focus());
}

/** 输入框 keydown：空格/Enter 跳下一个，最后一个 Enter 提交；退格在空框上回退 */
function onKeydown(e: KeyboardEvent, i: number): void {
  if (phase.value !== 'typing') return;
  if (e.key === 'Enter' && e.ctrlKey) {
    e.preventDefault();
    onCheck();
    return;
  }
  if (e.key === ' ' || e.key === 'Enter') {
    e.preventDefault();
    if (i >= blanks.value.length - 1) {
      onCheck();
    } else {
      focusBlank(i + 1);
    }
    return;
  }
  if (e.key === 'Backspace' && !inputs.value[i] && i > 0) {
    e.preventDefault();
    focusBlank(i - 1);
  }
}

/** 自动跳词：输入里出现空格就裁掉并跳下一个 */
function onInput(i: number): void {
  const v = inputs.value[i];
  if (!v) return;
  if (v.includes(' ')) {
    const trimmed = v.replace(/\s+/g, '');
    inputs.value[i] = trimmed;
    if (i < blanks.value.length - 1) focusBlank(i + 1);
  }
}

const allFilled = computed(() =>
  blanks.value.every((_, i) => (inputs.value[i] || '').trim().length > 0)
);

const fillStats = computed(() => {
  if (!results.value) return { right: 0, total: blanks.value.length };
  return {
    right: results.value.filter((r) => r.ok).length,
    total: blanks.value.length,
  };
});

const resultScore = computed(() => {
  const { right, total } = fillStats.value;
  return total ? Math.round((right / total) * 100) : 0;
});

function onCheck(): void {
  if (phase.value !== 'typing' || !allFilled.value) return;
  const expected = blanks.value.map((b) => b.text);
  results.value = judgeFill(expected, inputs.value);
  phase.value = 'checked';

  const { right, total } = fillStats.value;
  const issues = results.value
    .map((r, i) =>
      r.ok
        ? null
        : {
            type: '填错',
            bad: r.input || '（空）',
            good: r.expected,
            why: `第 ${i + 1} 空`,
          }
    )
    .filter((x): x is NonNullable<typeof x> => x !== null);

  recordFillAttempt({
    text: inputs.value.map((w) => w.trim()).join(' '),
    score: resultScore.value,
    issues,
    comment: `${right}/${total} 词正确`,
  });
  if (right === total) toast('全部正确 🎉');
}

/** 看答案：不记成绩 */
function onReveal(): void {
  if (phase.value !== 'typing') return;
  inputs.value = blanks.value.map((b) => b.text);
  results.value = blanks.value.map((b) => ({ input: b.text, expected: b.text, ok: false }));
  phase.value = 'revealed';
}

function onRedo(): void {
  inputs.value = blanks.value.map(() => '');
  results.value = null;
  phase.value = 'typing';
  focusBlank(0);
}

function verdict(score: number): string {
  if (score === 100) return '全对！';
  if (score >= 85) return '就差一两个';
  if (score >= 60) return '过半了，继续';
  return '再听一遍多试试';
}

watch(
  () => [props.zh, props.en],
  () => {
    inputs.value = blanks.value.map(() => '');
    results.value = null;
    phase.value = 'typing';
    boxEls.value = [];
    focusBlank(0);
  }
);

onMounted(() => focusBlank(0));
</script>

<template>
  <div class="write-card fill-card">
    <div class="write-zh">{{ props.zh }}</div>
    <div class="write-hint">按顺序把这句英文一个词一个词填出来</div>

    <div class="fill-line" :class="{ done: phase !== 'typing' }">
      <template v-for="(t, ti) in tokens" :key="ti">
        <span v-if="t.kind === 'punct'" class="fill-punct">{{ t.text }}</span>
        <span
          v-else
          class="blank"
          :class="{
            ok: phase === 'checked' && results?.[blankIndex(ti)]?.ok,
            bad: phase === 'checked' && results && !results[blankIndex(ti)]?.ok,
            show: phase === 'revealed',
          }"
        >
          <input
            :ref="(el) => setBox(el, blankIndex(ti))"
            v-model="inputs[blankIndex(ti)]"
            class="blank-input"
            type="text"
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
            :style="{ width: blankWidth(t.text) }"
            :disabled="phase !== 'typing'"
            :tabindex="blankIndex(ti) + 1"
            @keydown="onKeydown($event, blankIndex(ti))"
            @input="onInput(blankIndex(ti))"
          />
          <span
            v-if="phase === 'checked' && results && !results[blankIndex(ti)]?.ok"
            class="blank-fix"
          >
            {{ results[blankIndex(ti)]?.expected }}
          </span>
        </span>
      </template>
    </div>

    <div v-if="phase === 'typing'" class="write-bar">
      <span class="coach-tip">空格 / 回车跳下一个词 · Ctrl+Enter 检查</span>
      <div class="btn-row">
        <button class="btn ghost" @click="emit('skip')">跳过</button>
        <button class="btn ghost" @click="onReveal">看答案</button>
        <button class="btn primary" :disabled="!allFilled" @click="onCheck">检查</button>
      </div>
    </div>

    <div v-else class="coach-result fill-result">
      <div class="res-top">
        <span
          class="score"
          :class="resultScore === 100 ? 'good' : resultScore >= 60 ? 'mid' : 'bad'"
        >
          {{ resultScore }}
        </span>
        <div class="res-meta">
          <b>{{ verdict(resultScore) }}</b>
          <p class="res-comment">
            {{ fillStats.right }}/{{ fillStats.total }} 词正确 ·
            {{ phase === 'revealed' ? '已直接显示答案，不计成绩' : '已记入下面的记录' }}
          </p>
        </div>
      </div>

      <div class="res-block">
        <div class="res-label">完整句子</div>
        <p class="res-text ref">{{ props.en }}</p>
      </div>

      <div class="coach-again">
        <button class="btn ghost" @click="onRedo">清空重填</button>
        <button class="btn primary" @click="emit('next')">下一题</button>
      </div>
    </div>
  </div>
</template>
