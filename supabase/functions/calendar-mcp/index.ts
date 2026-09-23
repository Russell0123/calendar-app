// 行事曆 AI 連接器（MCP 伺服器）
// 任何支援 MCP 的 AI（Claude 自訂連接器等）用個人金鑰連線，只能讀寫該使用者自己的資料。
// 連線網址：https://<project>.supabase.co/functions/v1/calendar-mcp/<個人金鑰>（舊格式 ?key= 也可以）
// 資料寫進 records 表後，App 會透過即時同步馬上看到。
import { createClient } from 'npm:@supabase/supabase-js@2';

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

const TZ = 'Asia/Taipei';
const PERIODS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'A', 'B'];
const WEEK = '日一二三四五六';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, mcp-session-id, mcp-protocol-version',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

type Row = Record<string, any>;
type Ctx = { uid: string };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const nowIso = () => new Date().toISOString();
const byOrder = (a: Row, b: Row) => (a.order ?? 0) - (b.order ?? 0);

async function sha256(s: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map(x => x.toString(16).padStart(2, '0')).join('');
}

async function userFromKey(key: string | null) {
  if (!key) return null;
  const { data } = await admin.from('api_keys').select('id,user_id').eq('key_hash', await sha256(key)).maybeSingle();
  if (!data) return null;
  await admin.from('api_keys').update({ last_used_at: nowIso() }).eq('id', data.id);
  return data.user_id as string;
}

// ---------- 讀寫 records ----------
async function load(uid: string, tbls: string[]) {
  const out: Record<string, Row[]> = Object.fromEntries(tbls.map(t => [t, []]));
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin.from('records').select('tbl,data')
      .eq('user_id', uid).in('tbl', tbls).is('deleted_at', null).range(from, from + 999);
    if (error) throw error;
    for (const r of data) out[r.tbl].push(r.data);
    if (data.length < 1000) break;
  }
  return out;
}

async function save(uid: string, tbl: string, row: Row) {
  const { error } = await admin.from('records').upsert({
    id: row.id, user_id: uid, tbl, data: row, updated_at: row.updated_at, deleted_at: row.deleted_at ?? null,
  });
  if (error) throw error;
}

async function getRow(uid: string, tbl: string, id: string) {
  const { data, error } = await admin.from('records').select('data').eq('user_id', uid).eq('tbl', tbl).eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data || data.data.deleted_at) throw new Error(`找不到 id 為 ${id} 的資料`);
  return data.data as Row;
}

// ---------- 共用 ----------
function today() {
  const d = new Date();
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d);
  const wd = new Date(date + 'T00:00:00Z').getUTCDay();
  return { date, weekday: '星期' + WEEK[wd] };
}

function pickCalendar(cals: Row[], name?: string) {
  const sorted = [...cals].sort(byOrder);
  if (!sorted.length) throw new Error('這個帳號還沒有行事曆，請先打開 App 登入同步一次');
  if (!name) return sorted[0];
  const hit = sorted.find(c => c.name === name) || sorted.find(c => c.name.includes(name));
  if (!hit) throw new Error(`找不到行事曆「${name}」，可用的有：${sorted.map(c => c.name).join('、')}`);
  return hit;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/, TIME = /^\d{2}:\d{2}$/;
function checkWhen(a: Row) {
  for (const k of ['date', 'end_date']) if (a[k] != null && a[k] !== '' && !DATE.test(a[k])) throw new Error(`${k} 格式要是 YYYY-MM-DD`);
  for (const k of ['start_time', 'end_time']) if (a[k] != null && a[k] !== '' && !TIME.test(a[k])) throw new Error(`${k} 格式要是 HH:MM`);
  if (a.priority != null && ![0, 1, 2, 3].includes(a.priority)) throw new Error('priority 只能是 0–3');
}

// 標籤名稱 → id；沒有的自動建立（灰色、不分組）
async function resolveTags(uid: string, calId: string, names: string[], tags: Row[]) {
  const ids: string[] = [], created: string[] = [];
  for (const raw of names) {
    const name = String(raw).trim();
    if (!name) continue;
    let t = tags.find(x => x.calendar_id === calId && x.name === name);
    if (!t) {
      const ts = nowIso();
      t = { id: crypto.randomUUID(), calendar_id: calId, name, color: 'gray', group: null,
        order: tags.filter(x => x.calendar_id === calId).length, created_at: ts, updated_at: ts };
      await save(uid, 'tags', t);
      tags.push(t);
      created.push(name);
    }
    if (!ids.includes(t.id)) ids.push(t.id);
  }
  return { ids, created };
}

function showTask(t: Row, tags: Row[], cals: Row[]) {
  return {
    id: t.id, title: t.title, date: t.date ?? null, end_date: t.end_date ?? null,
    start_time: t.start_time ?? null, end_time: t.end_time ?? null,
    status: t.status, priority: t.priority ?? 0,
    tags: (t.tag_ids || []).map((id: string) => tags.find(x => x.id === id)?.name).filter(Boolean),
    reminders: t.reminders ?? [], notes: t.notes || undefined,
    calendar: cals.find(c => c.id === t.calendar_id)?.name,
  };
}

const TASK_FIELDS = {
  title: { type: 'string', description: '任務名稱' },
  date: { type: 'string', description: '日期 YYYY-MM-DD；不填＝未排日期（待安排）' },
  end_date: { type: 'string', description: '多日任務的結束日期 YYYY-MM-DD' },
  start_time: { type: 'string', description: '開始時間 HH:MM（24 小時制，台灣時間）；不填＝整天' },
  end_time: { type: 'string', description: '結束時間 HH:MM' },
  tags: { type: 'array', items: { type: 'string' }, description: '標籤名稱，例如 ["考試","化工熱力學"]；不存在的會自動建立。更新時提供＝整組取代' },
  priority: { type: 'integer', minimum: 0, maximum: 3, description: '重要程度 0–3 顆星' },
  notes: { type: 'string', description: '筆記' },
  reminders: { type: 'array', items: { type: 'integer' }, description: '提前幾分鐘提醒，例如 [1440] = 前一天、[60] = 前一小時' },
};

const COLORS = ['gray', 'darkgray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'];
const COURSE_FIELDS = {
  name: { type: 'string', description: '課程名稱（課表上顯示的全名）' },
  weekday: { type: 'integer', minimum: 1, maximum: 7, description: '星期幾：1＝週一 … 7＝週日' },
  start_period: { type: 'string', enum: PERIODS, description: '第幾節開始：1–10、A、B' },
  end_period: { type: 'string', enum: PERIODS, description: '第幾節結束；不填＝跟開始同一節' },
  room: { type: 'string', description: '教室' },
  teacher: { type: 'string', description: '老師' },
  subject_tag: { type: 'string', description: '連結的科目標籤名稱（可用簡稱）；不存在會自動建立在「科目」分組' },
  notes: { type: 'string', description: '筆記' },
};

// ---------- 工具 ----------
const TOOLS = [
  {
    name: 'get_calendar_info',
    description: '取得今天日期、所有行事曆、可用標籤（依分組）與課表。操作前先呼叫一次，用來換算「明天」「下週三」等日期，並對上正確的科目標籤。',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'list_tasks',
    description: '查詢任務。可依日期範圍、關鍵字、狀態篩選。修改或刪除前先用它找到任務 id。',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: '開始日期 YYYY-MM-DD（含）' },
        to: { type: 'string', description: '結束日期 YYYY-MM-DD（含）' },
        keyword: { type: 'string', description: '標題、筆記或標籤包含的文字' },
        status: { type: 'string', enum: ['todo', 'done', 'all'], description: '預設 todo（未完成）' },
        undated: { type: 'boolean', description: 'true＝只看未排日期的任務' },
        calendar: { type: 'string', description: '行事曆名稱；不填＝全部' },
        limit: { type: 'integer', description: '最多幾筆，預設 100' },
      },
    },
  },
  {
    name: 'create_task',
    description: '新增一個任務。',
    inputSchema: {
      type: 'object',
      properties: { ...TASK_FIELDS, calendar: { type: 'string', description: '行事曆名稱；不填＝第一個行事曆' } },
      required: ['title'],
    },
  },
  {
    name: 'update_task',
    description: '修改任務。只需要提供要改的欄位；把欄位設成空字串可清除（例如 date:"" 變回未排日期）。',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' }, ...TASK_FIELDS, status: { type: 'string', enum: ['todo', 'done'], description: '完成＝done' } },
      required: ['id'],
    },
  },
  {
    name: 'delete_task',
    description: '刪除任務。',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  },
  {
    name: 'create_course',
    description: '在課表新增一門課。會自動連結（或建立）一個「科目」分組的標籤，預設用課名；可用 subject_tag 指定簡稱。同名課程在不同時段請分別新增。',
    inputSchema: {
      type: 'object',
      properties: { ...COURSE_FIELDS, calendar: { type: 'string', description: '行事曆名稱；不填＝第一個行事曆' } },
      required: ['name', 'weekday', 'start_period'],
    },
  },
  {
    name: 'update_course',
    description: '修改課程（id 從 get_calendar_info 的 courses 取得）。只需提供要改的欄位。',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, ...COURSE_FIELDS }, required: ['id'] },
  },
  {
    name: 'delete_course',
    description: '從課表刪除一門課（科目標籤保留）。',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  },
  {
    name: 'save_tag',
    description: '新增或修改標籤：依名稱找，找不到就新增。可改名（new_name，例如把科目改成簡稱）、顏色、分組。改名後所有任務與課程上的標籤會一起變。',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '標籤目前的名稱（新增時就是新名稱）' },
        new_name: { type: 'string', description: '改成的新名稱' },
        color: { type: 'string', enum: COLORS, description: '顏色' },
        group: { type: 'string', description: '分組，例如 科目、類型、屬性；空字串＝不分組' },
        calendar: { type: 'string', description: '行事曆名稱；不填＝第一個行事曆' },
      },
      required: ['name'],
    },
  },
  {
    name: 'delete_tag',
    description: '刪除標籤，並從所有任務、課程、視圖上移除。',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string' }, calendar: { type: 'string', description: '行事曆名稱；不填＝第一個行事曆' } },
      required: ['name'],
    },
  },
];

const HANDLERS: Record<string, (c: Ctx, a: Row) => Promise<unknown>> = {
  async get_calendar_info({ uid }) {
    const d = await load(uid, ['calendars', 'tags', 'courses']);
    return {
      today: today(), timezone: TZ,
      calendars: [...d.calendars].sort(byOrder).map(c => {
        const tags = d.tags.filter(t => t.calendar_id === c.id).sort(byOrder);
        const groups: Record<string, string[]> = {};
        tags.forEach(t => (groups[t.group || '未分組'] ??= []).push(t.name));
        return {
          name: c.name,
          tags: groups,
          courses: d.courses.filter(x => x.calendar_id === c.id)
            .sort((a, b) => a.day - b.day || a.start - b.start)
            .map(x => ({
              id: x.id, name: x.name, weekday: '星期' + WEEK[x.day],
              periods: PERIODS[x.start] + (x.end > x.start ? '–' + PERIODS[x.end] : ''),
              room: x.room || undefined, teacher: x.teacher || undefined, subject_tag: d.tags.find(t => t.id === x.tag_id)?.name,
            })),
        };
      }),
    };
  },

  async list_tasks({ uid }, a) {
    const d = await load(uid, ['calendars', 'tags', 'tasks']);
    const cal = a.calendar ? pickCalendar(d.calendars, a.calendar) : null;
    const status = a.status || 'todo';
    const kw = (a.keyword || '').toLowerCase();
    const tagName = (id: string) => d.tags.find(t => t.id === id)?.name || '';
    const list = d.tasks.filter(t => {
      if (cal && t.calendar_id !== cal.id) return false;
      if (status !== 'all' && t.status !== status) return false;
      if (a.undated) return !t.date;
      const end = t.end_date || t.date;
      if (a.from && (!t.date || end < a.from)) return false;
      if (a.to && (!t.date || t.date > a.to)) return false;
      if (kw && ![t.title, t.notes, ...(t.tag_ids || []).map(tagName)].join(' ').toLowerCase().includes(kw)) return false;
      return true;
    }).sort((x, y) => (x.date || '9999').localeCompare(y.date || '9999') || (x.start_time || '99').localeCompare(y.start_time || '99'));
    const limit = Math.min(a.limit || 100, 300);
    return { total: list.length, tasks: list.slice(0, limit).map(t => showTask(t, d.tags, d.calendars)) };
  },

  async create_task({ uid }, a) {
    if (!a.title?.trim()) throw new Error('title 必填');
    checkWhen(a);
    const d = await load(uid, ['calendars', 'tags']);
    const cal = pickCalendar(d.calendars, a.calendar);
    const { ids, created } = await resolveTags(uid, cal.id, a.tags || [], d.tags);
    const ts = nowIso();
    const task = {
      id: crypto.randomUUID(), calendar_id: cal.id, title: a.title.trim(), notes: a.notes || '',
      date: a.date || null, end_date: a.end_date && a.end_date > (a.date || '') ? a.end_date : null,
      start_time: a.start_time || null, end_time: a.end_time || null,
      status: 'todo', priority: a.priority ?? 0, tag_ids: ids, reminders: a.reminders || [],
      created_at: ts, updated_at: ts,
    };
    await save(uid, 'tasks', task);
    return { created: showTask(task, d.tags, d.calendars), new_tags: created.length ? created : undefined };
  },

  async update_task({ uid }, a) {
    if (!a.id) throw new Error('id 必填');
    checkWhen(a);
    const task = await getRow(uid, 'tasks', a.id);
    const d = await load(uid, ['calendars', 'tags']);
    for (const k of ['title', 'notes', 'date', 'end_date', 'start_time', 'end_time']) {
      if (a[k] !== undefined) task[k] = a[k] === '' ? (k === 'title' ? task.title : k === 'notes' ? '' : null) : a[k];
    }
    if (a.priority !== undefined) task.priority = a.priority;
    if (a.status) task.status = a.status;
    if (a.reminders) task.reminders = a.reminders;
    let created: string[] = [];
    if (a.tags) ({ ids: task.tag_ids, created } = await resolveTags(uid, task.calendar_id, a.tags, d.tags));
    if (task.end_date && (!task.date || task.end_date <= task.date)) task.end_date = null;
    task.updated_at = nowIso();
    await save(uid, 'tasks', task);
    return { updated: showTask(task, d.tags, d.calendars), new_tags: created.length ? created : undefined };
  },

  async delete_task({ uid }, a) {
    if (!a.id) throw new Error('id 必填');
    const task = await getRow(uid, 'tasks', a.id);
    task.deleted_at = task.updated_at = nowIso();
    await save(uid, 'tasks', task);
    return { deleted: task.title };
  },

  // ---------- 課表 ----------
  async create_course({ uid }, a) {
    if (!a.name?.trim()) throw new Error('name 必填');
    const d = await load(uid, ['calendars', 'tags']);
    const cal = pickCalendar(d.calendars, a.calendar);
    const ts = nowIso();
    const course: Row = { id: crypto.randomUUID(), calendar_id: cal.id, name: a.name.trim(), room: '', teacher: '', notes: '', created_at: ts, updated_at: ts };
    applyCourse(course, a, true);
    course.tag_id = await subjectTag(uid, cal.id, a.subject_tag || course.name, d.tags);
    await save(uid, 'courses', course);
    return { created: showCourse(course, d.tags) };
  },

  async update_course({ uid }, a) {
    if (!a.id) throw new Error('id 必填');
    const course = await getRow(uid, 'courses', a.id);
    const d = await load(uid, ['tags']);
    if (a.name?.trim()) course.name = a.name.trim();
    applyCourse(course, a, false);
    if (a.subject_tag) course.tag_id = await subjectTag(uid, course.calendar_id, a.subject_tag, d.tags);
    course.updated_at = nowIso();
    await save(uid, 'courses', course);
    return { updated: showCourse(course, d.tags) };
  },

  async delete_course({ uid }, a) {
    if (!a.id) throw new Error('id 必填');
    const course = await getRow(uid, 'courses', a.id);
    course.deleted_at = course.updated_at = nowIso();
    await save(uid, 'courses', course);
    return { deleted: course.name };
  },

  // ---------- 標籤 ----------
  async save_tag({ uid }, a) {
    if (!a.name?.trim()) throw new Error('name 必填');
    if (a.color && !COLORS.includes(a.color)) throw new Error('顏色只能是：' + COLORS.join('、'));
    const d = await load(uid, ['calendars', 'tags']);
    const cal = pickCalendar(d.calendars, a.calendar);
    const inCal = d.tags.filter(t => t.calendar_id === cal.id);
    let tag = inCal.find(t => t.name === a.name.trim());
    const ts = nowIso();
    const isNew = !tag;
    if (!tag) tag = { id: crypto.randomUUID(), calendar_id: cal.id, name: a.name.trim(), color: 'gray', group: null, order: inCal.length, created_at: ts };
    if (a.new_name?.trim()) {
      if (inCal.some(t => t.name === a.new_name.trim() && t.id !== tag!.id)) throw new Error(`已經有叫「${a.new_name}」的標籤`);
      tag.name = a.new_name.trim();
    }
    if (a.color) tag.color = a.color;
    if (a.group !== undefined) tag.group = a.group.trim() || null;
    tag.updated_at = ts;
    await save(uid, 'tags', tag);
    return { [isNew ? 'created' : 'updated']: { name: tag.name, color: tag.color, group: tag.group } };
  },

  async delete_tag({ uid }, a) {
    const d = await load(uid, ['calendars', 'tags', 'tasks', 'courses', 'views']);
    const cal = pickCalendar(d.calendars, a.calendar);
    const tag = d.tags.find(t => t.calendar_id === cal.id && t.name === a.name);
    if (!tag) throw new Error(`找不到標籤「${a.name}」`);
    const ts = nowIso();
    let touched = 0;
    for (const t of d.tasks) if (t.tag_ids?.includes(tag.id)) { t.tag_ids = t.tag_ids.filter((x: string) => x !== tag.id); t.updated_at = ts; await save(uid, 'tasks', t); touched++; }
    for (const c of d.courses) if (c.tag_id === tag.id) { c.tag_id = null; c.updated_at = ts; await save(uid, 'courses', c); }
    for (const v of d.views) if (v.filter?.tag_ids?.includes(tag.id)) { v.filter.tag_ids = v.filter.tag_ids.filter((x: string) => x !== tag.id); v.updated_at = ts; await save(uid, 'views', v); }
    tag.deleted_at = tag.updated_at = ts;
    await save(uid, 'tags', tag);
    return { deleted: tag.name, removed_from_tasks: touched };
  },
};

// 課程欄位：星期 1–7 → 0–6（週日＝0）；節次標籤 → 索引
function applyCourse(c: Row, a: Row, isNew: boolean) {
  if (a.weekday !== undefined) {
    if (!(a.weekday >= 1 && a.weekday <= 7)) throw new Error('weekday 要是 1–7');
    c.day = a.weekday % 7;
  } else if (isNew) throw new Error('weekday 必填');
  const idx = (p: string) => { const i = PERIODS.indexOf(String(p)); if (i < 0) throw new Error(`節次只能是 ${PERIODS.join('、')}`); return i; };
  if (a.start_period !== undefined) c.start = idx(a.start_period);
  else if (isNew) throw new Error('start_period 必填');
  if (a.end_period !== undefined) c.end = idx(a.end_period);
  else if (isNew || c.end < c.start) c.end = c.start;
  if (c.end < c.start) c.end = c.start;
  for (const k of ['room', 'teacher', 'notes']) if (a[k] !== undefined) c[k] = a[k];
}

// 科目標籤：同名就沿用，沒有就建立在「科目」分組（灰色）
async function subjectTag(uid: string, calId: string, name: string, tags: Row[]) {
  const hit = tags.find(t => t.calendar_id === calId && t.name === name.trim());
  if (hit) return hit.id;
  const ts = nowIso();
  const t = { id: crypto.randomUUID(), calendar_id: calId, name: name.trim(), color: 'gray', group: '科目', order: tags.filter(x => x.calendar_id === calId).length, created_at: ts, updated_at: ts };
  await save(uid, 'tags', t);
  tags.push(t);
  return t.id;
}

const showCourse = (c: Row, tags: Row[]) => ({
  id: c.id, name: c.name, weekday: '星期' + WEEK[c.day],
  periods: PERIODS[c.start] + (c.end > c.start ? '–' + PERIODS[c.end] : ''),
  room: c.room || undefined, teacher: c.teacher || undefined,
  subject_tag: tags.find(t => t.id === c.tag_id)?.name,
});

const INSTRUCTIONS = [
  '這是使用者自己的行事曆 App。',
  '開始時先呼叫 get_calendar_info 取得今天日期（台灣時間）、行事曆、標籤與課表，再把「明天、下週三」等換算成 YYYY-MM-DD。',
  '標籤用名稱指定：課程相關的任務加上該課的 subject_tag，考試／作業等加上對應標籤。',
  '修改或刪除前先用 list_tasks 找到 id。新增前可先查一下避免重複。',
  '課表：課程 id 在 get_calendar_info 的 courses 裡；每門課連一個「科目」標籤，想改簡稱用 save_tag 的 new_name。',
  '一個帳號可以有多個行事曆；使用者沒指定時用第一個，指定時在 calendar 參數填行事曆名稱。',
  '完成後用一兩句話告訴使用者做了什麼。',
].join('\n');

// ---------- MCP（Streamable HTTP，無狀態、直接回 JSON） ----------
const ok = (id: unknown, result: unknown) => ({ jsonrpc: '2.0', id, result });
const fail = (id: unknown, code: number, message: string) => ({ jsonrpc: '2.0', id, error: { code, message } });

async function handle(ctx: Ctx, m: Row) {
  const { id, method, params } = m;
  if (id === undefined || id === null) return null; // 通知不用回
  switch (method) {
    case 'initialize':
      return ok(id, {
        protocolVersion: params?.protocolVersion || '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'calendar-app', version: '1.0.0' },
        instructions: INSTRUCTIONS,
      });
    case 'ping': return ok(id, {});
    case 'tools/list': return ok(id, { tools: TOOLS });
    case 'resources/list': return ok(id, { resources: [] });
    case 'prompts/list': return ok(id, { prompts: [] });
    case 'tools/call': {
      const fn = HANDLERS[params?.name];
      if (!fn) return fail(id, -32602, `沒有這個工具：${params?.name}`);
      try {
        const out = await fn(ctx, params.arguments || {});
        return ok(id, { content: [{ type: 'text', text: JSON.stringify(out, null, 1) }] });
      } catch (e) {
        return ok(id, { content: [{ type: 'text', text: '錯誤：' + ((e as Error).message || String(e)) }], isError: true });
      }
    }
    default: return fail(id, -32601, `不支援：${method}`);
  }
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  const url = new URL(req.url);
  const segs = url.pathname.split('/').filter(Boolean);
  // AI 客戶端連線前會探測 OAuth 設定；明確回 404 表示「不需要登入」
  if (segs.includes('.well-known')) return json({ error: 'not found' }, 404);
  if (req.method !== 'POST') return json({ error: '請用 MCP 客戶端以 POST 連線' }, 405);

  // 金鑰放在路徑最後一段（…/calendar-mcp/cal_xxx）；也相容舊的 ?key= 與 Authorization: Bearer
  const key = segs.find(s => s.startsWith('cal_')) || url.searchParams.get('key')
    || req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || null;
  const uid = await userFromKey(key);
  if (!uid) return json({ jsonrpc: '2.0', id: null, error: { code: -32001, message: '金鑰無效或已撤銷，請到 App 帳號頁重新產生' } }, 401);

  let body: Row | Row[];
  try { body = await req.json(); } catch { return json(fail(null, -32700, 'JSON 格式錯誤'), 400); }
  const batch = Array.isArray(body);
  const out = [];
  for (const m of batch ? body as Row[] : [body as Row]) {
    const r = await handle({ uid }, m);
    if (r) out.push(r);
  }
  if (!out.length) return new Response(null, { status: 202, headers: CORS });
  return json(batch ? out : out[0]);
});
