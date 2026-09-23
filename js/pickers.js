// App 內建的選擇器（取代手機系統的日期／時間選單與下拉選單）
import { h, popover, today, ymd, parseYmd, addDays, WEEK } from './ui.js';

const pad = n => String(n).padStart(2, '0');

// 日期：小月曆。onPick(null) = 清除
export function pickDate(anchor, value, onPick, { clearable = true, min = null } = {}) {
  let cursor = (value || today()).slice(0, 7);
  const box = h('div', { class: 'dp' });
  let p;
  const render = () => {
    const [y, m] = cursor.split('-').map(Number);
    const first = new Date(y, m - 1, 1);
    const start = new Date(y, m - 1, 1 - first.getDay());
    const t = today();
    const move = n => { cursor = ymd(new Date(y, m - 1 + n, 1)).slice(0, 7); render(); };
    box.replaceChildren(
      h('div', { class: 'dp-head' },
        h('button', { class: 'icon', onclick: () => move(-1) }, '‹'),
        h('b', {}, `${y}年${m}月`),
        h('button', { class: 'icon', onclick: () => move(1) }, '›')),
      h('div', { class: 'dp-grid' },
        [...WEEK].map(w => h('span', { class: 'dp-wd' }, w)),
        [...Array(42)].map((_, i) => {
          const d = new Date(start); d.setDate(start.getDate() + i);
          const day = ymd(d);
          const off = min && day < min;
          return h('button', {
            class: 'dp-day' + (d.getMonth() !== m - 1 ? ' out' : '') + (day === t ? ' today' : '') + (day === value ? ' on' : ''),
            disabled: off || null,
            onclick: () => { p.close(); onPick(day); },
          }, d.getDate());
        })),
      h('div', { class: 'row pad' },
        h('button', { onclick: () => { p.close(); onPick(t); } }, '今天'),
        h('button', { onclick: () => { p.close(); onPick(addDays(t, 1)); } }, '明天'),
        h('span', { class: 'spacer' }),
        clearable ? h('button', { class: 'link', onclick: () => { p.close(); onPick(null); } }, '清除') : null));
    p?.place();
  };
  render();
  p = popover(anchor, box, { width: 290, stack: true });
  return p;
}

// 時間：先選小時、再選分鐘（每 5 分鐘）。onPick(null) = 不設時間
export function pickTime(anchor, value, onPick, { clearLabel = '不設時間' } = {}) {
  let hour = null; // 一律先選小時（目前的小時會標示）
  const box = h('div', { class: 'tp2' });
  let p;
  const render = () => {
    box.replaceChildren(
      h('div', { class: 'tp2-head' }, hour == null ? '選小時' : h('span', {}, h('button', { class: 'link', onclick: () => { hour = null; render(); } }, '‹ ' + pad(hour) + ' 時'), '　選分鐘')),
      hour == null
        ? h('div', { class: 'tp2-grid' }, [...Array(24)].map((_, i) => h('button', { class: value && +value.slice(0, 2) === i ? 'on' : '', onclick: () => { hour = i; render(); } }, pad(i))))
        : h('div', { class: 'tp2-grid' }, [...Array(12)].map((_, i) => {
          const mm = pad(i * 5), v = `${pad(hour)}:${mm}`;
          return h('button', { class: v === value ? 'on' : '', onclick: () => { p.close(); onPick(v); } }, ':' + mm);
        })),
      h('div', { class: 'row pad' }, h('span', { class: 'spacer' }), h('button', { class: 'link', onclick: () => { p.close(); onPick(null); } }, clearLabel)));
    p?.place();
  };
  render();
  p = popover(anchor, box, { width: 260, stack: true });
  return p;
}

// 選項選單：options = [[value, label], …]
export function pickOption(anchor, options, value, onPick, { width = 220 } = {}) {
  const p = popover(anchor, h('div', { class: 'menu' },
    options.map(([v, label]) => h('div', { class: 'menu-row' + (v === value ? ' on' : ''), onclick: () => { p.close(); onPick(v); } },
      label, h('span', { class: 'spacer' }), v === value ? '✓' : ''))), { width, stack: true });
  return p;
}

// 看起來像下拉選單的按鈕（點了用 App 內的選單）
export function selectButton(options, value, onPick, attrs = {}) {
  const label = () => options.find(o => o[0] === value)?.[1] ?? '';
  const btn = h('button', { type: 'button', class: 'sel-btn ' + (attrs.class || ''),
    onclick: () => pickOption(btn, options, value, v => { value = v; btn.firstChild.textContent = label(); onPick(v); }, attrs) },
    h('span', {}, label()), h('span', { class: 'caret' }, '▾'));
  return btn;
}

// 日期／時間按鈕（顯示目前值，點了開選擇器）
export function dateButton(value, onPick, { placeholder = '日期', clearable = true, min } = {}) {
  const btn = h('button', { type: 'button', class: 'sel-btn' });
  const show = () => btn.replaceChildren(value ? `${+value.slice(5, 7)}/${+value.slice(8)}（${WEEK[parseYmd(value).getDay()]}）` : h('span', { class: 'blank' }, placeholder));
  btn.onclick = () => pickDate(btn, value, v => { value = v; show(); onPick(v); }, { clearable, min });
  show();
  return btn;
}

export function timeButton(value, onPick, { placeholder = '時間', clearLabel } = {}) {
  const btn = h('button', { type: 'button', class: 'sel-btn' });
  const show = () => btn.replaceChildren(value || h('span', { class: 'blank' }, placeholder));
  btn.onclick = () => pickTime(btn, value, v => { value = v; show(); onPick(v); }, { clearLabel });
  show();
  return btn;
}
