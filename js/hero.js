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

// 開場動畫：大圖（人物頂端在畫面 1/4 高、下半被切掉）→ 縮小到首頁的位置；同時面板與日期滑入
export async function playIntro(app) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  try { await img.decode(); } catch { return; }
  const target = frame.getBoundingClientRect();
  if (!target.width) return; // 首頁不在畫面上就不播

  const vw = innerWidth, vh = innerHeight;
  // 人物略放大：寬約畫面寬，但至少讓腳超出畫面底部（下半被切掉）；電腦寬螢幕以高度為準
  const figW = Math.min(Math.max(vw * 0.95, vh * 0.55), vh * 0.75);
  const s0 = figW / (FIG.x1 - FIG.x0); // 開場時的縮放
  const s1 = target.width / CROP.w;       // 首頁裡的縮放
  const from = { fx: 0, fy: 0, fw: vw, fh: vh,
    ix: vw / 2 - ((FIG.x0 + FIG.x1) / 2) * s0, iy: vh * 0.25 - FIG.y0 * s0, s: s0 };
  const to = { fx: target.left, fy: target.top, fw: target.width, fh: target.height,
    ix: target.left - CROP.x * s1, iy: target.top - CROP.y * s1, s: s1 };

  const bg = h('div', { class: 'intro-bg' });
  const big = h('img', { src: SRC, alt: '' });
  const box = h('div', { class: 'intro-frame' }, big);
  const layer = h('div', { class: 'intro' }, bg, box);
  document.body.append(layer);
  app.classList.add('intro-hide');

  const place = (k) => {
    const L = (a, b) => a + (b - a) * k;
    const fx = L(from.fx, to.fx), fy = L(from.fy, to.fy), s = L(from.s, to.s);
    Object.assign(box.style, { left: fx + 'px', top: fy + 'px', width: L(from.fw, to.fw) + 'px', height: L(from.fh, to.fh) + 'px' });
    Object.assign(big.style, { left: L(from.ix, to.ix) - fx + 'px', top: L(from.iy, to.iy) - fy + 'px', width: 1000 * s + 'px' });
  };
  place(0);

  await new Promise(r => setTimeout(r, 450)); // 先停一下讓人看到大圖
  app.classList.add('intro-go');              // 面板、日期開始滑入
  const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const dur = 750, t0 = performance.now();
  await new Promise(done => {
    const step = now => {
      const t = Math.min(1, (now - t0) / dur);
      place(ease(t));
      bg.style.opacity = String(1 - ease(t));
      t < 1 ? requestAnimationFrame(step) : done();
    };
    requestAnimationFrame(step);
    setTimeout(done, dur + 400); // 背景分頁動畫不跑時也一定結束
  });
  layer.remove();
  app.classList.remove('intro-hide', 'intro-go');
}
