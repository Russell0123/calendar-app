// 共用 UI 工具
import * as db from './db.js';

export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') for (const [p, x] of Object.entries(v)) p.startsWith('--') ? el.style.setProperty(p, x) : (el.style[p] = x);
    else if (k === 'value' || k === 'checked' || k === 'selected') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  kids.flat(Infinity).forEach(c => { if (c != null && c !== false) el.append(c.nodeType ? c : String(c)); });
  return el;
}

// ---------- 日期 ----------
export const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const today = () => ymd(new Date());
export const parseYmd = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const addDays = (s, n) => { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
export const WEEK = '日一二三四五六';
export const fmtDate = s => { if (!s) return ''; const d = parseYmd(s); return `${d.getMonth() + 1}/${d.getDate()}（${WEEK[d.getDay()]}）`; };
export function fmtWhen(t) {
  if (!t.date) return '';
  let s = fmtDate(t.date) + (t.start_time ? ' ' + t.start_time : '');
  if (t.end_date && t.end_date !== t.date) s += ' → ' + fmtDate(t.end_date) + (t.end_time ? ' ' + t.end_time : '');
  else if (t.end_time) s += '–' + t.end_time;
  return s;
}

// ---------- 顏色（沉穩色系） ----------
export const COLORS = {
  gray: ['#e6e2da', '#4a463f', '灰'], brown: ['#e8dacb', '#6b4a33', '棕'], orange: ['#f0d9c0', '#8a5424', '橙'],
  yellow: ['#ede0b8', '#6b571a', '黃'], green: ['#d6e0cf', '#3d5a35', '綠'], blue: ['#d3dde4', '#34516a', '藍'],
  purple: ['#ddd6e3', '#54436b', '紫'], pink: ['#ead5da', '#7a3f52', '粉'], red: ['#eacfc7', '#8a3b2c', '紅'],
};
export const colorOf = name => COLORS[name] || COLORS.gray;

export function chip(tag, attrs = {}, ...extra) {
  const [bg, fg] = colorOf(tag.color);
  return h('span', { class: 'chip', style: { background: bg, color: fg }, ...attrs }, tag.name, ...extra);
}

// 任務顯示色：只有灰色標籤→灰；恰好一種其他顏色→該色；兩種以上→略深的灰
const MIXED = ['#d5cfc3', '#2b2a27'];
export function taskColor(t) {
  const colors = [...new Set(db.taskTags(t).map(x => x.color).filter(c => c && c !== 'gray'))];
  if (colors.length > 1) return MIXED;
  return colorOf(colors[0] || 'gray');
}

// ---------- 彈窗 ----------
export function modal(body, { onClose, cls = '' } = {}) {
  const bg = h('div', { class: 'modal-bg', onmousedown: e => { if (e.target === bg) close(); } });
  const box = h('div', { class: 'modal ' + cls }, body);
  bg.append(box);
  document.body.append(bg);
  const esc = e => { if (e.key === 'Escape' && !document.querySelector('.pop') && bg === [...document.querySelectorAll('.modal-bg')].pop()) close(); };
  document.addEventListener('keydown', esc);
  function close() { if (!bg.isConnected) return; document.removeEventListener('keydown', esc); bg.remove(); onClose?.(); }
  return close;
}

// 確認框與提示（不用瀏覽器原生 confirm/alert/prompt：App 內嵌環境常不支援）
export function confirmBox(message, onYes, yesLabel = '刪除') {
  const close = modal(h('div', { class: 'confirm' },
    h('div', { class: 'confirm-msg' }, message),
    h('div', { class: 'row end' },
      h('button', { onclick: () => close() }, '取消'),
      h('button', { class: 'primary', onclick: () => { close(); onYes(); } }, yesLabel))), { cls: 'confirm-modal' });
}

export function toast(msg) {
  const t = h('div', { class: 'toast' }, msg);
  document.body.append(t);
  setTimeout(() => t.remove(), 2400);
}

// ---------- 浮動選單（貼著觸發元素） ----------
export function popover(anchor, content, { onClose, width = 300 } = {}) {
  document.querySelectorAll('.pop').forEach(p => p._close?.());
  const pop = h('div', { class: 'pop', style: { width: `min(${width}px, calc(100vw - 16px))` } }, content);
  document.body.append(pop);
  const place = () => {
    const r = anchor.getBoundingClientRect();
    const w = pop.offsetWidth, ht = pop.offsetHeight;
    let left = Math.min(r.left, innerWidth - w - 8);
    let top = r.bottom + 4;
    if (top + ht > innerHeight - 8) top = Math.max(8, r.top - ht - 4);
    pop.style.left = Math.max(8, left) + 'px'; pop.style.top = top + 'px';
  };
  place();
  const outside = e => { if (!pop.contains(e.target) && !anchor.contains(e.target)) close(); };
  const esc = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  setTimeout(() => document.addEventListener('pointerdown', outside, true));
  document.addEventListener('keydown', esc, true);
  function close() {
    if (!pop.isConnected) return;
    document.removeEventListener('pointerdown', outside, true);
    document.removeEventListener('keydown', esc, true);
    pop.remove(); onClose?.();
  }
  pop._close = close; pop._place = place;
  return { close, place, el: pop };
}

// ---------- 任務列 ----------
export function taskRow(t, { showDate = true } = {}) {
  return h('div', { class: 'task' + (t.status === 'done' ? ' done' : '') },
    h('input', { type: 'checkbox', checked: t.status === 'done', onclick: e => { e.stopPropagation(); db.put('tasks', { id: t.id, status: e.target.checked ? 'done' : 'todo' }); } }),
    h('div', { class: 'task-main', onclick: () => window.openTask(t.id) },
      h('div', { class: 'task-title' }, t.title || '（未命名）', t.priority ? h('span', { class: 'stars' }, '★'.repeat(t.priority)) : null),
      (showDate && t.date) || t.tag_ids?.length ? h('div', { class: 'task-meta' },
        showDate && t.date ? h('span', { class: 'when' }, fmtWhen(t)) : null, db.taskTags(t).map(o => chip(o))) : null));
}

export const empty = text => h('div', { class: 'empty' }, text);

// 簡易輸入框（取代 prompt，手機也好用）
export function ask(anchor, placeholder, value, onOk) {
  const input = h('input', { value: value || '', placeholder, onkeydown: e => { if (e.key === 'Enter' && input.value.trim()) { p.close(); onOk(input.value.trim()); } } });
  const p = popover(anchor, h('div', { class: 'ask' }, input, h('button', { class: 'primary', onclick: () => { if (input.value.trim()) { p.close(); onOk(input.value.trim()); } } }, '確定')), { width: 280 });
  setTimeout(() => { input.focus(); input.select(); }, 30);
}
