// 行事曆管理（左上角選單 →「管理行事曆」）：列出行事曆；點進單一行事曆可改名、複製、刪除、
// 清除資料、匯入 Google 日曆、國定假日、備份
import * as db from './db.js';
import { h, modal, ask, confirmBox, toast, today, addDays } from './ui.js';
import { parseICS, icsToTasks } from './ics.js';
import { selectButton, dateButton } from './pickers.js';

const isApp = () => !!window.Capacitor?.isNativePlatform?.();

export function openCalendars() {
  const body = h('div', { class: 'page-body' });
  const close = modal(h('div', { class: 'page' },
    h('div', { class: 'page-head' }, h('b', {}, '行事曆管理'), h('span', { class: 'spacer' }), h('button', { class: 'icon', onclick: () => close() }, '✕')),
    body), { cls: 'page-modal' });

  function render() {
    const cur = db.calId();
    body.replaceChildren(
      h('div', { class: 'cal-list' }, db.calendars().map(c => h('div', { class: 'cal-row' + (c.id === cur ? ' cur' : '') },
        h('button', { class: 'cal-pick', title: '切換到這個行事曆', onclick: () => { db.setMeta({ current_calendar_id: c.id }); render(); } },
          h('span', { class: 'radio' + (c.id === cur ? ' on' : '') }), c.name),
        h('button', { class: 'icon', onclick: () => openCalendar(c.id, render) }, '編輯 ›')))),
      h('button', { class: 'add', onclick: e => ask(e.currentTarget, '新行事曆名稱', '', name => { db.newCalendar(name); render(); }) }, '＋ 新行事曆'));
  }
  render();
}

// 單一行事曆的設定頁
function openCalendar(id, refreshList) {
  const body = h('div', { class: 'page-body settings' });
  const close = modal(h('div', { class: 'page' },
    h('div', { class: 'page-head' }, h('button', { class: 'link', onclick: () => close() }, '‹ 行事曆管理'), h('span', { class: 'spacer' }), h('button', { class: 'icon', onclick: () => close() }, '✕')),
    body), { cls: 'page-modal', onClose: refreshList });
  const sec = (title, ...kids) => h('section', { class: 'set-sec' }, h('h3', {}, title), ...kids);
  const file = h('input', { type: 'file', accept: '.json', style: { display: 'none' }, onchange: async e => {
    const f = e.target.files[0]; if (!f) return;
    try { db.importJSON(await f.text()); toast('匯入完成'); close(); } catch (err) { toast('匯入失敗：' + err.message); }
  } });

  function render() {
    const c = db.get('calendars', id);
    if (!c) return close();
    const many = db.calendars().length > 1;
    body.replaceChildren(
      sec('名稱',
        h('input', { class: 'grow cal-name', value: c.name, onchange: e => e.target.value.trim() && db.put('calendars', { id, name: e.target.value.trim() }) }),
        h('div', { class: 'row wrap' },
          h('button', { onclick: e => ask(e.currentTarget, '副本名稱', c.name + ' 副本', name => { db.copyCalendar(id, name); toast('已複製'); close(); }) }, '複製這個行事曆'),
          many ? h('button', { class: 'danger', onclick: () => confirmBox(`刪除行事曆「${c.name}」以及裡面所有資料？`, () => { db.deleteCalendar(id); close(); }) }, '刪除這個行事曆') : null)),

      sec('清除資料',
        h('div', { class: 'row wrap' },
          h('button', { onclick: () => confirmBox('刪除這個行事曆的所有任務（含連線）？標籤與課表會保留。', () => { db.clearCalendar(id, 'tasks'); toast('已刪除所有任務'); }) }, '刪除所有任務'),
          h('button', { class: 'danger', onclick: () => confirmBox('清空這個行事曆的所有資料（任務、標籤、課表、流程、視圖）？', () => { db.clearCalendar(id); toast('已清空'); }, '清空') }, '清空全部資料'),
          h('button', { class: 'danger', onclick: () => confirmBox('把這個行事曆的內容換成示範資料？（國定假日保留，其他行事曆不受影響）', () => { db.demoInto(id); toast('已還原示範資料'); }, '還原') }, '還原示範資料'))),

      gcalSection(sec, id),

      sec('國定假日',
        h('div', { class: 'row wrap' },
          h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: db.meta().auto_holidays !== false,
            onchange: e => { db.setMeta({ auto_holidays: e.target.checked }); if (e.target.checked) import('./holidays.js').then(m => m.autoImport()); } }), '自動加入今年和明年的國定假日'),
          h('button', { onclick: async () => {
            const m = await import('./holidays.js');
            const n = await m.autoImport({ force: true }).catch(() => -1);
            toast(n < 0 ? '無法取得假日資料' : n ? `已加入 ${n} 筆假日` : '假日都已經是最新的');
          } }, '立即更新'))),

      sec('備份（全部行事曆）',
        h('div', { class: 'row wrap' },
          // 手機 App 裡沒辦法下載檔案，按鈕變灰
          h('button', { disabled: isApp() || null, title: isApp() ? '請用電腦版匯出' : null, onclick: exportFile }, '匯出備份'),
          h('button', { onclick: () => file.click() }, '匯入備份'), file)));
  }
  render();
}

// 匯入 Google 日曆（.ics）到指定的行事曆：選日期範圍與標籤；同一事件再匯入會更新不會重複
function gcalSection(sec, calId) {
  const t = today();
  let from = t, to = addDays(t, 90), tag = '__google';
  const tagOptions = [['__google', '加上「Google」標籤'], ['', '不加標籤'],
    ...db.all('tags', x => x.calendar_id === calId).map(x => [x.id, `加上「${x.name}」`])];
  const input = h('input', { type: 'file', accept: '.ics,text/calendar', multiple: true, style: { display: 'none' }, onchange: async e => {
    const files = [...e.target.files]; e.target.value = '';
    if (!files.length) return;
    if (!from || !to || from > to) return toast('日期範圍不正確');
    try {
      const events = (await Promise.all(files.map(f => f.text()))).flatMap(parseICS);
      const rows = icsToTasks(events, from, to);
      if (!rows.length) return toast('這個範圍內沒有事件');
      const known = new Set(db.all('tasks', x => x.calendar_id === calId && x.ext_id).map(x => x.ext_id));
      const fresh = rows.filter(r => !known.has(r.ext_id)).length;
      confirmBox(`找到 ${rows.length} 筆：新增 ${fresh}、更新 ${rows.length - fresh}`, () => {
        const tagId = tag === '__google' ? db.ensureTag('Google', 'gray', calId) : tag || null;
        const { added, updated } = db.importTasks(rows, tagId, calId);
        toast(`已匯入：新增 ${added}、更新 ${updated}`);
      }, '匯入');
    } catch (err) { toast('讀取失敗：' + err.message); }
  } });
  return sec('匯入 Google 日曆',
    h('div', { class: 'row wrap' },
      dateButton(from, v => (from = v), { clearable: false }), '～', dateButton(to, v => (to = v), { clearable: false })),
    h('div', { class: 'row wrap' },
      selectButton(tagOptions, tag, v => (tag = v), { width: 240 }),
      h('button', { onclick: () => input.click() }, '選擇 .ics 檔'),
      h('button', { class: 'link', onclick: gcalHelp }, '教學'), input));
}

function gcalHelp() {
  const li = (...kids) => h('li', {}, ...kids);
  const close = modal(h('div', { class: 'page' },
    h('div', { class: 'page-head' }, h('b', {}, '如何取得 .ics 檔'), h('span', { class: 'spacer' }), h('button', { class: 'icon', onclick: () => close() }, '✕')),
    h('div', { class: 'page-body help' },
      h('ol', {},
        li('用', h('b', {}, '電腦'), '打開 calendar.google.com（手機 App 沒有匯出功能）'),
        li('右上角 ⚙ → ', h('b', {}, '設定')),
        li('左側選單 → ', h('b', {}, '匯入與匯出')),
        li('「匯出」區塊按 ', h('b', {}, '匯出'), '，會下載一個 .zip'),
        li('解壓縮 .zip，裡面每個日曆各一個 ', h('b', {}, '.ics'), ' 檔'),
        li('回到這裡選日期範圍和標籤，按「選擇 .ics 檔」（可一次選多個）')),
      h('div', { class: 'muted small' }, '只想匯入單一日曆：設定 → 左側點該日曆 →「匯出日曆」。重複匯入同一段時間不會產生重複任務。'))), { cls: 'page-modal' });
}

function exportFile() {
  const a = h('a', { href: URL.createObjectURL(new Blob([db.exportJSON()], { type: 'application/json' })), download: `calendar-backup-${new Date().toISOString().slice(0, 10)}.json` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
