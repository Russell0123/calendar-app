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

  function render() {
    const cals = db.calendars();
    const cur = db.currentCal();
    body.replaceChildren(
      sec('提醒',
        h('label', { class: 'row' }, '沒設時間的任務，提醒以', h('input', { type: 'time', value: db.meta().default_remind_time, onchange: e => db.setMeta({ default_remind_time: e.target.value }) }), '為準'),
        h('div', { class: 'muted small' }, '實際跳通知要等打包成 App 後才會啟用。')),

      sec('行事曆',
        h('div', { class: 'muted small' }, '每個行事曆的任務、標籤、課表、流程都各自獨立。'),
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
        h('div', { class: 'muted small' }, '目前資料只存在這個瀏覽器，換裝置前先匯出。'),
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

function exportFile() {
  const a = h('a', { href: URL.createObjectURL(new Blob([db.exportJSON()], { type: 'application/json' })), download: `calendar-backup-${new Date().toISOString().slice(0, 10)}.json` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
