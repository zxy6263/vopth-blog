/**
 * 构建收尾：把 Cloudflare Pages 的配置文件放进构建产物
 *
 * 为什么需要这一步？
 *   1. Cloudflare Pages 要求 `_headers` / `_redirects` 出现在「构建产物目录」里；
 *   2. Hexo 会忽略 `source/` 下所有以 `_` 开头的文件，所以不能把它们放在 source/；
 *   3. Hexo 的 `after_generate` 过滤器在 Hexo 8 里是在写 public/ 之前触发的，
 *      用它复制会因为目标目录不存在而直接让构建失败。
 *
 * 所以用一个明确的后置步骤来做，顺序完全可控。
 * 你只需要编辑根目录的 `_headers` / `_redirects`，这个脚本不用管。
 *
 * 由 package.json 的 build 脚本调用：hexo generate && node tools/post-build.js
 */

'use strict';

const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const publicDir = path.join(rootDir, 'public');
const FILES = ['_headers', '_redirects'];

if (!fs.existsSync(publicDir)) {
  console.error('[post-build] 找不到 public/ 目录，hexo generate 可能没有成功执行。');
  process.exit(1);
}

let copied = 0;

for (const name of FILES) {
  const src = path.join(rootDir, name);
  const dest = path.join(publicDir, name);

  if (!fs.existsSync(src)) {
    // 不阻断构建：缺了它站点照样能跑，只是少了自定义响应头 / 跳转规则
    console.warn(`[post-build] 警告：根目录没有 ${name}，已跳过。`);
    continue;
  }

  fs.copyFileSync(src, dest);
  console.log(`[post-build] ${name} -> public/${name}`);
  copied += 1;
}

console.log(`[post-build] 完成，共复制 ${copied} 个文件。`);
