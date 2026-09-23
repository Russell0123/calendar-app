// 任務頁（仿 Notion）：標題 + 屬性列 + 筆記，關閉時自動儲存
import * as db from './db.js';
import { h, modal, popover, chip, fmtWhen, confirmBox } from './ui.js';
import { tagPicker } from './tags.js';

const REMIND = [[0, '準時'], [10, '10 分鐘前'], [60, '1 小時前'], [180, '3 小時前'], [1440, '1 天前'], [4320, '3 天前'], [10080, '1 週前']];
const remindLabel = m => REMIND.find(r => r[0] === m)?.[1] || `${m} 分鐘前`;

export function openTask(id, preset = {}) {
  const orig = id ? db.get('tasks', id) : null;
  const d = orig ? structuredClone(orig) : {
    id: db.uid(), title: '', notes: '', date: null, end_date: null, start_time: null, end_time: null,
    status: 'todo', priority: 0, tag_ids: [], reminders: [], ...preset,
  };
  let deleted = false;

  const blankText = h('span', { class: 'blank' }, '空白');
  const prop = (label, value) => h('div', { class: 'prop' }, h('div', { class: 'prop-k' }, label), value);

  // 各屬性值是固定節點，只更新內容，讓浮動選單能一直貼著它
  const dateV = h('div', { class: 'pv' });
  const renderDate = () => dateV.replaceChildren(d.date ? fmtWhen(d) : blankText.cloneNode(true));
  dateV.onclick = () => datePop(dateV, d, renderDate);

  const tagV = h('div', { class: 'pv chips' });
  const renderTags = () => tagV.replaceChildren(...(d.tag_ids.length ? d.tag_ids.map(i => db.get('tags', i)).filter(Boolean).map(t => chip(t)) : [blankText.cloneNode(true)]));
  tagV.onclick = () => tagPicker(tagV, d.tag_ids, renderTags);

  const remindV = h('div', { class: 'pv chips' });
  const renderRemind = () => remindV.replaceChildren(...(d.reminders.length ? d.reminders.map(m => h('span', { class: 'chip plain' }, remindLabel(m))) : [blankText.cloneNode(true)]));
  remindV.onclick = () => remindPop(remindV, d, renderRemind);

  const status = h('label', { class: 'pv status' },
    h('input', { type: 'checkbox', checked: d.status === 'done', onchange: e => (d.status = e.target.checked ? 'done' : 'todo') }), '已完成');

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
  const renderStars = () => starV.replaceChildren(...[1, 2, 3].map(n => h('span', {
    class: 'star' + (n <= (d.priority || 0) ? ' on' : ''),
    onclick: () => { d.priority = d.priority === n ? 0 : n; renderStars(); },
  }, '★')), !d.priority ? h('span', { class: 'blank' }, ' 未標記') : null);

  renderDate(); renderTags(); renderRemind(); renderLinks(); renderStars();

  const title = h('textarea', { class: 'page-title', rows: 1, placeholder: '未命名', value: d.title,
    oninput: e => { d.title = e.target.value.replace(/\n/g, ''); fit(); },
    onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); notes.focus(); } } });
  const fit = () => { title.style.height = 'auto'; title.style.height = title.scrollHeight + 'px'; };
  const notes = h('textarea', { class: 'page-notes', placeholder: '筆記…', value: d.notes || '', oninput: e => (d.notes = e.target.value) });

  const close = modal(h('div', { class: 'page' },
    h('div', { class: 'page-head' },
      h('span', { class: 'muted small' }, db.currentCal()?.name ?? ''), h('span', { class: 'spacer' }),
      orig ? h('button', { class: 'icon', title: '刪除任務', onclick: () => confirmBox('刪除這個任務？', () => { deleted = true; db.remove('tasks', d.id); close(); }) }, '刪除') : null,
      h('button', { class: 'icon', onclick: () => close() }, '✕')),
    h('div', { class: 'page-body' },
      title,
      h('div', { class: 'props' },
        prop('日期', dateV), prop('標籤', tagV), prop('重要', starV), prop('狀態', status), prop('提醒', remindV), prop('流程', linkV)),
      notes)), { cls: 'page-modal', onClose: save });

  function save() {
    if (deleted) return;
    if (!d.title.trim()) {
      if (orig) d.title = orig.title;
      else { db.all('links', l => l.from === d.id || l.to === d.id).forEach(l => db.remove('links', l.id)); return; }
    }
    for (const k of ['end_date', 'start_time', 'end_time']) if (!d[k]) d[k] = null;
    if (d.end_date && (!d.date || d.end_date <= d.date)) d.end_date = null;
    db.put('tasks', d);
  }
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

function remindPop(anchor, d, update) {
  const box = h('div', { class: 'menu' });
  const render = () => box.replaceChildren(...REMIND.map(([m, l]) => h('div', { class: 'menu-row', onclick: () => {
    d.reminders = d.reminders.includes(m) ? d.reminders.filter(x => x !== m) : [...d.reminders, m].sort((a, b) => a - b);
    update(); render();
  } }, l, h('span', { class: 'spacer' }), d.reminders.includes(m) ? '✓' : '')),
  h('div', { class: 'muted small pad' }, `沒設時間的任務以 ${db.meta().default_remind_time} 為準`));
  render();
  popover(anchor, box, { width: 220 });
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
