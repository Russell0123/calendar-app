// 把網頁版的檔案（含圖片、打包好的函式庫）複製到 www/，給 APK 打包用
// 用法：npm run apk（會先跑這支，再 cap sync、Gradle 打包）
import { cpSync, rmSync, mkdirSync } from 'node:fs';

const OUT = 'www';
const FILES = ['index.html', 'css', 'js', 'vendor', 'img', 'icons'];
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT);
for (const f of FILES) cpSync(f, `${OUT}/${f}`, { recursive: true });
console.log('www/ 已更新：', FILES.join(', '));
