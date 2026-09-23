// Android App 專用：返回鍵、桌面小工具的資料
import * as db from './db.js';
import { registerPlugin } from '../vendor/capacitor.js';
import { occurrences } from './repeat.js';
import { taskColor, ymd, addDays } from './ui.js';

const App = registerPlugin('App');
const Widget = registerPlugin('WidgetBridge');

export function initNative() {
  // 返回鍵：先關選單 → 再關視窗（會照常自動儲存）→ 不在首頁就回首頁 → 在首頁才離開 App
  App.addListener('backButton', () => {
    const pops = document.querySelectorAll('.pop');
    if (pops.length) return pops[pops.length - 1]._close?.();
    if (document.querySelector('.modal-bg')) return history.back();
    if (window.appNav.current() !== window.appNav.HOME) return window.appNav.home();
    App.exitApp();
  });

  // 桌面小工具：資料一變就把前後幾個月的任務交給小工具
  let timer = 0;
  const push = () => { clearTimeout(timer); timer = setTimeout(sendWidget, 800); };
  db.onChange(push);
  App.addListener('resume', push);
  push();
}

function sendWidget() {
  const now = new Date();
  const from = ymd(new Date(now.getFullYear(), now.getMonth() - 3, 1));
  const to = ymd(new Date(now.getFullYear(), now.getMonth() + 5, 0));
  const days = {};
  for (const x of occurrences(db.tasks(), from, to).sort(db.sortByDate)) {
    const [bg, fg] = taskColor(x);
    const end = (x.end_date || x.date) > to ? to : (x.end_date || x.date);
    // 跨日任務每一天都顯示
    for (let d = x.date < from ? from : x.date; d <= end; d = addDays(d, 1))
      (days[d] ??= []).push([x.title, bg, fg, x.status === 'done' ? 1 : 0]);
  }
  const root = document.documentElement.dataset;
  Widget.update({ data: JSON.stringify({ dark: root.theme === 'dark', neon: root.accent === 'neon', days }) }).catch(() => {});
}
