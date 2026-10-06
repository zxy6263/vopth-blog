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
const { execSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const publicDir = path.join(rootDir, 'public');
const FILES = ['_headers', '_redirects'];

if (!fs.existsSync(publicDir)) {
  console.error('[post-build] 找不到 public/ 目录，hexo generate 可能没有成功执行。');
  process.exit(1);
}

/* ------------------------------------------------------------------ 构建标记
 *
 * 为什么需要这个文件：
 *   2026-10-06 凌晨，我手改 Worker 时写错一个 `{`，导致 CI 部署连续失败一小时
 *   没人发现 —— 因为「站点还能打开」，静态资源是上一次部署留下的。
 *   光靠"能不能访问"根本发现不了"新改动没上线"。
 *
 *   所以每次构建都写一个 build-info.json，巡检脚本拿线上的 commit 和仓库 HEAD
 *   对比：不一致 = 这次部署没生效（等了足够久之后仍不一致，就是真出事了）。
 *
 * commit 从哪来（按可靠性排序）：
 *   1. Cloudflare Workers 构建环境注入的 WORKERS_CI_COMMIT_SHA
 *   2. GitHub Actions 注入的 GITHUB_SHA
 *   3. 本地构建时直接问 git
 */
function git(args) {
  try {
    return execSync('git ' + args, { cwd: rootDir, encoding: 'utf8' }).trim();
  } catch (e) {
    return '';
  }
}

const commit =
  process.env.WORKERS_CI_COMMIT_SHA ||
  process.env.GITHUB_SHA ||
  git('rev-parse HEAD') ||
  'unknown';

const branch =
  process.env.WORKERS_CI_BRANCH ||
  process.env.GITHUB_REF_NAME ||
  git('rev-parse --abbrev-ref HEAD') ||
  'unknown';

// 顺便数一下源文章数。巡检脚本会拿它和线上 search.xml 的条目数对比，
// 对不上就说明有文章没被生成出来（构建半途失败 / 文章文件写坏了）。
const postsDir = path.join(rootDir, 'source', '_posts');
let articles = -1;
try {
  articles = fs.readdirSync(postsDir).filter((f) => /\.(md|markdown)$/i.test(f)).length;
} catch (e) {
  console.warn('[post-build] 警告：读不到 source/_posts，文章数记为 -1。');
}

const buildInfo = {
  commit,
  commit_short: commit.slice(0, 7),
  branch,
  built_at: new Date().toISOString(),
  articles,
};
fs.writeFileSync(
  path.join(publicDir, 'build-info.json'),
  JSON.stringify(buildInfo, null, 2) + '\n',
  'utf8'
);
console.log(
  `[post-build] build-info.json -> commit=${buildInfo.commit_short} branch=${branch} articles=${articles}`
);

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
