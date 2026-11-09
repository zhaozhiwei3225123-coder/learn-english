import fs from 'node:fs';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { parseTextItems } from './debug-layout.mjs';

const file = process.argv[2] || '../d03671f86e2931c5a4aa52e21381dc4e.pdf';
const data = new Uint8Array(fs.readFileSync(file));
const doc = await pdfjsLib.getDocument({
  data, isEvalSupported: false, useSystemFonts: true, disableFontFace: true,
}).promise;

const pagesItems = [];
for (let p = 1; p <= doc.numPages; p++) {
  const page = await doc.getPage(p);
  const content = await page.getTextContent();
  pagesItems.push(content.items);
}

const entries = parseTextItems(pagesItems).filter((e) => e.word && /[A-Za-z]/.test(e.word));
const got = new Set(entries.map((e) => e.no));
const missing = [];
for (let i = 1; i <= 1175; i++) if (!got.has(i)) missing.push(i);
console.log('missing numbers:', missing);

/* ---------- 按页/栏统计 ---------- */
const isDigits = (s) => /^\d{1,5}$/.test(s.trim());
const hasCJK = (s) => /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(s);
const isAsciiWord = (s) => /^[A-Za-z][A-Za-z'’.\- ]*$/.test(s.trim());

const clusterX = (xs, tol = 10, minCount = 3) => {
  const s = xs.slice().sort((a, b) => a - b);
  const g = [];
  for (const x of s) {
    const last = g[g.length - 1];
    if (last && x - last.sum / last.n <= tol) { last.sum += x; last.n++; }
    else g.push({ sum: x, n: 1 });
  }
  return g.filter((v) => v.n >= minCount).map((v) => v.sum / v.n);
};

let line = 0;
for (let p = 0; p < pagesItems.length; p++) {
  const pts = pagesItems[p]
    .filter((it) => it.str && it.str.trim())
    .map((it) => ({ x: it.transform[4], y: it.transform[5], str: it.str }));
  const centers = clusterX(pts.filter((q) => isDigits(q.str)).map((q) => q.x));
  const bounds = centers.slice(1).map((c, i) => (centers[i] + c) / 2);
  const lanes = centers.map(() => []);
  for (const q of pts) {
    let l = 0;
    while (l < bounds.length && q.x >= bounds[l]) l++;
    lanes[l].push(q);
  }
  const info = lanes.map((lane, i) => {
    const idx = lane.filter((q) => isDigits(q.str));
    const cjk = lane.filter((q) => hasCJK(q.str));
    const ascii = lane.filter((q) => !isDigits(q.str) && !hasCJK(q.str) && isAsciiWord(q.str));
    const ys = [...new Set(cjk.map((q) => Math.round(q.y * 10) / 10))].sort((a, b) => b - a);
    const gaps = ys.slice(1).map((y, k) => Math.round((ys[k] - y) * 10) / 10);
    return `L${i}[idx=${idx.length} first=${idx[0]?.str} last=${idx[idx.length - 1]?.str} cjk=${cjk.length} cjkLines=${ys.length} ascii=${ascii.length}]`;
  });
  console.log(`p${p + 1}: ${info.join(' ')}`);
  if (++line > 3) break;
}

/* 第 1 页左栏 CJK 行的 y 与间隙，用于判断释义分段规律 */
const page1 = pagesItems[0]
  .filter((it) => it.str && it.str.trim())
  .map((it) => ({ x: it.transform[4], y: it.transform[5], str: it.str }));
const left = page1.filter((q) => q.x < 180);
const ys = [...new Set(left.filter((q) => hasCJK(q.str)).map((q) => Math.round(q.y * 10) / 10))].sort((a, b) => b - a);
console.log('\npage1 left cjk y:', ys.join(' '));
console.log('gaps:', ys.slice(1).map((y, i) => Math.round((ys[i] - y) * 10) / 10).join(' '));
const leftIdx = left.filter((q) => isDigits(q.str)).map((q) => Math.round(q.y * 10) / 10);
console.log('page1 left idx y:', leftIdx.join(' '));
