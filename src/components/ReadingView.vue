<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue';
import { state, deckWords, addEntries } from '../store/vocab';
import { session, startReadingSession, endSession } from '../store/session';
import {
  articleText,
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
  analyze,
  clearArticle,
  archiveArticle,
  pickPiece,
  closePick,
  dailyList,
  dailySource,
  newsLevel,
  wikiSimple,
  findDaily,
  ensureDaily,
  note,
  noteLoading,
  setNote,
  type DailyItem,
} from '../store/reading';
import { speak } from '../lib/speech';
import { fetchWiki, type NewsLevel } from '../lib/articles';
import { annotateArticle, hasApiKey, resolveConfig } from '../lib/ai';
import { toast } from '../store/toast';
import { setView } from '../store/ui';
import StudySession from './StudySession.vue';

const showPicked = computed(() => !!picked.value);
const unmasteredCount = computed(
  () => studyWords.value.filter((w) => w.group !== 'mastered').length
);
const sampleText = ref(
  'Paste any English here — an article, a podcast transcript, a page from a book.'
);

const inReadingSession = computed(
  () => !!session.current && session.current.mode === 'reading'
);

/* ------------------------------------------------------- 今日一篇（DailyRead） */

const NEWS_LEVELS: NewsLevel[] = [1, 2, 3];
const fetching = ref<'' | 'wiki'>('');
const dailyLoading = ref(false);
const wikiTopic = ref('');
const showSources = ref(false);
const showHistory = ref(false);
/** 这一篇是从哪来的，抓到后显示在文章上方 */
const from = ref<{ label: string; url: string } | null>(null);

/** 当前选中「来源 + 难度」对应的今日文章 */
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
  if (err instanceof DOMException && err.name === 'AbortError') {
    return '抓取超时，网络慢或者源站卡住了，再点一次';
  }
  const msg = err instanceof Error ? err.message : '';
  if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) {
    return '连不上这个源，先手动复制一段（下面有网站清单）';
  }
  return msg || '抓取失败，先手动复制一段吧';
}

function loadArticle(a: { title: string; text: string; source: string; url: string }): void {
  articleText.value = a.text;
  from.value = { label: a.title ? `${a.title} · ${a.source}` : a.source, url: a.url };
  analyze();
  void nextTick(() => {
    document.querySelector('.read-stats')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
}

/** 抓「今日一篇」；force = 换一篇 */
async function onDaily(force: boolean): Promise<void> {
  if (dailyLoading.value) return;
  dailyLoading.value = true;
  try {
    loadArticle(await ensureDaily(force));
  } catch (err) {
    toast(friendlyError(err));
  } finally {
    dailyLoading.value = false;
  }
}

function switchSource(s: 'news' | 'wiki'): void {
  if (dailySource.value === s) return;
  dailySource.value = s;
  void onDaily(false);
}

function switchLevel(lv: NewsLevel): void {
  if (dailySource.value !== 'news' || newsLevel.value === lv) return;
  newsLevel.value = lv;
  void onDaily(false);
}

function switchWikiMode(simple: boolean): void {
  if (dailySource.value !== 'wiki' || wikiSimple.value === simple) return;
  wikiSimple.value = simple;
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

/** 进阅读页时，今天这篇还没抓就自动抓 */
onMounted(() => {
  if (!current.value) void onDaily(false);
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

async function onFetchWiki(): Promise<void> {
  if (fetching.value) return;
  fetching.value = 'wiki';
  try {
    const a = await fetchWiki(wikiSimple.value, wikiTopic.value);
    archiveArticle(a);
    loadArticle(a);
    toast('已抓取并存进往期，可读完后生成学习集');
  } catch (err) {
    toast(friendlyError(err));
  } finally {
    fetching.value = '';
  }
}

function onAnalyze(): void {
  const text = articleText.value.trim();
  if (!text) {
    toast('先把一段英文粘进来');
    return;
  }
  // 自己粘的长文也收进往期，之后能在历史里翻回来（短句不占位置）
  if (text.length >= 200) {
    archiveArticle({ title: '', text, source: '手动粘贴', url: '' });
  }
  from.value = null;
  analyze();
}

function onClear(): void {
  clearArticle();
  articleText.value = '';
  from.value = null;
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
        <h2>DailyRead <span class="daily-sub">每天更新</span></h2>
        <span class="pager-info">学完词，来读一篇</span>
      </div>

      <div class="daily-card">
        <div class="daily-banner">
          <span class="daily-tag">
            {{ dailySource === 'news' ? '📰 时事' : '📚 百科' }} · 今日
          </span>
          <div class="daily-title">
            {{
              dailyLoading && !current
                ? '正在抓今天这篇文章…'
                : current?.titleZh || current?.title || '今天这篇还没抓到，点「换一篇」试试'
            }}
          </div>
          <div v-if="current?.titleZh && current.title" class="daily-title-en">
            {{ current.title }}
          </div>
        </div>

        <div class="daily-meta">
          <span class="daily-chip">{{ current ? `${current.words} 词` : '— 词' }}</span>
          <span class="daily-chip">
            {{ dailySource === 'news' ? `Level ${newsLevel}` : wikiSimple ? '简单英语' : '标准英语' }}
          </span>
          <span class="daily-chip dim">{{ current?.source || 'News in Levels / Wikipedia' }}</span>
        </div>

        <div class="daily-bar">
          <div class="chips">
            <button
              class="chip"
              :class="{ active: dailySource === 'news' }"
              @click="switchSource('news')"
            >
              📰 新闻
            </button>
            <button
              class="chip"
              :class="{ active: dailySource === 'wiki' }"
              @click="switchSource('wiki')"
            >
              📚 百科
            </button>
            <template v-if="dailySource === 'news'">
              <button
                v-for="lv in NEWS_LEVELS"
                :key="lv"
                class="chip"
                :class="{ active: newsLevel === lv }"
                @click="switchLevel(lv)"
              >
                L{{ lv }}
              </button>
            </template>
            <template v-else>
              <button
                class="chip"
                :class="{ active: wikiSimple }"
                @click="switchWikiMode(true)"
              >
                简单
              </button>
              <button
                class="chip"
                :class="{ active: !wikiSimple }"
                @click="switchWikiMode(false)"
              >
                标准
              </button>
            </template>
          </div>
          <div class="btn-row">
            <button class="btn ghost" :disabled="dailyLoading" @click="onDaily(true)">
              {{ dailyLoading ? '抓取中…' : '换一篇' }}
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
      </div>

      <div class="daily-extra">
        <input
          v-model="wikiTopic"
          class="search find-input"
          placeholder="或在维基百科搜话题，如 coffee / space / Rome"
          @keydown.enter.prevent="onFetchWiki"
        />
        <button class="btn" :disabled="!!fetching || dailyLoading" @click="onFetchWiki">
          {{ fetching ? '抓取中…' : '搜这篇' }}
        </button>
      </div>

      <button class="find-toggle" @click="showHistory = !showHistory">
        {{ showHistory ? '收起往期' : `查看往期 · 已存 ${dailyList.length} 篇` }}
      </button>
      <div v-if="showHistory" class="daily-history">
        <p v-if="!dailyList.length" class="find-d">
          还没有往期。抓到第一篇后，每天的文章都会留在这里，随时点开重读。
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
          复制不了文字时：Safari 点地址栏左边的「显示阅读器」，Chrome 用 Ctrl/⌘ + A 全选再复制；
          或者直接在上面点「换一篇」，程序会自己把正文扒干净。
        </p>
      </div>
    </div>

    <div class="panel">
      <div class="panel-head">
        <h2>阅读 · 从文章里遇到单词</h2>
        <span class="pager-info">粘贴后自动标出词库里已有的词</span>
      </div>
      <p class="hint">
        把一段英文粘进下面的框，点「分析」后会标出词库里出现过的词——<b>琥珀色是还没掌握的</b>，灰色是已掌握。
        点任意单词可以看释义、听发音，然后把文中这些词一键组成一轮学习集（学完照常进入间隔复习）。
      </p>

      <textarea
        v-model="articleText"
        class="read-input"
        rows="7"
        :placeholder="sampleText"
        @keydown.meta.enter.prevent="onAnalyze"
        @keydown.ctrl.enter.prevent="onAnalyze"
      />

      <div class="read-bar">
        <span class="coach-tip">⌘/Ctrl + Enter 分析 · 文章会保存在本机</span>
        <div class="btn-row">
          <button v-if="analyzed" class="btn ghost" @click="onClear">清空</button>
          <button class="btn primary" @click="onAnalyze">
            {{ analyzed ? '重新分析' : '分析' }}
          </button>
        </div>
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
        <button class="btn ghost" :disabled="quizLoading" @click="onMakeQuiz">
          {{ quizLoading ? '出题中…' : quiz ? '🔁 再出 5 题' : '📝 阅读理解' }}
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

      <div class="article paras">
        <div v-for="(g, gi) in paraGroups" :key="gi" class="para-card">
          <div class="para-body">
            <template v-for="(p, pi) in g.pieces" :key="pi">
              <span v-if="!p.isWord" class="rd-sep">{{ p.text }}</span>
              <button
                v-else-if="p.word"
                class="rd-w"
                :class="p.word.group === 'mastered' ? 'know' : 'hit'"
                :title="p.word.meaning"
                @click="pickPiece(p)"
              >
                {{ p.text }}
              </button>
              <button v-else class="rd-w plain" @click="pickPiece(p)">{{ p.text }}</button>
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
          <b>{{ picked.word?.word ?? picked.surface }}</b>
          <span v-if="picked.word?.ipa" class="ipa">/ {{ picked.word.ipa }} /</span>
          <span v-if="picked.word" class="pick-tag" :class="picked.word.group">
            {{ picked.word.group === 'mastered' ? '已掌握' : picked.word.group === 'new' ? '新词' : '复习中' }}
          </span>
          <span v-if="!picked.word" class="pick-tag miss">不在词库</span>
          <button
            v-if="picked.word"
            class="icon-btn mini"
            title="朗读"
            @click="onSpeak(picked.word)"
          >
            🔊
          </button>
          <button class="icon-btn mini picked-close" title="关闭" @click="closePick">✕</button>
        </div>
        <p class="picked-mean">
          {{ picked.word ? picked.word.meaning || '（没有释义）' : '文章里有，但词库中没有这个词。' }}
          <span v-if="formNote()" class="picked-form">{{ formNote() }}</span>
        </p>
      </div>

      <!-- 阅读理解 -->
      <div v-if="quiz" class="quiz-card">
        <div class="quiz-head">
          <b>📝 阅读理解 · {{ quiz.length }} 题</b>
          <span class="pager-info">
            {{ quizDone ? `得分 ${quizScore} / ${quiz.length}` : '选出你认为对的选项，选完立刻判分' }}
          </span>
          <button class="btn ghost" @click="resetQuiz">重做</button>
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
        还没有分析文章。{{ deckWords.length ? `当前词库有 ${deckWords.length} 个词，能匹配到多少？粘一段试试。` : '先导入词库效果更好。' }}
      </div>
    </div>
  </template>
</template>
