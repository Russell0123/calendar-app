// 重複任務：任務只存一筆，顯示時依規則展開成每一次
// task.repeat = { freq: 'daily'|'weekly'|'monthly'|'yearly', interval: 1,
//                 weekdays: [0–6]（每週）, monthly: 'date'|'nth'（每月同一天／第 N 個週幾）, nth: 1–4 或 -1（最後一個）, until: 'YYYY-MM-DD'|null }
// task.done_dates：已完成的那幾次；task.skip_dates：單獨刪掉的那幾次
import { parseYmd, ymd, addDays, WEEK } from './ui.js';

const diffDays = (a, b) => Math.round((parseYmd(b) - parseYmd(a)) / 864e5);
const spanOf = t => (t.end_date ? Math.max(0, diffDays(t.date, t.end_date)) : 0);

// 某任務在 [from, to] 之間每一次的開始日期
export function repeatDates(t, from, to) {
  const span = spanOf(t);
  const r = t.repeat;
  if (!r?.freq) return t.date && t.date <= to && addDays(t.date, span) >= from ? [t.date] : [];
  const start = t.date, s = parseYmd(start);
  const iv = Math.max(1, r.interval || 1);
  const last = r.until && r.until < to ? r.until : to;
  const lo = addDays(from, -span); // 跨日的那次只要結束日落在範圍內也算
  const skip = new Set(t.skip_dates || []);
  const out = [];
  const push = d => { if (d >= start && d >= lo && d <= last && !skip.has(d)) out.push(d); };
  let guard = 0;

  if (r.freq === 'daily') {
    const k = Math.max(0, Math.floor(diffDays(start, lo) / iv));
    for (let d = addDays(start, k * iv); d <= last && guard++ < 2000; d = addDays(d, iv)) push(d);
  } else if (r.freq === 'weekly') {
    const wds = [...(r.weekdays?.length ? r.weekdays : [s.getDay()])].sort();
    const week0 = addDays(start, -s.getDay());
    const k = Math.max(0, Math.floor(diffDays(week0, lo) / 7 / iv));
    for (let w = addDays(week0, k * 7 * iv); w <= last && guard++ < 2000; w = addDays(w, 7 * iv)) wds.forEach(x => push(addDays(w, x)));
  } else if (r.freq === 'monthly' || r.freq === 'yearly') {
    const step = r.freq === 'yearly' ? 12 * iv : iv;
    const nth = r.freq === 'monthly' && r.monthly === 'nth';
    const wd = s.getDay(), n = r.nth ?? Math.ceil(s.getDate() / 7);
    const l = parseYmd(lo);
    let k = Math.max(0, Math.floor(((l.getFullYear() - s.getFullYear()) * 12 + l.getMonth() - s.getMonth()) / step) - 1);
    for (; guard++ < 1200; k++) {
      const m0 = new Date(s.getFullYear(), s.getMonth() + k * step, 1);
      if (ymd(m0) > last) break;
      let d;
      if (nth && n === -1) { // 最後一個週 X
        d = new Date(m0.getFullYear(), m0.getMonth() + 1, 0);
        d.setDate(d.getDate() - ((d.getDay() - wd + 7) % 7));
      } else if (nth) {       // 第 N 個週 X
        d = new Date(m0); d.setDate(1 + ((wd - m0.getDay() + 7) % 7) + (n - 1) * 7);
        if (d.getMonth() !== m0.getMonth()) continue;
      } else {                // 每月／每年的同一天（31 號遇到小月就跳過）
        d = new Date(m0.getFullYear(), m0.getMonth(), s.getDate());
        if (d.getDate() !== s.getDate()) continue;
      }
      push(ymd(d));
    }
  }
  return out;
}

// 把任務清單展開成 [from, to] 內的每一次（不重複的任務原樣保留）
export function occurrences(list, from, to) {
  const out = [];
  for (const t of list) {
    if (!t.date) continue;
    if (!t.repeat?.freq) { if (t.date <= to && (t.end_date || t.date) >= from) out.push(t); continue; }
    const span = spanOf(t);
    for (const d of repeatDates(t, from, to)) out.push({
      ...t, date: d, end_date: span ? addDays(d, span) : null, _occ: d,
      status: (t.done_dates || []).includes(d) ? 'done' : 'todo',
    });
  }
  return out;
}

// 規則的文字說明：「每週一、三」「每月第 2 個週二」「每 2 天」
export function repeatLabel(t) {
  const r = t.repeat;
  if (!r?.freq) return '';
  const s = parseYmd(t.date);
  const iv = r.interval > 1 ? r.interval : '';
  let txt;
  if (r.freq === 'daily') txt = iv ? `每 ${iv} 天` : '每天';
  else if (r.freq === 'weekly') {
    const wds = (r.weekdays?.length ? r.weekdays : [s.getDay()]).slice().sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
    txt = `${iv ? `每 ${iv} 週的` : '每'}週${wds.map(d => WEEK[d]).join('、')}`;
  } else if (r.freq === 'monthly') {
    const n = r.nth ?? Math.ceil(s.getDate() / 7);
    txt = (iv ? `每 ${iv} 個月的` : '每月') + (r.monthly === 'nth' ? `${n === -1 ? '最後一個' : `第 ${n} 個`}週${WEEK[s.getDay()]}` : `${s.getDate()} 號`);
  } else txt = (iv ? `每 ${iv} 年的` : '每年') + `${s.getMonth() + 1}/${s.getDate()}`;
  return txt + (r.until ? `，到 ${+r.until.slice(5, 7)}/${+r.until.slice(8)}` : '');
}
