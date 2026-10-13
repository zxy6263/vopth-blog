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

/* ------------------------------------------------------ 给 Pagefind 标注正文
 *
 * 为什么需要这一步
 * ----------------
 * Pagefind 默认索引整个 <body> —— 导航栏、侧边栏、页脚、相关文章列表全进去。
 * 2026-10-12 实测的后果（站点 11 篇文章）：
 *
 *   · 它索引了 50 个页面（把标签页/分类页/归档页都算上了）
 *   · 标签页里含全站文章标题列表 → 任何词命中一篇文章就命中所有列表页
 *     搜「静默失败」命中 49 条，第一名还是「博客」这个标签页
 *   · 摘录里混进日期和相邻文章的标题
 *
 * 给正文容器加 data-pagefind-body 之后：
 *   50 pages / 3112 words  →  11 pages / 2893 words
 *   搜「静默失败」49 条 → 3 条，且全是真实文章标题，摘录也只剩正文
 *
 * 为什么写在这里而不是改主题模板
 * ------------------------------
 * 项目约定：不碰 node_modules 里的主题（升级会被覆盖，而且公开仓库里改不了别人的包）。
 * post-build 改的是构建产物，效果一样，主题升级不受影响。
 * 这和本文件已经在做的事（复制 _headers、写 build-info.json）是同一类操作。
 *
 * 识别规则（2026-10-12 实测确认）
 * ------------------------------
 *   文章页：<meta og:type="article"> 且含 id="article-container"  → 11 个
 *   列表页：og:type="website"，没有 article-container              → 其余 41 个
 */
function injectPagefindBody() {
  const NEEDLE = 'data-pagefind-body';
  let injected = 0;
  let scanned = 0;

  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.name.endsWith('.html')) continue;
      scanned += 1;

      const html = fs.readFileSync(full, 'utf8');
      // 只处理文章页；列表页直接跳过（跳过等于把它排除出索引）
      if (!html.includes('content="article"')) continue;
      if (!html.includes('id="article-container"')) continue;
      if (html.includes(NEEDLE)) continue;

      const next = html.replace(
        /<article\b[^>]*id="article-container"[^>]*>/,
        (tag) => tag.replace('id="article-container"', NEEDLE + ' id="article-container"')
      );
      if (next !== html) {
        fs.writeFileSync(full, next, 'utf8');
        injected += 1;
      }
    }
  };

  walk(publicDir);
  console.log(
    `[post-build] Pagefind 正文标注：扫描 ${scanned} 个 HTML，注入 ${injected} 个文章页`
  );

  // 一个都没注入要报警 —— 否则搜索会悄悄退化成"索引整站"，而且不报错
  if (injected === 0 && scanned > 0) {
    console.warn(
      '[post-build] 警告：没有任何文章页被注入 data-pagefind-body。' +
        '可能是文章页选择器失效（主题结构变了）—— 搜索结果会被列表页污染。'
    );
  }
  return injected;
}

injectPagefindBody();
