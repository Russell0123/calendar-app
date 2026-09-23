// 手機提醒（只在 Android App 裡運作；網頁版不做事）
// 每次資料變動後，把接下來 60 天內的提醒重新排進手機的鬧鐘系統：App 關掉、沒網路也會準時跳
import * as db from './db.js';
import { fmtWhen, ymd } from './ui.js';
import { occurrences } from './repeat.js';

export const isApp = () => !!window.Capacitor?.isNativePlatform?.();

const DAYS_AHEAD = 60;
const MAX = 400; // Android 每個 App 的鬧鐘數量有上限，留一點空間
const LABEL = { 0: '現在', 10: '10 分鐘後', 60: '1 小時後', 180: '3 小時後', 1440: '明天', 2880: '後天', 4320: '3 天後', 10080: '1 週後' };

let LN = null, timer = null;

export async function initNotifications() {
  if (!isApp()) return;
  const { registerPlugin } = await import('https://cdn.jsdelivr.net/npm/@capacitor/core@8.5.2/+esm');
  LN = registerPlugin('LocalNotifications');
  await LN.requestPermissions().catch(() => {});
  // 點通知 → 打開那個任務
  LN.addListener('localNotificationActionPerformed', e => {
    const id = e.notification?.extra?.taskId;
    if (id && db.get('tasks', id)) window.openTask(id);
  });
  db.onChange(() => { clearTimeout(timer); timer = setTimeout(reschedule, 1500); });
  reschedule();
}

// 通知權限與「準時提醒」權限狀態（給設定頁顯示）
export async function status() {
  if (!LN) return null;
  const p = await LN.checkPermissions().catch(() => ({}));
  const exact = await LN.checkExactNotificationSetting?.().catch(() => null);
  return { notify: p.display, exact: exact?.exact_alarm };
}
export const openExactSetting = () => LN?.changeExactNotificationSetting?.();
export const askPermission = () => LN?.requestPermissions();

// 文字 id → 通知需要的正整數 id
const intId = s => { let h = 7; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h) || 1; };

export async function reschedule() {
  if (!LN) return;
  const now = Date.now(), until = now + DAYS_AHEAD * 864e5;
  const fallback = db.meta().default_remind_time || '09:00';
  const list = [];
  // 所有行事曆的未完成任務都要提醒；重複任務展開成每一次
  const tasks = db.all('tasks', x => x.date && (x.reminders?.length || x.remind_at?.length));
  for (const t of occurrences(tasks, ymd(new Date(now - 864e5)), ymd(new Date(until + 7 * 864e5)))) {
    if (t.status === 'done') continue;
    const [y, m, d] = t.date.split('-').map(Number);
    const [hh, mm] = (t.start_time || fallback).split(':').map(Number);
    const at = new Date(y, m - 1, d, hh, mm).getTime();
    const key = t.id + '|' + (t._occ || '');
    const add = (fire, tag, label) => {
      if (fire <= now || fire > until) return;
      list.push({ id: intId(key + '|' + tag), title: t.title, body: [label, fmtWhen(t)].join('・'),
        schedule: { at: new Date(fire), allowWhileIdle: true }, extra: { taskId: t.id } });
    };
    for (const before of t.reminders || []) add(at - before * 60e3, before, LABEL[before] ?? `${before} 分鐘後`);
    // 指定時間的提醒只跟著原本那一次（重複任務的後續幾次不會重複跳）
    if (!t._occ || t._occ === db.get('tasks', t.id)?.date)
      for (const a of t.remind_at || []) add(new Date(a).getTime(), 'at' + a, '提醒');
  }
  list.sort((a, b) => a.schedule.at - b.schedule.at);
  try {
    const pending = await LN.getPending();
    if (pending.notifications?.length) await LN.cancel({ notifications: pending.notifications.map(n => ({ id: n.id })) });
    if (list.length) await LN.schedule({ notifications: list.slice(0, MAX) });
  } catch (e) { console.warn('排提醒失敗', e); }
}
