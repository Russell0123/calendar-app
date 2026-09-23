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

  let mode = 'in'; // in = 登入, up = 註冊
  const render = () => {
    if (!body.isConnected) return;
    const s = sync.status;
    if (s.user) {
      body.replaceChildren(
        h('div', { class: 'acct-email' }, s.user.email),
        h('div', { class: 'acct-state sync-' + s.state }, syncLabel(s), s.state === 'error' ? h('div', { class: 'small' }, s.error) : null),
        h('div', { class: 'muted small' }, '電腦和手機登入同一個帳號，資料會自動同步。'),
        h('div', { class: 'row' },
          h('button', { onclick: () => sync.syncNow() }, '立即同步'),
          h('span', { class: 'spacer' }),
          h('button', { onclick: () => confirmBox('登出？這台裝置的資料會保留。', async () => { await sync.signOut(); close(); }, '登出') }, '登出')));
      return;
    }
    const email = h('input', { type: 'email', placeholder: 'email', autocomplete: 'username' });
    const pw = h('input', { type: 'password', placeholder: '密碼（至少 6 碼）', autocomplete: mode === 'in' ? 'current-password' : 'new-password',
      onkeydown: e => { if (e.key === 'Enter') submit(); } });
    const submit = async () => {
      if (!email.value.trim() || pw.value.length < 6) return toast('請填 email 和至少 6 碼密碼');
      try {
        if (mode === 'in') await sync.signIn(email.value.trim(), pw.value);
        else if (!await sync.signUp(email.value.trim(), pw.value)) return toast('請到信箱點確認信，再回來登入');
        close();
      } catch (e) { toast(e.message); }
    };
    body.replaceChildren(
      h('div', { class: 'seg acct-seg' }, [['in', '登入'], ['up', '註冊']].map(([k, l]) =>
        h('button', { class: mode === k ? 'on' : '', onclick: () => { mode = k; render(); } }, l))),
      email, pw,
      h('button', { class: 'primary', onclick: submit }, mode === 'in' ? '登入' : '註冊'));
    setTimeout(() => email.focus(), 30);
  };
  sync.onStatus(render);
  render();
}
