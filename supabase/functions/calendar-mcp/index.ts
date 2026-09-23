// 行事曆 AI 連接器（MCP 伺服器）
// 任何支援 MCP 的 AI（Claude 自訂連接器等）用個人金鑰連線，只能讀寫該使用者自己的資料。
// 連線網址：https://<project>.supabase.co/functions/v1/calendar-mcp?key=<個人金鑰>
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
              name: x.name, weekday: '星期' + WEEK[x.day],
              periods: PERIODS[x.start] + (x.end > x.start ? '–' + PERIODS[x.end] : ''),
              room: x.room || undefined, subject_tag: d.tags.find(t => t.id === x.tag_id)?.name,
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
};

const INSTRUCTIONS = [
  '這是使用者自己的行事曆 App。',
  '開始時先呼叫 get_calendar_info 取得今天日期（台灣時間）、行事曆、標籤與課表，再把「明天、下週三」等換算成 YYYY-MM-DD。',
  '標籤用名稱指定：課程相關的任務加上該課的 subject_tag，考試／作業等加上對應標籤。',
  '修改或刪除前先用 list_tasks 找到 id。新增前可先查一下避免重複。',
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
  if (req.method !== 'POST') return json({ error: '請用 MCP 客戶端以 POST 連線' }, 405);

  const url = new URL(req.url);
  const key = url.searchParams.get('key') || req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || null;
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
