// 自動匯入台灣國定假日（資料：行政院人事行政總處辦公日曆表，經 ruyut/TaiwanCalendar 整理成 JSON）
// 每個節日各自一筆（中秋節、教師節分開）；同一個名稱連續好幾天才合併，例如「春節 2/17–2/19」；只有週末的不列入。
// 任務 id 由「行事曆 + 日期」算出來，多台裝置同時匯入也不會重複；刪掉的假日不會再被加回來。
import * as db from './db.js';

const SRC = y => `https://cdn.jsdelivr.net/gh/ruyut/TaiwanCalendar/data/${y}.json`;
const VERSION = 2; // 1＝舊版（連假合併成一筆）
const iso = s => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
const nextDay = s => {
  const d = new Date(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8) + 1);
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
};

// 官方名稱太長的改成常用說法
const SHORT = { '孔子誕辰紀念日/教師節': '教師節', '臺灣光復暨金門古寧頭大捷紀念日': '光復節' };

// 逐日資料 → 有名稱的日子；同名且日期相連的合併成一筆
export function holidayItems(days) {
  const out = [];
  for (const raw of days) {
    if (!raw.description) continue;
    const d = { ...raw, description: SHORT[raw.description] || raw.description };
    const prev = out[out.length - 1];
    if (prev && prev.title === d.description && nextDay(prev.last) === d.date) {
      prev.last = d.date; prev.end_date = iso(d.date);
      continue;
    }
    // 不放假但有名稱＝補行上班日
    out.push({ title: d.description, date: iso(d.date), end_date: null, last: d.date, workday: !d.isHoliday });
  }
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
  // 舊版「連假」合併的資料換成新版：刪掉舊的、重新匯入
  if ((db.meta().holiday_version || 1) < VERSION) {
    db.all('tasks', t => t.ext_id?.startsWith('holiday:')).forEach(t => db.remove('tasks', t.id));
    db.setMeta({ holiday_version: VERSION, holiday_years: {} });
  }
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
    const items = holidayItems(days);
    for (const cal of cals) {
      const rows = [];
      let tagId = null;
      const have = db.extIds(cal.id);
      for (const r of items) {
        const id = await stableId(`${cal.id}|holiday${VERSION}|${r.date}`);
        if (db.everExisted('tasks', id) || have.has(`holiday${VERSION}:${r.date}`)) continue;
        tagId ??= db.ensureTag('國定假日', 'darkgray', cal.id, '類型');
        rows.push({
          id, calendar_id: cal.id, title: r.title, notes: '', date: r.date, end_date: r.end_date,
          start_time: null, end_time: null, status: 'todo', priority: 0,
          tag_ids: r.workday ? [] : [tagId], reminders: [], ext_id: `holiday${VERSION}:${r.date}`,
        });
      }
      if (rows.length) { db.putMany('tasks', rows); added += rows.length; }
      done[`${cal.id}:${y}`] = true;
    }
  }
  db.setMeta({ holiday_years: done });
  return added;
}
