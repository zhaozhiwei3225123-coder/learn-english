<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue';
import { state, deckWords, addEntries } from '../store/vocab';
import { session, startReadingSession, endSession } from '../store/session';
import {
  article,
  analyzed,
  paraGroups,
  paraZh,
  zhOpen,
  zhLoading,
  toggleParaZh,
  translateAllPara,
  quiz,
  quizPicks,
  quizLoading,
  quizScore,
  quizDone,
  makeQuiz,
  pickQuizOption,
  resetQuiz,
  readingStats,
  studyWords,
  includeMastered,
  picked,
  gloss,
  glossLoading,
  glossError,
  retryGloss,
  refreshPicked,
  analyze,
  pickPiece,
  pickSelection,
  closePick,
  dailyList,
  cetLevel,
  cetTopic,
  findDaily,
  ensureDaily,
  note,
  noteLoading,
  setNote,
  type DailyItem,
  type ArticlePiece,
} from '../store/reading';
import { speak } from '../lib/speech';
import {
  annotateArticle,
  hasApiKey,
  resolveConfig,
  CET_LEVELS,
  CET_TOPICS,
  type CetLevel,
} from '../lib/ai';
import { toast } from '../store/toast';
import StudySession from './StudySession.vue';

const showPicked = computed(() => !!picked.value);
const unmasteredCount = computed(
  () => studyWords.value.filter((w) => w.group !== 'mastered').length
);

const inReadingSession = computed(
  () => !!session.current && session.current.mode === 'reading'
);

/* ------------------------------------------------------- 今日一篇（DailyRead） */

const dailyLoading = ref(false);
/** 生成失败的原因，直接显示在卡片上，不用去翻 toast */
const dailyError = ref('');
const showSources = ref(false);
const showHistory = ref(false);
/** 这一篇是从哪来的，抓到后显示在文章上方 */
const from = ref<{ label: string; url: string } | null>(null);

/** 当前难度的今日文章 */
const current = computed(() => findDaily());

/** 找文章网站清单：实在想自己挑的时候用 */
const SOURCES = [
  {
    name: 'News in Levels',
    url: 'https://www.newsinlevels.com/',
    level: '入门',
    tone: 'easy',
    note: '每天更新，同一篇分 Level 1/2/3',
  },
  {
    name: 'VOA Learning English',
    url: 'https://learningenglish.voanews.com/',
    level: '入门',
    tone: 'easy',
    note: '慢速英语，每篇都有文字稿',
  },
  {
    name: 'ESL Fast 分级阅读',
    url: 'https://www.eslfast.com/gradedread1/',
    level: '入门',
    tone: 'easy',
    note: '1~5 级递进，都是几百词的短文',
  },
  {
    name: '简单英语维基',
    url: 'https://simple.wikipedia.org/',
    level: '入门',
    tone: 'easy',
    note: '只用基础词写的百科，主题随便挑',
  },
  {
    name: 'Breaking News English',
    url: 'https://breakingnewsenglish.com/',
    level: '进阶',
    tone: 'mid',
    note: '一篇新闻 7 个难度，还带练习',
  },
  {
    name: 'BBC Learning English',
    url: 'https://www.bbc.co.uk/learningenglish/',
    level: '进阶',
    tone: 'mid',
    note: '6 Minute English 附全文稿',
  },
  {
    name: '中国日报英语点津',
    url: 'https://language.chinadaily.com.cn/',
    level: '进阶',
    tone: 'mid',
    note: '中英对照，适合精读抠句子',
  },
  {
    name: 'TED 演讲文稿',
    url: 'https://www.ted.com/talks',
    level: '较难',
    tone: 'hard',
    note: '口语化但表达密集，开字幕稿读',
  },
  {
    name: 'The Guardian',
    url: 'https://www.theguardian.com/',
    level: '较难',
    tone: 'hard',
    note: '真实长文，和考试阅读最像',
  },
  {
    name: 'Project Gutenberg',
    url: 'https://www.gutenberg.org/',
    level: '较难',
    tone: 'hard',
    note: '公版小说，《爱丽丝》《福尔摩斯》',
  },
];

function friendlyError(err: unknown): string {
  const msg = err instanceof Error ? err.message : '';
  if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) {
    return '连不上 DeepSeek 接口，检查下网络再试';
  }
  return msg || '这篇没生成成功，再点一次试试';
}

function loadArticle(a: DailyItem): void {
  const name = a.titleZh || a.title || a.source;
  from.value = { label: `${name} · ${a.source}`, url: a.url };
  analyze(a.text);
  void nextTick(() => {
    document.querySelector('.read-stats')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
}

/** 生成 / 换一篇；force = 不管今天有没有，都重新写一篇 */
async function onDaily(force: boolean): Promise<void> {
  if (dailyLoading.value) return;
  if (!hasApiKey()) {
    dailyError.value = '要先生成文章，得在「设置」里填 DeepSeek API Key';
    return;
  }
  dailyLoading.value = true;
  dailyError.value = '';
  try {
    const it = await ensureDaily(force);
    loadArticle(it);
    toast(`已生成：${it.titleZh || it.title}（自带 ${it.quiz?.length ?? 0} 道题）`);
  } catch (err) {
    dailyError.value = friendlyError(err);
  } finally {
    dailyLoading.value = false;
  }
}

function switchLevel(lv: CetLevel): void {
  if (cetLevel.value === lv) return;
  cetLevel.value = lv;
  void onDaily(false);
}

function startDaily(it: DailyItem): void {
  loadArticle(it);
  const saved = [it.note && '解析', it.zh?.length && '译文', it.quiz?.length && '题目'].filter(Boolean);
  toast(
    saved.length
      ? `已打开：${it.titleZh || it.title || it.source}（含已存${saved.join(' / ')}）`
      : `已打开：${it.titleZh || it.title || it.source}`
  );
}

/** 进阅读页时，今天这篇还没生成就自动生成一篇 */
onMounted(() => {
  if (!current.value && hasApiKey()) void onDaily(false);
});

/* ------------------------------------------------------- AI 精读 */

async function onAnnotate(): Promise<void> {
  if (noteLoading.value) return;
  if (!article.value.trim()) {
    toast('先载入一篇才能精读');
    return;
  }
  const cfg = resolveConfig(state.settings);
  if (!cfg) {
    toast('先到「设置 → AI 造句练习」填 DeepSeek API Key');
    return;
  }
  noteLoading.value = true;
  try {
    const n = await annotateArticle({ text: article.value, config: cfg });
    setNote(n);
    toast(n.titleZh ? `精读完成，已存入往期：${n.titleZh}` : '精读完成，已存入往期');
  } catch (err) {
    toast(err instanceof Error ? err.message : '精读失败，稍后再试');
  } finally {
    noteLoading.value = false;
  }
}

/** 把 AI 挑的生词直接加进当前词库 */
function addNoteWords(): void {
  const n = note.value;
  if (!n?.words.length) return;
  const res = addEntries(
    n.words.map((w) => ({ word: w.word, meaning: w.zh, ipa: w.ipa })),
    '阅读精读'
  );
  toast(
    `已加进词库：新增 ${res.added} 个${res.skipped ? `，跳过 ${res.skipped} 个已有` : ''}`
  );
}

/** 段落译文展开 / 收起；第一次点会一次请求翻好全篇 */
async function onToggleZh(i: number): Promise<void> {
  try {
    await toggleParaZh(i);
  } catch (err) {
    toast(err instanceof Error ? err.message : '翻译失败，请重试');
  }
}

async function onTranslateAll(): Promise<void> {
  if (zhLoading.value) return;
  if (!article.value.trim()) {
    toast('先载入一篇文章');
    return;
  }
  try {
    await translateAllPara();
    toast('译文已生成，并存入往期');
  } catch (err) {
    toast(err instanceof Error ? err.message : '翻译失败，请重试');
  }
}

async function onMakeQuiz(): Promise<void> {
  if (quizLoading.value) return;
  if (!article.value.trim()) {
    toast('先载入一篇文章');
    return;
  }
  try {
    await makeQuiz();
    toast(`出了 ${quiz.value?.length ?? 5} 道题，已存入往期`);
  } catch (err) {
    toast(err instanceof Error ? err.message : '出题失败，请重试');
  }
}

/** 已经有题就滚到题目，没有才现场出题 */
function onQuizAction(): void {
  if (quiz.value?.length) {
    document.querySelector('.quiz-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  void onMakeQuiz();
}

function onStart(): void {
  const ids = studyWords.value.map((w) => w.id);
  if (!ids.length) {
    toast('这篇文章里没有可学的词');
    return;
  }
  endSession();
  if (startReadingSession(ids)) {
    toast(`开始学习这篇文章里的 ${ids.length} 个词`);
  }
}

function onSpeak(w: { word: string }): void {
  void speak(w.word, {
    engine: state.settings.ttsEngine,
    voice: state.settings.kokoroVoice,
  });
}

/* ------------------------------------------------------- 取词与收录 */

/** 刚刚是因为选中文字而取词，紧接着的 click 不要重复处理 */
let selectedAt = 0;

const ipaOf = computed(() => picked.value?.word?.ipa || gloss.value?.ipa || '');

/** 点词：如果刚选中过文字，这次点击跳过，避免把选区又拆成单词 */
function onWordClick(p: ArticlePiece): void {
  if (Date.now() - selectedAt < 300) return;
  pickPiece(p);
}

function onSelectionEnd(ev: MouseEvent | TouchEvent): void {
  const host = ev.currentTarget as HTMLElement | null;
  if (!host) return;
  // 手机上 touchend 早于选区更新，等一拍再读
  if (ev.type === 'touchend') setTimeout(() => readSelection(host), 40);
  else readSelection(host);
}

/** 读一次选区：去掉首尾标点，最多 4 个词，太长或含中文就忽略 */
function readSelection(host: HTMLElement): void {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.anchorNode) return;
  if (!host.contains(sel.anchorNode)) return;
  const raw = sel
    .toString()
    .replace(/\s+/g, ' ')
    .replace(/^[^A-Za-z]+/, '')
    .replace(/[^A-Za-z]+$/, '')
    .trim();
  if (!raw || raw.length > 40) return;
  if (!/^[A-Za-z][A-Za-z'’-]*( [A-Za-z][A-Za-z'’-]*){0,3}$/.test(raw)) return;
  selectedAt = Date.now();
  pickSelection(raw);
  sel.removeAllRanges();
}

/** 把当前词（或选中的短语）加进词库，用 AI 给的音标和释义 */
function onAddPicked(): void {
  const p = picked.value;
  if (!p) return;
  const word = (gloss.value?.word || p.surface).trim();
  const meaning = gloss.value?.zh || '';
  if (!word || !meaning) {
    toast('还没查到释义，等一下再点');
    return;
  }
  const res = addEntries([{ word, meaning, ipa: gloss.value?.ipa || '' }], '阅读取词');
  refreshPicked();
  toast(res.added ? `已加入词库：${word}` : `${word} 已在词库，跳过`);
}

/** 词形提示：文章里是 running，词库是 run */
function formNote(): string {
  const p = picked.value;
  if (!p?.word) return '';
  const same = p.surface.toLowerCase() === p.word.word.toLowerCase();
  return same ? '' : `（文中为 ${p.surface}）`;
}
</script>

<template>
  <StudySession v-if="inReadingSession" />

  <template v-else>
    <div class="panel daily-panel">
      <div class="panel-head">
        <h2>DailyRead <span class="daily-sub">每天一篇</span></h2>
        <span class="pager-info">四六级仿真阅读 · 文章自带 5 道题</span>
      </div>

      <div class="daily-card">
        <div class="daily-banner">
          <span class="daily-tag">🎯 {{ cetLevel === 'cet4' ? 'CET-4' : 'CET-6' }} · 今日</span>
          <div class="daily-title">
            {{
              dailyLoading && !current
                ? '正在按考试风格写这一篇…'
                : current?.titleZh || current?.title || '今天这篇还没生成，点「写一篇」'
            }}
          </div>
          <div v-if="current?.titleZh && current.title" class="daily-title-en">
            {{ current.title }}
          </div>
        </div>

        <div class="daily-meta">
          <span class="daily-chip">{{ current ? `${current.words} 词` : '— 词' }}</span>
          <span class="daily-chip">{{ cetLevel === 'cet4' ? '四级难度' : '六级难度' }}</span>
          <span v-if="current?.quiz?.length" class="daily-chip accent">
            自带 {{ current.quiz.length }} 题
          </span>
          <span class="daily-chip dim">{{ current?.source || 'AI 仿真题' }}</span>
        </div>

        <div class="daily-bar">
          <div class="chips">
            <button
              v-for="lv in CET_LEVELS"
              :key="lv.key"
              class="chip"
              :class="{ active: cetLevel === lv.key }"
              @click="switchLevel(lv.key)"
            >
              {{ lv.label }}
            </button>
          </div>
          <div class="btn-row">
            <button class="btn ghost" :disabled="dailyLoading" @click="onDaily(true)">
              {{ dailyLoading ? '抓取中…' : current ? '换一篇' : '再抓一次' }}
            </button>
            <button
              class="btn primary"
              :disabled="!current"
              @click="current && startDaily(current)"
            >
              开始阅读
            </button>
          </div>
        </div>

        <div class="daily-topic">
          <input
            v-model="cetTopic"
            class="search find-input"
            placeholder="想读什么主题？如 睡眠 / 城市交通 / 人工智能，留空随机"
            @keydown.enter.prevent="onDaily(true)"
          />
          <button class="btn" :disabled="dailyLoading" @click="onDaily(true)">按主题写</button>
        </div>
        <div class="chips topic-chips">
          <button
            v-for="t in CET_TOPICS"
            :key="t"
            class="chip"
            :class="{ active: cetTopic === t }"
            @click="cetTopic = cetTopic === t ? '' : t"
          >
            {{ t }}
          </button>
        </div>

        <p v-if="dailyError" class="daily-err">
          ⚠️ {{ dailyError }}
          <button class="btn ghost mini-btn" :disabled="dailyLoading" @click="onDaily(true)">
            重试
          </button>
        </p>
      </div>

      <button class="find-toggle" @click="showHistory = !showHistory">
        {{ showHistory ? '收起往期' : `查看往期 · 已存 ${dailyList.length} 篇` }}
      </button>
      <div v-if="showHistory" class="daily-history">
        <p v-if="!dailyList.length" class="find-d">
          还没有往期。生成第一篇后，每天的文章、译文和题目都会留在这里，随时点开重做。
        </p>
        <button
          v-for="it in dailyList.slice(0, 30)"
          :key="it.key"
          class="his-item"
          @click="startDaily(it)"
        >
          <span class="his-date">{{ it.date.slice(5) }}</span>
          <span class="his-title">{{ it.titleZh || it.title || it.source }}</span>
          <span v-if="it.note" class="his-tag">解析</span>
          <span v-if="it.zh?.length" class="his-tag">译文</span>
          <span v-if="it.quiz?.length" class="his-tag">题</span>
          <span class="his-meta">{{ it.words }} 词</span>
        </button>
      </div>

      <button class="find-toggle" @click="showSources = !showSources">
        {{ showSources ? '收起网站清单' : '想自己挑？这 10 个网站最好用' }}
      </button>

      <div v-if="showSources" class="src-list">
        <a
          v-for="s in SOURCES"
          :key="s.url"
          class="src-item"
          :href="s.url"
          target="_blank"
          rel="noopener noreferrer"
        >
          <b>{{ s.name }}</b>
          <span class="src-lv" :class="s.tone">{{ s.level }}</span>
          <span class="src-d">{{ s.note }}</span>
        </a>
        <p class="src-tip">
          每日一篇是按四六级命题思路现写的；想读真实材料（外刊、慢速新闻、分级读物）就从上面这些站点自己挑，
          复制正文粘到别处也能读——只是现在 App 里不再自动抓词条了。
        </p>
      </div>
    </div>

    <div v-if="analyzed" class="panel">
      <div class="panel-head">
        <h2>文章</h2>
        <div class="chips">
          <span class="read-legend hit">未掌握 {{ readingStats.unmastered }}</span>
          <span class="read-legend know">已掌握 {{ readingStats.mastered }}</span>
        </div>
      </div>

      <p class="hint">
        <b>琥珀色是还没掌握的词</b>，灰色是已掌握。<b>点任意单词，或者用鼠标/手指选中一段文字</b>，就能看释义、听发音——词库里没有的词会结合这句话翻译，看着有用就一键加进词库。滑到底是这篇文章的阅读理解题。
      </p>

      <p v-if="from" class="article-src">
        <span>来源：{{ from.label }}</span>
        <a v-if="from.url" :href="from.url" target="_blank" rel="noopener noreferrer">看原文 ↗</a>
      </p>

      <div class="ai-read-bar">
        <button class="btn ghost" :disabled="noteLoading" @click="onAnnotate">
          {{ noteLoading ? 'AI 正在读…' : note ? '✨ 重新精读' : '✨ AI 精读' }}
        </button>
        <button class="btn ghost" :disabled="zhLoading" @click="onTranslateAll">
          {{ zhLoading ? '翻译中…' : paraZh.length ? '🌐 全部译文' : '🌐 中文翻译' }}
        </button>
        <button class="btn ghost" :disabled="quizLoading" @click="onQuizAction">
          {{
            quizLoading
              ? '出题中…'
              : quiz
                ? `📝 去做题 · ${quiz.length} 题`
                : '📝 阅读理解'
          }}
        </button>
        <span v-if="!hasApiKey()" class="coach-tip">需要在「设置」里填 DeepSeek API Key 才能用这些功能</span>
      </div>

      <div v-if="note" class="note-card">
        <div class="note-head">
          <span class="daily-chip">{{ note.topic || '精读' }}</span>
          <b class="note-title">{{ note.titleZh || '精读笔记' }}</b>
        </div>
        <p v-if="note.summary" class="note-sum">{{ note.summary }}</p>

        <div v-if="note.words.length" class="note-words">
          <div v-for="w in note.words" :key="w.word" class="note-word">
            <b>{{ w.word }}</b>
            <span v-if="w.ipa" class="ipa">/{{ w.ipa }}/</span>
            <span class="nw-zh">{{ w.zh }}</span>
            <button class="icon-btn mini" title="朗读" @click="onSpeak({ word: w.word })">
              🔊
            </button>
          </div>
        </div>
        <div v-if="note.words.length" class="note-actions">
          <button class="btn ghost" @click="addNoteWords">把这 {{ note.words.length }} 个生词加进词库</button>
        </div>

        <div v-if="note.sentence" class="note-sent">
          <div class="ns-tag">长难句</div>
          <div class="ns-en">{{ note.sentence.en }}</div>
          <div class="ns-zh">{{ note.sentence.zh }}</div>
          <div v-if="note.sentence.note" class="ns-note">{{ note.sentence.note }}</div>
        </div>
      </div>

      <div class="read-stats">
        <span>全文 <b>{{ readingStats.total }}</b> 词</span>
        <span>命中词库 <b>{{ readingStats.matched }}</b> 词</span>
        <span>不在词库 <b>{{ readingStats.notInDeck }}</b> 词</span>
      </div>

      <div class="article paras" @mouseup="onSelectionEnd" @touchend="onSelectionEnd">
        <div v-for="(g, gi) in paraGroups" :key="gi" class="para-card">
          <div class="para-body">
            <template v-for="(p, pi) in g.pieces" :key="pi">
              <span v-if="!p.isWord" class="rd-sep">{{ p.text }}</span>
              <button
                v-else-if="p.word"
                class="rd-w"
                :class="p.word.group === 'mastered' ? 'know' : 'hit'"
                :title="p.word.meaning"
                @click="onWordClick(p)"
              >
                {{ p.text }}
              </button>
              <button v-else class="rd-w plain" @click="onWordClick(p)">{{ p.text }}</button>
            </template>
          </div>
          <div class="para-foot">
            <button
              class="para-zh-btn"
              :class="{ open: zhOpen[gi] }"
              :disabled="zhLoading && !paraZh.length"
              @click="onToggleZh(gi)"
            >
              {{ zhOpen[gi] ? '收起译文' : zhLoading && !paraZh.length ? '翻译中…' : '译' }}
            </button>
          </div>
          <p v-if="zhOpen[gi] && paraZh[gi]" class="para-zh">{{ paraZh[gi] }}</p>
        </div>
      </div>

      <!-- 点词详情 -->
      <div v-if="showPicked && picked" class="picked">
        <div class="picked-head">
          <b>{{ picked.word?.word ?? gloss?.word ?? picked.surface }}</b>
          <span v-if="ipaOf" class="ipa">/ {{ ipaOf }} /</span>
          <span v-if="picked.word" class="pick-tag" :class="picked.word.group">
            {{ picked.word.group === 'mastered' ? '已掌握' : picked.word.group === 'new' ? '新词' : '复习中' }}
          </span>
          <span v-else class="pick-tag miss">词库外</span>
          <button class="icon-btn mini" title="朗读" @click="onSpeak({ word: picked.word?.word || picked.surface })">
            🔊
          </button>
          <button class="icon-btn mini picked-close" title="关闭" @click="closePick">✕</button>
        </div>

        <!-- 词库里有释义就直接用，没有（或在词库外）就交给 AI -->
        <p v-if="picked.word?.meaning" class="picked-mean">
          {{ picked.word.meaning }}
          <span v-if="formNote()" class="picked-form">{{ formNote() }}</span>
        </p>

        <p v-else-if="glossLoading" class="picked-mean dim">正在结合上下文查释义…</p>
        <template v-else-if="gloss">
          <p class="picked-mean">{{ gloss.zh }}</p>
          <p v-if="gloss.note" class="picked-note">{{ gloss.note }}</p>
        </template>
        <p v-else-if="glossError" class="picked-mean dim">
          {{ glossError }}
          <button class="mini-link" @click="retryGloss">重试</button>
        </p>

        <div class="picked-act">
          <button v-if="picked.word" class="btn ghost" disabled>已在词库</button>
          <button v-else class="btn primary" :disabled="!gloss" @click="onAddPicked">
            ＋ 加入词库
          </button>
          <span class="picked-tip">点单词或选中一段文字都能查，查到的词可直接入库</span>
        </div>
      </div>

      <!-- 阅读理解 -->
      <div v-if="quiz" class="quiz-card">
        <div class="quiz-head">
          <b>📝 阅读理解 · {{ quiz.length }} 题</b>
          <span class="pager-info">
            {{ quizDone ? `得分 ${quizScore} / ${quiz.length}` : '选出你认为对的选项，选完立刻判分' }}
          </span>
          <button class="btn ghost" @click="resetQuiz">重做</button>
          <button class="btn ghost" :disabled="quizLoading" @click="onMakeQuiz">
            {{ quizLoading ? '出题中…' : '换一批题' }}
          </button>
        </div>

        <div v-for="(q, qi) in quiz" :key="qi" class="quiz-q">
          <div class="qq-t">{{ qi + 1 }}. {{ q.q }}</div>
          <div class="qq-ops">
            <button
              v-for="(op, oi) in q.options"
              :key="oi"
              class="quiz-op"
              :class="{
                right: quizPicks[qi] >= 0 && oi === q.answer,
                wrong: quizPicks[qi] === oi && oi !== q.answer,
              }"
              :disabled="quizPicks[qi] >= 0"
              @click="pickQuizOption(qi, oi)"
            >
              <span class="qq-letter">{{ String.fromCharCode(65 + oi) }}</span>
              {{ op }}
            </button>
          </div>
          <div v-if="quizPicks[qi] >= 0" class="qq-explain">
            <span :class="quizPicks[qi] === q.answer ? 'ok' : 'no'">
              {{
                quizPicks[qi] === q.answer
                  ? '✓ 答对了'
                  : `✗ 正确答案 ${String.fromCharCode(65 + q.answer)}`
              }}
            </span>
            {{ q.explain }}
          </div>
        </div>
      </div>

      <div class="read-actions">
        <label class="read-check">
          <input v-model="includeMastered" type="checkbox" />
          包含已掌握的词
        </label>
        <div class="btn-row">
          <span class="pager-info">可学 {{ studyWords.length }} 词（未掌握 {{ unmasteredCount }}）</span>
          <button class="btn primary" :disabled="!studyWords.length" @click="onStart">
            生成学习集 · {{ studyWords.length }} 词
          </button>
        </div>
      </div>
    </div>

    <div v-if="!analyzed" class="panel">
      <div class="empty">
        还没有今天的文章。点上面的「写一篇」——会按
        {{ cetLevel === 'cet4' ? '四级' : '六级' }}难度写一篇约
        {{ cetLevel === 'cet4' ? 300 : 400 }} 词的阅读，并配好 5 道题。
        {{ deckWords.length ? `当前词库有 ${deckWords.length} 个词，生成后能看到命中多少。` : '先导入词库，标词才准。' }}
      </div>
    </div>
  </template>
</template>
