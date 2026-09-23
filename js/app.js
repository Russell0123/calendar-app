// App 外殼：左上切換行事曆、右上設定；主體是左右滑動的頁面
import * as db from './db.js';
import { h, popover, ask } from './ui.js';
import { openTask } from './editor.js';
import { openSettings } from './settings.js';
import { openCalendars } from './calendars.js';
import { playIntro } from './hero.js';
import { openAccount, syncLabel } from './account.js';
import { renderSchedule } from './pages/schedule.js';
import { renderHome } from './pages/home.js';
import { renderCalendar } from './pages/calendar.js';
import { renderFlow, showBoard } from './pages/flow.js';

window.openTask = openTask;
db.init();
const isNative = !!window.Capacitor?.isNativePlatform?.();
// 外觀：主題色（黑／螢光綠）、字體（明體／黑體）
const darkQuery = matchMedia('(prefers-color-scheme: dark)');
const applyAccent = () => {
  const root = document.documentElement, m = db.meta();
  root.dataset.accent = m.accent || 'ink';
  root.dataset.font = m.font || 'serif';
  const mode = m.mode || 'system';
  root.dataset.theme = mode === 'system' ? (darkQuery.matches ? 'dark' : 'light') : mode;
};
applyAccent();
db.onChange(applyAccent);
darkQuery.addEventListener('change', applyAccent);
// 新版偵測：App 從背景回來時比對 version.json，有更新就重新載入（手機 App 常駐背景，不會自己重開）
let loadedVersion = null;
const fetchVersion = () => fetch('version.json', { cache: 'no-store' }).then(r => r.json()).then(j => j.v).catch(() => null);
if (!isNative) fetchVersion().then(v => (loadedVersion = v));
document.addEventListener('visibilitychange', async () => {
  if (document.hidden || !loadedVersion) return;
  const v = await fetchVersion();
  if (v && v !== loadedVersion && !document.querySelector('.modal-bg')) location.reload();
});
// 網路優先的快取：更新馬上看得到，離線也能開
if (!isNative && 'serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW 註冊失敗', e));
// 雲端同步：模組載入失敗（例如離線打不開 CDN）也不影響本機使用
let syncStatus = null;
// Android App 裡才啟用手機提醒
if (isNative) {
  import('./notify.js').then(m => m.initNotifications()).catch(e => console.warn('提醒未啟動', e));
  import('./native.js').then(m => m.initNative()).catch(e => console.warn('返回鍵／小工具未啟動', e));
}

// 國定假日在第一次同步完成後才匯入，避免新裝置在拿到雲端資料前重複建立
const importHolidays = () => import('./holidays.js').then(m => m.autoImport()).catch(e => console.warn('假日匯入失敗', e));
import('./sync.js').then(s => { syncStatus = s.status; s.onStatus(renderHeader); return s.start(); })
  .catch(e => console.warn('同步未啟動', e))
  .finally(importHolidays);

// 課表 ← 首頁 → 月曆／看板 → 流程圖
const PAGES = [['schedule', '課表', renderSchedule], ['home', '首頁', renderHome], ['calendar', '月曆', renderCalendar], ['flow', '流程圖', renderFlow]];
const HOME = 1;

const app = document.getElementById('app');
const header = h('header', { class: 'topbar' });
const tabs = h('nav', { class: 'pagetabs' });
const swiper = h('div', { class: 'swiper' });
const panels = PAGES.map(([k]) => h('div', { class: 'panel panel-' + k }));
let current = HOME;

function renderHeader() {
  const cal = db.currentCal();
  header.replaceChildren(
    h('button', { class: 'cal-switch', onclick: e => calMenu(e.currentTarget) }, h('span', {}, cal?.name ?? '行事曆'), h('span', { class: 'caret' }, '▾')),
    h('span', { class: 'spacer' }),
    h('button', { class: 'primary new-task', onclick: () => openTask(null) }, '＋ 任務'),
    accountButton(),
    h('button', { class: 'icon gear', title: '設定', onclick: openSettings }, '⚙'));
}

// 右上帳號鈕：沒登入顯示「登入」；登入後顯示帳號名稱＋同步狀態小圓點
function accountButton() {
  const u = syncStatus?.user;
  return h('button', { class: 'acct-btn' + (u ? ' in' : ''), title: u ? `${u.email}・${syncLabel(syncStatus)}` : '登入以同步', onclick: openAccount },
    u ? [h('span', { class: 'dot sync-' + syncStatus.state }), h('span', { class: 'acct-name' }, u.email.split('@')[0])] : '登入');
}

function calMenu(anchor) {
  const cur = db.calId();
  const p = popover(anchor, h('div', { class: 'menu' },
    db.calendars().map(c => h('div', { class: 'menu-row', onclick: () => { p.close(); db.setMeta({ current_calendar_id: c.id }); } },
      c.name, h('span', { class: 'spacer' }), c.id === cur ? '✓' : '')),
    h('div', { class: 'menu-sep' }),
    h('div', { class: 'menu-row', onclick: () => { p.close(); ask(anchor, '新行事曆名稱', '', name => db.newCalendar(name)); } }, '＋ 新行事曆'),
    h('div', { class: 'menu-row', onclick: () => { p.close(); openCalendars(); } }, '管理行事曆…')), { width: 240 });
}

// 自己做切頁動畫：瀏覽器的 smooth scroll 碰上 scroll-snap 常常停在半路
let anim = 0, guard = 0;
function goto(i, smooth = true) {
  if (!panels[i]) return;
  const to = panels[i].offsetLeft, from = swiper.scrollLeft;
  cancelAnimationFrame(anim); clearTimeout(guard);
  swiper.style.scrollSnapType = 'none';
  const done = () => { cancelAnimationFrame(anim); clearTimeout(guard); swiper.scrollLeft = to; swiper.style.scrollSnapType = ''; };
  if (!smooth || from === to || document.hidden) return done();
  guard = setTimeout(done, 400); // 動畫沒跑完（例如背景分頁）也一定到位
  const t0 = performance.now(), dur = 260;
  const step = now => {
    const p = Math.min(1, (now - t0) / dur);
    swiper.scrollLeft = from + (to - from) * (1 - Math.pow(1 - p, 3));
    p < 1 ? (anim = requestAnimationFrame(step)) : done();
  };
  anim = requestAnimationFrame(step);
}

function renderTabs() {
  tabs.replaceChildren(...PAGES.map(([, label], i) => h('button', { class: i === current ? 'on' : '', onclick: () => goto(i) }, label)));
}

swiper.addEventListener('scroll', () => {
  if (!swiper.clientWidth) return; // 視窗縮到 0 寬（隱藏）時不要算出錯的頁數
  const i = Math.round(swiper.scrollLeft / swiper.clientWidth);
  if (i !== current) { current = i; renderTabs(); }
}, { passive: true });

// 資料變動時重繪全部頁面，保留各頁捲動位置
function draw() {
  renderHeader();
  renderTabs();
  panels.forEach((p, i) => { const top = p.scrollTop; PAGES[i][2](p); p.scrollTop = top; });
}

swiper.append(...panels);
app.replaceChildren(header, swiper, tabs);
db.onChange(draw);
draw();
requestAnimationFrame(() => { goto(HOME, false); playIntro(app); });

// 任務頁「流程」點下去：切到那張流程圖
window.gotoBoard = id => { showBoard(id); draw(); goto(PAGES.findIndex(p => p[0] === 'flow')); };
// 給手機返回鍵用：目前在哪一頁、回首頁
window.appNav = { current: () => current, home: () => goto(HOME), HOME };
addEventListener('resize', () => goto(current, false));
