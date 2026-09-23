// 小圖示（SVG，跟著文字顏色或指定顏色）
const NS = 'http://www.w3.org/2000/svg';
const PATHS = {
  // 儲存（磁碟片）
  save: '<path d="M5 3h11l3 3v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M7 3v5h8V3M7 21v-7h10v7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
  // 禁止標誌：紅色圓底＋白色橫槓
  noentry: '<circle cx="12" cy="12" r="10" fill="#d93025"/><rect x="5.5" y="10.2" width="13" height="3.6" rx=".6" fill="#fff"/>',
};

export function icon(name, cls = '') {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'ico ' + cls);
  svg.innerHTML = PATHS[name];
  return svg;
}
