// 標籤選擇器（仿 Notion）：搜尋、建立、點 ⋯ 改名／分組／顏色／刪除
import * as db from './db.js';
import { h, chip, popover, COLORS } from './ui.js';

export function tagPicker(anchor, selected, onChange, onClose) {
  const root = h('div', { class: 'tagpick' });
  const p = popover(anchor, root, { width: 320, onClose });
  let q = '';

  const input = h('input', { class: 'tp-input', placeholder: '搜尋或建立標籤',
    oninput: e => { q = e.target.value; renderList(); },
    onkeydown: e => {
      const name = q.trim();
      if (e.key === 'Enter' && name) { const ex = db.tags().find(t => t.name === name); ex ? toggle(ex.id) : create(name); }
      if (e.key === 'Backspace' && !q && selected.length) { selected.pop(); changed(); }
    } });
  const top = h('div', { class: 'tp-top' });
  const list = h('div', { class: 'tp-list' });

  const changed = () => { onChange?.(selected); renderTop(); renderList(); p.place(); };
  const toggle = id => { const i = selected.indexOf(id); i >= 0 ? selected.splice(i, 1) : selected.push(id); q = ''; input.value = ''; changed(); input.focus(); };
  const create = name => {
    selected.push(db.put('tags', { name, color: 'gray', group: null, order: db.tags().length }).id);
    q = ''; input.value = ''; changed(); input.focus();
  };

  function renderTop() {
    top.replaceChildren(...selected.map(id => db.get('tags', id)).filter(Boolean).map(t =>
      chip(t, {}, h('span', { class: 'x', onclick: () => toggle(t.id) }, '×'))), input);
  }

  function renderList() {
    const kw = q.trim().toLowerCase();
    const all = db.tags().filter(t => !kw || t.name.toLowerCase().includes(kw) || (t.group || '').toLowerCase().includes(kw));
    const out = [];
    db.tagGroups().forEach(g => {
      const ts = all.filter(t => (t.group || '') === g);
      if (!ts.length) return;
      if (g) out.push(h('div', { class: 'tp-group' }, g));
      ts.forEach(t => out.push(h('div', { class: 'tp-row' + (selected.includes(t.id) ? ' on' : ''), 'data-id': t.id, onclick: () => toggle(t.id) },
        h('span', { class: 'tp-handle', title: '拖曳排序', onpointerdown: e => startDrag(e, t), onclick: e => e.stopPropagation() }, '⋮⋮'),
        chip(t), h('span', { class: 'spacer' }),
        selected.includes(t.id) ? h('span', { class: 'check-mark' }, '✓') : null,
        h('button', { class: 'icon', title: '編輯標籤', onclick: e => { e.stopPropagation(); edit(t); } }, '⋯'))));
    });
    if (kw && !db.tags().some(t => t.name === q.trim())) {
      out.push(h('div', { class: 'tp-row', onclick: () => create(q.trim()) }, h('span', { class: 'muted' }, '建立'), chip({ name: q.trim(), color: 'gray' })));
    }
    list.replaceChildren(...out);
  }

  // 拖曳排序：拖到別的分組裡＝同時換分組
  function startDrag(e, t) {
    e.preventDefault(); e.stopPropagation();
    const rowEl = e.target.closest('.tp-row');
    rowEl.classList.add('dragging');
    let target = null, after = false;
    const clear = () => list.querySelectorAll('.drop-before, .drop-after').forEach(x => x.classList.remove('drop-before', 'drop-after'));
    const move = ev => {
      clear();
      const r = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.tp-row[data-id]');
      if (!r || r === rowEl) { target = null; return; }
      const rect = r.getBoundingClientRect();
      after = ev.clientY > rect.top + rect.height / 2;
      r.classList.add(after ? 'drop-after' : 'drop-before');
      target = r.dataset.id;
    };
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
      clear(); rowEl.classList.remove('dragging');
      if (target) reorder(t.id, target, after);
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
  }

  function reorder(dragId, targetId, after) {
    const group = db.get('tags', targetId).group || null;
    const seq = db.tagGroups().flatMap(g => db.tags().filter(x => (x.group || '') === g)).filter(x => x.id !== dragId);
    seq.splice(seq.findIndex(x => x.id === targetId) + (after ? 1 : 0), 0, db.get('tags', dragId));
    db.putMany('tags', seq.map((x, k) => (x.id === dragId ? { id: x.id, order: k, group } : { id: x.id, order: k })));
    renderTop(); renderList();
  }

  function edit(t) {
    const groups = db.tagGroups().filter(Boolean);
    const save = patch => { Object.assign(t, db.put('tags', { id: t.id, ...patch })); };
    // 分組：點選既有分組或輸入新分組（不用原生下拉，避免位置跑掉）
    const groupBox = h('div', { class: 'chips' });
    const renderGroups = () => groupBox.replaceChildren(
      h('span', { class: 'chip gpick' + (!t.group ? ' on' : ''), onclick: () => { save({ group: null }); renderGroups(); } }, '無'),
      ...groups.map(g => h('span', { class: 'chip gpick' + (t.group === g ? ' on' : ''), onclick: () => { save({ group: g }); renderGroups(); } }, g)),
      h('input', { class: 'gnew', placeholder: '＋ 新分組', onkeydown: e => {
        const g = e.target.value.trim();
        if (e.key !== 'Enter' || !g) return;
        if (!groups.includes(g)) groups.push(g);
        save({ group: g }); renderGroups();
      } }));
    renderGroups();
    const colors = h('div', { class: 'tp-colors' });
    const renderColors = () => colors.replaceChildren(...Object.entries(COLORS).map(([k, [bg, fg, label]]) =>
      h('div', { class: 'tp-color', onclick: () => { save({ color: k }); renderColors(); } },
        h('span', { class: 'swatch', style: { background: bg, borderColor: fg } }), label + '色',
        h('span', { class: 'spacer' }), t.color === k ? '✓' : '')));
    renderColors();
    root.replaceChildren(
      h('div', { class: 'tp-edit' },
        h('button', { class: 'link', onclick: main }, '‹ 返回'),
        h('label', { class: 'field' }, h('span', {}, '名稱'), h('input', { value: t.name, onchange: e => e.target.value.trim() && save({ name: e.target.value.trim() }) })),
        h('div', { class: 'field' }, h('span', {}, '分組'), groupBox),
        h('div', { class: 'field' }, h('span', {}, '顏色'), colors),
        h('button', { class: 'danger tp-del', onclick: () => {
          // 在按鈕上二次確認（跳確認框會讓浮動選單關掉）
          const btn = root.querySelector('.tp-del');
          if (!btn.dataset.armed) { btn.dataset.armed = '1'; btn.textContent = '再按一次確認刪除'; return; }
          const i = selected.indexOf(t.id); if (i >= 0) selected.splice(i, 1);
          db.remove('tags', t.id); onChange?.(selected); main();
        } }, '刪除標籤')));
    p.place();
  }

  function main() { root.replaceChildren(top, list); renderTop(); renderList(); p.place(); setTimeout(() => input.focus(), 20); }
  main();
  return p;
}
