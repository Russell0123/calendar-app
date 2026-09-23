// 共用 UI 工具
import * as db from './db.js';
import { icon } from './icons.js';

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

// 讓 el.replaceChildren(...) 跟 h() 一樣：略過 null／false、自動攤平陣列
// （原生版本會把 null 顯示成「null」、把陣列顯示成「[object …]」）
const nativeReplace = Element.prototype.replaceChildren;
Element.prototype.replaceChildren = function (...kids) {
  return nativeReplace.apply(this, kids.flat(Infinity).filter(c => c != null && c !== false));
};

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
  gray: ['#e6e2da', '#4a463f', '灰'], darkgray: ['#cdc7bb', '#2b2a27', '深灰'], brown: ['#e8dacb', '#6b4a33', '棕'], orange: ['#f0d9c0', '#8a5424', '橙'],
  yellow: ['#ede0b8', '#6b571a', '黃'], green: ['#d6e0cf', '#3d5a35', '綠'], blue: ['#d3dde4', '#34516a', '藍'],
  purple: ['#ddd6e3', '#54436b', '紫'], pink: ['#ead5da', '#7a3f52', '粉'], red: ['#eacfc7', '#8a3b2c', '紅'],
};
// 螢光綠主題：標籤改成更淺、更鮮豔的配色
const NEON_COLORS = {
  gray: ['#eef0ee', '#5a605a'], darkgray: ['#d9ddd9', '#262a26'], brown: ['#f7e6d6', '#8a4f22'], orange: ['#ffe4c7', '#c25800'],
  yellow: ['#fff6bf', '#8a6d00'], green: ['#dcffdf', '#11892b'], blue: ['#dcefff', '#0a63c9'],
  purple: ['#f0e3ff', '#6d2fc4'], pink: ['#ffe1f1', '#c4186d'], red: ['#ffe1dd', '#d1321d'],
};
const isNeon = () => document.documentElement.dataset.accent === 'neon';
const isDark = () => document.documentElement.dataset.theme === 'dark';
// 深色模式：同色系的深底＋淺字，才不會在暗背景上太刺眼
const toDark = ([bg, fg, label]) => [fg + '59', bg, label];
export const colorOf = name => {
  const c = isNeon() ? NEON_COLORS[name] || NEON_COLORS.gray : COLORS[name] || COLORS.gray;
  return isDark() ? toDark(c) : c;
};

export function chip(tag, attrs = {}, ...extra) {
  const [bg, fg] = colorOf(tag.color);
  return h('span', { class: 'chip', style: { background: bg, color: fg }, ...attrs }, tag.name, ...extra);
}

// 任務顯示色：只有灰色標籤→灰；恰好一種其他顏色→該色；兩種以上→略深的灰
const MIXED = ['#d5cfc3', '#2b2a27'], NEON_MIXED = ['#e4e8e4', '#1f231f'];
export function taskColor(t) {
  const colors = [...new Set(db.taskTags(t).map(x => x.color).filter(c => c && c !== 'gray'))];
  if (colors.length > 1) return isDark() ? ['#3a3833', '#e8e3d8'] : isNeon() ? NEON_MIXED : MIXED;
  return colorOf(colors[0] || 'gray');
}

// ---------- 彈窗 ----------
const modalStack = [];
let skipPop = 0;
addEventListener('popstate', () => {
  if (skipPop) { skipPop--; return; }
  modalStack[modalStack.length - 1]?.(true);
});

export function modal(body, { onClose, cls = '' } = {}) {
  const bg = h('div', { class: 'modal-bg', onmousedown: e => { if (e.target === bg) close(); } });
  const box = h('div', { class: 'modal ' + cls }, body);
  bg.append(box);
  document.body.append(bg);
  const esc = e => { if (e.key === 'Escape' && !document.querySelector('.pop') && bg === [...document.querySelectorAll('.modal-bg')].pop()) close(); };
  document.addEventListener('keydown', esc);
  modalStack.push(close);
  history.pushState({ modal: modalStack.length }, '');
  function close(fromBack) {
    if (!bg.isConnected) return;
    // 先讓輸入框失去焦點：手機輸入法會在這時把組字中的文字確定下來
    if (bg.contains(document.activeElement)) document.activeElement.blur();
    document.removeEventListener('keydown', esc);
    modalStack.splice(modalStack.indexOf(close), 1);
    if (fromBack !== true) { skipPop++; history.back(); }
    bg.remove(); onClose?.();
  }
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

// 刪除任務用的確認：設定「刪除前確認」關掉時直接刪
export function confirmDelete(message, onYes) {
  if (db.meta().confirm_delete === false) onYes();
  else confirmBox(message, onYes);
}

export function toast(msg) {
  const t = h('div', { class: 'toast' }, msg);
  document.body.append(t);
  setTimeout(() => t.remove(), 2400);
}

// ---------- 浮動選單（貼著觸發元素） ----------
let popZ = 0;
// stack：疊在現有選單上面（例如日期選單裡再開小月曆），不關掉原本的
export function popover(anchor, content, { onClose, width = 300, stack = false } = {}) {
  if (!stack) document.querySelectorAll('.pop').forEach(p => p._close?.());
  const pop = h('div', { class: 'pop', 'data-z': ++popZ, style: { width: `min(${width}px, calc(100vw - 16px))`, zIndex: 30 + popZ } }, content);
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
  // 點在自己、觸發按鈕、或疊在上面的子選單裡都不算「外面」
  const outside = e => {
    if (pop.contains(e.target) || anchor.contains(e.target)) return;
    const other = e.target.closest?.('.pop');
    if (other && +other.dataset.z > +pop.dataset.z) return;
    close();
  };
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
    h('input', { type: 'checkbox', checked: t.status === 'done', onclick: e => { e.stopPropagation(); db.setDone(t, e.target.checked); } }),
    h('div', { class: 'task-main', onclick: () => window.openTask(t.id, {}, { occ: t._occ }) },
      h('div', { class: 'task-title' }, t.title || '（未命名）', t.repeat?.freq ? h('span', { class: 'rep', title: '重複' }, '↻') : null, t.priority ? h('span', { class: 'stars' }, '★'.repeat(t.priority)) : null),
      (showDate && t.date) || t.tag_ids?.length ? h('div', { class: 'task-meta' },
        showDate && t.date ? h('span', { class: 'when' }, fmtWhen(t)) : null, db.taskTags(t).map(o => chip(o))) : null),
    t.status === 'done' ? h('button', { class: 'del-done', title: '刪除', 'aria-label': '刪除', onclick: e => {
      e.stopPropagation();
      // 重複任務的某一次：只刪那一次
      if (t._occ) confirmDelete(`刪除「${t.title}」的這一次？`, () => db.skipOccurrence(t.id, t._occ));
      else confirmDelete(`刪除「${t.title}」？`, () => db.remove('tasks', t.id));
    } }, icon('noentry')) : null);
}

export const canAutofocus = () => matchMedia('(pointer: fine)').matches;

export const empty = text => h('div', { class: 'empty' }, text);

// 簡易輸入框（取代 prompt，手機也好用）
export function ask(anchor, placeholder, value, onOk) {
  const input = h('input', { value: value || '', placeholder, onkeydown: e => { if (e.key === 'Enter' && input.value.trim()) { p.close(); onOk(input.value.trim()); } } });
  const p = popover(anchor, h('div', { class: 'ask' }, input, h('button', { class: 'primary', onclick: () => { if (input.value.trim()) { p.close(); onOk(input.value.trim()); } } }, '確定')), { width: 280 });
  if (canAutofocus()) setTimeout(() => { input.focus(); input.select(); }, 30);
}
