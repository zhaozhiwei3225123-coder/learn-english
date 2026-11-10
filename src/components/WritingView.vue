<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue';
import { state } from '../store/vocab';
import { setView } from '../store/ui';
import { toast } from '../store/toast';
import { hasApiKey, resolveConfig, SENTENCE_LEVELS, SENTENCE_THEMES } from '../lib/ai';
import {
  writingTheme,
  writingLevel,
  writeMode,
  currentPrompt,
  generating,
  grading,
  writingError,
  lastResult,
  attempts,
  writingStats,
  nextPrompt,
  submitAnswer,
  removeAttempt,
  clearAttempts,
  retryCurrent,
} from '../store/writing';
import FillCard from './FillCard.vue';

const answer = ref('');
const textarea = ref<HTMLTextAreaElement | null>(null);
const keyReady = ref(hasApiKey());

const cfg = computed(() => resolveConfig(state.settings));

function scoreClass(score: number): string {
  if (score >= 85) return 'good';
  if (score >= 65) return 'mid';
  return 'bad';
}

function verdict(score: number): string {
  if (score >= 90) return '很地道';
  if (score >= 75) return '意思到位';
  if (score >= 60) return '基本能懂';
  return '需要重写';
}

function levelLabel(key: string): string {
  return SENTENCE_LEVELS.find((x) => x.key === key)?.label ?? key;
}

function fmtDate(at: number): string {
  const d = new Date(at);
  return `${d.getMonth() + 1}-${String(d.getDate()).padStart(2, '0')} ${String(
    d.getHours()
  ).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function focusInput(): void {
  void nextTick(() => textarea.value?.focus());
}

function setTheme(theme: string): void {
  writingTheme.value = theme;
}

function setLevel(level: string): void {
  writingLevel.value = level as typeof writingLevel.value;
}

async function onGenerate(): Promise<void> {
  const c = cfg.value;
  if (!c) {
    keyReady.value = false;
    return;
  }
  answer.value = '';
  await nextPrompt(c);
  if (currentPrompt.value) focusInput();
}

async function onSubmit(): Promise<void> {
  const c = cfg.value;
  if (!c) {
    keyReady.value = false;
    return;
  }
  const r = await submitAnswer(answer.value, c);
  if (r) toast(`已批改：${r.score} 分`);
}

async function onNext(): Promise<void> {
  answer.value = '';
  await onGenerate();
}

function onRetry(): void {
  answer.value = '';
  retryCurrent();
  focusInput();
}

function onClear(): void {
  if (!attempts.value.length) return;
  if (!confirm(`清空全部 ${attempts.value.length} 条造句记录？`)) return;
  clearAttempts();
  toast('记录已清空');
}

function onRemove(id: string): void {
  removeAttempt(id);
  toast('已删除这条记录');
}

onMounted(() => {
  keyReady.value = hasApiKey();
  // 配置好 Key 且没有待做的题时，直接要一道
  if (keyReady.value && !currentPrompt.value && cfg.value) {
    void onGenerate();
  }
});
</script>

<template>
  <div class="stat-row">
    <div class="stat brand">
      <div class="k">累计造句</div>
      <div class="v">{{ writingStats.total }}</div>
      <div class="stat-sub">跟词库无关的独立练习</div>
    </div>
    <div class="stat">
      <div class="k">今日</div>
      <div class="v">{{ writingStats.today }}</div>
    </div>
    <div class="stat">
      <div class="k">近 20 句均分</div>
      <div class="v">{{ writingStats.avg }}</div>
    </div>
    <div class="stat">
      <div class="k">最高分</div>
      <div class="v">{{ writingStats.best }}</div>
    </div>
  </div>

  <!-- 未配置 Key -->
  <div v-if="!keyReady" class="panel">
    <h2>先配置 AI 接口</h2>
    <p class="hint">
      造句练习由 DeepSeek 实时出题并批改，需要一个 API Key。Key 只保存在本机浏览器，
      不会写进备份文件，也不会随项目发布。
    </p>
    <button class="btn primary" @click="setView('settings')">去设置里填写 Key</button>
  </div>

  <template v-else>
    <div class="panel">
      <div class="panel-head">
        <h2>造句练习</h2>
        <div class="mode-seg">
          <button :class="{ active: writeMode === 'free' }" @click="writeMode = 'free'">
            ✍️ 自由写 · AI 批改
          </button>
          <button :class="{ active: writeMode === 'fill' }" @click="writeMode = 'fill'">
            ⌨️ 逐词填空
          </button>
        </div>
      </div>

      <div class="write-controls">
        <div class="chips">
          <button
            v-for="t in SENTENCE_THEMES"
            :key="t"
            class="chip"
            :class="{ active: writingTheme === t }"
            @click="setTheme(t)"
          >
            {{ t }}
          </button>
        </div>
        <div class="chips">
          <button
            v-for="l in SENTENCE_LEVELS"
            :key="l.key"
            class="chip"
            :class="{ active: writingLevel === l.key }"
            :title="l.hint"
            @click="setLevel(l.key)"
          >
            {{ l.label }}
          </button>
        </div>
        <button class="btn primary" :disabled="generating || grading" @click="onGenerate">
          {{ generating ? '出题中…' : currentPrompt ? '换一题' : '出题' }}
        </button>
      </div>

      <p v-if="writingError" class="coach-error">{{ writingError }}</p>

      <div v-if="generating && !currentPrompt" class="empty">正在向 DeepSeek 要题目…</div>

      <!-- 逐词填空模式 -->
      <FillCard
        v-if="writeMode === 'fill' && currentPrompt"
        :zh="currentPrompt.zh"
        :en="currentPrompt.en"
        :phrases="currentPrompt.phrases"
        @next="onNext"
        @skip="onNext"
      />

      <!-- 自由写模式 -->
      <div v-if="writeMode === 'free' && currentPrompt" class="write-card">
        <div class="write-zh">{{ currentPrompt.zh }}</div>
        <div class="write-hint">把这句中文写成英文</div>

        <textarea
          ref="textarea"
          v-model="answer"
          class="write-input"
          rows="3"
          maxlength="400"
          placeholder="Write it in English…"
          :disabled="grading"
          @keydown.meta.enter.prevent="onSubmit"
          @keydown.ctrl.enter.prevent="onSubmit"
        />

        <div class="write-bar">
          <span class="coach-tip">⌘/Ctrl + Enter 提交</span>
          <div class="btn-row">
            <button class="btn ghost" :disabled="grading" @click="onNext">跳过这题</button>
            <button class="btn primary" :disabled="grading || !answer.trim()" @click="onSubmit">
              {{ grading ? '批改中…' : '提交批改' }}
            </button>
          </div>
        </div>

        <div v-if="lastResult" class="coach-result">
          <div class="res-top">
            <span class="score" :class="scoreClass(lastResult.score)">{{ lastResult.score }}</span>
            <div class="res-meta">
              <b>{{ verdict(lastResult.score) }}</b>
              <p v-if="lastResult.comment" class="res-comment">{{ lastResult.comment }}</p>
            </div>
          </div>

          <div class="res-block">
            <div class="res-label">你写的</div>
            <p class="res-text dim">{{ lastResult.text }}</p>
          </div>

          <div class="res-block">
            <div class="res-label">AI 修正</div>
            <p class="res-text">{{ lastResult.corrected }}</p>
          </div>

          <div class="res-block">
            <div class="res-label">参考译文</div>
            <p class="res-text ref">{{ lastResult.reference }}</p>
          </div>

          <div v-if="lastResult.phrases?.length" class="res-block">
            <div class="res-label">词组 / 句型</div>
            <ul class="phrase-list">
              <li v-for="(p, i) in lastResult.phrases" :key="i" class="phrase-item">
                <span class="phrase-en">{{ p.en }}</span>
                <span class="phrase-zh">{{ p.zh }}</span>
              </li>
            </ul>
          </div>

          <ul v-if="lastResult.issues.length" class="res-issues">
            <li v-for="(it, i) in lastResult.issues" :key="i">
              <div class="issue-line">
                <span class="issue-type">{{ it.type }}</span>
                <span class="issue-bad">{{ it.bad || '—' }}</span>
                <span class="issue-arrow">→</span>
                <span class="issue-good">{{ it.good || '—' }}</span>
              </div>
              <p v-if="it.why" class="issue-why">{{ it.why }}</p>
            </li>
          </ul>

          <div class="coach-again">
            <button class="btn ghost" @click="onRetry">同一题再写一版</button>
            <button class="btn primary" :disabled="generating" @click="onNext">下一题</button>
          </div>
        </div>
      </div>

      <div v-else-if="!generating" class="empty">
        点「出题」开始，每道题由 DeepSeek 现场生成，不计入背单词的统计。
      </div>
    </div>

    <div class="panel">
      <div class="panel-head">
        <h2>做过的句子</h2>
        <div class="btn-row">
          <span class="pager-info">共 {{ attempts.length }} 条</span>
          <button class="btn ghost" :disabled="!attempts.length" @click="onClear">清空</button>
        </div>
      </div>

      <div v-if="!attempts.length" class="empty">还没有记录，做完第一句就会出现在这里</div>

      <div v-else class="history-list">
        <details v-for="a in attempts" :key="a.id" class="write-history">
          <summary>
            <span class="hi-score" :class="scoreClass(a.score)">{{ a.score }}</span>
            <span class="hi-mode">{{ a.mode === 'fill' ? '填空' : '造句' }}</span>
            <span class="wh-zh">{{ a.zh }}</span>
            <span class="wh-meta">{{ levelLabel(a.level) }} · {{ a.theme }} · {{ fmtDate(a.at) }}</span>
          </summary>
          <div class="wh-body">
            <div class="res-block">
              <div class="res-label">{{ a.mode === 'fill' ? '你填的' : '你写的' }}</div>
              <p class="res-text dim">{{ a.text }}</p>
            </div>
            <div v-if="a.mode !== 'fill'" class="res-block">
              <div class="res-label">AI 修正</div>
              <p class="res-text">{{ a.corrected }}</p>
            </div>
            <div class="res-block">
              <div class="res-label">参考译文</div>
              <p class="res-text ref">{{ a.reference }}</p>
            </div>

            <div v-if="a.phrases?.length" class="res-block">
              <div class="res-label">词组 / 句型</div>
              <ul class="phrase-list">
                <li v-for="(p, i) in a.phrases" :key="i" class="phrase-item">
                  <span class="phrase-en">{{ p.en }}</span>
                  <span class="phrase-zh">{{ p.zh }}</span>
                </li>
              </ul>
            </div>

            <ul v-if="a.issues.length" class="res-issues">
              <li v-for="(it, i) in a.issues" :key="i">
                <div class="issue-line">
                  <span class="issue-type">{{ it.type }}</span>
                  <span class="issue-bad">{{ it.bad || '—' }}</span>
                  <span class="issue-arrow">→</span>
                  <span class="issue-good">{{ it.good || '—' }}</span>
                </div>
                <p v-if="it.why" class="issue-why">{{ it.why }}</p>
              </li>
            </ul>
            <p v-if="a.comment" class="wh-comment">{{ a.comment }}</p>
            <div class="coach-again">
              <button class="link-btn" @click="onRemove(a.id)">删除这条记录</button>
            </div>
          </div>
        </details>
      </div>
    </div>
  </template>
</template>
