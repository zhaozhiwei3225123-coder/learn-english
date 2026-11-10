<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import { state, deckWords } from '../store/vocab';
import { session, startReadingSession, endSession } from '../store/session';
import {
  articleText,
  article,
  analyzed,
  pieces,
  readingStats,
  studyWords,
  includeMastered,
  picked,
  analyze,
  clearArticle,
  pickPiece,
  closePick,
} from '../store/reading';
import { speak } from '../lib/speech';
import {
  fetchNews,
  fetchWiki,
  type FetchedArticle,
  type NewsLevel,
} from '../lib/articles';
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

/* ------------------------------------------------------- 找文章 */

const NEWS_LEVELS: NewsLevel[] = [1, 2, 3];
const fetching = ref<'' | 'news' | 'wiki'>('');
const newsLevel = ref<NewsLevel>(1);
const wikiTopic = ref('');
const wikiSimple = ref(true);
const showSources = ref(false);
/** 这一篇是从哪来的，抓到后显示在文章上方 */
const from = ref<{ label: string; url: string } | null>(null);

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

function loadArticle(a: FetchedArticle): void {
  articleText.value = a.text;
  from.value = { label: a.title ? `${a.title} · ${a.source}` : a.source, url: a.url };
  analyze();
  toast(`已抓取：${a.title || a.source}`);
  void nextTick(() => {
    document.querySelector('.read-stats')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
}

async function onFetchNews(): Promise<void> {
  if (fetching.value) return;
  fetching.value = 'news';
  try {
    loadArticle(await fetchNews(newsLevel.value));
  } catch (err) {
    toast(friendlyError(err));
  } finally {
    fetching.value = '';
  }
}

async function onFetchWiki(): Promise<void> {
  if (fetching.value) return;
  fetching.value = 'wiki';
  try {
    loadArticle(await fetchWiki(wikiSimple.value, wikiTopic.value));
  } catch (err) {
    toast(friendlyError(err));
  } finally {
    fetching.value = '';
  }
}

function onAnalyze(): void {
  if (!articleText.value.trim()) {
    toast('先把一段英文粘进来');
    return;
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

    <div class="panel find-panel">
      <div class="panel-head">
        <h2>找文章</h2>
        <span class="pager-info">没有素材？点一下抓一篇</span>
      </div>
      <p class="hint">
        不用自己到处搜。左边是每天更新的真实新闻（同一篇有三个难度），右边是维基百科——可以搜你感兴趣的话题，也可以随机。
        抓到后自动分析，不满意再点一次。
      </p>

      <div class="find-grid">
        <div class="find-card">
          <div class="find-t">今日新闻 <span>News in Levels</span></div>
          <p class="find-d">真实新闻用简单英语改写，每条约 60 词，一分钟读完。</p>
          <div class="chips">
            <button
              v-for="lv in NEWS_LEVELS"
              :key="lv"
              class="chip"
              :class="{ active: newsLevel === lv }"
              @click="newsLevel = lv"
            >
              Level {{ lv }}
            </button>
          </div>
          <button class="btn" :disabled="!!fetching" @click="onFetchNews">
            {{ fetching === 'news' ? '抓取中…' : '抓一条新闻' }}
          </button>
        </div>

        <div class="find-card">
          <div class="find-t">维基百科 <span>Wikipedia</span></div>
          <p class="find-d">搜一个你感兴趣的话题，或者什么都不填直接随机；一篇约 250 词。</p>
          <input
            v-model="wikiTopic"
            class="search find-input"
            placeholder="话题，如 coffee / space / Rome"
            @keydown.enter.prevent="onFetchWiki"
          />
          <div class="chips">
            <button class="chip" :class="{ active: wikiSimple }" @click="wikiSimple = true">
              简单英语
            </button>
            <button class="chip" :class="{ active: !wikiSimple }" @click="wikiSimple = false">
              标准英语
            </button>
          </div>
          <button class="btn" :disabled="!!fetching" @click="onFetchWiki">
            {{ fetching === 'wiki' ? '抓取中…' : wikiTopic.trim() ? '搜这个词条' : '随便来一篇' }}
          </button>
        </div>
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
          或者直接在上面点「抓一条」，程序会自己把正文扒干净。
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

      <p v-if="from" class="article-src">
        <span>来源：{{ from.label }}</span>
        <a v-if="from.url" :href="from.url" target="_blank" rel="noopener noreferrer">看原文 ↗</a>
      </p>

      <div class="read-stats">
        <span>全文 <b>{{ readingStats.total }}</b> 词</span>
        <span>命中词库 <b>{{ readingStats.matched }}</b> 词</span>
        <span>不在词库 <b>{{ readingStats.notInDeck }}</b> 词</span>
      </div>

      <div class="article">
        <template v-for="(p, i) in pieces" :key="i">
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
