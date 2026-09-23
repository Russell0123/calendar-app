// 課表頁：節次 × 星期的格子，可切換週次。
// 每門課連一個科目標籤；當天有該科目的任務會顯示在那堂課裡
import * as db from '../db.js';
import { h, modal, chip, today, parseYmd, addDays, WEEK, confirmBox, toast, taskColor } from '../ui.js';
import { tagPicker } from '../tags.js';
import { PERIODS } from '../periods.js';
import { selectButton } from '../pickers.js';
import { occurrences } from '../repeat.js';

let weekStart = null; // 週一

const hasTag = (x, id) => id && x.tag_ids?.includes(id);

// 這科之後的未完成任務（首頁用）
export function courseTasks(c) {
  const t = today();
  return db.tasks(x => x.status !== 'done' && x.date && x.date >= t && hasTag(x, c.tag_id)).sort(db.sortByDate);
}

export function renderSchedule(el) {
  const t = today();
  if (!weekStart) { const d = parseYmd(t); weekStart = addDays(t, -((d.getDay() + 6) % 7)); }
  const dateOf = day => addDays(weekStart, (day + 6) % 7);
  const courses = db.mine('courses');
  // 週一到週五固定顯示；週末有課才顯示
  const days = [1, 2, 3, 4, 5, ...[6, 0].filter(d => courses.some(c => c.day === d))];
  const move = n => { weekStart = addDays(weekStart, n * 7); renderSchedule(el); };

  const grid = h('div', { class: 'tt', style: { gridTemplateColumns: `var(--tt-label) repeat(${days.length}, minmax(0, 1fr))`, gridTemplateRows: `auto repeat(${PERIODS.length}, minmax(var(--tt-row), auto))` } },
    h('div', { class: 'tt-corner' }),
    days.map((d, i) => {
      const date = dateOf(d);
      return h('div', { class: 'tt-day' + (date === t ? ' today' : ''), style: { gridColumn: i + 2 } },
        h('div', {}, WEEK[d]), h('div', { class: 'tt-date' }, `${+date.slice(5, 7)}/${+date.slice(8)}`));
    }),
    PERIODS.map(([label], p) => h('div', { class: 'tt-period', style: { gridRow: p + 2 } }, label)),
    // 空格：點了新增課程
    days.flatMap((d, i) => PERIODS.map((_, p) => h('div', { class: 'tt-cell', style: { gridColumn: i + 2, gridRow: p + 2 }, onclick: () => editCourse(null, { day: d, start: p, end: p }) }))),
    courses.filter(c => days.includes(c.day)).map(c => {
      const date = dateOf(c.day);
      const due = occurrences(db.tasks(x => hasTag(x, c.tag_id)), date, date).sort(db.sortByDate);
      return h('div', { class: 'tt-course' + (due.length ? ' has-due' : ''), style: { gridColumn: days.indexOf(c.day) + 2, gridRow: `${c.start + 2} / ${c.end + 3}` }, onclick: () => editCourse(c.id) },
        h('div', { class: 'tt-name' }, c.name),
        c.room ? h('div', { class: 'tt-room' }, c.room) : null,
        c.teacher ? h('div', { class: 'tt-teacher' }, c.teacher) : null,
        due.map(x => {
          const [bg, fg] = taskColor(x);
          return h('div', { class: 'tt-task' + (x.status === 'done' ? ' done' : ''), style: { background: bg, color: fg },
            onclick: e => { e.stopPropagation(); window.openTask(x.id, {}, { occ: x._occ }); } }, x.title);
        }));
    }));

  const s = parseYmd(weekStart), e = parseYmd(addDays(weekStart, 6));
  el.replaceChildren(
    h('div', { class: 'page-bar' },
      h('button', { class: 'icon', onclick: () => move(-1) }, '‹'),
      h('b', {}, `${s.getMonth() + 1}/${s.getDate()} – ${e.getMonth() + 1}/${e.getDate()}`),
      h('button', { class: 'icon', onclick: () => move(1) }, '›'),
      h('button', { onclick: () => { weekStart = null; renderSchedule(el); } }, '本週'),
      h('span', { class: 'spacer' }),
      h('button', { onclick: () => editCourse(null, { day: parseYmd(t).getDay() || 1, start: 0, end: 0 }) }, '＋ 課程')),
    grid);
}

function editCourse(id, preset = {}) {
  const orig = id ? db.get('courses', id) : null;
  const d = orig ? structuredClone(orig) : { name: '', room: '', teacher: '', notes: '', tag_id: null, day: 1, start: 0, end: 0, ...preset };
  const prop = (k, v) => h('div', { class: 'prop' }, h('div', { class: 'prop-k' }, k), v);

  const dayBox = h('div', { class: 'chips' });
  const renderDays = () => dayBox.replaceChildren(...[1, 2, 3, 4, 5, 6, 0].map(n =>
    h('span', { class: 'chip day' + (d.day === n ? ' on' : ''), onclick: () => { d.day = n; renderDays(); } }, WEEK[n])));
  renderDays();

  // 節次：App 內建選單；開始晚於結束時自動把結束拉到同一節
  const periodOpts = PERIODS.map(([l], i) => [i, `第 ${l} 節`]);
  const periodBox = h('div', { class: 'row' });
  const renderPeriods = () => periodBox.replaceChildren(
    selectButton(periodOpts, d.start, v => { d.start = v; if (d.end < v) d.end = v; renderPeriods(); }, { width: 140 }), '到',
    selectButton(periodOpts, d.end, v => { d.end = Math.max(v, d.start); renderPeriods(); }, { width: 140 }));
  renderPeriods();

  // 科目標籤（單選）：沒選的話儲存時用課名自動建立；點 ⋯ 可改成簡稱
  const tagSel = d.tag_id && db.get('tags', d.tag_id) ? [d.tag_id] : [];
  const tagV = h('div', { class: 'pv chips' });
  const renderTag = () => tagV.replaceChildren(tagSel.length && db.get('tags', tagSel[0]) ? chip(db.get('tags', tagSel[0])) : h('span', { class: 'blank' }, '儲存時自動建立'));
  tagV.onclick = () => tagPicker(tagV, tagSel, arr => { arr.splice(0, arr.length - 1); renderTag(); });
  renderTag();

  const inp = (k, ph) => h('input', { class: 'bare', placeholder: ph, value: d[k] || '', oninput: e => (d[k] = e.target.value) });

  const save = () => {
    if (!d.name.trim()) { toast('請填課程名稱'); return false; }
    d.tag_id = tagSel[0] || db.ensureSubjectTag(d.name.trim());
    db.put('courses', d);
    return true;
  };

  const close = modal(h('div', { class: 'page' },
    h('div', { class: 'page-head' }, h('span', { class: 'muted small' }, '課程'), h('span', { class: 'spacer' }),
      orig ? h('button', { class: 'icon', onclick: () => confirmBox(`刪除「${orig.name}」？（科目標籤會保留）`, () => { db.remove('courses', id); close(); }) }, '刪除') : null,
      h('button', { class: 'icon', onclick: () => close() }, '✕')),
    h('div', { class: 'page-body' },
      h('input', { class: 'page-title', placeholder: '課程名稱', value: d.name, oninput: e => (d.name = e.target.value) }),
      h('div', { class: 'props' },
        prop('科目', tagV),
        prop('星期', dayBox),
        prop('節次', periodBox),
        prop('教室', inp('room', '空白')),
        prop('老師', inp('teacher', '空白'))),
      h('textarea', { class: 'page-notes', placeholder: '筆記…', value: d.notes || '', oninput: e => (d.notes = e.target.value) }),
      h('div', { class: 'row end' },
        h('button', { onclick: () => { if (save()) { close(); window.openTask(null, { tag_ids: [d.tag_id] }); } } }, '＋ 這科的任務'),
        h('button', { class: 'primary', onclick: () => { if (save()) close(); } }, '儲存')))), { cls: 'page-modal' });
}
