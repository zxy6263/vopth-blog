#!/usr/bin/env node
/**
 * 后台页面语法自检
 * ===========================================================================
 *
 * 为什么需要这个脚本
 *   src/admin-page.js 把整个后台页面（HTML + 内联 <script>）装在一个模板字符串里。
 *   这里有个很容易踩的坑：页面脚本里写 '\n'，普通模板字符串会把它求值成【真正的换行】，
 *   于是产出的 <script> 内容变成字符串中间夹着裸换行 —— 语法错误，整段脚本不执行。
 *
 *   症状特别有迷惑性：页面 HTML 正常显示，但所有按钮都没反应、自动保存也不工作。
 *   静态读源码看不出任何问题。
 *
 *   2026-10-06 就这么翻过一次车（站主报「发布和清空按键都按不了，自动保存也没了」）。
 *   所以写这个脚本：把 ADMIN_PAGE 取出来，抽出 <script> 段，用 node 做语法检查。
 *   改完 src/admin-page.js 就跑一次，别再靠肉眼。
 *
 * 用法
 *   node tools/check-admin-page.js        （或 npm run check:admin）
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src', 'admin-page.js');

function fail(msg) {
  console.log('[FAIL] ' + msg);
  process.exit(1);
}

if (!fs.existsSync(SRC)) fail('找不到 ' + SRC);

// ---- 第一步：查源码里有没有"多余的反引号" ------------------------------
//
// 必须放在【导入之前】。踩过：模板被提前结束时，导入会先失败并抛出
// "Unexpected token ..." 这种看不懂的错误，根本走不到这里。
// 而这条检查是纯文本的，不需要模块能跑起来。
//
// ADMIN_PAGE 整体是一个模板字符串，源码里应该【只有】开头和结尾两个反引号。
// 中间再出现一个（代码块片段的三个反引号、甚至注释里举例用的反引号），
// 模板就会被提前结束，整份文件变成语法错误。
const srcLines = fs.readFileSync(SRC, 'utf8').split(/\r?\n/);
const btLines = [];
srcLines.forEach((l, i) => { if (l.indexOf('\u0060') !== -1) btLines.push(i + 1); });

if (btLines.length > 2) {
  const extra = btLines.slice(1, -1);
  const bt = '\u0060';
  console.log('[FAIL] 模板字符串里有多余的反引号，会把模板提前结束：');
  console.log('        模板起于第 ' + btLines[0] + ' 行、止于第 ' + btLines[btLines.length - 1] + ' 行');
  console.log('        多余的在第 ' + extra.join(', ') + ' 行：');
  extra.slice(0, 5).forEach((n) => {
    console.log('          ' + n + ' | ' + srcLines[n - 1].trim().slice(0, 100));
  });
  console.log('        修法：拼出来，写成 FENCE = ' + "String.fromCharCode(96)" + ' 重复三次，');
  console.log('        或者用转义 \\u0060 —— 总之不要在模板里直接写那个字符。');
  fail('源码里有 ' + extra.length + ' 处多余的反引号');
}
console.log('[ OK ] 模板字符串起止干净（源码里只有首尾两个反引号）');

// ---- 第二步：导入模块，抽出 <script> 做语法检查 --------------------------

// admin-page.js 是 ESM，node 直接 require 不了；复制成 .mjs 再动态 import
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'admin-page-check-'));
const tmpModule = path.join(tmpDir, 'admin-page.mjs');
fs.copyFileSync(SRC, tmpModule);

(async function main() {
  let mod;
  try {
    mod = await import('file://' + tmpModule.replace(/\\/g, '/'));
  } catch (e) {
    fail('导入 admin-page.js 失败：' + e.message);
  }

  const html = mod.ADMIN_PAGE;
  if (typeof html !== 'string' || html.length < 100) fail('ADMIN_PAGE 不是预期的字符串');

  console.log('[ OK ] ADMIN_PAGE 长度 ' + html.length + ' 字符');

  // 抽出所有内联 <script>（不带 src 的那些）
  const blocks = [];
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) blocks.push(m[1]);

  if (!blocks.length) fail('页面里没有内联 <script>，是不是结构变了？');
  console.log('[ OK ] 找到 ' + blocks.length + ' 段内联脚本');

  let bad = 0;
  blocks.forEach((code, i) => {
    const f = path.join(tmpDir, 'block' + i + '.js');
    fs.writeFileSync(f, code, 'utf8');
    const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
    if (r.status === 0) {
      console.log('[ OK ] 第 ' + (i + 1) + ' 段脚本语法正确（' + code.split('\n').length + ' 行）');
    } else {
      bad++;
      console.log('[FAIL] 第 ' + (i + 1) + ' 段脚本语法错误：');
      console.log((r.stderr || '').split('\n').slice(0, 12).map((l) => '        ' + l).join('\n'));
      // 顺手把出问题的行标出来，模板求值导致的裸换行在这里会现形
      const stderr = r.stderr || '';
      const lm = /block\d+\.js:(\d+)/.exec(stderr);
      if (lm) {
        const n = parseInt(lm[1], 10);
        const lines = code.split('\n');
        console.log('        出问题附近：');
        for (let k = Math.max(0, n - 4); k < Math.min(lines.length, n + 3); k++) {
          console.log('          ' + String(k + 1).padStart(3) + ' | ' + lines[k]);
        }
      }
    }
  });

  // 额外查一遍：模板字符串里容易被求值的转义（String.raw 生效时不该有问题，
  // 但万一有人把 String.raw 去掉，这里能直接指出来）
  const src = fs.readFileSync(SRC, 'utf8');
  if (!/=\s*String\.raw`/.test(src)) {
    console.log('[WARN] admin-page.js 没有用 String.raw —— 页面脚本里的 \\n 会被模板求值成真换行');
  } else {
    console.log('[ OK ] 用的是 String.raw，换行转义不会被模板求值');
  }

  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { /* 忽略 */ }

  if (bad) fail(bad + ' 段脚本有语法错误 —— 页面上按钮会全部失灵');
  console.log('');
  console.log('[ OK ] 后台页面自检通过');
})();
