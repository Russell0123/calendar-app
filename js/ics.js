// 解析 Google 日曆匯出的 .ics，展開重複事件，只取指定日期範圍
import { ymd, parseYmd, addDays } from './ui.js';

const pad = n => String(n).padStart(2, '0');
const text = f => f?.value.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1').trim() || '';
const dayDiff = (a, b) => Math.round((parseYmd(b) - parseYmd(a)) / 864e5);

export function parseICS(src) {
  const lines = src.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
  const events = [];
  let cur = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') cur = {};
    else if (line === 'END:VEVENT') { if (cur) events.push(cur); cur = null; }
    else if (cur) {
      const i = line.indexOf(':');
      if (i < 0) continue;
      const [name, ...params] = line.slice(0, i).split(';');
      const value = line.slice(i + 1);
      const p = Object.fromEntries(params.map(x => x.split('=')));
      if (name === 'EXDATE') (cur.EXDATE ??= []).push(...value.split(',').map(v => parseDT(v, p)));
      else cur[name] = { value, p };
    }
  }
  return events;
}

// 整天事件 → { date, time: null }；有時間 → 轉成本地時間（TZID 視為本地時區）
function parseDT(v, p = {}) {
  if (p.VALUE === 'DATE' || /^\d{8}$/.test(v)) return { date: `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`, time: null };
  const m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);
  if (!m) return null;
  const d = m[7] ? new Date(Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5])) : new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5]);
  return { date: ymd(d), time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
}

// 展開 RRULE（DAILY / WEEKLY+BYDAY / MONTHLY / YEARLY、INTERVAL、COUNT、UNTIL）
function expand(start, rrule, from, to, span) {
  const r = Object.fromEntries(rrule.split(';').map(x => x.split('=')));
  const interval = +(r.INTERVAL || 1);
  const count = r.COUNT ? +r.COUNT : Infinity;
  const until = r.UNTIL ? parseDT(r.UNTIL)?.date || '9999-12-31' : '9999-12-31';
  const limit = to < until ? to : until;
  const out = [];
  let n = 0, guard = 0;
  const take = d => { n++; if (addDays(d, span) >= from) out.push(d); };

  if (r.FREQ === 'WEEKLY') {
    const DAYS = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
    const byday = (r.BYDAY ? r.BYDAY.split(',').map(x => DAYS[x.slice(-2)]) : [parseYmd(start).getDay()]).sort();
    let wk = addDays(start, -parseYmd(start).getDay());
    while (wk <= limit && n < count && guard++ < 3000) {
      for (const wd of byday) { const d = addDays(wk, wd); if (d >= start && d <= limit && n < count) take(d); }
      wk = addDays(wk, 7 * interval);
    }
  } else {
    const s = parseYmd(start);
    for (let k = 0; n < count && guard++ < 5000; k++) {
      let d;
      if (r.FREQ === 'DAILY') d = addDays(start, k * interval);
      else if (r.FREQ === 'MONTHLY' || r.FREQ === 'YEARLY') {
        const x = new Date(s.getFullYear() + (r.FREQ === 'YEARLY' ? k * interval : 0), s.getMonth() + (r.FREQ === 'MONTHLY' ? k * interval : 0), s.getDate());
        if (x.getDate() !== s.getDate()) continue; // 例如 31 號遇到小月就跳過
        d = ymd(x);
      } else break;
      if (d > limit) break;
      take(d);
    }
  }
  return out;
}

// 轉成任務資料列；ext_id 用來避免重複匯入（再匯入一次會更新而不是新增）
export function icsToTasks(events, from, to) {
  const rid = e => e['RECURRENCE-ID'] && parseDT(e['RECURRENCE-ID'].value, e['RECURRENCE-ID'].p)?.date;
  const overridden = new Set(events.filter(rid).map(e => e.UID?.value + '|' + rid(e)));
  const out = [];
  for (const e of events) {
    if (e.STATUS?.value === 'CANCELLED' || !e.DTSTART) continue;
    const s = parseDT(e.DTSTART.value, e.DTSTART.p);
    if (!s) continue;
    let span = 0, endTime = null;
    const en = e.DTEND && parseDT(e.DTEND.value, e.DTEND.p);
    if (en) {
      const endDate = s.time ? en.date : addDays(en.date, -1); // 整天事件的 DTEND 是隔天
      span = Math.max(0, dayDiff(s.date, endDate));
      endTime = en.time;
    }
    const location = text(e.LOCATION);
    const base = {
      title: text(e.SUMMARY) || '（無標題）',
      notes: [location && '地點：' + location, text(e.DESCRIPTION)].filter(Boolean).join('\n'),
      start_time: s.time, end_time: endTime,
    };
    const recurring = e.RRULE && !rid(e);
    const skip = new Set((e.EXDATE || []).filter(Boolean).map(x => x.date));
    for (const d of recurring ? expand(s.date, e.RRULE.value, from, to, span) : [s.date]) {
      const end = span ? addDays(d, span) : null;
      if (d > to || (end || d) < from || skip.has(d)) continue;
      const key = (e.UID?.value || base.title) + '|' + (rid(e) || d);
      if (recurring && overridden.has(key)) continue;
      out.push({ ...base, date: d, end_date: end, ext_id: 'gcal:' + key });
    }
  }
  return out;
}
