// 設定（右上角 ⚙）：App 本身的設定——提醒、外觀、刪除確認
import * as db from './db.js';
import { h, modal, toast } from './ui.js';
import { timeButton } from './pickers.js';

export const APP_VERSION = 'v1.0.0';

export function openSettings() {
  const body = h('div', { class: 'page-body settings' });
  const close = modal(h('div', { class: 'page' },
    h('div', { class: 'page-head' }, h('b', {}, '設定'), h('span', { class: 'spacer' }), h('button', { class: 'icon', onclick: () => close() }, '✕')),
    body,
    h('div', { class: 'version' }, APP_VERSION)), { cls: 'page-modal' });

  const sec = (title, ...kids) => h('section', { class: 'set-sec' }, h('h3', {}, title), ...kids);
  // 二選一／三選一的按鈕組，值存在 meta[key]
  const pick = (label, key, def, options) => h('div', { class: 'look-item' }, h('span', { class: 'muted small' }, label),
    h('div', { class: 'accent-pick' }, options.map(([k, name, icon]) =>
      h('button', { class: (db.meta()[key] || def) === k ? 'on' : '', onclick: () => { db.setMeta({ [key]: k }); render(); } }, icon, name))));
  const swatch = color => h('span', { class: 'swatch-lg', style: { background: color } });

  function render() {
    body.replaceChildren(
      sec('提醒',
        h('div', { class: 'row wrap' }, '沒設時間的任務，提醒以',
          timeButton(db.meta().default_remind_time || '09:00', v => db.setMeta({ default_remind_time: v || '09:00' }), { clearLabel: '恢復 09:00' }), '為準'),
        notifyRow()),

      sec('外觀',
        h('div', { class: 'look' },
          pick('主題色', 'accent', 'ink', [['ink', '黑', swatch('#2b2a27')], ['neon', '螢光綠', swatch('#3dff5c')]]),
          pick('字體', 'font', 'serif', [['serif', '明體', h('span', { class: 'font-demo serif' }, '字')], ['sans', '黑體', h('span', { class: 'font-demo sans' }, '字')]]),
          pick('深淺', 'mode', 'system', [['light', '淺色', swatch('#f1ede4')], ['dark', '深色', swatch('#1d1c1a')], ['system', '跟隨系統', swatch('linear-gradient(90deg,#f1ede4 50%,#1d1c1a 50%)')]]))),

      sec('刪除',
        h('label', { class: 'check' },
          h('input', { type: 'checkbox', checked: db.meta().confirm_delete !== false, onchange: e => db.setMeta({ confirm_delete: e.target.checked }) }),
          '刪除任務前先確認')));
  }
  render();
}

// 手機提醒的權限狀態（只在 Android App 裡顯示）
function notifyRow() {
  const box = h('div', { class: 'row wrap' });
  if (!window.Capacitor?.isNativePlatform?.()) return box;
  import('./notify.js').then(async n => {
    const s = await n.status();
    if (!s) return;
    const okNotify = s.notify === 'granted', okExact = s.exact !== 'denied';
    box.replaceChildren(
      h('span', { class: okNotify ? '' : 'sync-error' }, okNotify ? '通知：已允許' : '通知：未允許'),
      okNotify ? null : h('button', { onclick: async () => { await n.askPermission(); n.reschedule(); } }, '允許通知'),
      h('span', { class: okExact ? '' : 'sync-error' }, okExact ? '準時提醒：已開啟' : '準時提醒：未開啟'),
      okExact ? null : h('button', { onclick: () => n.openExactSetting() }, '開啟準時提醒'),
      h('button', { onclick: async () => { await n.reschedule(); toast('提醒已重新排程'); } }, '重新排程'));
  });
  return box;
}
