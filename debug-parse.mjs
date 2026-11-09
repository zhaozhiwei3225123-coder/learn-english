import fs from 'node:fs';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { parseTextItems, itemsToPlainText, parsePlainText } from './debug-layout.mjs';

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

let entries = parseTextItems(pagesItems);
let mode = 'position';
if (entries.length < 3) {
  mode = 'text';
  entries = parsePlainText(itemsToPlainText(pagesItems));
}
entries = entries.filter((e) => e.word && /[A-Za-z]/.test(e.word));

console.log('pages =', doc.numPages, 'mode =', mode, 'entries =', entries.length);
console.log('first 8:', entries.slice(0, 8));
console.log('last 5:', entries.slice(-5));

const bad = entries.filter((e) => !e.meaning);
console.log('no-meaning =', bad.length, bad.slice(0, 5));
const weird = entries.filter((e) => /[\u4e00-\u9fff]/.test(e.word));
console.log('word-with-cjk =', weird.length, weird.slice(0, 5));
const nums = entries.map((e) => e.no).filter((n) => typeof n === 'number');
console.log('no range =', Math.min(...nums), '~', Math.max(...nums), 'count =', nums.length);
const dupNo = nums.length - new Set(nums).size;
console.log('dup numbers =', dupNo);
