<script setup lang="ts">
import { computed } from 'vue';
import { state, createDeck, renameDeck, removeDeck, setActiveDeck } from '../store/vocab';
import { setView, wordFilter } from '../store/ui';
import { toast } from '../store/toast';

const cards = computed(() =>
  state.decks.map((d) => {
    let newC = 0;
    let reviewC = 0;
    let masteredC = 0;
    for (const w of state.words) {
      if (w.deckId !== d.id) continue;
      if (w.group === 'new') newC++;
      else if (w.group === 'mastered') masteredC++;
      else reviewC++;
    }
    return { ...d, total: newC + reviewC + masteredC, newC, reviewC, masteredC };
  })
);

function open(id: string) {
  setActiveDeck(id);
  wordFilter.value = 'all';
  setView('words');
}

function importInto(id: string) {
  setActiveDeck(id);
  setView('import');
}

function onCreate() {
  const name = window.prompt('新词库名称（例如：六级核心词）');
  if (!name || !name.trim()) return;
  const deck = createDeck(name);
  if (deck) toast(`已新建词库「${deck.name}」`);
}

function onRename(id: string, name: string) {
  const next = window.prompt('修改词库名称', name);
  if (!next || !next.trim()) return;
  renameDeck(id, next);
  toast('词库名称已更新');
}

function onRemove(id: string, name: string) {
  const count = state.words.filter((w) => w.deckId === id).length;
  if (!confirm(`删除词库「${name}」及其 ${count} 个单词和学习记录？`)) return;
  if (!removeDeck(id)) {
    toast('至少保留一个词库');
    return;
  }
  toast('词库已删除');
}
</script>

<template>
  <div class="panel">
    <div class="panel-head">
      <h2>我的词库</h2>
      <button class="btn ghost" @click="onCreate">＋ 新建词库</button>
    </div>
    <p class="hint">
      点击词库卡片进入单词列表；点「导入」把 Excel 加到对应词库；学习、复习和统计都只针对当前词库。
    </p>

    <div class="deck-grid">
      <div
        v-for="d in cards"
        :key="d.id"
        class="deck-card"
        :class="{ current: d.id === state.activeDeckId }"
        @click="open(d.id)"
      >
        <div class="dc-top">
          <span class="dc-name">{{ d.name }}</span>
          <span v-if="d.id === state.activeDeckId" class="tag mastered">当前</span>
        </div>
        <div class="dc-meta">
          <span>共 <b>{{ d.total }}</b> 词</span>
          <span>新词 <b>{{ d.newC }}</b></span>
          <span>复习 <b>{{ d.reviewC }}</b></span>
          <span>已掌握 <b>{{ d.masteredC }}</b></span>
        </div>
        <div class="dc-ops">
          <button class="btn ghost" @click.stop="open(d.id)">查看单词</button>
          <button class="btn ghost" @click.stop="importInto(d.id)">导入</button>
          <button class="btn ghost" @click.stop="onRename(d.id, d.name)">重命名</button>
          <button
            class="btn ghost"
            :disabled="state.decks.length <= 1"
            @click.stop="onRemove(d.id, d.name)"
          >
            删除
          </button>
        </div>
      </div>

      <button class="deck-card new" @click="onCreate">＋ 新建词库</button>
    </div>
  </div>
</template>
