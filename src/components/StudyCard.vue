<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import type { CardDirection, QueueItem, Word } from '../types';
import { deckWords, setWordIpa, similarWords, state } from '../store/vocab';
import { intervalDays, nextStage, type Recall } from '../lib/srs';
import { similarBySpelling } from '../lib/similar';
import { speak } from '../lib/speech';

const props = defineProps<{
  word: Word | null;
  item: QueueItem | null;
  revealed: boolean;
  doneNew: number;
  doneReview: number;
  plannedNew: number;
  plannedReview: number;
  right: number;
  wrong: number;
  vague: number;
  canUndo: boolean;
  remain: number;
  direction: CardDirection;
}>();

const emit = defineEmits<{
  (e: 'reveal'): void;
  (e: 'grade', recall: Recall): void;
  (e: 'undo'): void;
  (e: 'speak'): void;
  (e: 'finish'): void;
}>();

const frontIsEn = computed(() => props.direction !== 'zh2en');
const frontText = computed(() => {
  const w = props.word;
  if (!w) return '';
  return frontIsEn.value ? w.word : w.meaning || w.word;
});
const backText = computed(() => {
  const w = props.word;
  if (!w) return '';
  return frontIsEn.value ? w.meaning || '（暂无释义）' : w.word;
});

const badge = computed(() => {
  if (props.item?.requeued) return { cls: 'requeue', text: '再来一次' };
  if (props.item?.kind === 'new') return { cls: '', text: '新词' };
  return { cls: 'review', text: '复习' };
});

const total = computed(() => props.remain + props.doneNew + props.doneReview);
const pct = computed(() =>
  total.value ? Math.round(((total.value - props.remain) / total.value) * 100) : 0
);

/* 相近词：形近 / 同词族 / 释义相近 三组 */
const spelling = computed(() =>
  props.word ? similarBySpelling(props.word, deckWords.value) : { confusable: [], family: [] }
);
const synonym = computed(() => (props.word ? similarWords(props.word.id, 2) : []));
const hasSimilar = computed(
  () =>
    spelling.value.confusable.length > 0 ||
    spelling.value.family.length > 0 ||
    synonym.value.length > 0
);

/* 答完之后大概多久再见 */
const known = computed(() => props.word?.stage ?? 0);
const knownGap = computed(() =>
  intervalDays(nextStage(known.value, 'known'), state.settings.reviewDelayDays)
);

/* 朗读相近词（点击 🔊） */
function onSpeakWord(word: string): void {
  void speak(word, {
    engine: state.settings.ttsEngine,
    voice: state.settings.kokoroVoice,
  });
}

/* 音标编辑 */
const editingIpa = ref(false);
const ipaDraft = ref('');
const ipaInput = ref<HTMLInputElement | null>(null);

function startEditIpa(): void {
  if (!props.word) return;
  ipaDraft.value = props.word.ipa;
  editingIpa.value = true;
  void nextTick(() => ipaInput.value?.focus());
}

function commitIpa(): void {
  if (!editingIpa.value) return;
  editingIpa.value = false;
  const w = props.word;
  if (!w) return;
  const next = ipaDraft.value
    .trim()
    .replace(/^[/[]+/, '')
    .replace(/[/\]]+$/, '')
    .trim();
  setWordIpa(w.id, next);
}

function cancelIpa(): void {
  editingIpa.value = false;
}

// 换到下一张卡时退出编辑状态
watch(
  () => props.word?.id,
  () => {
    editingIpa.value = false;
  }
);
</script>

<template>
  <div class="study">
    <div class="study-top">
      <div class="progress">
        <div class="bar"><span :style="{ width: pct + '%' }" /></div>
        <span class="num">剩 {{ remain }} 张</span>
      </div>
      <button class="btn ghost undo-btn" :disabled="!canUndo" title="撤销上一次判定（u）" @click="emit('undo')">
        ↶ 撤销
      </button>
      <button class="btn ghost" @click="emit('finish')">结束本轮</button>
    </div>

    <div class="card">
      <span class="badge" :class="badge.cls">{{ badge.text }}</span>
      <button class="icon-btn speak" title="朗读" @click="emit('speak')">🔊</button>

      <div class="front" :class="{ zh: !frontIsEn }">{{ frontText }}</div>
      <template v-if="word">
        <input
          v-if="editingIpa"
          ref="ipaInput"
          v-model="ipaDraft"
          class="ipa-input"
          placeholder="如 ˈæpl（可留空）"
          @keydown.enter.prevent="commitIpa"
          @keydown.esc.prevent="cancelIpa"
          @blur="commitIpa"
        />
        <button
          v-else
          type="button"
          class="ipa ipa-edit"
          :title="word.ipa ? '点击修改音标' : '点击添加音标'"
          @click="startEditIpa"
        >
          <template v-if="word.ipa">/ {{ word.ipa }} /</template>
          <template v-else>＋ 添加音标</template>
        </button>
      </template>

      <template v-if="revealed">
        <div class="divider" />
        <div class="back" :class="{ en: !frontIsEn }">{{ backText }}</div>

        <div v-if="hasSimilar" class="similar">
          <template v-if="spelling.confusable.length">
            <div class="similar-title">形近词 · 别记混</div>
            <div v-for="s in spelling.confusable" :key="'c' + s.id" class="similar-item">
              <button class="icon-btn mini" title="朗读" @click="onSpeakWord(s.word)">🔊</button>
              <span class="sw">{{ s.word }}</span>
              <span v-if="s.ipa" class="si">/ {{ s.ipa }} /</span>
              <span class="sm">{{ s.meaning || '—' }}</span>
            </div>
          </template>

          <template v-if="spelling.family.length">
            <div class="similar-title">同词根词族</div>
            <div v-for="s in spelling.family" :key="'f' + s.id" class="similar-item">
              <button class="icon-btn mini" title="朗读" @click="onSpeakWord(s.word)">🔊</button>
              <span class="sw">{{ s.word }}</span>
              <span v-if="s.ipa" class="si">/ {{ s.ipa }} /</span>
              <span class="sm">{{ s.meaning || '—' }}</span>
            </div>
          </template>

          <template v-if="synonym.length">
            <div class="similar-title">释义相近（本词库）</div>
            <div v-for="s in synonym" :key="'s' + s.id" class="similar-item">
              <button class="icon-btn mini" title="朗读" @click="onSpeakWord(s.word)">🔊</button>
              <span class="sw">{{ s.word }}</span>
              <span v-if="s.ipa" class="si">/ {{ s.ipa }} /</span>
              <span class="sm">{{ s.meaning || '—' }}</span>
            </div>
          </template>
        </div>
      </template>
      <div v-else class="back placeholder">先在心里回忆一下，再显示答案</div>
    </div>

    <div class="actions three">
      <template v-if="revealed">
        <button class="btn unknow" @click="emit('grade', 'unknown')">
          不认识 <span class="kbd">2</span>
        </button>
        <button class="btn vague" title="想起来了但不确定，明天再来一次" @click="emit('grade', 'vague')">
          模糊 <span class="kbd">3</span>
        </button>
        <button class="btn know" @click="emit('grade', 'known')">
          认识 <span class="kbd">1</span>
        </button>
      </template>
      <button v-else class="btn primary" @click="emit('reveal')">
        显示释义 <span class="kbd">空格</span>
      </button>
    </div>

    <div class="next-hint">
      <template v-if="revealed">认识 → {{ knownGap }} 天后复习 · 模糊 → 明天再来 · 不认识 → 今天再考</template>
    </div>

    <div class="study-meta">
      <span>新词 <b>{{ doneNew }}/{{ plannedNew }}</b></span>
      <span>复习 <b>{{ doneReview }}/{{ plannedReview }}</b></span>
      <span>认识 <b>{{ right }}</b> · 模糊 <b>{{ vague }}</b> · 不认识 <b>{{ wrong }}</b></span>
    </div>
  </div>
</template>
