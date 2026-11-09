import fs from 'node:fs';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

const file = process.argv[2] || '../d03671f86e2931c5a4aa52e21381dc4e.pdf';

const data = new Uint8Array(fs.readFileSync(file));
const doc = await pdfjsLib.getDocument({
  data, isEvalSupported: false, useSystemFonts: true, disableFontFace: true,
}).promise;

const isDigits = (s) => /^\d{1,5}$/.test(s.trim());
const hasCJK = (s) => /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(s);
const isAsciiWord = (s) => /^[A-Za-z][A-Za-z'’.\- ]*$/.test(s.trim());

const pts = [];
for (let p = 1; p <= doc.numPages; p++) {
  const page = await doc.getPage(p);
  const content = await page.getTextContent();
  for (const it of content.items) {
    if (!it.str || !it.str.trim()) continue;
    pts.push({ x: it.transform[4], y: it.transform[5], str: it.str, page: p });
  }
}

const digitX = [], cjkX = [], asciiX = [];
for (const it of pts) {
  const s = it.str.trim();
  if (isDigits(s)) digitX.push(it.x);
  else if (hasCJK(s)) cjkX.push(it.x);
  else if (isAsciiWord(s)) asciiX.push(it.x);
}
const median = (a) => { const s = a.slice().sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
console.log('digitX count', digitX.length, 'median', median(digitX));
console.log('asciiX count', asciiX.length, 'median', median(asciiX));
console.log('cjkX   count', cjkX.length, 'median', median(cjkX));

const hist = (arr, label) => {
  const buckets = new Map();
  for (const x of arr) { const k = Math.round(x / 20) * 20; buckets.set(k, (buckets.get(k) || 0) + 1); }
  console.log(label, [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}:${v}`).join(' '));
};
hist(digitX, 'digit x hist ');
hist(asciiX, 'ascii x hist ');
hist(cjkX, 'cjk x hist   ');
