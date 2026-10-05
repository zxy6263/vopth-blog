#!/usr/bin/env node
/**
 * 把后台页面导出成静态 HTML
 * ===========================================================================
 *
 * 为什么需要它
 *   后台页面（src/admin-page.js 里的 ADMIN_PAGE）平时由 Worker 在 /admin/ 返回，
 *   而 /admin/ 有 Cloudflare Access 挡着，本地想「打开看看、点一点」很麻烦。
 *   这个脚本把同一份 HTML 写到 public/ 下，就能用本地服务器直接访问、随便点。
 *
 *   还有一个用处：改完后台页面想看效果、又不想部署时，用它导出一份。
 *
 * ⚠️ 导出的文件是【临时测试用】的，别提交、别部署上去 —— 它绕过了 Access。
 *    （所以文件名都以 __ 开头，而且用完请删掉。）
 *
 * 用法
 *   node tools/dump-admin-page.js                       # 写到 public/__admin-test.html
 *   node tools/dump-admin-page.js 别的路径.html          # 写到指定位置
 *
 * 注意：导出的页面里 fetch 调 /admin/api/* 仍然会 403（没有 Access 凭证），
 *       所以只能测界面和交互，测不了真正的发布。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src', 'admin-page.js');
const out = process.argv[2] || path.join('public', '__admin-test.html');

if (!fs.existsSync(SRC)) {
  console.error('[FAIL] 找不到 ' + SRC);
  process.exit(1);
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dump-admin-'));
const tmpModule = path.join(tmpDir, 'admin-page.mjs');
fs.copyFileSync(SRC, tmpModule);

import('file://' + tmpModule.replace(/\\/g, '/'))
  .then(function (mod) {
    if (typeof mod.ADMIN_PAGE !== 'string') {
      console.error('[FAIL] ADMIN_PAGE 不是字符串');
      process.exit(1);
    }
    const target = path.isAbsolute(out) ? out : path.join(ROOT, out);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, mod.ADMIN_PAGE, 'utf8');
    console.log('[ OK ] 已写出 ' + target + '（' + mod.ADMIN_PAGE.length + ' 字符）');
    console.log('       本地预览：npm run server  然后打开 /' + path.basename(target));
    console.log('       ⚠️ 这是绕过 Access 的临时文件，测完请删掉，别提交');
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { /* 忽略 */ }
  })
  .catch(function (e) {
    console.error('[FAIL] 导入 admin-page.js 失败：' + e.message);
    process.exit(1);
  });
