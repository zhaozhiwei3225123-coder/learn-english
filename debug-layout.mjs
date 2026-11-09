// src/lib/pdfLayout.ts
var HEADER_PATTERNS = [
  /^classicvocabularylist$/i,
  /^title:/i,
  /^date:/i,
  /^-\d+$/,
  /^no\.?word/
];
function isHeaderText(raw) {
  const n = String(raw || "").replace(/\s+/g, "");
  if (!n) return true;
  return HEADER_PATTERNS.some((re) => re.test(n));
}
var isDigits = (s) => /^\d{1,5}$/.test(s.trim());
var isAsciiWord = (s) => /^[A-Za-z][A-Za-z'’.\- ]*$/.test(s.trim());
var hasCJK = (s) => /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(s);
var WORD_TAIL = /[A-Za-z0-9)\].,;:'"!?%]$/;
var WORD_HEAD = /^[A-Za-z0-9(\[#]/;
function joinRaw(items) {
  let out = "";
  for (const it of items) {
    const s = it.str;
    if (!s) continue;
    if (!out) {
      out = s;
      continue;
    }
    const prev = out[out.length - 1];
    const next = s[0];
    const needSpace = WORD_TAIL.test(prev) && WORD_HEAD.test(next);
    out += needSpace ? " " + s : s;
  }
  return out;
}
function joinWordParts(parts) {
  let out = "";
  for (const raw of parts) {
    const t = String(raw || "").trim();
    if (!t) continue;
    if (!out) {
      out = t;
      continue;
    }
    if (out.endsWith("-") || t.length <= 1 || out.length >= 12) out += t;
    else out += " " + t;
  }
  return out.replace(/\s+/g, " ").trim();
}
function joinMeaningParts(parts) {
  return parts.map((p) => String(p || "").trim()).filter(Boolean).join("").replace(/[ \t]{2,}/g, " ").trim();
}
function assembleEntries(rows) {
  const entries = [];
  let cur = null;
  const flush = () => {
    if (!cur) return;
    const word = joinWordParts(cur.wordParts);
    const meaning = joinMeaningParts(cur.meaningParts);
    if (word && !/^\d+$/.test(word)) entries.push({ no: cur.no, word, meaning });
    cur = null;
  };
  for (const row of rows) {
    if (row.header) continue;
    if (row.index != null && row.index !== "") {
      flush();
      cur = { no: Number(row.index), wordParts: [], meaningParts: [] };
    }
    if (!cur) continue;
    if (row.word) cur.wordParts.push(row.word);
    if (row.meaning) cur.meaningParts.push(row.meaning);
  }
  flush();
  return entries;
}
function collectPoints(items) {
  const pts = [];
  for (const it of items || []) {
    if (!it || !it.str) continue;
    if (!String(it.str).trim()) continue;
    const tr = it.transform || [1, 0, 0, 1, 0, 0];
    pts.push({ x: tr[4], y: tr[5], str: String(it.str) });
  }
  return pts;
}
function groupRows(items) {
  const sorted = items.slice().sort((a, b) => b.y - a.y || a.x - b.x);
  const rows = [];
  const TOL = 4;
  for (const p of sorted) {
    let row = rows.find((r) => Math.abs(r.y - p.y) <= TOL);
    if (!row) {
      row = { y: p.y, items: [] };
      rows.push(row);
    }
    row.items.push(p);
  }
  for (const r of rows) r.items.sort((a, b) => a.x - b.x);
  rows.sort((a, b) => b.y - a.y);
  return rows;
}
function median(nums) {
  if (!nums.length) return null;
  const s = nums.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function clusterX(xs, tol = 10, minCount = 3) {
  if (!xs.length) return [];
  const sorted = xs.slice().sort((a, b) => a - b);
  const groups = [];
  for (const x of sorted) {
    const g = groups[groups.length - 1];
    if (g && x - g.sum / g.n <= tol) {
      g.sum += x;
      g.n += 1;
    } else {
      groups.push({ sum: x, n: 1 });
    }
  }
  return groups.filter((g) => g.n >= minCount).map((g) => g.sum / g.n);
}
function splitLanes(pts) {
  const indexXs = pts.filter((p) => isDigits(p.str)).map((p) => p.x);
  const centers = clusterX(indexXs);
  if (centers.length <= 1) {
    return [{ indexX: centers[0] ?? null, pts }];
  }
  const bounds = [];
  for (let i = 1; i < centers.length; i++) bounds.push((centers[i - 1] + centers[i]) / 2);
  const buckets = centers.map(() => []);
  for (const p of pts) {
    let lane = 0;
    while (lane < bounds.length && p.x >= bounds[lane]) lane += 1;
    buckets[lane].push(p);
  }
  return centers.map((indexX, i) => ({ indexX, pts: buckets[i] })).filter((lane) => lane.pts.length > 0);
}
function rowsOfLane(lane) {
  const rows = groupRows(lane.pts);
  const asciiXs = [];
  const cjkXs = [];
  for (const p of lane.pts) {
    const s = p.str.trim();
    if (!s || isDigits(s)) continue;
    if (hasCJK(s)) cjkXs.push(p.x);
    else if (isAsciiWord(s)) asciiXs.push(p.x);
  }
  let wordX = median(asciiXs);
  const meaningX = median(cjkXs);
  if (wordX == null) wordX = lane.indexX != null ? lane.indexX + 40 : null;
  if (wordX != null && lane.indexX != null && wordX - lane.indexX < 8) wordX = lane.indexX + 40;
  const b1 = wordX == null ? -Infinity : lane.indexX == null ? wordX - 20 : (lane.indexX + wordX) / 2;
  const b2 = wordX == null ? Infinity : meaningX == null ? wordX + 80 : (wordX + meaningX) / 2;
  return rows.map((r) => {
    const index = [];
    const word = [];
    const meaning = [];
    for (const it of r.items) {
      if (it.x < b1) index.push(it);
      else if (it.x < b2) word.push(it);
      else meaning.push(it);
    }
    const row = {
      header: isHeaderText(joinRaw(r.items)),
      index: joinRaw(index).replace(/\s+/g, "") || null,
      word: joinRaw(word).trim(),
      meaning: joinRaw(meaning).trim()
    };
    if (row.index && !isDigits(row.index)) {
      row.header = true;
      row.index = null;
    }
    return row;
  });
}
function parseTextItems(pages) {
  const rows = [];
  for (const items of pages || []) {
    const pts = collectPoints(items);
    if (!pts.length) continue;
    for (const lane of splitLanes(pts)) rows.push(...rowsOfLane(lane));
  }
  return assembleEntries(rows);
}
function itemsToPlainText(pages) {
  const lines = [];
  for (const items of pages || []) {
    const pts = collectPoints(items);
    if (!pts.length) continue;
    for (const lane of splitLanes(pts)) {
      for (const row of groupRows(lane.pts)) lines.push(joinRaw(row.items));
    }
  }
  return lines.join("\n");
}
function parsePlainText(text) {
  const lines = String(text || "").replace(/\r\n?/g, "\n").split("\n").map((l) => l.trim());
  const rows = [];
  for (const line of lines) {
    if (!line || isHeaderText(line)) {
      rows.push({ header: true, index: null, word: "", meaning: "" });
      continue;
    }
    if (isDigits(line)) {
      rows.push({ header: false, index: line, word: "", meaning: "" });
      continue;
    }
    if (hasCJK(line)) rows.push({ header: false, index: null, word: "", meaning: line });
    else if (isAsciiWord(line)) rows.push({ header: false, index: null, word: line, meaning: "" });
    else rows.push({ header: false, index: null, word: "", meaning: line });
  }
  return assembleEntries(rows);
}
export {
  itemsToPlainText,
  parsePlainText,
  parseTextItems
};
