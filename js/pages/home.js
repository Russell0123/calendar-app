// 首頁：像助理的白板。今天的行程、任務、隨手記排在一起
import * as db from '../db.js';
import { h, taskRow, empty, today, addDays, parseYmd, WEEK, fmtDate, modal } from '../ui.js';
import { PERIODS } from '../periods.js';
import { courseTasks } from './schedule.js';

export function renderHome(el) {
  const t = today();
  const d = parseYmd(t);

  const courses = db.mine('courses', c => c.day === d.getDay());
  const todayTasks = db.tasks(x => db.onDay(x, t));
  const notes = db.mine('notes', n => n.date === t || !n.done);

  // 今天：課程和有時間的任務依時間排，沒時間的任務接著，隨手記最後
  const timed = [
    ...courses.map(c => ({ time: PERIODS[c.start][1], el: courseRow(c) })),
    ...todayTasks.filter(x => x.start_time).map(x => ({ time: x.start_time, el: withTime(x.start_time, taskRow(x, { showDate: false })) })),
  ].sort((a, b) => a.time.localeCompare(b.time)).map(x => x.el);
  const untimed = todayTasks.filter(x => !x.start_time).map(x => taskRow(x, { showDate: false }));
  const noteRows = notes.sort((a, b) => (a.done - b.done) || a.created_at.localeCompare(b.created_at)).map(noteRow);

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

  const input = h('input', { id: 'quick', class: 'quick-input', placeholder: '記點什麼…',
    oninput: e => e.target.parentNode.classList.toggle('has', !!e.target.value),
    onkeydown: e => { if (e.key === 'Enter') addNote(); } });
  const addNote = () => { const v = input.value.trim(); if (!v) return; db.put('notes', { date: t, text: v, done: false }); document.getElementById('quick')?.focus(); };

  el.replaceChildren(h('div', { class: 'home' },
    h('div', { class: 'home-top' },
      h('div', { class: 'home-art' }, h('img', { src: '20260729.png', alt: '' })),
      h('div', { class: 'home-head' },
      h('div', {}, h('div', { class: 'big-date' }, `${d.getMonth() + 1}月${d.getDate()}日`), h('div', { class: 'muted' }, `星期${WEEK[d.getDay()]}`)),
      h('div', { class: 'quick' }, input,
        h('div', { class: 'quick-btns' },
          h('button', { onclick: addNote }, '記下'),
          h('button', { onclick: () => { const v = input.value.trim(); window.openTask(null, { title: v, date: t }); input.value = ''; } }, '建成任務'))))),
    h('div', { class: 'home-grid' },
      h('section', { class: 'block today-block' },
        h('h3', {}, '今天'),
        timed, untimed, noteRows.length > 0 && (timed.length > 0 || untimed.length > 0) ? h('div', { class: 'thin-sep' }) : null, noteRows,
        !timed.length && !untimed.length && !noteRows.length ? empty('沒有安排') : null),
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

const withTime = (time, row) => { row.prepend(h('span', { class: 'time' }, time)); return row; };

function courseRow(c) {
  const next = courseTasks(c)[0];
  return h('div', { class: 'task routine-row' },
    h('span', { class: 'time' }, PERIODS[c.start][1]),
    h('div', { class: 'task-main', onclick: () => next && window.openTask(next.id) },
      h('div', { class: 'task-title' }, c.name, c.room ? h('span', { class: 'muted small' }, '　' + c.room) : null),
      h('div', { class: 'task-meta' }, h('span', { class: 'when' }, `第 ${PERIODS[c.start][0]}${c.end > c.start ? '–' + PERIODS[c.end][0] : ''} 節`),
        next ? h('span', { class: 'when' }, `・${next.title} ${fmtDate(next.date)}`) : null)));
}

function noteRow(n) {
  return h('div', { class: 'task note' + (n.done ? ' done' : '') },
    h('input', { type: 'checkbox', checked: n.done, onchange: e => db.put('notes', { id: n.id, done: e.target.checked }) }),
    h('div', { class: 'task-main' }, h('div', { class: 'task-title' }, n.text, n.date !== today() ? h('span', { class: 'muted small' }, '　' + fmtDate(n.date)) : null)),
    h('button', { class: 'icon', title: '刪除', onclick: () => db.remove('notes', n.id) }, '×'));
}
