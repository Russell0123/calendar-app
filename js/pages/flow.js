// 流程圖：節點＝任務、連線＝全域 links，跟行事曆共用同一份資料
// 操作：拖曳節點移動｜從右側圓點拖到另一任務＝連線｜點節點選取（再點一次＝編輯）｜點連線選取
//      拖曳空白＝平移｜Ctrl+滾輪 或 右下按鈕＝縮放｜雙擊空白＝在該處新增任務｜Delete＝刪除選取
import * as db from '../db.js';
import { h, chip, fmtWhen, taskColor, empty, ask, popover, confirmBox } from '../ui.js';

let boardId = null;
let view = { x: 40, y: 60, k: 1 };
let sel = null;      // { type: 'node' | 'edge', id }
let linking = null;  // 「連線到…」模式的來源任務 id
const SVGNS = 'http://www.w3.org/2000/svg';
const OFF = 5000;    // SVG 偏移，節點拖到負座標也畫得到線

export function renderFlow(el) {
  const boards = db.mine('boards').sort((a, b) => a.created_at.localeCompare(b.created_at));
  const b = db.get('boards', boardId) || boards[0];
  if (b?.id !== boardId) { view = { x: 40, y: 60, k: 1 }; sel = null; linking = null; }
  boardId = b?.id;

  const bar = h('div', { class: 'page-bar' },
    h('button', { class: 'board-sel', onclick: e => boardMenu(e.currentTarget, boards, b, el) },
      h('span', {}, b?.title ?? '流程圖'), h('span', { class: 'caret' }, '▾')),
    h('span', { class: 'spacer' }),
    b ? h('button', { class: 'primary', onclick: e => {
      const btn = e.currentTarget;
      const p = popover(btn, h('div', { class: 'menu' },
        h('div', { class: 'menu-row', onclick: () => { p.close(); ask(btn, '任務名稱', '', title => addNew(b, title, centerOf(el))); } }, '新任務'),
        h('div', { class: 'menu-row', onclick: () => { p.close(); addExisting(btn, b, el); } }, '加入既有任務')), { width: 160 });
    } }, '＋ 任務') : null);

  if (!b) return el.replaceChildren(bar, empty('還沒有流程圖。點左上「流程圖 ▾」→ 新流程。'));

  const nodes = b.nodes.filter(n => db.get('tasks', n.task_id)).map(n => ({ ...n }));
  const onBoard = new Set(nodes.map(n => n.task_id));
  const links = db.all('links', l => onBoard.has(l.from) && onBoard.has(l.to));
  if (sel && !(sel.type === 'node' ? onBoard.has(sel.id) : links.some(l => l.id === sel.id))) sel = null;

  // ---------- DOM ----------
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('class', 'flow-svg');
  svg.setAttribute('width', OFF * 2); svg.setAttribute('height', OFF * 2);
  svg.innerHTML = ['arrow', 'arrow-on'].map(id => `<marker id="${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" class="${id}"/></marker>`).join('')
    .replace(/^/, '<defs>') + `</defs><g class="edges" transform="translate(${OFF},${OFF})"></g>`;
  const edgesG = svg.querySelector('.edges');
  const layer = h('div', { class: 'flow-layer' }, svg);
  const tip = h('div', { class: 'flow-tip' });
  const canvas = h('div', { class: 'flow', tabindex: '0' }, layer, tip,
    h('div', { class: 'flow-zoom' },
      h('button', { onclick: () => zoomAt(1.2) }, '＋'),
      h('button', { onclick: () => zoomAt(1 / 1.2) }, '－'),
      h('button', { onclick: () => fit() }, '全部')));

  const nodeEls = {};
  nodes.forEach(n => {
    const t = db.get('tasks', n.task_id);
    const tags = db.taskTags(t);
    const e = h('div', { class: 'node' + (t.status === 'done' ? ' done' : ''), 'data-id': t.id, style: { left: n.x + 'px', top: n.y + 'px', borderTopColor: taskColor(t)[1] } },
      h('div', { class: 'node-title' }, t.title),
      h('div', { class: 'node-when' }, t.date ? fmtWhen(t) : '未排日期'),
      tags.length ? h('div', { class: 'chips' }, tags.map(o => chip(o))) : null,
      h('div', { class: 'node-port', 'data-port': t.id, title: '拖到另一個任務建立連線' }));
    nodeEls[t.id] = e;
    layer.append(e);
  });

  // ---------- 畫線 ----------
  const port = (id, side) => { const e = nodeEls[id]; return e && { x: e.offsetLeft + (side === 'out' ? e.offsetWidth : 0), y: e.offsetTop + e.offsetHeight / 2 }; };
  const curve = (a, c) => { const dx = Math.max(40, Math.abs(c.x - a.x) / 2); return `M${a.x},${a.y} C${a.x + dx},${a.y} ${c.x - dx},${c.y} ${c.x},${c.y}`; };
  function drawEdges(temp) {
    edgesG.replaceChildren();
    links.forEach(l => {
      const a = port(l.from, 'out'), c = port(l.to, 'in');
      if (!a || !c) return;
      const on = sel?.type === 'edge' && sel.id === l.id;
      const g = document.createElementNS(SVGNS, 'g');
      g.setAttribute('class', 'edge' + (on ? ' on' : ''));
      g.dataset.edge = l.id;
      const d = curve(a, c);
      g.innerHTML = `<path class="edge-hit" d="${d}"/><path class="edge-line" d="${d}" marker-end="url(#${on ? 'arrow-on' : 'arrow'})"/>`;
      edgesG.append(g);
    });
    if (temp) {
      const p = document.createElementNS(SVGNS, 'path');
      p.setAttribute('class', 'edge-line temp'); p.setAttribute('d', curve(temp.a, temp.c));
      edgesG.append(p);
    }
  }

  // ---------- 視角 ----------
  const applyView = () => (layer.style.transform = `translate(${view.x}px,${view.y}px) scale(${view.k})`);
  const toWorld = (cx, cy) => { const r = canvas.getBoundingClientRect(); return { x: (cx - r.left - view.x) / view.k, y: (cy - r.top - view.y) / view.k }; };
  function zoomAt(f, cx, cy) {
    const r = canvas.getBoundingClientRect();
    const px = (cx ?? r.left + r.width / 2) - r.left, py = (cy ?? r.top + r.height / 2) - r.top;
    const k = Math.min(2.5, Math.max(0.3, view.k * f));
    view.x = px - (px - view.x) * k / view.k; view.y = py - (py - view.y) * k / view.k; view.k = k;
    applyView();
  }
  function fit() {
    const els = Object.values(nodeEls); if (!els.length) return;
    const x0 = Math.min(...els.map(e => e.offsetLeft)), y0 = Math.min(...els.map(e => e.offsetTop));
    const x1 = Math.max(...els.map(e => e.offsetLeft + e.offsetWidth)), y1 = Math.max(...els.map(e => e.offsetTop + e.offsetHeight));
    const W = canvas.clientWidth, H = canvas.clientHeight;
    const k = Math.min(1.5, Math.max(0.3, Math.min((W - 80) / (x1 - x0), (H - 120) / (y1 - y0))));
    view = { k, x: (W - (x1 - x0) * k) / 2 - x0 * k, y: (H - (y1 - y0) * k) / 2 - y0 * k + 20 };
    applyView();
  }

  // ---------- 選取狀態（不重建畫面） ----------
  function updateSel() {
    Object.entries(nodeEls).forEach(([id, e]) => {
      e.classList.toggle('sel', sel?.type === 'node' && sel.id === id);
      e.classList.toggle('src', linking === id);
    });
    canvas.classList.toggle('linking', !!linking);
    drawEdges();
    if (linking) {
      tip.replaceChildren(h('span', {}, '點選後續任務'), h('button', { onclick: () => { linking = null; updateSel(); } }, '取消'));
    } else if (sel?.type === 'node') {
      const t = db.get('tasks', sel.id);
      tip.replaceChildren(h('b', {}, t.title),
        h('button', { onclick: () => window.openTask(t.id) }, '編輯'),
        h('button', { onclick: () => { linking = t.id; sel = null; updateSel(); } }, '連線到…'),
        h('button', { onclick: () => removeNode(t.id) }, '移出流程'),
        h('button', { class: 'danger', onclick: () => confirmBox(`刪除任務「${t.title}」？行事曆上也會一起刪除。`, () => { sel = null; db.remove('tasks', t.id); }) }, '刪除任務'));
    } else if (sel?.type === 'edge') {
      const l = links.find(x => x.id === sel.id);
      tip.replaceChildren(h('span', {}, `${db.get('tasks', l.from)?.title} → ${db.get('tasks', l.to)?.title}`),
        h('button', { onclick: () => { db.remove('links', l.id); db.addLink(l.to, l.from); sel = null; } }, '反轉方向'),
        h('button', { class: 'danger', onclick: () => { sel = null; db.remove('links', l.id); } }, '刪除連線'));
    } else {
      tip.replaceChildren(h('span', { class: 'muted' }, '拖圓點連線・雙擊空白新增'));
    }
  }
  const removeNode = id => { sel = null; db.put('boards', { id: b.id, nodes: nodes.filter(n => n.task_id !== id) }); };

  // ---------- 指標操作 ----------
  const targetNode = ev => document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.node')?.dataset.id;

  // ---------- 兩指縮放 ----------
  const pts = new Map();
  let pinch = null, gesture = null;
  const two = () => [...pts.values()].slice(0, 2);
  const dist = () => { const [a, c] = two(); return Math.hypot(a.x - c.x, a.y - c.y) || 1; };
  const mid = () => { const [a, c] = two(); return { x: (a.x + c.x) / 2, y: (a.y + c.y) / 2 }; };
  canvas.addEventListener('pointerdown', e => {
    if (e.target.closest('button, .flow-tip, .flow-zoom')) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2) {
      if (gesture) gesture.cancelled = true;
      const r = canvas.getBoundingClientRect(), c = mid();
      pinch = { d0: dist(), k0: view.k, w: { x: (c.x - r.left - view.x) / view.k, y: (c.y - r.top - view.y) / view.k } };
    }
  }, true);
  canvas.addEventListener('pointermove', e => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!pinch || pts.size < 2) return;
    const r = canvas.getBoundingClientRect(), c = mid();
    const k = Math.min(2.5, Math.max(0.3, pinch.k0 * dist() / pinch.d0));
    // 兩指中心底下的那一點保持不動（同時可平移）
    view = { k, x: c.x - r.left - pinch.w.x * k, y: c.y - r.top - pinch.w.y * k };
    applyView();
  });
  const lift = e => { pts.delete(e.pointerId); if (pts.size < 2) pinch = null; };
  canvas.addEventListener('pointerup', lift);
  canvas.addEventListener('pointercancel', lift);

  canvas.addEventListener('pointerdown', e => {
    if (pts.size > 1) return; // 已經是兩指縮放
    if (e.button !== 0 || e.target.closest('button, select, .flow-tip, .flow-zoom')) return;
    e.preventDefault();
    canvas.focus({ preventScroll: true });
    canvas.setPointerCapture(e.pointerId);
    const sx = e.clientX, sy = e.clientY;
    let moved = false, onMove = null, onUp = null;
    const portEl = e.target.closest('[data-port]');
    const nodeEl = e.target.closest('.node');
    const edgeEl = e.target.closest('[data-edge]');

    if (portEl) {
      const from = portEl.dataset.port;
      const a = port(from, 'out');
      onMove = ev => drawEdges({ a, c: toWorld(ev.clientX, ev.clientY) });
      onUp = ev => { const to = moved && targetNode(ev); if (to && to !== from) db.addLink(from, to); else drawEdges(); };
    } else if (nodeEl) {
      const id = nodeEl.dataset.id;
      const n = nodes.find(x => x.task_id === id);
      const ox = n.x, oy = n.y;
      onMove = ev => { n.x = Math.round(ox + (ev.clientX - sx) / view.k); n.y = Math.round(oy + (ev.clientY - sy) / view.k); nodeEl.style.left = n.x + 'px'; nodeEl.style.top = n.y + 'px'; drawEdges(); };
      onUp = () => {
        if (moved) return db.put('boards', { id: b.id, nodes });
        if (linking) { const from = linking; linking = null; if (from !== id) db.addLink(from, id); else updateSel(); return; }
        if (sel?.type === 'node' && sel.id === id) return window.openTask(id);
        sel = { type: 'node', id }; updateSel();
      };
    } else if (edgeEl) {
      onUp = () => { sel = { type: 'edge', id: edgeEl.dataset.edge }; updateSel(); };
    } else {
      const o = { ...view };
      canvas.classList.add('panning');
      onMove = ev => { view.x = o.x + ev.clientX - sx; view.y = o.y + ev.clientY - sy; applyView(); };
      onUp = () => { canvas.classList.remove('panning'); if (!moved && (sel || linking)) { sel = null; linking = null; updateSel(); } };
    }

    const g = gesture = { cancelled: false }; // 第二根手指落下時會被取消，改成兩指縮放
    const move = ev => { if (g.cancelled || ev.pointerId !== e.pointerId) return; if (!moved && Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) < 4) return; moved = true; onMove?.(ev); };
    const up = ev => {
      if (ev.pointerId !== e.pointerId) return;
      canvas.removeEventListener('pointermove', move); canvas.removeEventListener('pointerup', up); canvas.removeEventListener('pointercancel', up);
      canvas.classList.remove('panning');
      if (g.cancelled) return drawEdges();
      onUp?.(ev);
    };
    canvas.addEventListener('pointermove', move); canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
  });

  canvas.addEventListener('dblclick', e => {
    if (e.target.closest('.node, [data-edge], button, .flow-tip, .flow-zoom')) return;
    const at = toWorld(e.clientX, e.clientY);
    const anchor = h('div', { style: { position: 'fixed', left: e.clientX + 'px', top: e.clientY + 'px', width: '1px', height: '1px' } });
    document.body.append(anchor);
    ask(anchor, '新任務名稱', '', title => addNew(b, title, at));
    setTimeout(() => anchor.remove(), 200);
  });

  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) zoomAt(Math.exp(-e.deltaY / 300), e.clientX, e.clientY);
    else { view.x -= e.deltaX; view.y -= e.deltaY; applyView(); }
  }, { passive: false });

  canvas.addEventListener('keydown', e => {
    if (e.key === 'Escape') { sel = null; linking = null; updateSel(); }
    if ((e.key === 'Delete' || e.key === 'Backspace') && sel) {
      if (sel.type === 'edge') { const id = sel.id; sel = null; db.remove('links', id); }
      else removeNode(sel.id);
    }
  });

  el.replaceChildren(bar, canvas);
  applyView();
  requestAnimationFrame(() => updateSel());
}

// 畫面中央（世界座標）
function centerOf(el) {
  const c = el.querySelector('.flow');
  const w = c?.clientWidth || 600, hh = c?.clientHeight || 400;
  return { x: (w / 2 - view.x) / view.k - 85, y: (hh / 2 - view.y) / view.k - 30 };
}

function addNew(b, title, at) {
  const t = db.put('tasks', { title, notes: '', date: null, end_date: null, start_time: null, end_time: null, status: 'todo', tag_ids: [], reminders: [] });
  sel = { type: 'node', id: t.id };
  db.put('boards', { id: b.id, nodes: [...b.nodes, { task_id: t.id, x: Math.round(at.x), y: Math.round(at.y) }] });
}

function addExisting(anchor, b, el) {
  const on = new Set(b.nodes.map(n => n.task_id));
  const input = h('input', { placeholder: '搜尋任務', oninput: () => render() });
  const list = h('div', { class: 'menu scroll' });
  const render = () => {
    const kw = input.value.trim().toLowerCase();
    list.replaceChildren(...db.tasks(t => !on.has(t.id) && (!kw || t.title.toLowerCase().includes(kw))).sort(db.sortByDate).slice(0, 80)
      .map(t => h('div', { class: 'menu-row', onclick: () => {
        p.close();
        const at = centerOf(el);
        const k = b.nodes.length % 6;
        sel = { type: 'node', id: t.id };
        db.put('boards', { id: b.id, nodes: [...b.nodes, { task_id: t.id, x: Math.round(at.x + k * 16), y: Math.round(at.y + k * 16) }] });
      } }, t.title, h('span', { class: 'spacer' }), h('span', { class: 'muted small' }, fmtWhen(t)))));
  };
  render();
  const p = popover(anchor, h('div', {}, input, list), { width: 320 });
  setTimeout(() => input.focus(), 30);
}

// 流程下拉選單：切換、新增、改名、刪除
function boardMenu(anchor, boards, b, el) {
  const p = popover(anchor, h('div', { class: 'menu' },
    boards.map(x => h('div', { class: 'menu-row', onclick: () => { p.close(); boardId = x.id; renderFlow(el); } },
      x.title, h('span', { class: 'spacer' }), x.id === b?.id ? '✓' : '')),
    boards.length ? h('div', { class: 'menu-sep' }) : null,
    h('div', { class: 'menu-row', onclick: () => { p.close(); ask(anchor, '流程名稱（例：期末專題）', '', title => { boardId = db.put('boards', { title, nodes: [] }).id; }); } }, '＋ 新流程'),
    b ? [
      h('div', { class: 'menu-row', onclick: () => { p.close(); ask(anchor, '流程名稱', b.title, title => db.put('boards', { id: b.id, title })); } }, '重新命名'),
      h('div', { class: 'menu-row danger', onclick: () => { p.close(); confirmBox(`刪除流程「${b.title}」？任務本身不會刪除。`, () => db.remove('boards', b.id)); } }, '刪除這個流程'),
    ] : null), { width: 220 });
}
