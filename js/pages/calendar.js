// 月曆頁：月曆 / 看板 切換
import * as db from '../db.js';
import { h, today, ymd, taskRow, empty, fmtDate, fmtWhen, taskColor, WEEK, chip, popover, ask, confirmBox } from '../ui.js';
import { tagPicker } from '../tags.js';
import { selectButton } from '../pickers.js';
import { occurrences } from '../repeat.js';

let mode = 'month';
let cursor = null, selected = null;
let viewId = null;

export function renderCalendar(el) {
  const bar = h('div', { class: 'page-bar' },
    h('div', { class: 'seg' }, [['month', '月曆'], ['board', '看板']].map(([k, l]) =>
      h('button', { class: mode === k ? 'on' : '', onclick: () => { mode = k; renderCalendar(el); } }, l))));
  const body = h('div', { class: 'cal-body' });
  el.replaceChildren(bar, body);
  mode === 'month' ? month(body, bar, el) : boardView(body, bar, el);
}

// ---------- 月曆 ----------
function month(el, bar, root) {
  const t = today();
  if (!cursor) {
    // 今天這個月沒任務的話，跳到最近有任務的月份
    const ds = db.tasks(x => x.date).map(x => x.date).sort();
    cursor = !ds.length || ds.some(x => x.slice(0, 7) === t.slice(0, 7)) ? t.slice(0, 7) : (ds.find(x => x >= t) || ds[ds.length - 1]).slice(0, 7);
  }
  selected ??= t;
  const [y, m] = cursor.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const start = new Date(y, m - 1, 1 - first.getDay());
  // 重複任務展開成這 6 週內的每一次
  const tasks = occurrences(db.tasks(), ymd(start), ymd(new Date(start.getFullYear(), start.getMonth(), start.getDate() + 41)));
  const move = n => { cursor = ymd(new Date(y, m - 1 + n, 1)).slice(0, 7); renderCalendar(root); };

  bar.append(
    h('button', { class: 'icon', onclick: () => move(-1) }, '‹'),
    h('b', { class: 'month-title' }, `${y}年${m}月`),
    h('button', { class: 'icon', onclick: () => move(1) }, '›'),
    h('span', { class: 'spacer' }),
    h('button', { onclick: () => { cursor = t.slice(0, 7); selected = t; renderCalendar(root); } }, '今天'));

  // 一週一列；任務是跨日的連續色條，依序排進不重疊的「車道」
  const weeks = [];
  for (let w = 0; w < 6; w++) {
    const days = [...Array(7)].map((_, i) => { const d = new Date(start); d.setDate(start.getDate() + w * 7 + i); return ymd(d); });
    const [ws, we] = [days[0], days[6]];
    const evs = tasks.filter(x => x.date <= we && (x.end_date || x.date) >= ws)
      .map(x => ({ x, s: x.date < ws ? 0 : days.indexOf(x.date), e: (x.end_date || x.date) > we ? 6 : days.indexOf(x.end_date || x.date) }))
      .sort((a, b) => a.s - b.s || (b.e - b.s) - (a.e - a.s) || db.sortByDate(a.x, b.x));
    const lanes = [];
    evs.forEach(ev => { let l = lanes.findIndex(end => end < ev.s); if (l < 0) { l = lanes.length; lanes.push(-1); } lanes[l] = ev.e; ev.lane = l; });

    // 每格最多 5 行字：同一天的任務平分行數；放不下的收成「⋯」
    const MAX = 5;
    const vis = lanes.length > MAX ? MAX - 1 : lanes.length;
    const perDay = i => evs.filter(ev => ev.lane < vis && ev.s <= i && i <= ev.e).length;
    evs.forEach(ev => { const c = Math.max(...Array.from({ length: ev.e - ev.s + 1 }, (_, k) => perDay(ev.s + k))); ev.lines = Math.max(1, Math.floor(MAX / Math.max(1, c))); });
    const hidden = days.map((_, i) => evs.filter(ev => ev.lane >= vis && ev.s <= i && i <= ev.e).length);
    const more = hidden.some(Boolean);

    weeks.push(h('div', { class: 'cal-week', style: { gridTemplateRows: `26px repeat(${vis}, auto)${more ? ' auto' : ''} 1fr` } },
      days.map((day, i) => h('div', {
        class: 'cal-bg' + (parseInt(day.slice(5, 7)) !== m ? ' out' : '') + (day === t ? ' today' : '') + (day === selected ? ' sel' : ''),
        style: { gridColumn: i + 1, gridRow: '1 / -1' },
        // 點一下選取，再點一次＝新增
        onclick: () => { if (selected === day) return window.openTask(null, { date: day }); selected = day; renderCalendar(root); },
      })),
      days.map((day, i) => h('div', { class: 'cal-num' + (day === t ? ' today' : '') + (day === selected ? ' sel' : '') + (parseInt(day.slice(5, 7)) !== m ? ' out' : ''), style: { gridColumn: i + 1, gridRow: 1 } },
        h('span', {}, parseInt(day.slice(8))))),
      evs.filter(ev => ev.lane < vis).map(({ x, s, e, lane, lines }) => {
        const [bg, fg] = taskColor(x);
        const tags = db.taskTags(x);
        return h('div', {
          class: 'ev' + (x.status === 'done' ? ' done' : '') + (x.date < days[0] ? ' cl' : '') + ((x.end_date || x.date) > days[6] ? ' cr' : '') + (tags.length && lines > 1 ? ' has-tags' : ''),
          // --ln：可用行數；--lw：寬螢幕多顯示一行標籤時，標題剩下的行數
          style: { gridColumn: `${s + 1} / ${e + 2}`, gridRow: lane + 2, background: bg, color: fg, '--ln': lines, '--lw': Math.max(1, lines - 1) },
          onclick: () => window.openTask(x.id, {}, { occ: x._occ }),
        }, h('div', { class: 'ev-title' }, x.start_time ? h('span', { class: 'ev-time' }, x.start_time) : null, x.title),
          tags.length && lines > 1 ? h('div', { class: 'ev-tags' }, tags.map(o => chip(o))) : null);
      }),
      more ? hidden.map((n, i) => n ? h('div', { class: 'ev-more', style: { gridColumn: i + 1, gridRow: vis + 2 } }, '⋯') : null) : null));
  }
  const dayTasks = tasks.filter(x => db.onDay(x, selected)).sort(db.sortByDate);
  el.replaceChildren(
    h('div', { class: 'cal-month' }, h('div', { class: 'cal-wds' }, [...WEEK].map(w => h('div', {}, w))), weeks),
    h('section', { class: 'block day-list' },
      h('h3', {}, fmtDate(selected)),
      dayTasks.length ? dayTasks.map(x => taskRow(x, { showDate: false })) : empty('這天沒有任務'),
      h('button', { class: 'add', onclick: () => window.openTask(null, { date: selected }) }, '＋ 新增到這天')));
}

// ---------- 看板（可儲存的篩選視圖） ----------
function boardView(el, bar, root) {
  const views = db.mine('views').sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  let v = views.find(x => x.id === viewId) || views[0]; // 換了行事曆就改用新行事曆的視圖
  if (!v) v = db.put('views', { name: '全部', group: null, filter: { tag_ids: [], range: 'all', status: 'all' }, order: 0 });
  viewId = v.id;
  const f = v.filter ??= { tag_ids: [], range: 'all', status: 'all' };
  const save = patch => db.put('views', { id: v.id, ...patch });

  bar.append(h('div', { class: 'tabs' },
    views.map(x => h('button', { class: x.id === viewId ? 'on' : '', onclick: () => { viewId = x.id; renderCalendar(root); } }, x.name)),
    h('button', { class: 'icon', title: '新增視圖', onclick: e => ask(e.currentTarget, '視圖名稱', '', name => {
      viewId = db.put('views', { name, group: null, filter: { tag_ids: [], range: 'all', status: 'all' }, order: views.length }).id;
    }) }, '＋')));

  // App 內建選單（不用手機系統的下拉選單）
  const sel = (value, opts, onchange) => selectButton(opts, value, onchange, { width: 200 });
  const filterTags = h('div', { class: 'pv chips' });
  const selTags = [...f.tag_ids];
  const renderFT = () => filterTags.replaceChildren(...(selTags.length ? selTags.map(i => db.get('tags', i)).filter(Boolean).map(x => chip(x)) : [h('span', { class: 'blank' }, '篩選標籤')]));
  renderFT();
  filterTags.onclick = () => tagPicker(filterTags, selTags, renderFT, () => save({ filter: { ...f, tag_ids: [...selTags] } }));

  const groups = db.tagGroups().filter(Boolean);
  const controls = h('div', { class: 'view-controls' },
    filterTags,
    sel(v.group || '', [['', '列表'], ...groups.map(g => [g, '依「' + g + '」分欄'])], x => save({ group: x || null })),
    sel(f.range, [['all', '全部日期'], ['future', '今天以後'], ['past', '已過去'], ['nodate', '未排日期']], x => save({ filter: { ...f, range: x } })),
    sel(f.status || 'all', [['all', '全部狀態'], ['todo', '未完成'], ['done', '已完成']], x => save({ filter: { ...f, status: x } })),
    h('span', { class: 'spacer' }),
    h('button', { class: 'icon', title: '視圖選項', onclick: e => {
      const btn = e.currentTarget;
      const p = popover(btn, h('div', { class: 'menu' },
        h('div', { class: 'menu-row', onclick: () => { p.close(); ask(btn, '重新命名', v.name, n => save({ name: n })); } }, '重新命名'),
        h('div', { class: 'menu-row danger', onclick: () => { p.close(); confirmBox(`刪除視圖「${v.name}」？`, () => { viewId = null; db.remove('views', v.id); }); } }, '刪除視圖')), { width: 160 });
    } }, '⋯'));

  const t = today();
  const tasks = db.tasks(x => db.matchFilter(x, f, t)).sort(db.sortByDate);
  const preset = () => ({ tag_ids: [...f.tag_ids] });

  el.replaceChildren(controls, v.group && groups.includes(v.group)
    ? board(v.group, tasks, preset)
    : h('section', { class: 'block' }, h('div', { class: 'muted small' }, `${tasks.length} 項`),
      tasks.length ? tasks.map(x => taskRow(x)) : empty('沒有符合的任務'),
      h('button', { class: 'add', onclick: () => window.openTask(null, preset()) }, '＋ 新增')));
}

function board(group, tasks, preset) {
  const cols = db.tags().filter(x => (x.group || '') === group);
  const colIds = cols.map(c => c.id);
  const lists = [...cols.map(o => ({ o, list: tasks.filter(t => t.tag_ids?.includes(o.id)) })),
    { o: null, list: tasks.filter(t => !t.tag_ids?.some(id => colIds.includes(id))) }];

  // 拖曳卡片到別欄 = 換掉這個分組的標籤
  const moveTo = (taskId, fromId, toId) => {
    const t = db.get('tasks', taskId); if (!t || fromId === toId) return;
    const ids = (t.tag_ids || []).filter(id => id !== fromId);
    if (toId && !ids.includes(toId)) ids.push(toId);
    db.put('tasks', { id: taskId, tag_ids: ids });
  };

  const el = h('div', { class: 'board' }, lists.map(({ o, list }) => h('div', { class: 'board-col', 'data-opt': o?.id || '' },
    h('div', { class: 'board-head' }, o ? chip(o) : h('span', { class: 'muted' }, '無'), h('span', { class: 'muted small' }, list.length)),
    list.map(t => h('div', {
      class: 'board-card' + (t.status === 'done' ? ' done' : ''), 'data-id': t.id, 'data-from': o?.id || '',
      onclick: () => window.openTask(t.id),
    }, h('div', { class: 'bc-title' }, t.title), t.date ? h('div', { class: 'when' }, fmtWhen(t)) : null,
      h('div', { class: 'chips' }, db.taskTags(t).filter(x => x.id !== o?.id).map(x => chip(x))))),
    h('button', { class: 'add', onclick: () => { const p = preset(); if (o && !p.tag_ids.includes(o.id)) p.tag_ids.push(o.id); window.openTask(null, p); } }, '＋'))));
  boardDrag(el, moveTo);
  return el;
}

// 滑鼠：按住拖曳＝左右捲動；長按卡片再拖＝移到別欄。觸控交給原生捲動
function boardDrag(board, moveTo) {
  let suppress = false;
  board.addEventListener('click', e => { if (suppress) { e.stopPropagation(); e.preventDefault(); suppress = false; } }, true);
  board.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'mouse' || e.button !== 0 || e.target.closest('button, input, select, .chip .x')) return;
    e.preventDefault();
    const card = e.target.closest('.board-card');
    const sx = e.clientX, sy = e.clientY, sl = board.scrollLeft;
    let mode = null, ghost = null, over = null;
    const place = ev => { ghost.style.left = ev.clientX - 24 + 'px'; ghost.style.top = ev.clientY - 16 + 'px'; };
    const timer = card && setTimeout(() => {
      mode = 'card';
      card.classList.add('lifted');
      ghost = card.cloneNode(true);
      ghost.classList.add('ghost');
      ghost.style.width = card.offsetWidth + 'px';
      document.body.append(ghost);
      place(e);
    }, 250);
    const move = ev => {
      if (!mode && Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) > 5) { clearTimeout(timer); mode = 'scroll'; board.classList.add('grabbing'); }
      if (mode === 'scroll') board.scrollLeft = sl - (ev.clientX - sx);
      if (mode === 'card') {
        place(ev);
        const col = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.board-col');
        if (col !== over) { over?.classList.remove('drop'); over = col; over?.classList.add('drop'); }
        // 拖到邊緣自動捲動
        const r = board.getBoundingClientRect();
        if (ev.clientX > r.right - 40) board.scrollLeft += 12; else if (ev.clientX < r.left + 40) board.scrollLeft -= 12;
      }
    };
    const up = () => {
      clearTimeout(timer);
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      board.classList.remove('grabbing');
      if (mode) suppress = true;
      if (mode === 'card') {
        ghost.remove(); card.classList.remove('lifted'); over?.classList.remove('drop');
        if (over) moveTo(card.dataset.id, card.dataset.from || null, over.dataset.opt || null);
      }
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  });
}
