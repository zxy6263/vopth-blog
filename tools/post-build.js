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
 *
 * ⚠️ 判据为什么是"标签内"而不是"整页含"
 * ------------------------------------
 * hexo generate 是【增量生成】：只重写"变了"的页面，不清空 public/。
 * 所以每次构建时，一部分页面带着上一轮注入的属性、一部分被重写后丢掉了，
 * 本函数只补后者 —— 于是"本轮注入 N 个"这个数字每轮都不一样（实测 6/7/8）。
 *
 * 那个数字没有诊断价值。真正有意义的是【最终覆盖率】：
 *   文章页总数 vs 带属性的文章页数。两者不等 = 有页面没被标注
 *   = Pagefind 会把它排除出索引（轻则搜不到，重则如果全都没标注 → 索引整站）。
 *
 * 另一个必须用"标签内"判断的理由：
 * 如果某篇文章的【正文里】出现 data-pagefind-body 这个词，
 * 用整页 includes 判断会把它误认为"已经注入过" → 静默漏掉那一页。
 */
function injectPagefindBody() {
  const NEEDLE = 'data-pagefind-body';
  const ART_TAG = /<article\b[^>]*id="article-container"[^>]*>/;
  let injected = 0;
  let articlePages = 0;   // ⚠️ 不能叫 articles —— 会和本文件上面那个（源目录文章数）撞名
  let tagged = 0;
  let noTag = 0;

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

      const html = fs.readFileSync(full, 'utf8');
      // 只处理文章页；列表页直接跳过（跳过等于把它排除出索引）
      if (!html.includes('content="article"')) continue;
      if (!html.includes('id="article-container"')) continue;
      articlePages += 1;

      const m = html.match(ART_TAG);
      if (!m) {
        // 有 article-container 字符串但匹配不到标签 —— 主题结构变了
        noTag += 1;
        continue;
      }

      // ★ 只看标签内有没有属性，不看整页
      if (m[0].includes(NEEDLE)) {
        tagged += 1;
        continue;
      }

      const next = html.replace(
        ART_TAG,
        (tag) => tag.replace('id="article-container"', NEEDLE + ' id="article-container"')
      );
      if (next !== html) {
        fs.writeFileSync(full, next, 'utf8');
        injected += 1;
        tagged += 1;
      }
    }
  };

  walk(publicDir);

  console.log(
    `[post-build] Pagefind 正文标注：文章页 ${articlePages} 个，` +
      `已标注 ${tagged} 个（本轮新注入 ${injected} 个）`
  );

  // 覆盖率不足要报警 —— 否则搜索会悄悄退化，而且不报错
  if (articlePages === 0) {
    console.warn(
      '[post-build] 警告：一个文章页都没识别出来。' +
        '文章页选择器可能失效了（主题结构变了）—— Pagefind 会退回"索引整站"。'
    );
  } else if (tagged < articlePages) {
    console.warn(
      `[post-build] 警告：${articlePages - tagged} 个文章页没有 ${NEEDLE}` +
        (noTag ? `（其中 ${noTag} 个连 <article id="article-container"> 标签都匹配不到）` : '') +
        '，这些页面会被 Pagefind 排除出索引。'
    );
  }

  /* ★ 交叉校验：识别出的文章页数 vs 源目录的文章数
   *
   * 为什么需要这一层
   * ----------------
   * 上面那个"覆盖率"只能发现"识别出来了但没标注"。
   * 如果识别规则【整体失效】（比如主题把 id="article-container" 改了名），
   * 表现是"文章页数变少"—— 而覆盖率仍然是 100%，一声不吭。
   *
   * 实测：把某页的 id 改坏，日志变成「文章页 10 个，已标注 10 个」，
   *       看起来完全正常，但那一页已经从索引里消失了。
   *
   * 所以拿两个互相独立的来源对一下：
   *   articles      （本文件上面算的）  = source/_posts 里的 .md 文件数 —— 构建【输入】
   *   articlePages  （本函数数出来的）= public/ 里识别出的文章页数   —— 构建【输出】
   * 输入等于输出才算对。
   */
  if (articles > 0 && articlePages !== articles) {
    console.warn(
      `[post-build] 警告：源目录有 ${articles} 篇文章，但 public/ 里只识别出 ` +
        `${articlePages} 个文章页。识别规则可能失效了（主题结构变了？），` +
        '漏掉的页面会被 Pagefind 排除出索引。'
    );
  }

  return { articles: articlePages, tagged, injected };
}

injectPagefindBody();
