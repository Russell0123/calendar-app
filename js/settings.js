// 設定（右上角）：行事曆管理、清除資料、提醒、備份
import * as db from './db.js';
import { h, modal, ask, confirmBox, toast, today, addDays } from './ui.js';
import { parseICS, icsToTasks } from './ics.js';

export function openSettings() {
  const body = h('div', { class: 'page-body settings' });
  const file = h('input', { type: 'file', accept: '.json', style: { display: 'none' }, onchange: async e => {
    const f = e.target.files[0]; if (!f) return;
    try { db.importJSON(await f.text()); render(); toast('匯入完成'); } catch (err) { toast('匯入失敗：' + err.message); }
  } });
  document.body.append(file);
  const close = modal(h('div', { class: 'page' },
    h('div', { class: 'page-head' }, h('b', {}, '設定'), h('span', { class: 'spacer' }), h('button', { class: 'icon', onclick: () => close() }, '✕')),
    body), { cls: 'page-modal', onClose: () => file.remove() });

  const sec = (title, ...kids) => h('section', { class: 'set-sec' }, h('h3', {}, title), ...kids);
  const pick = (label, key, def, options) => h('div', { class: 'look-item' }, h('span', { class: 'muted small' }, label),
    h('div', { class: 'accent-pick' }, options.map(([k, name, icon]) =>
      h('button', { class: (db.meta()[key] || def) === k ? 'on' : '', onclick: () => { db.setMeta({ [key]: k }); render(); } }, icon, name))));

  function render() {
    const cals = db.calendars();
    const cur = db.currentCal();
    body.replaceChildren(
      sec('提醒',
        h('label', { class: 'row' }, '沒設時間的任務，提醒以', h('input', { type: 'time', value: db.meta().default_remind_time, onchange: e => db.setMeta({ default_remind_time: e.target.value }) }), '為準'),
        notifyRow()),

      sec('外觀',
        h('div', { class: 'look' },
          pick('主題色', 'accent', 'ink', [['ink', '黑', h('span', { class: 'swatch-lg', style: { background: '#2b2a27' } })], ['neon', '螢光綠', h('span', { class: 'swatch-lg', style: { background: '#3dff5c' } })]]),
          pick('字體', 'font', 'serif', [['serif', '明體', h('span', { class: 'font-demo serif' }, '字')], ['sans', '黑體', h('span', { class: 'font-demo sans' }, '字')]]))),

      sec('國定假日',
        h('div', { class: 'row wrap' },
          h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: db.meta().auto_holidays !== false,
            onchange: e => { db.setMeta({ auto_holidays: e.target.checked }); if (e.target.checked) import('./holidays.js').then(m => m.autoImport()); } }), '自動加入今年和明年的國定假日'),
          h('button', { onclick: async () => {
            const m = await import('./holidays.js');
            const n = await m.autoImport({ force: true }).catch(() => -1);
            toast(n < 0 ? '無法取得假日資料' : n ? `已加入 ${n} 筆假日` : '假日都已經是最新的');
          } }, '立即更新'))),

      sec('行事曆',
        cals.map(c => h('div', { class: 'set-row' + (c.id === cur?.id ? ' cur' : '') },
          h('input', { type: 'radio', name: 'cal', checked: c.id === cur?.id, onchange: () => { db.setMeta({ current_calendar_id: c.id }); render(); } }),
          h('input', { class: 'grow', value: c.name, onchange: e => e.target.value.trim() && db.put('calendars', { id: c.id, name: e.target.value.trim() }) }),
          h('button', { onclick: e => ask(e.currentTarget, '副本名稱', c.name + ' 副本', name => { db.copyCalendar(c.id, name); render(); }) }, '複製'),
          cals.length > 1 ? h('button', { class: 'danger', onclick: () => confirmBox(`刪除行事曆「${c.name}」以及裡面所有資料？`, () => { db.deleteCalendar(c.id); render(); }) }, '刪除') : null)),
        h('button', { class: 'add', onclick: e => ask(e.currentTarget, '新行事曆名稱', '', name => { db.newCalendar(name); render(); }) }, '＋ 新行事曆')),

      sec(`清除「${cur?.name ?? ''}」的資料`,
        h('div', { class: 'row wrap' },
          h('button', { onclick: () => confirmBox('刪除這個行事曆的所有任務（含連線、隨手記）？標籤與課表會保留。', () => db.clearCalendar(cur.id, 'tasks')) }, '刪除所有任務'),
          h('button', { class: 'danger', onclick: () => confirmBox('清空這個行事曆的所有資料（任務、標籤、課表、流程、視圖）？', () => { db.clearCalendar(cur.id); render(); }, '清空') }, '清空全部資料'))),

      gcalSection(sec),

      sec('備份',
        h('div', { class: 'row wrap' },
          h('button', { onclick: exportFile }, '匯出備份'),
          h('button', { onclick: () => file.click() }, '匯入備份'),
          h('button', { class: 'danger', onclick: () => confirmBox('清除所有行事曆並還原示範資料？', () => { db.resetDemo(); render(); }, '還原') }, '還原示範資料'))));
  }

  render();
}

// 匯入 Google 日曆（.ics）：選日期範圍與標籤，可重複使用；同一事件再匯入會更新不會重複
function gcalSection(sec) {
  const t = today();
  const from = h('input', { type: 'date', value: t });
  const to = h('input', { type: 'date', value: addDays(t, 90) });
  const GOOGLE = '__google';
  const tagSel = h('select', {},
    h('option', { value: GOOGLE }, '加上「Google」標籤'),
    h('option', { value: '' }, '不加標籤'),
    db.tags().map(x => h('option', { value: x.id }, `加上「${x.name}」`)));
  const input = h('input', { type: 'file', accept: '.ics,text/calendar', multiple: true, style: { display: 'none' }, onchange: async e => {
    const files = [...e.target.files]; e.target.value = '';
    if (!files.length) return;
    if (!from.value || !to.value || from.value > to.value) return toast('日期範圍不正確');
    try {
      const events = (await Promise.all(files.map(f => f.text()))).flatMap(parseICS);
      const rows = icsToTasks(events, from.value, to.value);
      if (!rows.length) return toast('這個範圍內沒有事件');
      const known = new Set(db.tasks(x => x.ext_id).map(x => x.ext_id));
      const fresh = rows.filter(r => !known.has(r.ext_id)).length;
      confirmBox(`找到 ${rows.length} 筆：新增 ${fresh}、更新 ${rows.length - fresh}`, () => {
        const tagId = tagSel.value === GOOGLE ? db.ensureTag('Google') : tagSel.value || null;
        const { added, updated } = db.importTasks(rows, tagId);
        toast(`已匯入：新增 ${added}、更新 ${updated}`);
      }, '匯入');
    } catch (err) { toast('讀取失敗：' + err.message); }
  } });
  return sec('匯入 Google 日曆',
    h('div', { class: 'row wrap' }, from, '～', to),
    h('div', { class: 'row wrap' }, tagSel,
      h('button', { onclick: () => input.click() }, '選擇 .ics 檔'),
      h('button', { class: 'link', onclick: gcalHelp }, '教學'), input));
}

function gcalHelp() {
  const step = (n, ...kids) => h('li', {}, ...kids);
  const close = modal(h('div', { class: 'page' },
    h('div', { class: 'page-head' }, h('b', {}, '如何取得 .ics 檔'), h('span', { class: 'spacer' }), h('button', { class: 'icon', onclick: () => close() }, '✕')),
    h('div', { class: 'page-body help' },
      h('ol', {},
        step(1, '用', h('b', {}, '電腦'), '打開 calendar.google.com（手機 App 沒有匯出功能）'),
        step(2, '右上角 ⚙ → ', h('b', {}, '設定')),
        step(3, '左側選單 → ', h('b', {}, '匯入與匯出')),
        step(4, '「匯出」區塊按 ', h('b', {}, '匯出'), '，會下載一個 .zip'),
        step(5, '解壓縮 .zip，裡面每個日曆各一個 ', h('b', {}, '.ics'), ' 檔'),
        step(6, '回到這裡選日期範圍和標籤，按「選擇 .ics 檔」（可一次選多個）')),
      h('div', { class: 'muted small' }, '只想匯入單一日曆：設定 → 左側點該日曆 →「匯出日曆」。重複匯入同一段時間不會產生重複任務。'))), { cls: 'page-modal' });
}

// 手機提醒的權限狀態（只在 Android App 裡顯示）
function notifyRow() {
  const box = h('div', { class: 'row wrap' });
  if (!window.Capacitor?.isNativePlatform?.()) return box;
  import('./notify.js').then(async n => {
    const s = await n.status();
    if (!s) return;
    const okNotify = s.notify === 'granted', okExact = s.exact !== 'denied';
    box.replaceChildren(
      h('span', { class: okNotify ? '' : 'sync-error' }, okNotify ? '通知：已允許' : '通知：未允許'),
      okNotify ? null : h('button', { onclick: async () => { await n.askPermission(); n.reschedule(); } }, '允許通知'),
      h('span', { class: okExact ? '' : 'sync-error' }, okExact ? '準時提醒：已開啟' : '準時提醒：未開啟'),
      okExact ? null : h('button', { onclick: () => n.openExactSetting() }, '開啟準時提醒'),
      h('button', { onclick: async () => { await n.reschedule(); toast('提醒已重新排程'); } }, '重新排程'));
  });
  return box;
}

function exportFile() {
  const a = h('a', { href: URL.createObjectURL(new Blob([db.exportJSON()], { type: 'application/json' })), download: `calendar-backup-${new Date().toISOString().slice(0, 10)}.json` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
