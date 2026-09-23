// 任務頁（仿 Notion）：完成／重要程度 → 標題 → 屬性列 → 筆記；邊打字邊自動儲存
import * as db from './db.js';
import { h, modal, popover, chip, fmtWhen, fmtDate, confirmDelete, parseYmd, WEEK, canAutofocus } from './ui.js';
import { tagPicker } from './tags.js';
import { repeatLabel } from './repeat.js';
import { selectButton, dateButton, timeButton } from './pickers.js';

const REMIND = [[0, '準時'], [60, '前一小時'], [1440, '前一天'], [2880, '前兩天'], [4320, '前三天'], [10080, '前一週']];
const OLD_REMIND = { 10: '10 分鐘前', 180: '3 小時前' };
const remindLabel = m => REMIND.find(r => r[0] === m)?.[1] || OLD_REMIND[m] || `${m} 分鐘前`;
const fmtAt = s => `${+s.slice(5, 7)}/${+s.slice(8, 10)} ${s.slice(11, 16)}`;

// opts.occ：從重複任務的某一次打開（勾完成、刪除只影響那一次）
export function openTask(id, preset = {}, opts = {}) {
  const orig = id ? db.get('tasks', id) : null;
  const d = orig ? structuredClone(orig) : {
    id: db.uid(), title: '', notes: '', date: null, end_date: null, start_time: null, end_time: null,
    status: 'todo', priority: 0, tag_ids: [], reminders: [], ...preset,
  };
  d.remind_at ??= [];
  const occ = orig?.repeat?.freq ? opts.occ : null;
  let deleted = false, ready = false, saveTimer = 0;
  // 任何欄位改動後 0.4 秒自動儲存（初始化完成後才開始）
  const touch = () => { if (!ready) return; clearTimeout(saveTimer); saveTimer = setTimeout(() => persist(false), 400); };

  const blankText = () => h('span', { class: 'blank' }, '空白');
  const prop = (label, value) => h('div', { class: 'prop' }, h('div', { class: 'prop-k' }, label), value);

  // ---------- 標題上方：完成（左）、重要程度（右） ----------
  const doneBox = h('label', { class: 'done-toggle' },
    h('input', { type: 'checkbox', checked: occ ? (d.done_dates || []).includes(occ) : d.status === 'done', onchange: e => {
      if (occ) { const set = new Set(d.done_dates || []); e.target.checked ? set.add(occ) : set.delete(occ); d.done_dates = [...set]; }
      else d.status = e.target.checked ? 'done' : 'todo';
      touch();
    } }),
    occ ? `這一次（${fmtDate(occ)}）完成` : '完成');
  const starV = h('div', { class: 'stars-pick' });
  const renderStars = () => { starV.replaceChildren(...[1, 2, 3].map(n => h('span', {
    class: 'star' + (n <= (d.priority || 0) ? ' on' : ''),
    onclick: () => { d.priority = d.priority === n ? 0 : n; renderStars(); },
  }, '★'))); touch(); };

  // ---------- 屬性列（固定節點，只更新內容，讓浮動選單一直貼著它） ----------
  const dateV = h('div', { class: 'pv' });
  const renderDate = () => {
    dateV.replaceChildren(d.date ? [fmtWhen(d), d.repeat?.freq ? h('span', { class: 'muted' }, '・' + repeatLabel(d)) : null] : blankText());
    touch();
  };
  dateV.onclick = () => datePop(dateV, d, renderDate);

  const tagV = h('div', { class: 'pv chips' });
  const renderTags = () => { tagV.replaceChildren(d.tag_ids.length ? d.tag_ids.map(i => db.get('tags', i)).filter(Boolean).map(t => chip(t)) : blankText()); touch(); };
  tagV.onclick = () => tagPicker(tagV, d.tag_ids, renderTags);

  const remindV = h('div', { class: 'pv chips' });
  const renderRemind = () => {
    remindV.replaceChildren(d.reminders.length || d.remind_at.length
      ? [...d.reminders.map(m => h('span', { class: 'chip plain' }, remindLabel(m))), ...d.remind_at.map(a => h('span', { class: 'chip plain' }, '⏰ ' + fmtAt(a)))]
      : blankText());
    touch();
  };
  remindV.onclick = () => remindPop(remindV, d, renderRemind);

  // 流程：只列出這個任務在哪些流程圖裡，點了跳過去
  const boards = db.mine('boards', b => b.nodes.some(n => n.task_id === d.id));
  const flowV = h('div', { class: 'pv chips' }, boards.length
    ? boards.map(b => h('span', { class: 'chip plain link-chip', onclick: () => { close(); window.gotoBoard?.(b.id); } }, b.title))
    : blankText());

  renderDate(); renderTags(); renderRemind(); renderStars();

  const title = h('textarea', { class: 'page-title', rows: 1, placeholder: '未命名', value: d.title,
    oninput: e => { d.title = e.target.value.replace(/\n/g, ''); fit(title); touch(); },
    oncompositionend: touch, onblur: () => persist(false),
    onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); notes.focus(); } } });
  // 筆記跟著內容長高：只有點到文字那幾行才會開始打字，下面的空白不會叫出鍵盤
  const notes = h('textarea', { class: 'page-notes', rows: 1, placeholder: '筆記…', value: d.notes || '',
    oninput: e => { d.notes = e.target.value; fit(notes); touch(); }, onblur: () => persist(false) });
  const fit = el => { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; };

  const saved = h('span', { class: 'muted small' }, orig ? '' : '輸入標題後會自動儲存');
  const close = modal(h('div', { class: 'page' },
    h('div', { class: 'page-head' },
      h('span', { class: 'muted small' }, db.currentCal()?.name ?? ''),
      occ ? h('span', { class: 'muted small' }, `・重複任務，這次是 ${fmtDate(occ)}`) : null,
      h('span', { class: 'spacer' }),
      orig ? h('button', { class: 'icon', title: '刪除任務', onclick: () => occ
        ? deleteOccurrence(occ, () => { d.skip_dates = [...new Set([...(d.skip_dates || []), occ])]; close(); }, () => { deleted = true; db.remove('tasks', d.id); close(); })
        : confirmDelete('刪除這個任務？', () => { deleted = true; db.remove('tasks', d.id); close(); }) }, '刪除') : null,
      h('button', { class: 'icon', onclick: () => close() }, '✕')),
    h('div', { class: 'page-body' },
      h('div', { class: 'page-top' }, doneBox, h('span', { class: 'spacer' }), starV),
      title,
      h('div', { class: 'props' },
        prop('日期', dateV), prop('標籤', tagV), prop('提醒', remindV), prop('流程', flowV)),
      notes),
    h('div', { class: 'page-foot' }, saved, h('span', { class: 'spacer' }), h('button', { class: 'primary save-btn', onclick: () => close() }, '儲存'))),
    { cls: 'page-modal', onClose: () => persist(true) });

  let exists = !!orig; // 這個任務已經寫進資料了嗎（新任務在第一次自動儲存時建立）
  function persist(final) {
    clearTimeout(saveTimer);
    if (deleted) return;
    // 直接讀輸入框（手機輸入法組字中的文字也算）
    d.title = title.value.replace(/\n/g, '');
    d.notes = notes.value;
    const row = { ...d };
    if (!row.title.trim()) {
      if (!final) return;
      if (orig) row.title = orig.title;
      else {
        if (exists) db.remove('tasks', d.id);
        db.all('links', l => l.from === d.id || l.to === d.id).forEach(l => db.remove('links', l.id));
        return;
      }
    }
    for (const k of ['end_date', 'start_time', 'end_time']) if (!row[k]) row[k] = null;
    if (row.end_date && (!row.date || row.end_date <= row.date)) row.end_date = null;
    if (!row.date) row.repeat = null; // 沒日期不能重複
    db.put('tasks', row);
    exists = true;
    saved.textContent = '已自動儲存';
  }
  ready = true;
  requestAnimationFrame(() => { fit(title); fit(notes); if (!orig && canAutofocus()) title.focus(); });
}

// ---------- 日期：開始（日期＋時間）、可勾「結束時間」、重複 ----------
function datePop(anchor, d, update) {
  const box = h('div', { class: 'datepop' });
  let p;
  const set = patch => {
    Object.assign(d, patch);
    if (!d.date) d.repeat = null;
    update(); render();
  };
  function render() {
    const hasEnd = d.end_date != null || d.end_time != null;
    box.replaceChildren(
      h('div', { class: 'dp-row' }, h('span', { class: 'dp-label' }, '開始'),
        dateButton(d.date, v => set(v ? { date: v } : { date: null, end_date: null, end_time: null }), { placeholder: '選日期' }),
        timeButton(d.start_time, v => set({ start_time: v }), { placeholder: '時間' })),
      h('label', { class: 'toggle' }, '結束時間',
        h('input', { type: 'checkbox', checked: hasEnd, onchange: e => set(e.target.checked ? { end_date: d.date, end_time: '' } : { end_date: null, end_time: null }) })),
      hasEnd ? h('div', { class: 'dp-row' }, h('span', { class: 'dp-label' }, '結束'),
        dateButton(d.end_date || d.date, v => set({ end_date: v }), { placeholder: '選日期', min: d.date, clearable: false }),
        timeButton(d.end_time || null, v => set({ end_time: v || '' }), { placeholder: '時間' })) : null,
      h('div', { class: 'menu-sep' }),
      repeatSection(d, set),
      h('div', { class: 'row' }, h('span', { class: 'spacer' }),
        h('button', { class: 'link', onclick: () => { set({ date: null, end_date: null, start_time: null, end_time: null, repeat: null }); p.close(); } }, '清除日期')));
    p?.place();
  }
  render();
  p = popover(anchor, box, { width: 320 });
}

// 重複：每天／每週幾／每月同一天或第 N 個週幾／每年，可設間隔與結束日
function repeatSection(d, setTask) {
  if (!d.date) return h('div', { class: 'muted small' }, '設定日期後可以重複');
  const r = d.repeat || {};
  const s = parseYmd(d.date), wd = s.getDay();
  const n = Math.ceil(s.getDate() / 7);
  const isLastWeek = s.getDate() + 7 > new Date(s.getFullYear(), s.getMonth() + 1, 0).getDate();
  const set = patch => setTask({ repeat: patch && { ...r, ...patch } });
  const unit = { daily: '天', weekly: '週', monthly: '個月', yearly: '年' }[r.freq];
  const iv = r.interval || 1;

  return h('div', { class: 'rep-sec' },
    h('div', { class: 'dp-row' }, h('span', { class: 'dp-label' }, '重複'),
      selectButton([['', '不重複'], ['daily', '每天'], ['weekly', '每週'], ['monthly', '每月'], ['yearly', '每年']], r.freq || '',
        v => set(v ? { freq: v, interval: iv, weekdays: [wd], monthly: 'date', nth: null } : null)),
      r.freq ? h('span', { class: 'stepper' }, '每',
        h('button', { type: 'button', onclick: () => set({ interval: Math.max(1, iv - 1) }) }, '－'),
        h('b', {}, iv),
        h('button', { type: 'button', onclick: () => set({ interval: Math.min(99, iv + 1) }) }, '＋'),
        unit) : null),
    r.freq === 'weekly' ? h('div', { class: 'chips' }, [1, 2, 3, 4, 5, 6, 0].map(x => {
      const on = (r.weekdays || [wd]).includes(x);
      return h('span', { class: 'chip day' + (on ? ' on' : ''), onclick: () => {
        const list = (r.weekdays || [wd]).filter(y => y !== x);
        set({ weekdays: on ? (list.length ? list : [x]) : [...list, x] });
      } }, WEEK[x]);
    })) : null,
    r.freq === 'monthly' ? h('div', { class: 'chips' }, [
      ['date', null, `每月 ${s.getDate()} 號`],
      n <= 4 ? ['nth', n, `第 ${n} 個週${WEEK[wd]}`] : null,
      isLastWeek ? ['nth', -1, `最後一個週${WEEK[wd]}`] : null,
    ].filter(Boolean).map(([mode, nth, label]) =>
      h('span', { class: 'chip day' + (r.monthly === mode && (mode === 'date' || (r.nth ?? n) === nth) ? ' on' : ''), onclick: () => set({ monthly: mode, nth }) }, label))) : null,
    r.freq ? h('div', { class: 'dp-row' },
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!r.until, onchange: e => set({ until: e.target.checked ? d.date : null }) }), '結束於'),
      r.until ? dateButton(r.until, v => set({ until: v }), { min: d.date, clearable: false }) : null) : null,
    r.freq ? h('div', { class: 'muted small' }, repeatLabel(d)) : null);
}

// ---------- 提醒：提前（相對任務時間）或指定某個時間點 ----------
function remindPop(anchor, d, update) {
  const box = h('div', { class: 'menu' });
  let atDate = d.date, atTime = d.start_time || db.meta().default_remind_time || '09:00';
  const render = () => box.replaceChildren(
    REMIND.map(([m, l]) => h('div', { class: 'menu-row', onclick: () => {
      d.reminders = d.reminders.includes(m) ? d.reminders.filter(x => x !== m) : [...d.reminders, m].sort((a, b) => a - b);
      update(); render();
    } }, l, h('span', { class: 'spacer' }), d.reminders.includes(m) ? '✓' : '')),
    d.remind_at.map(a => h('div', { class: 'menu-row', onclick: () => { d.remind_at = d.remind_at.filter(x => x !== a); update(); render(); } },
      '⏰ ' + fmtAt(a), h('span', { class: 'spacer' }), '✕')),
    h('div', { class: 'menu-sep' }),
    h('div', { class: 'row pad wrap' },
      dateButton(atDate, v => (atDate = v), { placeholder: '日期', clearable: false }),
      timeButton(atTime, v => (atTime = v || '09:00'), { placeholder: '時間', clearLabel: '取消' }),
      h('button', { onclick: () => {
        if (!atDate) return;
        const v = `${atDate}T${atTime}`;
        if (!d.remind_at.includes(v)) { d.remind_at = [...d.remind_at, v].sort(); update(); render(); }
      } }, '指定時間')),
    h('div', { class: 'muted small pad' }, `沒設時間的任務以 ${db.meta().default_remind_time} 為準`));
  render();
  popover(anchor, box, { width: 300 });
}

// 刪除重複任務：只刪這一次，或整個系列
function deleteOccurrence(occ, onlyThis, all) {
  const close = modal(h('div', { class: 'confirm' },
    h('div', { class: 'confirm-msg' }, '這是重複任務，要刪除哪些？'),
    h('div', { class: 'row end wrap' },
      h('button', { onclick: () => close() }, '取消'),
      h('button', { onclick: () => { close(); onlyThis(); } }, `只刪這一次（${fmtDate(occ)}）`),
      h('button', { class: 'primary', onclick: () => { close(); all(); } }, '刪除全部'))), { cls: 'confirm-modal' });
}

