// 本地資料層：所有讀寫都經過這裡。資料先存本機（離線可用），變動會排進 sync.dirty 由 sync.js 上傳
import { SEED } from './seed.js';
import { courseRows } from './periods.js';

const KEY = 'calapp.v2';
// 除了 calendars 以外，每張表都有 calendar_id → 每個行事曆完全獨立
export const TABLES = ['calendars', 'tags', 'tasks', 'links', 'boards', 'courses', 'routines', 'notes', 'views'];
const SCOPED = TABLES.slice(1);

let state;
const listeners = new Set();      // 任何變動（畫面重繪）
const localListeners = new Set(); // 只有本機變動（觸發上傳）

export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const now = () => new Date().toISOString();

const blankSync = () => ({ user_id: null, cursor: null, dirty: {} });
function blank() {
  const s = { version: 2, meta: { current_calendar_id: null, default_remind_time: '09:00' }, sync: blankSync() };
  TABLES.forEach(t => (s[t] = {}));
  return s;
}

function persist() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { console.error(e); } }
function emit(local = true) { persist(); listeners.forEach(f => f()); if (local) localListeners.forEach(f => f()); }
export const onChange = f => listeners.add(f);
export const onLocalChange = f => localListeners.add(f);
const markDirty = (table, id) => { state.sync.dirty[table + '|' + id] = true; };

export function init() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && s.version === 2) {
      state = s; TABLES.forEach(t => (state[t] ??= {}));
      state.sync ??= blankSync();
      // 一次性：把課表匯入既有資料
      if (!state.meta.courses_seeded) {
        const cal = calId();
        if (cal && !all('courses', c => c.calendar_id === cal).length) courseRows(cal).forEach(r => rawPut('courses', r));
        state.meta.courses_seeded = true; persist();
      }
      // 一次性：課程連上科目標籤，並移除舊的科目標籤
      if (!state.meta.course_tags_v1) { calendars().forEach(c => linkCourses(c.id, true)); state.meta.course_tags_v1 = true; persist(); }
      // 一次性：首頁不再有隨手記，舊的隨手記轉成當天的任務
      if (!state.meta.notes_to_tasks_v1) {
        all('notes').forEach(n => {
          rawPut('tasks', { calendar_id: n.calendar_id, title: n.text, notes: '', date: n.date, end_date: null, start_time: null, end_time: null, status: n.done ? 'done' : 'todo', priority: 0, tag_ids: [], reminders: [] });
          softDelete('notes', n.id);
        });
        state.meta.notes_to_tasks_v1 = true; persist();
      }
      return;
    }
  } catch (e) { console.error(e); }
  resetDemo(false);
}

export function resetDemo(notify = true) {
  const prev = state;
  state = blank();
  // 已登入雲端：舊資料標成刪除一起同步，其他裝置也會清掉
  if (prev?.sync?.user_id) {
    state.sync = prev.sync;
    TABLES.forEach(t => Object.values(prev[t]).forEach(r => { state[t][r.id] = r; softDelete(t, r.id); }));
  }
  SEED(state, { put: rawPut });
  linkCourses(state.meta.current_calendar_id, true);
  state.meta.course_tags_v1 = true;
  persist();
  if (notify) emit();
}

// ---------- 科目標籤：每門課連一個，新增課程時自動建立，同名課程共用 ----------
const SUBJECT = '科目';
const OLD_SUBJECTS = ['材力', '工數', '物化', '有機', '有機實', '普心', '普天'];

export function ensureSubjectTag(name, cal = calId()) {
  const ex = all('tags', t => t.calendar_id === cal && t.group === SUBJECT && t.name === name)[0];
  if (ex) return ex.id;
  return rawPut('tags', { calendar_id: cal, name, group: SUBJECT, color: 'gray', order: all('tags', t => t.calendar_id === cal).length }).id;
}

function linkCourses(cal, dropOld) {
  if (!cal) return;
  all('courses', c => c.calendar_id === cal && !get('tags', c.tag_id)).forEach(c => rawPut('courses', { id: c.id, tag_id: ensureSubjectTag(c.name, cal) }));
  if (dropOld) all('tags', t => t.calendar_id === cal && t.group === SUBJECT && OLD_SUBJECTS.includes(t.name)).forEach(t => { softDelete('tags', t.id); stripTag(t.id); });
}

// ---------- 通用 CRUD ----------
function rawPut(table, row) {
  const id = row.id || uid();
  const r = { ...(state[table][id] || {}), ...row, id, updated_at: now() };
  r.created_at ??= r.updated_at;
  if (SCOPED.includes(table)) r.calendar_id ??= state.meta.current_calendar_id;
  state[table][id] = r;
  markDirty(table, id);
  return r;
}
function softDelete(table, id) { const r = state[table][id]; if (r && !r.deleted_at) { r.deleted_at = now(); r.updated_at = r.deleted_at; markDirty(table, id); } }

export function put(table, row) { const r = rawPut(table, row); emit(); return r; }
export function putMany(table, rows) { rows.forEach(r => rawPut(table, r)); emit(); }
export function get(table, id) { const r = id && state[table][id]; return r && !r.deleted_at ? r : null; }
export function all(table, pred) { return Object.values(state[table]).filter(r => !r.deleted_at && (!pred || pred(r))); }
// 目前行事曆內的資料
export const mine = (table, pred) => all(table, r => r.calendar_id === calId() && (!pred || pred(r)));

export function remove(table, id) {
  softDelete(table, id);
  if (table === 'tasks') {
    all('links', l => l.from === id || l.to === id).forEach(l => softDelete('links', l.id));
    all('boards', b => b.nodes.some(n => n.task_id === id)).forEach(b => rawPut('boards', { id: b.id, nodes: b.nodes.filter(n => n.task_id !== id) }));
  }
  if (table === 'tags') stripTag(id);
  emit();
}

// 把標籤從所有引用處拿掉
function stripTag(id) {
  for (const t of ['tasks', 'routines']) all(t, r => r.tag_ids?.includes(id)).forEach(r => rawPut(t, { id: r.id, tag_ids: r.tag_ids.filter(x => x !== id) }));
  all('views', v => v.filter?.tag_ids?.includes(id)).forEach(v => rawPut('views', { id: v.id, filter: { ...v.filter, tag_ids: v.filter.tag_ids.filter(x => x !== id) } }));
  all('courses', c => c.tag_id === id).forEach(c => rawPut('courses', { id: c.id, tag_id: null }));
}

// ---------- meta / 行事曆 ----------
export const meta = () => state.meta;
export function setMeta(patch) {
  Object.assign(state.meta, patch);
  // 只有偏好設定需要同步；目前選哪個行事曆是各裝置自己的
  if (Object.keys(patch).some(k => SYNCED_META.includes(k))) { state.meta.updated_at = now(); markDirty('meta', 'meta'); }
  emit();
}
const SYNCED_META = ['default_remind_time'];
export const calendars = () => all('calendars').sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
export const calId = () => (get('calendars', state.meta.current_calendar_id) || calendars()[0])?.id ?? null;
export const currentCal = () => get('calendars', calId());

export function newCalendar(name) {
  const c = rawPut('calendars', { name, order: calendars().length });
  state.meta.current_calendar_id = c.id;
  rawPut('views', { calendar_id: c.id, name: '全部', group: null, filter: { tag_ids: [], range: 'all', status: 'all' }, order: 0 });
  emit(); return c;
}

export function copyCalendar(id, name) {
  const nc = rawPut('calendars', { name, order: calendars().length });
  const rows = SCOPED.flatMap(t => all(t, r => r.calendar_id === id).map(r => [t, r]));
  const map = {};
  rows.forEach(([, r]) => (map[r.id] = uid()));
  const m = x => map[x] || x;
  rows.forEach(([t, r]) => {
    const c = structuredClone(r);
    delete c.created_at;
    Object.assign(c, { id: map[r.id], calendar_id: nc.id });
    if (c.tag_ids) c.tag_ids = c.tag_ids.map(m);
    if (c.from) { c.from = m(c.from); c.to = m(c.to); }
    if (c.nodes) c.nodes = c.nodes.map(n => ({ ...n, task_id: m(n.task_id) }));
    if (c.filter?.tag_ids) c.filter.tag_ids = c.filter.tag_ids.map(m);
    rawPut(t, c);
  });
  state.meta.current_calendar_id = nc.id;
  emit(); return nc;
}

// 清空行事曆：only='tasks' 只清任務（連同連線、提醒），否則全部
export function clearCalendar(id, only) {
  const tables = only === 'tasks' ? ['tasks', 'links', 'notes'] : SCOPED;
  tables.forEach(t => all(t, r => r.calendar_id === id).forEach(r => softDelete(t, r.id)));
  if (only === 'tasks') all('boards', b => b.calendar_id === id).forEach(b => rawPut('boards', { id: b.id, nodes: [] }));
  emit();
}

export function deleteCalendar(id) {
  SCOPED.forEach(t => all(t, r => r.calendar_id === id).forEach(r => softDelete(t, r.id)));
  softDelete('calendars', id);
  if (state.meta.current_calendar_id === id) state.meta.current_calendar_id = calendars()[0]?.id ?? null;
  emit();
}

// ---------- 標籤 ----------
const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0);
export const tags = () => mine('tags').sort(byOrder);
// 分組是標籤的選填屬性；依出現順序列出
export const tagGroups = () => [...new Set(tags().map(t => t.group || ''))];
export function taskTags(task) {
  const groups = tagGroups();
  return (task.tag_ids || []).map(id => get('tags', id)).filter(Boolean)
    .sort((a, b) => groups.indexOf(a.group || '') - groups.indexOf(b.group || '') || byOrder(a, b));
}
export const tagByName = name => tags().find(t => t.name === name);

// ---------- 任務查詢 ----------
export const tasks = pred => mine('tasks', pred);
export const onDay = (t, day) => t.date && (t.date === day || (t.end_date && t.date <= day && day <= t.end_date));
export const sortByDate = (a, b) => (a.date || '9999').localeCompare(b.date || '9999') || (a.start_time || '99').localeCompare(b.start_time || '99');

// 篩選：同分組 OR、跨分組 AND
export function matchFilter(task, filter = {}, today) {
  const sel = filter.tag_ids || [];
  if (sel.length) {
    const byGroup = {};
    sel.forEach(id => { const t = get('tags', id); if (t) (byGroup[t.group || ''] ??= []).push(id); });
    for (const ids of Object.values(byGroup)) if (!ids.some(id => task.tag_ids?.includes(id))) return false;
  }
  const r = filter.range || 'all';
  const end = task.end_date || task.date;
  if (r === 'future' && !(task.date && end >= today)) return false;
  if (r === 'past' && !(task.date && end < today)) return false;
  if (r === 'nodate' && task.date) return false;
  if (filter.status && filter.status !== 'all' && task.status !== filter.status) return false;
  return true;
}

// ---------- 連線 ----------
export function addLink(from, to) {
  if (!from || !to || from === to || all('links', l => l.from === from && l.to === to).length) return;
  put('links', { from, to });
}

// ---------- 外部匯入（Google 日曆等） ----------
export function ensureTag(name, color = 'gray') {
  return tagByName(name)?.id || rawPut('tags', { name, color, group: null, order: tags().length }).id;
}

// 以 ext_id 對應：已匯入過的只更新標題／日期／時間，保留你改過的狀態、標籤、提醒、筆記
export function importTasks(rows, tagId) {
  const existing = new Map(tasks(t => t.ext_id).map(t => [t.ext_id, t]));
  let added = 0, updated = 0;
  rows.forEach(r => {
    const ex = existing.get(r.ext_id);
    if (ex) { rawPut('tasks', { id: ex.id, title: r.title, date: r.date, end_date: r.end_date, start_time: r.start_time, end_time: r.end_time }); updated++; }
    else { rawPut('tasks', { ...r, status: 'todo', reminders: [], tag_ids: tagId ? [tagId] : [] }); added++; }
  });
  emit();
  return { added, updated };
}

// ---------- 匯出匯入 ----------
export const exportJSON = () => JSON.stringify(state, null, 1);
export function importJSON(text) {
  const s = JSON.parse(text);
  if (s.version !== 2) throw new Error('版本不符');
  const sync = state.sync;
  state = s; TABLES.forEach(t => (state[t] ??= {}));
  state.sync = { ...sync, dirty: {} };
  markAllDirty();
  emit();
}

// ---------- 同步介面（給 sync.js 用） ----------
export const syncInfo = () => state.sync;
export function setSyncInfo(patch) { Object.assign(state.sync, patch); persist(); }

export function markAllDirty() {
  TABLES.forEach(t => Object.keys(state[t]).forEach(id => markDirty(t, id)));
  if (state.meta.updated_at) markDirty('meta', 'meta');
}

// 取出待上傳的資料列（記下當時的 updated_at，上傳成功後只清掉沒再被改過的）
export function takeDirty() {
  return Object.keys(state.sync.dirty).map(key => {
    const [tbl, id] = key.split('|');
    const row = tbl === 'meta' ? pickMeta() : state[tbl]?.[id];
    return row && { key, tbl, id, row: structuredClone(row), stamp: row.updated_at };
  }).filter(Boolean);
}
export function ackDirty(items) {
  items.forEach(i => {
    const cur = i.tbl === 'meta' ? state.meta : state[i.tbl]?.[i.id];
    if (!cur || cur.updated_at === i.stamp) delete state.sync.dirty[i.key];
  });
  persist();
}
const pickMeta = () => ({ ...Object.fromEntries(SYNCED_META.map(k => [k, state.meta[k]])), updated_at: state.meta.updated_at || now() });

// 套用雲端資料：較新的才覆蓋（最後寫入者勝）
export function applyRemote(records) {
  let changed = false;
  for (const rec of records) {
    const incoming = rec.data;
    if (!incoming?.updated_at) continue;
    if (rec.tbl === 'meta') {
      if (!state.meta.updated_at || state.meta.updated_at < incoming.updated_at) { Object.assign(state.meta, incoming); changed = true; }
      continue;
    }
    if (!TABLES.includes(rec.tbl)) continue;
    const local = state[rec.tbl][rec.id];
    if (!local || (local.updated_at || '') < incoming.updated_at) {
      state[rec.tbl][rec.id] = incoming;
      delete state.sync.dirty[rec.tbl + '|' + rec.id];
      changed = true;
    }
  }
  if (changed) emit(false); else persist();
  return changed;
}

// 換成雲端資料前清空本機（保留同步設定與一次性旗標）
export function clearLocal() {
  const keep = { sync: state.sync, flags: { courses_seeded: true, course_tags_v1: true, default_remind_time: state.meta.default_remind_time } };
  state = blank();
  state.sync = { ...keep.sync, dirty: {}, cursor: null };
  Object.assign(state.meta, keep.flags);
  persist();
}
