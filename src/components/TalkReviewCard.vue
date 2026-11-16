<script setup lang="ts">
import { computed } from 'vue';
import type { TalkSession } from '../types';
import { speak } from '../lib/speech';

const props = defineProps<{ session: TalkSession }>();
defineEmits<{ (e: 'close'): void; (e: 'again'): void }>();

const review = computed(() => props.session.review);

const myTurns = computed(() => props.session.turns.filter((t) => t.role === 'me'));

function scoreClass(score: number): string {
  if (score >= 85) return 'good';
  if (score >= 65) return 'mid';
  return 'bad';
}

function verdict(score: number): string {
  if (score >= 90) return '开口就像老手';
  if (score >= 80) return '事情办得漂亮';
  if (score >= 65) return '能沟通，还能更顺';
  if (score >= 50) return '勉强说清了';
  return '再练一次会好很多';
}

function fmtDate(at: number): string {
  const d = new Date(at);
  return `${d.getMonth() + 1}-${String(d.getDate()).padStart(2, '0')} ${String(
    d.getHours()
  ).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function say(text: string): void {
  void speak(text, { engine: 'kokoro' });
}
</script>

<template>
  <div class="talk-review">
    <div class="res-top">
      <span class="score" :class="scoreClass(review?.score ?? 0)">{{ review?.score ?? 0 }}</span>
      <div class="res-meta">
        <b>{{ verdict(review?.score ?? 0) }}</b>
        <p class="res-comment">{{ review?.comment }}</p>
        <p class="talk-review-meta">
          {{ session.partner }} · 你说 {{ myTurns.length }} 句 · {{ fmtDate(session.startedAt) }}
        </p>
      </div>
    </div>

    <div v-if="session.targets.length" class="res-block">
      <div class="res-label">目标生词</div>
      <div class="chips">
        <span
          v-for="t in session.targets"
          :key="t.word"
          class="chip talk-word"
          :class="{ hit: review?.usedTargets.includes(t.word) }"
        >
          {{ review?.usedTargets.includes(t.word) ? '✓' : '○' }} {{ t.word }}
        </span>
      </div>
      <p v-if="review?.missedTargets.length" class="hint talk-missed">
        没用上的：{{ review.missedTargets.join('、') }}——下次聊同类场景时刻意带一句。
      </p>
    </div>

    <div v-if="review?.upgrades.length" class="res-block">
      <div class="res-label">更地道的说法</div>
      <ul class="talk-upgrades">
        <li v-for="(u, i) in review.upgrades" :key="i">
          <div class="talk-up-line">
            <span class="talk-up-from">{{ u.from }}</span>
            <span class="issue-arrow">→</span>
            <span class="talk-up-to">{{ u.to }}</span>
            <button class="talk-say" title="朗读" @click="say(u.to)">🔊</button>
          </div>
          <p v-if="u.why" class="issue-why">{{ u.why }}</p>
        </li>
      </ul>
    </div>

    <div v-if="review?.issues.length" class="res-block">
      <div class="res-label">要注意的地方</div>
      <ul class="res-issues">
        <li v-for="(it, i) in review.issues" :key="i">
          <div class="issue-line">
            <span class="issue-type">{{ it.type }}</span>
            <span class="issue-bad">{{ it.bad || '—' }}</span>
            <span class="issue-arrow">→</span>
            <span class="issue-good">{{ it.good || '—' }}</span>
          </div>
          <p v-if="it.why" class="issue-why">{{ it.why }}</p>
        </li>
      </ul>
    </div>

    <div class="res-block">
      <div class="res-label">这轮对话</div>
      <div class="talk-replay">
        <div
          v-for="t in session.turns"
          :key="t.id"
          class="talk-replay-line"
          :class="t.role"
        >
          <span class="talk-replay-who">{{ t.role === 'them' ? session.partner : '我' }}</span>
          <span class="talk-replay-text">{{ t.en }}</span>
          <button v-if="t.role === 'them'" class="talk-say" @click="say(t.en)">🔊</button>
        </div>
      </div>
    </div>

    <div class="coach-again">
      <button class="btn ghost" @click="$emit('close')">返回</button>
      <button class="btn primary" @click="$emit('again')">再聊一个场景</button>
    </div>
  </div>
</template>
