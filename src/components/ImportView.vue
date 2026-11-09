<script setup lang="ts">
import { computed, ref } from 'vue';
import type { ParsedEntry } from '../types';
import { parseVocabExcel } from '../lib/excelParser';
import { makeId } from '../lib/persist';
import { state, addEntries, activeDeck, deckWords } from '../store/vocab';
import { toast } from '../store/toast';
import { fmtDateTime } from '../lib/date';

interface PreviewState {
  entries: ParsedEntry[];
  source: string;
}

interface PreviewItem {
  entry: ParsedEntry;
  /** new = 词库没有；ipa = 词库已有但缺音标 */
  mode: 'new' | 'ipa';
}

const fileInput = ref<HTMLInputElement | null>(null);
const dragging = ref(false);
const parsing = ref(false);
const status = ref<{ text: string; err: boolean } | null>(null);
const preview = ref<PreviewState | null>(null);

/* 预览：只列出当前词库可新增的词，以及词库已有但缺音标、可以补音标的词 */
const previewItems = computed<PreviewItem[]>(() => {
  if (!preview.value) return [];
  const existing = new Map(deckWords.value.map((w) => [makeId(w.word), w]));
  const seen = new Set<string>();
  const list: PreviewItem[] = [];
  for (const e of preview.value.entries) {
    const id = makeId(e.word);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const found = existing.get(id);
    if (found) {
      if (e.ipa && !found.ipa) list.push({ entry: e, mode: 'ipa' });
      continue;
    }
    list.push({ entry: e, mode: 'new' });
  }
  return list;
});

const newCount = computed(() => previewItems.value.filter((i) => i.mode === 'new').length);
const ipaCount = computed(() => previewItems.value.filter((i) => i.mode === 'ipa').length);

const dupCount = computed(() =>
  preview.value ? preview.value.entries.length - previewItems.value.length : 0
);

function setStatus(text: string, err = false) {
  status.value = { text, err };
}

function openPicker() {
  fileInput.value?.click();
}

function onDrop(e: DragEvent) {
  e.preventDefault();
  dragging.value = false;
  if (e.dataTransfer?.files) handleFiles(e.dataTransfer.files);
}

function onPick(e: Event) {
  const input = e.target as HTMLInputElement;
  if (input.files) handleFiles(input.files);
  input.value = '';
}

async function handleFiles(fileList: FileList) {
  const files = Array.from(fileList).filter((f) => /\.(xlsx|xls|xlsm|csv)$/i.test(f.name));
  if (!files.length) {
    toast('请选择 Excel 文件（.xlsx / .xls / .csv）');
    return;
  }

  parsing.value = true;
  preview.value = null;
  setStatus('正在解析…');

  const all: ParsedEntry[] = [];

  for (const f of files) {
    try {
      const res = await parseVocabExcel(f);
      all.push(...res.entries);
      setStatus(
        `解析 ${f.name} 完成：${res.sheets} 个工作表，${res.entries.length} 个单词`
      );
    } catch (err) {
      console.error(err);
      setStatus(`解析 ${f.name} 失败：${(err as Error).message}`, true);
    }
  }

  parsing.value = false;

  if (!all.length) {
    setStatus('没有解析到单词，请检查第一列是否为单词、第二列是否为释义', true);
    return;
  }
  preview.value = { entries: all, source: files.map((f) => f.name).join(', ') };
}

function confirmImport() {
  if (!preview.value) return;
  // 传入完整解析结果：新词新增；已在词库的词只在缺音标时补上音标
  const res = addEntries(preview.value.entries, preview.value.source || '导入');
  const extra = res.updated ? `，补充音标 ${res.updated} 个` : '';
  toast(`导入完成：新增 ${res.added} 个${extra}，跳过 ${res.skipped} 个`);
  cancel();
}

function cancel() {
  preview.value = null;
  status.value = null;
}
</script>

<template>
  <div class="panel">
    <h2>导入 Excel 单词表</h2>
    <p class="hint">
      当前导入到词库：<b>{{ activeDeck?.name }}</b>（可在顶部下拉框切换词库）。支持
      <code>.xlsx / .xls / .csv</code>：<b>第一列为单词，第二列为释义，第三列为音标（可选）</b>，表头行
      （如「单词 / 释义 / 音标」）会自动跳过。解析在本地浏览器完成，不上传任何数据；重复单词不会新增，
      若词库里的旧单词缺音标，会用这一列补上。
    </p>

    <div
      class="dropzone"
      :class="{ over: dragging }"
      @click="openPicker"
      @dragover.prevent="dragging = true"
      @dragleave="dragging = false"
      @drop="onDrop"
    >
      <input
        ref="fileInput"
        type="file"
        accept=".xlsx,.xls,.xlsm,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
        multiple
        hidden
        @change="onPick"
      />
      <div class="dz-icon">＋</div>
      <div class="dz-main">
        拖拽 Excel 到这里，或 <button class="link" type="button" @click.stop="openPicker">选择文件</button>
      </div>
      <div class="dz-sub">可一次选择多个文件，自动合并去重</div>
    </div>

    <div v-if="status" class="status" :class="{ err: status.err }">{{ status.text }}</div>

    <div v-if="preview" class="preview">
      <div class="preview-head">
        <span>
          共解析 <b>{{ preview.entries.length }}</b> 条，可新增
          <b>{{ newCount }}</b> 条，补充音标 <b>{{ ipaCount }}</b> 条，已存在/重复
          <b>{{ dupCount }}</b> 条
        </span>
        <div class="preview-actions">
          <button class="btn ghost" @click="cancel">取消</button>
          <button
            class="btn primary"
            :disabled="!previewItems.length || parsing"
            @click="confirmImport"
          >
            确认导入
          </button>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>#</th><th>单词</th><th>释义</th><th>音标</th></tr>
          </thead>
          <tbody>
            <tr v-for="(item, i) in previewItems.slice(0, 300)" :key="i">
              <td class="idx">{{ i + 1 }}</td>
              <td class="w">
                {{ item.entry.word }}
                <span v-if="item.mode === 'ipa'" class="tag mastered">补音标</span>
              </td>
              <td class="m">{{ item.entry.meaning }}</td>
              <td class="m">{{ item.entry.ipa ? `/ ${item.entry.ipa} /` : '—' }}</td>
            </tr>
            <tr v-if="!previewItems.length">
              <td colspan="4" class="m">没有可新增的单词</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>

  <div class="panel">
    <h2>导入记录</h2>
    <div v-if="!state.imports.length" class="empty">还没有导入记录</div>
    <div v-else class="history">
      <div v-for="(i, idx) in state.imports" :key="idx" class="item">
        <span>
          <b>{{ i.source }}</b> · 新增 {{ i.added }}<span v-if="i.updated"> · 补音标 {{ i.updated }}</span> · 重复
          {{ i.skipped }}
        </span>
        <span>{{ fmtDateTime(i.at) }}</span>
      </div>
    </div>
  </div>
</template>
