// 首頁插圖：開場動畫＋彩蛋
// 圖片 1000×1200，人物大約在 x207–832、y98 開始；首頁只露出上半身（CROP 那一塊）
import { h } from './ui.js';

const SRC = 'img/hero.webp', BLINK = 'img/hero-blink.webp';
const CROP = { x: 200, y: 90, w: 640, h: 506 };
const FIG = { x0: 207, x1: 832, y0: 98 };

// 同一個 <img> 重複使用：首頁重繪時不會重新載入圖片
const img = h('img', { src: SRC, alt: '', draggable: 'false', decoding: 'async' });
const frame = h('div', { class: 'home-art' }, img);
new Image().src = BLINK; // 先載好彩蛋圖

// 彩蛋：連點 10 下換成閉眼，約兩秒後換回來
let taps = 0, last = 0, blinking = false;
frame.addEventListener('click', () => {
  const now = Date.now();
  taps = now - last < 1500 ? taps + 1 : 1;
  last = now;
  if (taps < 10 || blinking) return;
  taps = 0; blinking = true;
  img.src = BLINK;
  frame.classList.add('wiggle');
  setTimeout(() => { img.src = SRC; frame.classList.remove('wiggle'); blinking = false; }, 2000);
});

export const heroFrame = () => frame;

// 開場動畫（總長 < 1 秒）：
// 1 一打開就是大圖（人物頭頂約在畫面 18% 高，下半身超出畫面），等字體與任務載入好才開始動
// 2 人物往上縮小，下方區塊跟著人物底部一起升上來（稍快一點，粗線切齊人物底部）
// 3 人物走完約八成路徑時，右側日期從右邊滑入、上方工具列淡入
// 4 到定位
const HOLD = 300, DUR = 900; // HOLD：圖一至少停留的時間
const inOut = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const out = t => 1 - Math.pow(1 - t, 3);
const clamp = t => Math.max(0, Math.min(1, t));
const L = (a, b, k) => a + (b - a) * k;

// ready：App 的資料（雲端任務）載入完成的 promise
export async function playIntro(app, ready = Promise.resolve()) {
  const parts = () => [app.querySelector('.panel-home .home-head'), app.querySelector('.panel-home .home-grid'), app.querySelector('.topbar'), app.querySelector('.pagetabs')];
  const finish = () => {
    parts().forEach(el => el && (el.style.transform = el.style.opacity = ''));
    app.classList.remove('intro-hide');
  };
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return finish();
  try { await img.decode(); } catch { return finish(); }

  // 圖一：一打開先顯示大圖（只跟螢幕大小有關，不用等版面）
  const vw = innerWidth, vh = innerHeight;
  const figW = Math.min(Math.max(vw * 0.95, vh * 0.55), vh * 0.75); // 寬約畫面寬、腳超出畫面底部；電腦以高度為準
  const s0 = figW / (FIG.x1 - FIG.x0);
  const from = { x: vw / 2 - ((FIG.x0 + FIG.x1) / 2) * s0, y: vh * 0.18 - FIG.y0 * s0 };
  const big = h('img', { src: SRC, alt: '' });
  const box = h('div', { class: 'intro-frame' }, big);
  const layer = h('div', { class: 'intro' }, box);
  Object.assign(box.style, { left: 0, top: 0, width: vw + 'px', height: vh + 'px' });
  Object.assign(big.style, { left: from.x + 'px', top: from.y + 'px', width: 1000 * s0 + 'px' });
  document.body.append(layer);

  // 等字體、日期、任務都載入好才開始動（最多等 3 秒，沒網路也不會卡住）
  const wait = ms => new Promise(r => setTimeout(r, ms));
  await Promise.race([Promise.all([document.fonts?.ready, ready, wait(HOLD)]), wait(3000)]);
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); // 讓重繪後的版面先排好

  // 載入完才量最終位置（字體會影響版面）
  const [head0, grid0] = parts();
  const target = frame.getBoundingClientRect();
  if (!head0 || !grid0 || !target.width) { layer.remove(); return finish(); } // 首頁不在畫面上就不播
  grid0.style.transform = 'none';
  const gEnd = grid0.getBoundingClientRect().top, hLeft = head0.getBoundingClientRect().left;
  const s1 = target.width / CROP.w;
  const to = { x: target.left - CROP.x * s1, y: target.top - CROP.y * s1 };
  const cut = target.bottom - gEnd; // 人物底部與粗線的差（通常是 0）
  // 人物走完八成路徑的時間點（右側文字、工具列從這裡開始進場）
  let tHead = 0; while (inOut(tHead) < 0.8) tHead += 0.01;

  const place = t => {
    const [head, grid, bar, tabs] = parts(); // 動畫中資料同步可能重繪首頁，每格重新抓
    if (!head || !grid) return;
    const k = inOut(t);                         // 人物
    const kg = inOut(clamp(t / 0.85));          // 下方區塊（稍快）
    const kh = out(clamp((t - tHead) / (1 - tHead))); // 右側文字、工具列
    const gTop = L(vh, gEnd, kg);
    const top = L(0, target.top, k), left = L(0, target.left, k);
    const bottom = Math.max(top, Math.min(vh, gTop + cut));
    Object.assign(box.style, { left: left + 'px', top: top + 'px', width: L(vw, target.width, k) + 'px', height: bottom - top + 'px' });
    const s = L(s0, s1, k);
    Object.assign(big.style, { left: L(from.x, to.x, k) - left + 'px', top: L(from.y, to.y, k) - top + 'px', width: 1000 * s + 'px' });
    grid.style.transform = `translateY(${gTop - gEnd}px)`;
    head.style.transform = `translateX(${(1 - kh) * (vw - hLeft)}px)`;
    head.style.opacity = bar.style.opacity = tabs.style.opacity = String(kh);
  };
  place(0);

  const t0 = performance.now();
  await new Promise(done => {
    const step = now => {
      const t = Math.min(1, (now - t0) / DUR);
      place(t);
      t < 1 ? requestAnimationFrame(step) : done();
    };
    requestAnimationFrame(step);
    setTimeout(done, DUR + 400); // 背景分頁動畫不跑時也一定結束
  });
  layer.remove();
  finish();
}
