// 自動匯入台灣國定假日（資料：行政院人事行政總處辦公日曆表，經 ruyut/TaiwanCalendar 整理成 JSON）
// 連續放假的日子合併成一筆，例如「中秋節、孔子誕辰紀念日/教師節連假 9/25–9/28」；只有週末的不列入。
// 任務 id 由「行事曆 + 開始日期」算出來，多台裝置同時匯入也不會重複；刪掉的假日不會再被加回來。
import * as db from './db.js';

const SRC = y => `https://cdn.jsdelivr.net/gh/ruyut/TaiwanCalendar/data/${y}.json`;
const iso = s => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;

// 把逐日資料合併成「連續放假區間」
export function holidayRuns(days) {
  const out = [];
  let run = [];
  const flush = () => {
    const names = [...new Set(run.map(d => d.description).filter(n => n && n !== '補假'))];
    if (names.length) out.push({
      title: names.join('、') + (run.length >= 3 ? '連假' : ''),
      date: iso(run[0].date),
      end_date: run.length > 1 ? iso(run[run.length - 1].date) : null,
    });
    run = [];
  };
  for (const d of days) {
    if (d.isHoliday) run.push(d);
    else {
      flush();
      if (d.description) out.push({ title: d.description, date: iso(d.date), end_date: null, workday: true }); // 補行上班日
    }
  }
  flush();
  return out;
}

async function stableId(text) {
  const b = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  const x = [...b.slice(0, 16)].map(v => v.toString(16).padStart(2, '0')).join('');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-4${x.slice(13, 16)}-a${x.slice(17, 20)}-${x.slice(20, 32)}`;
}

// force：忽略「已匯入過」的紀錄重新檢查（仍然不會覆蓋或復活既有的假日）
export async function autoImport({ force = false } = {}) {
  if (db.meta().auto_holidays === false && !force) return 0;
  const year = new Date().getFullYear();
  const done = { ...(db.meta().holiday_years || {}) };
  let added = 0;
  for (const y of [year, year + 1]) {
    const cals = db.calendars().filter(c => force || !done[`${c.id}:${y}`]);
    if (!cals.length) continue;
    let days;
    try {
      const res = await fetch(SRC(y));
      if (!res.ok) continue; // 明年的還沒公布，下次再試
      days = await res.json();
    } catch { continue; }
    const runs = holidayRuns(days);
    for (const cal of cals) {
      const rows = [];
      let tagId = null;
      for (const r of runs) {
        const id = await stableId(`${cal.id}|holiday|${r.date}`);
        if (db.everExisted('tasks', id)) continue;
        tagId ??= db.ensureTag('國定假日', 'gray', cal.id);
        rows.push({
          id, calendar_id: cal.id, title: r.title, notes: '', date: r.date, end_date: r.end_date,
          start_time: null, end_time: null, status: 'todo', priority: 0,
          tag_ids: r.workday ? [] : [tagId], reminders: [], ext_id: 'holiday:' + r.date,
        });
      }
      if (rows.length) { db.putMany('tasks', rows); added += rows.length; }
      done[`${cal.id}:${y}`] = true;
    }
  }
  db.setMeta({ holiday_years: done });
  return added;
}
