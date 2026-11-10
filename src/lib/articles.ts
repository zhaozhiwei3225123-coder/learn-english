/**
 * 找文章：直接从「允许浏览器跨域」的公开接口抓一篇，不用自己搜。
 *
 * 两个源：
 * 1) News in Levels —— 每天更新的真实新闻，同一篇有 Level 1/2/3 三个难度。
 *    它的站内 RSS 不带 CORS 头，走 rss2json 转一道（免费、无需 key）。
 * 2) Wikipedia —— 官方 api.php 支持 origin=*，可以搜话题，也可以随机。
 *    Simple English 版只用基础词写作，比标准版好读得多。
 *
 * 两个都不用 key、不花钱。抓失败就把错误抛给界面，提示用户手动复制。
 */

export interface FetchedArticle {
  title: string;
  text: string;
  source: string;
  /** 原文地址，可能为空 */
  url: string;
}

/* ------------------------------------------------------------ 工具 */

const TIMEOUT_MS = 15000;

async function getJson(url: string): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  rsquo: '’',
  lsquo: '‘',
  ldquo: '“',
  rdquo: '”',
  middot: '·',
  times: '×',
  deg: '°',
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, ent: string) => {
    if (ent[0] === '#') {
      const hex = ent[1] === 'x' || ent[1] === 'X';
      const code = parseInt(hex ? ent.slice(2) : ent.slice(1), hex ? 16 : 10);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[ent.toLowerCase()] ?? whole;
  });
}

/** HTML → 干净正文（保留段落换行，去掉标签与实体） */
function htmlToText(html: string): string {
  const stripped = html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|blockquote)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');

  return decodeEntities(stripped)
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/* ------------------------------------------------------------ News in Levels */

const NIV_FEED = 'https://www.newsinlevels.com/feed/';
const RSS_PROXY = 'https://api.rss2json.com/v1/api.json';

export type NewsLevel = 1 | 2 | 3;

interface RssItem {
  title?: string;
  link?: string;
  description?: string;
}

/**
 * 抓一条当天新闻。description 里是正文前 3~5 句（原文被截断，末尾带省略号），
 * 对「读一段真实语境」来说够用；想看全文点标题链接。
 */
export async function fetchNews(level: NewsLevel): Promise<FetchedArticle> {
  const url = `${RSS_PROXY}?rss_url=${encodeURIComponent(NIV_FEED)}&count=40`;
  const data = (await getJson(url)) as { status?: string; items?: RssItem[] };

  if (data?.status !== 'ok' || !Array.isArray(data.items) || !data.items.length) {
    throw new Error('新闻源暂时取不到，稍后再试');
  }

  const items = data.items;
  const want = new RegExp(`level\\s*${level}\\b`, 'i');
  const sameLevel = items.filter((it) => want.test(String(it.title || '')));
  const pool = sameLevel.length ? sameLevel : items;
  const item = pool[Math.floor(Math.random() * pool.length)];

  const text = htmlToText(String(item.description || ''))
    // 开头的「10-11-2026 07:00」时间戳
    .replace(/^\d{2}-\d{2}-\d{4}\s+\d{2}:\d{2}\s*/, '')
    // 结尾 WordPress 自动追加的「The post … appeared first on …」
    .replace(/\s*The post[\s\S]*$/i, '')
    .trim();

  if (text.length < 40) throw new Error('这篇没抓到正文，换一篇试试');

  return {
    title: String(item.title || '')
      .replace(/\s*[–—-]\s*level\s*\d+\s*$/i, '')
      .trim(),
    text,
    source: `News in Levels · Level ${level}`,
    url: String(item.link || ''),
  };
}

/* ------------------------------------------------------------ Wikipedia */

const WIKI_JUNK_TITLE = /^(list of|lists of|timeline of|index of|outline of|glossary of|bibliography of)/i;
const WIKI_JUNK_TEXT = /may refer to|is a disambiguation|can mean:/i;

interface WikiPage {
  title?: string;
  extract?: string;
  missing?: string;
}

function wikiApi(simple: boolean, params: Record<string, string>): string {
  const host = simple ? 'simple.wikipedia.org' : 'en.wikipedia.org';
  const q = new URLSearchParams({
    action: 'query',
    format: 'json',
    origin: '*',
    prop: 'extracts',
    explaintext: '1',
    exintro: '1',
    // 不给够 exlimit 的话只有第一篇会带正文，随机就没得挑了
    exlimit: '10',
    ...params,
  });
  return `https://${host}/w/api.php?${q.toString()}`;
}

function wikiPages(data: unknown): WikiPage[] {
  const pages = (data as { query?: { pages?: Record<string, WikiPage> } })?.query?.pages;
  return pages ? Object.values(pages) : [];
}

/** 读一篇的舒服长度：约 250~300 词，超了就在句号处收尾 */
const MAX_CHARS = 1600;

function clipSentences(raw: string): string {
  const t = raw.trim();
  if (t.length <= MAX_CHARS) return t;
  const head = t.slice(0, MAX_CHARS);
  const cut = head.lastIndexOf('. ');
  return cut > 600 ? head.slice(0, cut + 1) : head;
}

function extractOf(p: WikiPage): string {
  return clipSentences(p.extract || '');
}

function usable(p: WikiPage): boolean {
  const text = extractOf(p);
  return (
    text.length >= 350 &&
    !p.missing &&
    !WIKI_JUNK_TITLE.test(p.title || '') &&
    !WIKI_JUNK_TEXT.test(text)
  );
}

/** 挑一篇能读的：优先合格且够长的，实在没有就退而求本次长的 */
function bestOf(pages: WikiPage[]): WikiPage | null {
  const pool = pages.filter((p) => extractOf(p).length >= 150);
  const good = pool.filter(usable);
  if (good.length) {
    return good.sort((a, b) => extractOf(b).length - extractOf(a).length)[0];
  }
  if (!pool.length) return null;
  return pool.sort((a, b) => extractOf(b).length - extractOf(a).length)[0];
}

function toArticle(p: WikiPage, label: string, simple: boolean): FetchedArticle {
  const host = simple ? 'simple' : 'en';
  const title = p.title || 'Wikipedia';
  return {
    title,
    text: extractOf(p),
    source: label,
    url: `https://${host}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`,
  };
}

/**
 * 抓维基百科词条。传了 topic 就搜这个词条，不传就随机抽一篇
 * （随机可能抽到「List of …」或只有一句话的残条，所以一次拿 10 篇再挑）。
 */
export async function fetchWiki(simple: boolean, topic = ''): Promise<FetchedArticle> {
  const label = simple ? '维基百科 · 简单英语' : '维基百科 · 标准英语';
  const q = topic.trim();

  if (q) {
    const data = await getJson(
      wikiApi(simple, { generator: 'search', gsrsearch: q, gsrlimit: '5' })
    );
    const hit = bestOf(wikiPages(data));
    if (!hit) {
      throw new Error(`没搜到「${q}」的可读词条，换个说法或切到标准英语`);
    }
    return toArticle(hit, label, simple);
  }

  const data = await getJson(
    wikiApi(simple, { generator: 'random', grnnamespace: '0', grnlimit: '10' })
  );
  const hit = bestOf(wikiPages(data));
  if (!hit) throw new Error('这次随机到的词条都太短，再点一次试试');
  return toArticle(hit, label, simple);
}
