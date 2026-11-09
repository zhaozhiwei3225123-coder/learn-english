/**
 * Excel / CSV 单词表解析
 *
 * 约定：第一列为单词，第二列为释义，第三列为音标（可选）；表头行会自动跳过。
 * 支持 .xlsx / .xls / .xlsm / .csv，多个工作表会合并。
 */
import * as XLSX from 'xlsx';
import type { ParsedEntry } from '../types';

const HEADER_WORD = /^(单词|词汇|英文|word|words|vocabulary|term)$/i;
const HEADER_MEANING = /^(释义|意思|中文|中文释义|meaning|definition|translation)$/i;

export interface ExcelParseResult {
  entries: ParsedEntry[];
  sheets: number;
}

function cellText(value: unknown): string {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).replace(/\u00a0/g, ' ').trim();
}

/** 音标单元格：去掉外层斜杠/方括号，统一成不带包裹的写法 */
function cleanIpa(value: unknown): string {
  return cellText(value)
    .replace(/^[/[]+/, '')
    .replace(/[/\]]+$/, '')
    .trim();
}

function isHeaderRow(row: unknown[]): boolean {
  const word = cellText(row[0]);
  const meaning = cellText(row[1]);
  return HEADER_WORD.test(word) || (!/[A-Za-z]/.test(word) && HEADER_MEANING.test(meaning));
}

export async function parseVocabExcel(file: File): Promise<ExcelParseResult> {
  const isCsv = /\.csv$/i.test(file.name) || file.type === 'text/csv';
  const workbook = isCsv
    ? XLSX.read(await file.text(), { type: 'string', raw: false })
    : XLSX.read(await file.arrayBuffer(), { type: 'array' });

  const entries: ParsedEntry[] = [];

  for (const sheetName of workbook.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], {
      header: 1,
      blankrows: false,
      defval: '',
      raw: false,
    });

    rows.forEach((row, index) => {
      if (index === 0 && isHeaderRow(row)) return;
      const word = cellText(row[0]);
      const meaning = cellText(row[1]);
      const ipa = cleanIpa(row[2]);
      if (!word) return;
      entries.push({ word, meaning, ipa });
    });
  }

  return { entries, sheets: workbook.SheetNames.length };
}
