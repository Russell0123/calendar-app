// 任務頁（仿 Notion）：標題 + 屬性列 + 筆記，關閉時自動儲存
import * as db from './db.js';
import { h, modal, popover, chip, fmtWhen, fmtDate, confirmBox, parseYmd, WEEK } from './ui.js';
import { tagPicker } from './tags.js';
import { repeatLabel } from './repeat.js';

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
  const touch = () => { if (!ready) return; clearTimeout(saveTimer); saveTimer = setTimeout(() => persist(false), 400); };

  const blankText = h('span', { class: 'blank' }, '空白');
  const prop = (label, value) => h('div', { class: 'prop' }, h('div', { class: 'prop-k' }, label), value);

  // 各屬性值是固定節點，只更新內容，讓浮動選單能一直貼著它；每次更新也順便排程自動儲存
  const dateV = h('div', { class: 'pv' });
  const renderDate = () => (touch(), 0) || dateV.replaceChildren(d.date ? fmtWhen(d) : blankText.cloneNode(true));
  dateV.onclick = () => datePop(dateV, d, renderDate);

  const tagV = h('div', { class: 'pv chips' });
  const renderTags = () => (touch(), 0) || tagV.replaceChildren(...(d.tag_ids.length ? d.tag_ids.map(i => db.get('tags', i)).filter(Boolean).map(t => chip(t)) : [blankText.cloneNode(true)]));
  tagV.onclick = () => tagPicker(tagV, d.tag_ids, renderTags);

  const remindV = h('div', { class: 'pv chips' });
  const renderRemind = () => (touch(), 0) || remindV.replaceChildren(...(d.reminders.length || d.remind_at.length
    ? [...d.reminders.map(m => h('span', { class: 'chip plain' }, remindLabel(m))), ...d.remind_at.map(a => h('span', { class: 'chip plain' }, '⏰ ' + fmtAt(a)))]
    : [blankText.cloneNode(true)]));
  remindV.onclick = () => remindPop(remindV, d, renderRemind);

  // 重複任務從某一次打開：勾的是「這一次」
  const status = occ
    ? h('label', { class: 'pv status' },
      h('input', { type: 'checkbox', checked: (d.done_dates || []).includes(occ), onchange: e => {
        const set = new Set(d.done_dates || []); e.target.checked ? set.add(occ) : set.delete(occ); d.done_dates = [...set]; touch();
      } }), `這一次（${fmtDate(occ)}）已完成`)
    : h('label', { class: 'pv status' },
      h('input', { type: 'checkbox', checked: d.status === 'done', onchange: e => { d.status = e.target.checked ? 'done' : 'todo'; touch(); } }), '已完成');

  const repeatV = h('div', { class: 'pv' });
  const renderRepeat = () => (touch(), 0) || repeatV.replaceChildren(d.repeat?.freq && d.date ? repeatLabel(d) : blankText.cloneNode(true));
  repeatV.onclick = () => repeatPop(repeatV, d, () => { renderRepeat(); renderDate(); });

  const linkV = h('div', { class: 'pv links' });
  const renderLinks = () => {
    const side = (label, links, key, add) => [h('span', { class: 'muted' }, label),
      links.map(l => { const t = db.get('tasks', l[key]); return t && h('span', { class: 'chip plain' }, t.title,
        h('span', { class: 'x', onclick: e => { e.stopPropagation(); db.remove('links', l.id); renderLinks(); } }, '×')); }),
      h('button', { class: 'icon add-link', onclick: e => linkPop(e.currentTarget, d.id, add, renderLinks) }, '＋')];
    linkV.replaceChildren(
      ...side('前置', db.all('links', l => l.to === d.id), 'from', other => db.addLink(other, d.id)),
      h('span', { class: 'sep' }),
      ...side('後續', db.all('links', l => l.from === d.id), 'to', other => db.addLink(d.id, other)));
  };

  // 重要程度 0–3：點第 n 顆設成 n 星，再點同一顆歸零
  const starV = h('div', { class: 'pv stars-pick' });
  const renderStars = () => (touch(), 0) || starV.replaceChildren(...[1, 2, 3].map(n => h('span', {
    class: 'star' + (n <= (d.priority || 0) ? ' on' : ''),
    onclick: () => { d.priority = d.priority === n ? 0 : n; renderStars(); },
  }, '★')), !d.priority ? h('span', { class: 'blank' }, ' 未標記') : null);

  renderDate(); renderTags(); renderRemind(); renderLinks(); renderStars(); renderRepeat();

  const title = h('textarea', { class: 'page-title', rows: 1, placeholder: '未命名', value: d.title,
    oninput: e => { d.title = e.target.value.replace(/\n/g, ''); fit(); touch(); },
    oncompositionend: touch, onblur: () => persist(false),
    onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); notes.focus(); } } });
  const fit = () => { title.style.height = 'auto'; title.style.height = title.scrollHeight + 'px'; };
  const notes = h('textarea', { class: 'page-notes', placeholder: '筆記…', value: d.notes || '', oninput: e => { d.notes = e.target.value; touch(); }, onblur: () => persist(false) });

  const saved = h('span', { class: 'muted small' }, orig ? '' : '輸入標題後會自動儲存');
  const close = modal(h('div', { class: 'page' },
    h('div', { class: 'page-head' },
      h('span', { class: 'muted small' }, db.currentCal()?.name ?? ''),
      occ ? h('span', { class: 'muted small' }, `・重複任務，這次是 ${fmtDate(occ)}`) : null,
      h('span', { class: 'spacer' }),
      orig ? h('button', { class: 'icon', title: '刪除任務', onclick: () => occ
        ? deleteOccurrence(occ, () => { d.skip_dates = [...new Set([...(d.skip_dates || []), occ])]; close(); }, () => { deleted = true; db.remove('tasks', d.id); close(); })
        : confirmBox('刪除這個任務？', () => { deleted = true; db.remove('tasks', d.id); close(); }) }, '刪除') : null,
      h('button', { class: 'icon', onclick: () => close() }, '✕')),
    h('div', { class: 'page-body' },
      title,
      h('div', { class: 'props' },
        prop('日期', dateV), prop('重複', repeatV), prop('標籤', tagV), prop('重要', starV), prop('狀態', status), prop('提醒', remindV), prop('流程', linkV)),
      notes),
    h('div', { class: 'page-foot' }, saved, h('span', { class: 'spacer' }), h('button', { class: 'primary save-btn', onclick: () => close() }, '儲存'))),
    { cls: 'page-modal', onClose: () => persist(true) });

  let exists = !!orig; // 這個任務已經寫進資料了嗎（新任務在第一次自動儲存時建立）
  function persist(final) {
    clearTimeout(saveTimer);
    if (deleted) return;
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
  requestAnimationFrame(() => { fit(); if (!orig) title.focus(); });
}

// 日期：主日期 + 可開關的結束日期、時間（仿 Notion）
function datePop(anchor, d, update) {
  const box = h('div', { class: 'datepop' });
  const set = patch => { Object.assign(d, patch); update(); render(); };
  const toggle = (label, on, onChange) => h('label', { class: 'toggle' }, label, h('input', { type: 'checkbox', checked: on, onchange: e => onChange(e.target.checked) }));
  let p;
  function render() {
    const hasEnd = d.end_date != null, hasTime = d.start_time != null;
    box.replaceChildren(
      h('div', { class: 'row' },
        h('input', { type: 'date', value: d.date || '', onchange: e => set({ date: e.target.value || null }) }),
        hasTime ? h('input', { type: 'time', value: d.start_time || '', onchange: e => set({ start_time: e.target.value || '' }) }) : null),
      hasEnd || (hasTime && d.end_time != null) ? h('div', { class: 'row' }, h('span', { class: 'muted' }, '→'),
        hasEnd ? h('input', { type: 'date', value: d.end_date || '', onchange: e => set({ end_date: e.target.value || '' }) }) : null,
        hasTime ? h('input', { type: 'time', value: d.end_time || '', onchange: e => set({ end_time: e.target.value || null }) }) : null) : null,
      toggle('結束日期', hasEnd, on => set({ end_date: on ? (d.date || '') : null })),
      toggle('包含時間', hasTime, on => set(on ? { start_time: '', end_time: '' } : { start_time: null, end_time: null })),
      h('button', { class: 'link', onclick: () => { set({ date: null, end_date: null, start_time: null, end_time: null }); p.close(); } }, '清除'));
    p?.place();
  }
  render();
  p = popover(anchor, box, { width: 290 });
}

// 提醒：提前（相對任務時間）或指定某個時間點
function remindPop(anchor, d, update) {
  const box = h('div', { class: 'menu' });
  const at = h('input', { type: 'datetime-local', value: d.date ? `${d.date}T${d.start_time || db.meta().default_remind_time || '09:00'}` : '' });
  const render = () => box.replaceChildren(
    ...REMIND.map(([m, l]) => h('div', { class: 'menu-row', onclick: () => {
      d.reminders = d.reminders.includes(m) ? d.reminders.filter(x => x !== m) : [...d.reminders, m].sort((a, b) => a - b);
      update(); render();
    } }, l, h('span', { class: 'spacer' }), d.reminders.includes(m) ? '✓' : '')),
    ...d.remind_at.map(a => h('div', { class: 'menu-row', onclick: () => { d.remind_at = d.remind_at.filter(x => x !== a); update(); render(); } },
      '⏰ ' + fmtAt(a), h('span', { class: 'spacer' }), '✕')),
    h('div', { class: 'menu-sep' }),
    h('div', { class: 'row pad' }, at, h('button', { onclick: () => {
      if (!at.value || d.remind_at.includes(at.value)) return;
      d.remind_at = [...d.remind_at, at.value].sort(); update(); render();
    } }, '指定時間')),
    h('div', { class: 'muted small pad' }, `沒設時間的任務以 ${db.meta().default_remind_time} 為準`));
  render();
  popover(anchor, box, { width: 280 });
}

// 重複：每天／每週幾／每月同一天或第 N 個週幾／每年，可設間隔與結束日
function repeatPop(anchor, d, update) {
  const box = h('div', { class: 'datepop repeat-pop' });
  let p;
  const render = () => {
    if (!d.date) { box.replaceChildren(h('div', { class: 'muted' }, '先設定日期，才能設定重複')); p?.place(); return; }
    const r = d.repeat || {};
    const s = parseYmd(d.date), wd = s.getDay();
    const n = Math.ceil(s.getDate() / 7);
    const isLastWeek = s.getDate() + 7 > new Date(s.getFullYear(), s.getMonth() + 1, 0).getDate();
    const set = patch => { d.repeat = patch && { ...r, ...patch }; update(); render(); };
    const unit = { daily: '天', weekly: '週', monthly: '個月', yearly: '年' }[r.freq];

    box.replaceChildren(
      h('select', { onchange: e => set(e.target.value ? { freq: e.target.value, interval: r.interval || 1, weekdays: [wd], monthly: 'date', nth: null } : null) },
        [['', '不重複'], ['daily', '每天'], ['weekly', '每週'], ['monthly', '每月'], ['yearly', '每年']].map(([v, l]) => h('option', { value: v, selected: (r.freq || '') === v }, l))),
      r.freq ? h('label', { class: 'row' }, '每', h('input', { type: 'number', min: 1, max: 99, value: r.interval || 1, class: 'num',
        onchange: e => set({ interval: Math.max(1, +e.target.value || 1) }) }), unit) : null,
      r.freq === 'weekly' ? h('div', { class: 'chips' }, [1, 2, 3, 4, 5, 6, 0].map(x => {
        const on = (r.weekdays || [wd]).includes(x);
        return h('span', { class: 'chip day' + (on ? ' on' : ''), onclick: () => {
          const list = (r.weekdays || [wd]).filter(y => y !== x);
          set({ weekdays: on ? (list.length ? list : [x]) : [...list, x] });
        } }, WEEK[x]);
      })) : null,
      r.freq === 'monthly' ? h('div', { class: 'col' },
        ...[
          ['date', null, `每月 ${s.getDate()} 號`],
          n <= 4 ? ['nth', n, `每月第 ${n} 個週${WEEK[wd]}`] : null,
          isLastWeek ? ['nth', -1, `每月最後一個週${WEEK[wd]}`] : null,
        ].filter(Boolean).map(([mode, nth, label]) => h('label', { class: 'check' },
          h('input', { type: 'radio', name: 'mrep', checked: r.monthly === mode && (mode === 'date' || (r.nth ?? n) === nth), onchange: () => set({ monthly: mode, nth }) }), label))) : null,
      r.freq ? h('label', { class: 'toggle' }, '結束於',
        h('input', { type: 'checkbox', checked: !!r.until, onchange: e => set({ until: e.target.checked ? d.date : null }) })) : null,
      r.until ? h('input', { type: 'date', value: r.until, min: d.date, onchange: e => set({ until: e.target.value || null }) }) : null,
      r.freq ? h('div', { class: 'muted small' }, repeatLabel(d)) : null);
    p?.place();
  };
  render();
  p = popover(anchor, box, { width: 290 });
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

function linkPop(anchor, selfId, add, update) {
  const list = h('div', { class: 'menu scroll' });
  const input = h('input', { placeholder: '搜尋任務', oninput: () => render() });
  const render = () => {
    const kw = input.value.trim().toLowerCase();
    list.replaceChildren(...db.tasks(t => t.id !== selfId && (!kw || t.title.toLowerCase().includes(kw))).sort(db.sortByDate).slice(0, 60)
      .map(t => h('div', { class: 'menu-row', onclick: () => { add(t.id); update(); p.close(); } }, t.title, h('span', { class: 'spacer' }), h('span', { class: 'muted small' }, fmtWhen(t)))));
  };
  render();
  const p = popover(anchor, h('div', {}, input, list), { width: 300 });
  setTimeout(() => input.focus(), 30);
}
