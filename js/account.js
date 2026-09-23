// 帳號頁（右上角按鈕）：沒登入→登入／註冊；登入後→同步狀態、立即同步、登出
import { h, modal, confirmBox, toast } from './ui.js';

export const syncLabel = s => ({ syncing: '同步中…', ok: '已同步' + (s.last ? ' ' + s.last.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''), error: '同步失敗', off: '未登入' })[s.state] ?? '';

export async function openAccount() {
  let sync;
  try { sync = await import('./sync.js'); } catch { return toast('目前無法連線'); }

  const body = h('div', { class: 'page-body account' });
  const close = modal(h('div', { class: 'page' },
    h('div', { class: 'page-head' }, h('b', {}, '帳號'), h('span', { class: 'spacer' }), h('button', { class: 'icon', onclick: () => close() }, '✕')),
    body), { cls: 'page-modal account-modal' });

  const aiBox = h('section', { class: 'ai-box' });
  if (sync.status.user) renderAI(aiBox, sync);

  let mode = 'in'; // in = 登入, up = 註冊
  const render = () => {
    if (!body.isConnected) return;
    const s = sync.status;
    if (s.user) {
      body.replaceChildren(
        h('div', { class: 'acct-email' }, s.user.email),
        h('div', { class: 'acct-state sync-' + s.state }, syncLabel(s), s.state === 'error' ? h('div', { class: 'small' }, s.error) : null),
        h('div', { class: 'row' },
          h('button', { onclick: () => sync.syncNow() }, '立即同步'),
          h('span', { class: 'spacer' }),
          h('button', { onclick: () => confirmBox('登出？這台裝置的資料會保留。', async () => { await sync.signOut(); close(); }, '登出') }, '登出')),
        aiBox);
      return;
    }
    const email = h('input', { type: 'email', placeholder: 'email', autocomplete: 'username' });
    const pw = h('input', { type: 'password', placeholder: '密碼（至少 6 碼）', autocomplete: mode === 'in' ? 'current-password' : 'new-password',
      onkeydown: e => { if (e.key === 'Enter') submit(); } });
    const pw2 = mode === 'up' ? h('input', { type: 'password', placeholder: '再輸入一次密碼', autocomplete: 'new-password', onkeydown: e => { if (e.key === 'Enter') submit(); } }) : null;
    const submit = async () => {
      if (!email.value.trim() || pw.value.length < 6) return toast('請填 email 和至少 6 碼密碼');
      if (pw2 && pw2.value !== pw.value) return toast('兩次密碼不一樣');
      try {
        if (mode === 'in') await sync.signIn(email.value.trim(), pw.value);
        else if (!await sync.signUp(email.value.trim(), pw.value)) return toast('請到信箱點確認信，再回來登入');
        close();
      } catch (e) { toast(e.message); }
    };
    body.replaceChildren(
      h('div', { class: 'seg acct-seg' }, [['in', '登入'], ['up', '註冊']].map(([k, l]) =>
        h('button', { class: mode === k ? 'on' : '', onclick: () => { mode = k; render(); } }, l))),
      email, pw, pw2,
      h('button', { class: 'primary', onclick: submit }, mode === 'in' ? '登入' : '註冊'));
    setTimeout(() => email.focus(), 30);
  };
  sync.onStatus(render);
  render();
}

// ---------- AI 助理：個人連線網址（MCP 自訂連接器） ----------
const b64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
async function sha256(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map(x => x.toString(16).padStart(2, '0')).join('');
}

async function renderAI(box, sync) {
  const endpoint = `${sync.SUPABASE_URL}/functions/v1/calendar-mcp`;
  const { data: keys, error } = await sync.sb.from('api_keys').select('id,name,prefix,created_at,last_used_at').order('created_at');
  const fmt = s => s ? new Date(s).toLocaleDateString() : '從未';

  const create = async () => {
    const key = 'cal_' + b64url(crypto.getRandomValues(new Uint8Array(24)));
    const { error } = await sync.sb.from('api_keys').insert({ key_hash: await sha256(key), prefix: key.slice(0, 8), name: new Date().toLocaleDateString() });
    if (error) return toast('產生失敗：' + error.message);
    showUrl(`${endpoint}?key=${key}`);
    renderAI(box, sync);
  };

  box.replaceChildren(
    h('div', { class: 'row' }, h('h3', {}, 'AI 助理'), h('span', { class: 'spacer' }), h('button', { class: 'link', onclick: aiHelp }, '教學')),
    error ? h('div', { class: 'sync-error small' }, '尚未啟用（' + error.message + '）') : [
      ...(keys || []).map(k => h('div', { class: 'key-row' },
        h('span', { class: 'mono' }, k.prefix + '…'),
        h('span', { class: 'muted small grow' }, `建立 ${fmt(k.created_at)}・最後使用 ${fmt(k.last_used_at)}`),
        h('button', { class: 'icon', onclick: () => confirmBox('撤銷這個連線？用它連線的 AI 會立刻無法存取。', async () => {
          await sync.sb.from('api_keys').delete().eq('id', k.id); renderAI(box, sync);
        }, '撤銷') }, '撤銷'))),
      h('button', { class: 'primary', onclick: create }, '產生 AI 連線網址'),
    ]);
}

// 網址只顯示這一次（資料庫只存雜湊）
function showUrl(url) {
  const input = h('input', { class: 'mono', value: url, readonly: true, onclick: e => e.target.select() });
  const close = modal(h('div', { class: 'confirm' },
    h('b', {}, '你的 AI 連線網址'),
    input,
    h('div', { class: 'small sync-error' }, '只會顯示這一次，請現在複製。擁有這個網址的 AI 可以讀寫你的行事曆，不要分享給別人。'),
    h('div', { class: 'row end' },
      h('button', { onclick: aiHelp }, '怎麼用？'),
      h('button', { class: 'primary', onclick: async () => {
        try { await navigator.clipboard.writeText(url); toast('已複製'); } catch { input.select(); document.execCommand('copy'); toast('已複製'); }
      } }, '複製'),
      h('button', { onclick: () => close() }, '完成'))), { cls: 'confirm-modal' });
}

function aiHelp() {
  const li = (...k) => h('li', {}, ...k);
  const close = modal(h('div', { class: 'page' },
    h('div', { class: 'page-head' }, h('b', {}, '讓 AI 幫你管理行事曆'), h('span', { class: 'spacer' }), h('button', { class: 'icon', onclick: () => close() }, '✕')),
    h('div', { class: 'page-body help' },
      h('b', {}, 'Claude'),
      h('ol', {},
        li('在這裡按「產生 AI 連線網址」並複製'),
        li('打開 claude.ai（電腦版）→ 左下角頭像 → ', h('b', {}, '設定 → 連接器')),
        li('按 ', h('b', {}, '新增自訂連接器'), '，名稱填「行事曆」，網址貼上剛剛複製的，按新增'),
        li('開新對話，在輸入框下方的工具選單確認「行事曆」已開啟'),
        li('直接說：「下週三化工熱力學小考，前一天提醒我」')),
      h('b', {}, '其他 AI'),
      h('ol', {}, li('只要支援 MCP 自訂連接器（遠端 MCP 伺服器），貼上同一個網址即可')),
      h('b', {}, '安全'),
      h('ol', {}, li('每個網址只能存取你自己的資料'), li('網址外洩或不用了，回這裡按「撤銷」就立刻失效'))),
  ), { cls: 'page-modal' });
}
