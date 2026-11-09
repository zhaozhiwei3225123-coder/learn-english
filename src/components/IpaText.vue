<script setup lang="ts">
import { ref, watch } from 'vue';
import { state } from '../store/vocab';
import { getIpa, voiceLang } from '../lib/ipa';

const props = defineProps<{ word: string }>();

const ipa = ref('');

watch(
  () => [props.word, state.settings.kokoroVoice] as const,
  async ([word, voice]) => {
    ipa.value = '';
    if (!word) return;
    const text = await getIpa(word, voiceLang(voice)).catch(() => '');
    // 单词已经切走时丢弃旧结果
    if (props.word === word) ipa.value = text;
  },
  { immediate: true }
);
</script>

<template>
  <span v-if="ipa" class="ipa" :title="ipa">/{{ ipa }}/</span>
</template>
