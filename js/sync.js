// 雲端同步（Supabase）：本機優先、有網路就上傳下載，另一台裝置改了即時推送過來
// 衝突規則：同一筆資料以 updated_at 較新的為準
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import * as db from './db.js';
import { h, modal } from './ui.js';

const SUPABASE_URL = 'https://qpwkbduxgpabtitpzqui.supabase.co';
const SUPABASE_KEY = 'sb_publishable_3T7E6zsILt206GQtB1BRQw_OdAGFH5u'; // 公開金鑰，安全靠資料表權限規則
const PAGE = 1000;
const OVERLAP = 60e3; // 下載時往前多抓 1 分鐘，避免同時寫入時漏資料（重複套用無害）

export const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

export const status = { user: null, state: 'off', last: null, error: null }; // state: off | syncing | ok | error
const listeners = new Set();
export const onStatus = f => listeners.add(f);
const setStatus = patch => { Object.assign(status, patch); listeners.forEach(f => f(status)); };

let timer = null, busy = false, again = false, channel = null;

export async function start() {
  db.onLocalChange(() => schedule(800));
  addEventListener('online', () => schedule(0));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) schedule(0); });
  setInterval(() => schedule(0), 60e3); // 即時推送斷線時的備援
  sb.auth.onAuthStateChange((_e, session) => setTimeout(() => setUser(session?.user ?? null)));
  const { data } = await sb.auth.getSession();
  await setUser(data.session?.user ?? null);
}

// ---------- 登入 ----------
export async function signIn(email, password) {
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message === 'Invalid login credentials' ? '帳號或密碼錯誤' : error.message);
}
export async function signUp(email, password) {
  const { data, error } = await sb.auth.signUp({ email, password });
  if (error) throw error;
  return !!data.session; // false = 需要先到信箱點確認
}
export const signOut = () => sb.auth.signOut();

async function setUser(user) {
  if (status.user?.id === user?.id) return;
  channel?.unsubscribe(); channel = null;
  setStatus({ user, error: null, state: user ? 'syncing' : 'off' });
  if (!user) return;
  try {
    await firstSync(user);
    subscribe(user);
    await syncNow();
  } catch (e) { fail(e); }
}

// 這台裝置第一次登入這個帳號：雲端是空的就上傳本機；雲端已有資料就問要不要取代本機
async function firstSync(user) {
  if (db.syncInfo().user_id === user.id) return;
  const { count, error } = await sb.from('records').select('id', { count: 'exact', head: true });
  if (error) throw error;
  if (count > 0 && await choose('雲端已經有資料', '這台裝置的資料要怎麼處理？', '改用雲端資料', '合併上傳')) db.clearLocal();
  else db.markAllDirty();
  db.setSyncInfo({ user_id: user.id, cursor: null });
}

function subscribe(user) {
  channel = sb.channel('records-' + user.id)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'records', filter: `user_id=eq.${user.id}` },
      p => p.new?.id && db.applyRemote([p.new]))
    .subscribe();
}

// ---------- 上傳 + 下載 ----------
export function schedule(ms) {
  if (!status.user) return;
  clearTimeout(timer);
  timer = setTimeout(syncNow, ms);
}

export async function syncNow() {
  if (!status.user || !navigator.onLine) return;
  if (busy) { again = true; return; }
  busy = true;
  setStatus({ state: 'syncing' });
  try {
    await push();
    await pull();
    setStatus({ state: 'ok', last: new Date(), error: null });
  } catch (e) { fail(e); }
  busy = false;
  if (again) { again = false; schedule(0); }
}

async function push() {
  const items = db.takeDirty();
  for (let i = 0; i < items.length; i += 500) {
    const chunk = items.slice(i, i + 500);
    const rows = chunk.map(x => ({
      id: x.tbl === 'meta' ? 'meta:' + status.user.id : x.id,
      tbl: x.tbl, data: x.row, updated_at: x.row.updated_at, deleted_at: x.row.deleted_at ?? null,
    }));
    const { error } = await sb.from('records').upsert(rows);
    if (error) throw error;
    db.ackDirty(chunk);
  }
}

async function pull() {
  let cursor = db.syncInfo().cursor;
  // 只有第一頁往前重疊，之後分頁照游標往後走
  for (let first = true; ; first = false) {
    let q = sb.from('records').select('id,tbl,data,synced_at').order('synced_at').limit(PAGE);
    if (cursor) q = q.gt('synced_at', first ? new Date(new Date(cursor) - OVERLAP).toISOString() : cursor);
    const { data, error } = await q;
    if (error) throw error;
    db.applyRemote(data);
    const last = data[data.length - 1]?.synced_at;
    if (last && (!cursor || last > cursor)) { cursor = last; db.setSyncInfo({ cursor }); }
    if (data.length < PAGE) break;
  }
}

function fail(e) {
  console.error('[sync]', e);
  setStatus({ state: 'error', error: e.message || String(e) });
  schedule(30e3);
}

// 二選一對話框：回傳 true = 第一個選項
function choose(title, message, yes, no) {
  return new Promise(resolve => {
    let answered = false;
    const pick = v => { answered = true; resolve(v); close(); };
    const close = modal(h('div', { class: 'confirm' },
      h('b', {}, title), h('div', { class: 'confirm-msg' }, message),
      h('div', { class: 'muted small' }, '改用雲端：清掉這台的資料，下載雲端版本。合併：把這台的資料也傳上去。'),
      h('div', { class: 'row end' }, h('button', { onclick: () => pick(false) }, no), h('button', { class: 'primary', onclick: () => pick(true) }, yes))),
      { cls: 'confirm-modal', onClose: () => { if (!answered) resolve(false); } });
  });
}
