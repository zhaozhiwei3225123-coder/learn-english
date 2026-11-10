<script setup lang="ts">
import { ref } from 'vue';
import {
  state,
  save,
  resetAllProgress,
  clearAll,
  replaceAll,
  deckCount,
  createDeck,
  renameDeck,
  removeDeck,
  setActiveDeck,
} from '../store/vocab';
import { endSession } from '../store/session';
import { toast } from '../store/toast';
import { kokoroState, speakKokoro } from '../lib/kokoro';
import { todayKey } from '../lib/date';
import { getApiKey, resolveConfig, setApiKey, testConnection } from '../lib/ai';

const backupInput = ref<HTMLInputElement | null>(null);
const testingKokoro = ref(false);
const newDeckName = ref('');

/* ---------------------------------------------------------- AI 批改 */
const apiKeyInput = ref(getApiKey());
const hasKey = ref(!!getApiKey());
const showKey = ref(false);
const testingAi = ref(false);
const aiState = ref('');

function onSaveKey() {
  setApiKey(apiKeyInput.value);
  hasKey.value = !!getApiKey();
  apiKeyInput.value = getApiKey();
  aiState.value = '';
  toast(hasKey.value ? 'API Key 已保存在本机' : '已清除 API Key');
}

async function onTestAi() {
  const cfg = resolveConfig(state.settings, apiKeyInput.value);
  if (!cfg) {
    toast('先填一个 API Key');
    return;
  }
  testingAi.value = true;
  aiState.value = '';
  try {
    const msg = await testConnection(cfg);
    setApiKey(apiKeyInput.value);
    hasKey.value = true;
    aiState.value = msg;
    toast('连接正常，可以开始造句批改了');
  } catch (err) {
    aiState.value = (err as Error).message;
    toast((err as Error).message, 3600);
  } finally {
    testingAi.value = false;
  }
}

/* ---------------------------------------------------------- 词库管理 */

function onCreateDeck() {
  const deck = createDeck(newDeckName.value);
  if (!deck) {
    toast('请输入词库名称');
    return;
  }
  newDeckName.value = '';
  endSession();
  toast(`已新建词库「${deck.name}」`);
}

function onSwitchDeck(id: string) {
  endSession();
  setActiveDeck(id);
  toast('已切换词库');
}

function onRenameDeck(id: string, name: string) {
  const next = window.prompt('修改词库名称', name);
  if (!next || !next.trim()) return;
  renameDeck(id, next);
  toast('词库名称已更新');
}

function onRemoveDeck(id: string, name: string) {
  const count = deckCount(id);
  if (!confirm(`删除词库「${name}」及其 ${count} 个单词和学习记录？`)) return;
  if (!removeDeck(id)) {
    toast('至少保留一个词库');
    return;
  }
  endSession();
  toast('词库已删除');
}

function onSettingChange() {
  save();
  toast('设置已保存');
}

async function testKokoro() {
  testingKokoro.value = true;
  try {
    await speakKokoro('vocabulary', state.settings.kokoroVoice);
    toast('Kokoro 发音正常');
  } catch (err) {
    console.error(err);
  } finally {
    testingKokoro.value = false;
  }
}

function exportBackup() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `vocab-backup-${todayKey()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast('备份已导出');
}

async function onBackupPicked(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  try {
    const obj = JSON.parse(await file.text());
    if (!obj || !Array.isArray(obj.words)) throw new Error('文件格式不正确');
    if (!confirm(`将用备份覆盖当前数据（${obj.words.length} 个单词），确定？`)) return;
    await replaceAll(obj);
    endSession();
    toast('备份已恢复');
  } catch (err) {
    alert('恢复失败：' + (err as Error).message);
  }
}

function onResetProgress() {
  if (!confirm('重置所有单词的学习进度（单词保留，学习记录清空），确定？')) return;
  resetAllProgress();
  endSession();
  toast('学习进度已重置');
}

function onClearAll() {
  if (!confirm('清空全部数据（单词、记录、设置），确定？')) return;
  clearAll(state.settings);
  endSession();
  toast('数据已清空');
}
</script>

<template>
  <div class="panel">
    <h2>每日计划</h2>
    <div class="form-grid">
      <label class="field">
        <span>每天新学单词数</span>
        <input v-model.number="state.settings.dailyNew" type="number" min="0" max="200" @change="onSettingChange" />
      </label>
      <label class="field">
        <span>每天复习单词数</span>
        <input v-model.number="state.settings.dailyReview" type="number" min="0" max="500" @change="onSettingChange" />
      </label>
      <label class="field">
        <span>首次复习间隔（天）</span>
        <input
          v-model.number="state.settings.reviewDelayDays"
          type="number"
          min="1"
          max="30"
          @change="onSettingChange"
        />
      </label>
      <label class="field">
        <span>卡片方向</span>
        <select v-model="state.settings.direction" @change="onSettingChange">
          <option value="en2zh">英 → 中（看单词想释义）</option>
          <option value="zh2en">中 → 英（看释义想单词）</option>
        </select>
      </label>
      <label class="field checkbox">
        <input v-model="state.settings.autoSpeak" type="checkbox" @change="onSettingChange" />
        <span>认词时自动朗读单词</span>
      </label>
    </div>
    <p class="hint">
      复习按间隔阶梯推进：答「认识」后依次间隔 {{ state.settings.reviewDelayDays }}、4、7、15、30、60、90
      天；答「模糊」明天再来一次、阶段原地不动；答「不认识」阶段回退两档，今天继续考。
    </p>
    <p class="hint">修改后立即生效，下一次开始学习时应用。</p>
  </div>

  <div class="panel">
    <h2>词库管理</h2>
    <p class="hint">
      可以创建多个词库（例如「四级核心词」「雅思词汇」）。学习、复习、统计和导入都只针对当前词库，
      不同词库的学习进度互相独立。
    </p>
    <div class="deck-list">
      <div
        v-for="d in state.decks"
        :key="d.id"
        class="deck-row"
        :class="{ active: d.id === state.activeDeckId }"
      >
        <div class="deck-info">
          <b>{{ d.name }}</b>
          <span class="deck-count">{{ deckCount(d.id) }} 个单词</span>
        </div>
        <span v-if="d.id === state.activeDeckId" class="tag mastered">当前</span>
        <div class="deck-ops">
          <button class="btn ghost" :disabled="d.id === state.activeDeckId" @click="onSwitchDeck(d.id)">
            切换
          </button>
          <button class="btn ghost" @click="onRenameDeck(d.id, d.name)">重命名</button>
          <button
            class="btn ghost"
            :disabled="state.decks.length <= 1"
            @click="onRemoveDeck(d.id, d.name)"
          >
            删除
          </button>
        </div>
      </div>
    </div>
    <div class="btn-row deck-new">
      <input
        v-model="newDeckName"
        class="search"
        placeholder="新词库名称，如「六级核心词」"
        @keydown.enter="onCreateDeck"
      />
      <button class="btn primary" @click="onCreateDeck">新建词库</button>
    </div>
  </div>

  <div class="panel">
    <h2>发音</h2>
    <div class="form-grid">
      <label class="field">
        <span>发音引擎</span>
        <select v-model="state.settings.ttsEngine" @change="onSettingChange">
          <option value="kokoro">Kokoro 神经网络（高音质）</option>
          <option value="system">系统语音（轻量）</option>
        </select>
      </label>
      <label v-if="state.settings.ttsEngine === 'kokoro'" class="field">
        <span>Kokoro 音色</span>
        <select v-model="state.settings.kokoroVoice" @change="onSettingChange">
          <option value="af_heart">Heart · 美式女声（推荐）</option>
          <option value="af_bella">Bella · 美式女声</option>
          <option value="af_nicole">Nicole · 美式女声</option>
          <option value="am_michael">Michael · 美式男声</option>
          <option value="bf_emma">Emma · 英式女声</option>
          <option value="bm_george">George · 英式男声</option>
        </select>
      </label>
    </div>
    <p v-if="state.settings.ttsEngine === 'kokoro'" class="hint">
      使用 kokoro-js 在本机离线合成发音，模型文件随项目一起加载（约 90MB），无需联网。
      首次加载需要几秒到十几秒，加载期间或失败时自动回退系统语音。
    </p>
    <div v-if="state.settings.ttsEngine === 'kokoro'" class="btn-row">
      <button
        class="btn"
        :disabled="testingKokoro || kokoroState.phase === 'loading'"
        @click="testKokoro"
      >
        {{
          kokoroState.phase === 'loading'
            ? '加载中…'
            : kokoroState.phase === 'ready'
              ? '试听 Kokoro'
              : '加载并试听'
        }}
      </button>
      <span class="hint" style="margin: 0; align-self: center">{{ kokoroState.text }}</span>
    </div>
  </div>

  <div class="panel">
    <h2>AI 造句练习</h2>
    <p class="hint">
      「造句」页由 DeepSeek 实时出题（中文句子），你写英文，它按「意思准确 / 语法 / 地道程度」打分并逐条指出问题。
      浏览器直连接口，不需要后端；Key 只保存在本机浏览器，<b>不会写进导出的备份文件</b>。
      每句约消耗几百 token，按 DeepSeek 官方计费。
    </p>
    <div class="form-grid">
      <label class="field">
        <span>API Key{{ hasKey ? '（已配置）' : '' }}</span>
        <input
          v-model="apiKeyInput"
          :type="showKey ? 'text' : 'password'"
          placeholder="sk-..."
          autocomplete="off"
          spellcheck="false"
          @change="onSaveKey"
        />
      </label>
      <label class="field">
        <span>接口地址</span>
        <input
          v-model="state.settings.aiBaseUrl"
          placeholder="https://api.deepseek.com"
          spellcheck="false"
          @change="onSettingChange"
        />
      </label>
      <label class="field">
        <span>模型</span>
        <input
          v-model="state.settings.aiModel"
          placeholder="deepseek-chat"
          spellcheck="false"
          @change="onSettingChange"
        />
      </label>
      <label class="field checkbox">
        <input v-model="showKey" type="checkbox" />
        <span>显示 Key</span>
      </label>
    </div>
    <div class="btn-row">
      <button class="btn" @click="onSaveKey">保存 Key</button>
      <button class="btn primary" :disabled="testingAi" @click="onTestAi">
        {{ testingAi ? '测试中…' : '测试连接' }}
      </button>
      <span class="hint inline">{{ aiState || (hasKey ? 'Key 已保存' : '尚未配置 Key') }}</span>
    </div>
    <p class="hint">
      也支持任何 OpenAI 兼容接口：把「接口地址」换成如 <code>https://api.openai.com/v1</code>，
      模型填对应名称即可。
    </p>
  </div>

  <div class="panel">
    <h2>数据备份</h2>
    <p class="hint">所有数据保存在本机浏览器 IndexedDB 中（不受 localStorage 5MB 限制）。换电脑 / 清理浏览器前请先导出备份。</p>
    <div class="btn-row">
      <button class="btn" @click="exportBackup">导出备份 JSON</button>
      <button class="btn" @click="backupInput?.click()">导入备份 JSON</button>
      <input ref="backupInput" type="file" accept="application/json,.json" hidden @change="onBackupPicked" />
    </div>
  </div>

  <div class="panel danger">
    <h2>危险操作</h2>
    <div class="btn-row">
      <button class="btn danger" @click="onResetProgress">重置学习进度（保留单词）</button>
      <button class="btn danger" @click="onClearAll">清空全部数据</button>
    </div>
  </div>
</template>
