// 首頁：像助理的白板。今天的行程、任務、隨手記排在一起
import * as db from '../db.js';
import { h, taskRow, empty, today, addDays, parseYmd, WEEK, fmtDate, modal } from '../ui.js';

export function renderHome(el) {
  const t = today();
  const d = parseYmd(t);

  // 今天：只放任務。長按拖曳排過的依 day_order，其餘依時間、建立順序
  const todayTasks = db.tasks(x => db.onDay(x, t)).sort((a, b) =>
    (a.day_order ?? 1e9) - (b.day_order ?? 1e9) || (a.start_time || '99').localeCompare(b.start_time || '99') || a.created_at.localeCompare(b.created_at));
  const todayList = h('div', { class: 'today-list' }, todayTasks.map(x => {
    const row = taskRow(x, { showDate: false });
    if (x.start_time) row.querySelector('.task-main').prepend(h('span', { class: 'time inline' }, x.start_time));
    row.dataset.sort = x.id;
    return row;
  }));
  sortable(todayList, ids => db.putMany('tasks', ids.map((id, i) => ({ id, day_order: i }))));

  const upcoming = db.tasks(x => x.date && x.date > t && x.date <= addDays(t, 7)).sort(db.sortByDate);
  const byDay = {};
  upcoming.forEach(x => (byDay[x.date] ??= []).push(x));
  // 待安排：依星數分組（多→少），同組新的在前；首頁最多 15 項
  const unscheduled = db.tasks(x => !x.date && x.status !== 'done')
    .sort((a, b) => (b.priority || 0) - (a.priority || 0) || b.created_at.localeCompare(a.created_at));
  const shown = unscheduled.slice(0, HOME_LIMIT);
  const pending = [];
  shown.forEach((x, i) => {
    const p = x.priority || 0;
    if (i === 0 || p !== (shown[i - 1].priority || 0)) pending.push(h('div', { class: 'prio-label' }, p ? '★'.repeat(p) : '未標記'));
    pending.push(taskRow(x));
  });

  // 快速輸入：Enter 直接變成今天的任務；「詳細」打開任務頁再補資料
  const input = h('input', { id: 'quick', class: 'quick-input', placeholder: '記點什麼…',
    oninput: e => e.target.parentNode.classList.toggle('has', !!e.target.value),
    onkeydown: e => { if (e.key === 'Enter') addToday(); } });
  const addToday = () => {
    const v = input.value.trim(); if (!v) return;
    db.put('tasks', { title: v, notes: '', date: t, end_date: null, start_time: null, end_time: null, status: 'todo', priority: 0, tag_ids: [], reminders: [] });
    document.getElementById('quick')?.focus();
  };

  el.replaceChildren(h('div', { class: 'home' },
    h('div', { class: 'home-top' },
      h('div', { class: 'home-art' }, h('img', { src: '20260729.png', alt: '' })),
      h('div', { class: 'home-head' },
      h('div', {}, h('div', { class: 'big-date' }, `${d.getMonth() + 1}月${d.getDate()}日`), h('div', { class: 'muted' }, `星期${WEEK[d.getDay()]}`)),
      h('div', { class: 'quick' }, input,
        h('div', { class: 'quick-btns' },
          h('button', { onclick: addToday }, '記下'),
          h('button', { onclick: () => { const v = input.value.trim(); window.openTask(null, { title: v, date: t }); input.value = ''; } }, '詳細'))))),
    h('div', { class: 'home-grid' },
      h('section', { class: 'block today-block' }, h('h3', {}, '今天'), todayList),
      h('div', { class: 'home-side' },
        h('section', { class: 'block' },
          h('h3', {}, '接下來一週'),
          Object.keys(byDay).length ? Object.entries(byDay).map(([day, list]) => h('div', { class: 'day-group' },
            h('div', { class: 'day-label' }, fmtDate(day)), list.map(x => taskRow(x, { showDate: false })))) : empty('沒有')),
        h('section', { class: 'block' },
          h('h3', {}, '待安排'),
          unscheduled.length ? pending : empty('沒有'),
          h('button', { class: 'add', onclick: openAllTasks }, `顯示全部${unscheduled.length > HOME_LIMIT ? `（還有 ${unscheduled.length - HOME_LIMIT} 項）` : ''}`))))));
}

const HOME_LIMIT = 15;

// 全部任務列表：依建立時間新到舊；可切換只看待安排或所有任務
function openAllTasks() {
  let mode = 'pending';
  const list = h('div', { class: 'all-list' });
  const seg = h('div', { class: 'seg' });
  const render = () => {
    const items = db.tasks(x => mode === 'all' || (!x.date && x.status !== 'done')).sort((a, b) => b.created_at.localeCompare(a.created_at));
    seg.replaceChildren(...[['pending', '待安排'], ['all', '所有任務']].map(([k, l]) =>
      h('button', { class: mode === k ? 'on' : '', onclick: () => { mode = k; render(); } }, l)));
    list.replaceChildren(h('div', { class: 'muted small' }, `${items.length} 項・新到舊`), ...(items.length ? items.map(x => taskRow(x)) : [empty('沒有')]));
  };
  const close = modal(h('div', { class: 'page' },
    h('div', { class: 'page-head' }, seg, h('span', { class: 'spacer' }), h('button', { class: 'icon', onclick: () => close() }, '✕')),
    h('div', { class: 'page-body' }, list)), { cls: 'page-modal' });
  render();
  // 在清單裡勾完成或編輯後即時更新
  db.onChange(() => list.isConnected && render());
}

// 長按（約 0.35 秒）後拖曳排序；手指／滑鼠一開始就移動則視為捲動
function sortable(list, onDrop) {
  let suppress = false;
  list.addEventListener('click', e => { if (suppress) { e.stopPropagation(); e.preventDefault(); suppress = false; } }, true);
  list.addEventListener('contextmenu', e => e.preventDefault());
  list.addEventListener('pointerdown', e => {
    const row = e.target.closest('[data-sort]');
    if (!row || e.button > 0 || e.target.closest('input, button')) return;
    const sx = e.clientX, sy = e.clientY;
    let dragging = false;
    const timer = setTimeout(() => { dragging = true; row.classList.add('lifting'); navigator.vibrate?.(15); }, 350);
    const blockScroll = ev => { if (dragging) ev.preventDefault(); };
    const move = ev => {
      if (!dragging) { if (Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) > 8) end(); return; }
      ev.preventDefault();
      const over = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('[data-sort]');
      if (over && over !== row && over.parentNode === list) {
        const r = over.getBoundingClientRect();
        list.insertBefore(row, ev.clientY > r.top + r.height / 2 ? over.nextSibling : over);
      }
    };
    const end = () => {
      clearTimeout(timer);
      removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', end);
      row.removeEventListener('touchmove', blockScroll);
      row.classList.remove('lifting');
    };
    const up = () => {
      const was = dragging; end();
      if (was) { suppress = true; setTimeout(() => (suppress = false), 300); onDrop([...list.querySelectorAll('[data-sort]')].map(x => x.dataset.sort)); }
    };
    addEventListener('pointermove', move, { passive: false }); addEventListener('pointerup', up); addEventListener('pointercancel', end);
    row.addEventListener('touchmove', blockScroll, { passive: false });
  });
}
