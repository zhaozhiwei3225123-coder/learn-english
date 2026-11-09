/** 日期工具（全部使用本地时区的 yyyy-mm-dd 字符串） */

export function todayKey(d: Date = new Date()): string {
  const t = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return t.toISOString().slice(0, 10);
}

export function addDays(dateKey: string, n: number): string {
  const d = new Date(dateKey + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return todayKey(d);
}

export function fmtDate(key?: string | null): string {
  if (!key) return '—';
  const [, m, d] = key.split('-');
  return `${Number(m)}月${Number(d)}日`;
}

export function fmtDateTime(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
