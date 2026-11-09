<script setup lang="ts">
import { computed, ref } from 'vue';
import type { Word, WordFilter } from '../types';
import { state, deckWords, activeDeck, resetWord, removeWord } from '../store/vocab';
import { wordFilter, setView } from '../store/ui';
import { toast } from '../store/toast';
import { speak } from '../lib/speech';
import { fmtDate } from '../lib/date';
import { isMastered } from '../lib/srs';

const search = ref('');
const filter = wordFilter;
const limit = ref(60);

const filters: { key: WordFilter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'new', label: '新词库' },
  { key: 'review', label: '复习库' },
  { key: 'mastered', label: '已掌握' },
  { key: 'wrong', label: '易错' },
];

/** 「易错」的门槛：至少答错过两次 */
const WRONG_MIN = 2;

const counts = computed(() => {
  const c = { all: deckWords.value.length, new: 0, review: 0, mastered: 0, wrong: 0 };
  for (const w of deckWords.value) {
    if (w.group === 'new') c.new++;
    else if (w.group === 'mastered') c.mastered++;
    else c.review++;
    if (w.wrong >= WRONG_MIN) c.wrong++;
  }
  return c;
});

const filtered = computed(() => {
  const kw = search.value.trim().toLowerCase();
  const list = deckWords.value.filter((w) => {
    if (filter.value === 'new' && w.group !== 'new') return false;
    if (filter.value === 'review' && w.group !== 'review') return false;
    if (filter.value === 'mastered' && !isMastered(w)) return false;
    if (filter.value === 'wrong' && w.wrong < WRONG_MIN) return false;
    if (!kw) return true;
    return w.word.toLowerCase().includes(kw) || (w.meaning || '').toLowerCase().includes(kw);
  });
  // 易错列表按答错次数从多到少排
  return filter.value === 'wrong' ? list.slice().sort((a, b) => b.wrong - a.wrong) : list;
});

const shown = computed(() => filtered.value.slice(0, limit.value));
const left = computed(() => filtered.value.length - shown.value.length);

function pick(f: WordFilter) {
  filter.value = f;
  limit.value = 60;
}

function onSearch() {
  limit.value = 60;
}

function onReset(id: string) {
  const w = state.words.find((x) => x.id === id);
  if (!w) return;
  resetWord(w);
  toast(`「${w.word}」已放回新词库`);
}

function onDelete(id: string) {
  const w = state.words.find((x) => x.id === id);
  if (!w) return;
  if (!confirm(`确定删除「${w.word}」？`)) return;
  removeWord(id);
  toast('已删除');
}

function onSpeak(w: Word) {
  void speak(w.word, {
    engine: state.settings.ttsEngine,
    voice: state.settings.kokoroVoice,
  });
}

const today = computed(() => new Date().toISOString().slice(0, 10));

function tagOf(w: Word) {
  if (isMastered(w)) return { cls: 'mastered', text: '已掌握' };
  return w.group === 'new'
    ? { cls: 'new', text: '新词' }
    : { cls: 'review', text: '复习' };
}
</script>

<template>
  <div class="panel">
    <div class="panel-head">
      <h2>
        <button class="btn ghost back-btn" @click="setView('decks')">← 词库</button>
        {{ activeDeck?.name || '单词列表' }}
      </h2>
      <button class="btn ghost" @click="setView('import')">导入到本词库</button>
    </div>
    <div class="toolbar">
      <input
        v-model="search"
        class="search"
        type="search"
        placeholder="搜索单词或释义…"
        @input="onSearch"
      />
      <div class="chips">
        <button
          v-for="f in filters"
          :key="f.key"
          class="chip"
          :class="{ active: filter === f.key }"
          @click="pick(f.key)"
        >
          {{ f.label }}<span class="n">{{ counts[f.key] }}</span>
        </button>
      </div>
    </div>

    <div v-if="!filtered.length" class="empty">没有匹配的单词</div>

    <div v-else class="word-table">
      <div class="wt-head">
        <div>单词</div>
        <div>释义</div>
        <div>分组</div>
        <div>下次复习</div>
        <div />
      </div>
      <div v-for="w in shown" :key="w.id" class="wt-row">
        <div class="w-word">
          {{ w.word }}
          <span v-if="w.ipa" class="ipa">/ {{ w.ipa }} /</span>
        </div>
        <div class="w-mean">{{ w.meaning || '—' }}</div>
        <div><span class="tag" :class="tagOf(w).cls">{{ tagOf(w).text }}</span></div>
        <div class="w-due" :class="{ today: w.group === 'review' && w.due && w.due <= today }">
          {{ w.group === 'new' ? '—' : fmtDate(w.due) }}
        </div>
        <div class="w-ops">
          <button class="icon-btn" title="朗读" @click="onSpeak(w)">🔊</button>
          <button class="icon-btn" title="放回新词库" @click="onReset(w.id)">↺</button>
          <button class="icon-btn" title="删除" @click="onDelete(w.id)">✕</button>
        </div>
      </div>
    </div>

    <div class="more-wrap">
      <button v-if="left > 0" class="btn ghost" @click="limit += 100">
        加载更多（还有 {{ left }} 个）
      </button>
    </div>
  </div>
</template>
