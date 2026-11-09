import fs from 'node:fs';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

const file = process.argv[2] || '../d03671f86e2931c5a4aa52e21381dc4e.pdf';
const maxPages = Number(process.argv[3] || 2);

const data = new Uint8Array(fs.readFileSync(file));
const doc = await pdfjsLib.getDocument({
  data,
  isEvalSupported: false,
  useSystemFonts: true,
  disableFontFace: true,
}).promise;

console.log('numPages =', doc.numPages);

for (let p = 1; p <= Math.min(maxPages, doc.numPages); p++) {
  const page = await doc.getPage(p);
  const content = await page.getTextContent();
  console.log(`\n===== page ${p} : ${content.items.length} items =====`);
  for (const it of content.items) {
    if (!('str' in it)) continue;
    const tr = it.transform;
    console.log(
      JSON.stringify({
        str: it.str,
        x: Math.round(tr[4] * 10) / 10,
        y: Math.round(tr[5] * 10) / 10,
        w: Math.round(it.width),
        h: Math.round(it.height),
        font: it.fontName,
      })
    );
  }
}
