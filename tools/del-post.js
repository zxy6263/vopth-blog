#!/usr/bin/env node
/**
 * 删除文章
 * ===========================================================================
 *
 * 为什么要有这个脚本
 *   手动删文章其实有 5 步，而且【很容易漏】：
 *     · 漏删专属封面图 -> source/img/covers/ 里留一张没人用的孤儿图
 *     · 漏删资源文件夹 -> source/_posts/<文件名>/ 整个留着
 *     · 忘了加 301   -> 分享出去的旧链接变成死链
 *   这个脚本把这几步一次做对，并且每一步都有确认和校验。
 *
 * 发帖方式仍然没变
 *   依然是「删掉 Markdown 文件 -> git push -> Cloudflare 自动构建」。
 *   生成的旧页面由 Hexo 自动清理（构建日志里会出现 Deleted: ...，已实测验证）。
 *
 * 用法
 *   npm run del-post                    交互式：列出所有文章让你选
 *   双击仓库根目录的「删文章.cmd」        同样效果
 *
 *   node tools/del-post.js --list       只列出文章，不删
 *   node tools/del-post.js --slug xxx --yes --no-push
 *
 * 参数
 *   --slug <英文>   直接指定要删的文章文件名
 *   --yes           跳过删除确认（脚本化用，慎用）
 *   --no-push       删除并构建，但不提交推送
 *   --redirect <路径>  自定义 301 跳转目标（默认不加跳转）
 *   --list          只列出文章
 *   --help          看帮助
 */

'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline/promises');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const POSTS_DIR = path.join(ROOT, 'source', '_posts');
const COVERS_DIR = path.join(ROOT, 'source', 'img', 'covers');
const SITEMAP = path.join(ROOT, 'public', 'sitemap.xml');
const REDIRECTS = path.join(ROOT, '_redirects');

const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];

// ------------------------------------------------------------------ 输出
const say = (m = '') => console.log(m);
const ok = (m) => console.log('[ OK ] ' + m);
const warn = (m) => console.log('[WARN] ' + m);
const bad = (m) => console.log('[FAIL] ' + m);
const step = (i, n, m) => { say(''); say(`--- [${i}/${n}] ${m} ---`); };
const bail = (m) => { say(''); bad(m); say(''); process.exit(1); };

// ------------------------------------------------------------------ 系统
function runShell(command) {
  const r = spawnSync(command, { cwd: ROOT, stdio: 'inherit', shell: true });
  return r.status === 0;
}

function capture(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8' });
  if (r.error || r.status !== 0) return null;
  return (r.stdout || '').trim();
}

// ------------------------------------------------------------------ 文章列表
function listPosts() {
  if (!fs.existsSync(POSTS_DIR)) return [];
  return fs.readdirSync(POSTS_DIR)
    .filter((f) => f.toLowerCase().endsWith('.md'))
    .map((f) => {
      const slug = f.replace(/\.md$/i, '');
      const raw = fs.readFileSync(path.join(POSTS_DIR, f), 'utf8');
      // 只做很轻量的 front-matter 解析：只关心 title 和 date
      const head = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw);
      const fm = head ? head[1] : '';
      const titleM = /^title:\s*(.+?)\s*$/m.exec(fm);
      const dateM = /^date:\s*(.+?)\s*$/m.exec(fm);
      return {
        slug,
        file: path.join(POSTS_DIR, f),
        title: titleM ? titleM[1].replace(/^["']|["']$/g, '') : '(无标题)',
        date: dateM ? dateM[1] : '',
        order: dateM ? Date.parse(dateM[1].replace(/\//g, '-')) || 0 : 0
      };
    })
    .sort((a, b) => b.order - a.order);
}

// 找出这篇关联的附属文件
function findRelated(post) {
  const items = [];

  // 专属封面（任何支持的扩展名）
  for (const ext of IMAGE_EXTS) {
    const p = path.join(COVERS_DIR, post.slug + ext);
    if (fs.existsSync(p)) items.push(p);
  }

  // 资源文件夹（用 hexo new 创建的文章才有）
  const assetDir = path.join(POSTS_DIR, post.slug);
  if (fs.existsSync(assetDir) && fs.statSync(assetDir).isDirectory()) items.push(assetDir);

  return items;
}

// 从 front-matter 的 date 推文章 URL：/YYYY/MM/DD/slug/
function postUrl(post) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(post.date || '');
  if (!m) return null;
  return `/${m[1]}/${m[2]}/${m[3]}/${post.slug}/`;
}

// ------------------------------------------------------------------ 参数
function parseArgs(argv) {
  const out = { flags: new Set() };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { out.flags.add('help'); continue; }
    if (a === '--yes' || a === '-y') { out.flags.add('yes'); continue; }
    if (a === '--no-push') { out.flags.add('no-push'); continue; }
    if (a === '--list') { out.flags.add('list'); continue; }
    if (a === '--slug') { out.slug = argv[++i] || ''; continue; }
    if (a === '--redirect') { out.redirect = argv[++i] || ''; continue; }
  }
  return out;
}

const HELP = `
删除文章

  npm run del-post                     交互式：列出所有文章让你选
  双击仓库根目录的「删文章.cmd」         同样效果

参数：
  --slug <英文>        直接指定要删的文章文件名（免去选择）
  --yes                跳过删除确认（脚本化用，慎用 —— 删除不可逆）
  --redirect <路径>    顺便加一条 301 跳转（旧链接 -> 该路径）
                       例如 --redirect /archives/
  --no-push            删除并构建，但不提交推送
  --list               只列出所有文章，不删

说明：
  会自动清理这篇的专属封面图 source/img/covers/<文件名>.*
  以及资源文件夹 source/_posts/<文件名>/（如果有）
`;

// ------------------------------------------------------------------ 主流程
(async function main() {
  if (process.platform === 'win32' && process.stdout.isTTY) {
    spawnSync('chcp.com', ['65001'], { stdio: 'ignore' });
  }

  const args = parseArgs(process.argv.slice(2));
  if (args.flags.has('help')) { say(HELP); return; }

  say('');
  say('==============================================================');
  say(' 删除文章');
  say('==============================================================');

  // ---------------------------------------------------------- 1. 前置检查
  step(1, 6, '环境检查');

  if (!fs.existsSync(path.join(ROOT, '.git'))) bail('这里不是 git 仓库，脚本要在博客项目根目录下运行。');
  ok('git 仓库正常');

  const posts = listPosts();
  if (!posts.length) bail('source/_posts 里没有任何文章。');

  // 只列出
  if (args.flags.has('list')) {
    say('');
    say(`  共 ${posts.length} 篇文章：`);
    say('');
    posts.forEach((p, i) => {
      say(`   ${String(i + 1).padStart(2)}. ${p.title}`);
      say(`       ${p.slug}.md      ${p.date}`);
    });
    say('');
    return;
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const canAsk = !!process.stdin.isTTY;
  const ask = async (q, def) => {
    const hint = def ? ` [${def}]` : '';
    const a = (await rl.question(`${q}${hint}: `)).trim();
    return a || def || '';
  };

  const dirty = capture('git', ['status', '--porcelain']);
  if (dirty === null) {
    warn('读不到 git 状态，跳过「工作区是否干净」检查');
  } else if (dirty) {
    const lines = dirty.split(/\r?\n/);
    warn('工作区有未提交的改动：');
    lines.slice(0, 10).forEach((l) => say('        ' + l));
    if (lines.length > 10) say('        ...（共 ' + lines.length + ' 项）');
    say('');
    say('  继续的话，这些改动会和「删除文章」【一起被提交】。');
    if (canAsk) {
      const a = (await ask('确认继续？(y/N)', 'n')).toLowerCase();
      if (a !== 'y' && a !== 'yes') {
        rl.close();
        say('');
        say('  已取消，什么都没做。');
        say('');
        process.exit(0);
      }
    } else {
      warn('非交互模式，直接继续');
    }
  } else {
    ok('工作区干净');
  }

  // ---------------------------------------------------------- 2. 选文章
  step(2, 6, '选择要删除的文章');

  let target = null;

  if (args.slug) {
    const wanted = args.slug.trim().toLowerCase();
    target = posts.find((p) => p.slug.toLowerCase() === wanted);
    if (!target) bail(`找不到文章：${args.slug}\n       用 --list 看看有哪些。`);
  } else {
    say('');
    posts.forEach((p, i) => {
      say(`   ${String(i + 1).padStart(2)}. ${p.title}`);
      say(`       ${p.slug}.md`);
    });
    say('');

    if (!canAsk) bail('当前终端不能交互输入，请用 --slug <文件名> 指定要删的文章。');

    while (!target) {
      const a = (await ask(`输入序号（1-${posts.length}），或直接回车取消`, '')).trim();
      if (!a) { rl.close(); say(''); say('  已取消，什么都没做。'); say(''); process.exit(0); }
      const n = parseInt(a, 10);
      if (Number.isInteger(n) && n >= 1 && n <= posts.length) target = posts[n - 1];
      else warn('序号不对，请重新输入');
    }
  }

  const related = findRelated(target);
  const tocUrl = postUrl(target);

  say('');
  say('  即将删除：');
  say(`    - source/_posts/${target.slug}.md`);
  related.forEach((p) => say('    - ' + path.relative(ROOT, p).replace(/\\/g, '/') + (fs.statSync(p).isDirectory() ? '/  （资源文件夹）' : '')));
  say('');
  say(`  标题：${target.title}`);
  if (tocUrl) say(`  原链接：${tocUrl}`);

  // ---------------------------------------------------------- 3. 确认
  step(3, 6, '确认');

  if (args.flags.has('yes')) {
    warn('按 --yes 跳过确认（删除不可逆）');
  } else {
    if (!canAsk) bail('当前终端不能交互输入，确认删除请加 --yes。');
    say('  ⚠️ 删除不可逆（文件从工作区移除，提交后就推上去了）');
    const a = (await ask('确认删除？输入 y 确认', 'n')).toLowerCase();
    if (a !== 'y' && a !== 'yes') {
      rl.close();
      say('');
      say('  已取消，什么都没做。');
      say('');
      process.exit(0);
    }
  }

  // ---------------------------------------------------------- 4. 执行删除
  step(4, 6, '删除文件');

  try {
    fs.unlinkSync(target.file);
    ok('已删除 source/_posts/' + target.slug + '.md');
  } catch (e) {
    bail('删除文章文件失败：' + e.message);
  }

  related.forEach((p) => {
    try {
      fs.rmSync(p, { recursive: true, force: true });
      ok('已删除 ' + path.relative(ROOT, p).replace(/\\/g, '/'));
    } catch (e) {
      warn('删除失败（请手动处理）：' + p + ' —— ' + e.message);
    }
  });

  // ---------------------------------------------------------- 5. 构建校验
  step(5, 6, '构建并校验旧页面已清除');
  say('  正在执行 npm run build ...');
  if (!runShell('npm run build')) {
    bail('构建失败，已中止（没有提交、没有推送）。\n       文章源文件已删除，可以用 git checkout 恢复。');
  }
  ok('构建成功');

  // 关键校验：确认旧页面真的没了。Hexo 会自动删，但必须亲眼确认
  if (fs.existsSync(SITEMAP)) {
    const stillThere = fs.readFileSync(SITEMAP, 'utf8').includes(target.slug);
    if (stillThere) {
      warn('sitemap 里【仍然】有 ' + target.slug + ' —— 请人工确认构建产物');
    } else {
      ok('已在 sitemap 中确认这篇文章已移除');
    }
  }
  if (tocUrl) {
    const page = path.join(ROOT, 'public', tocUrl.replace(/^\//, ''), 'index.html');
    say('  生成的页面 ' + tocUrl + ' : ' + (fs.existsSync(page) ? '⚠️ 仍存在' : '已清除'));
  }

  // ---------------------------------------------------------- 6. 301 跳转
  step(6, 6, '301 跳转（可选）');

  if (tocUrl) {
    say('  如果这个链接【已经分享出去过】（发过微信、论坛、或被别人收藏），');
    say('  建议加一条 301，让旧链接跳到归档页而不是变成 404。');
    say('');
    if (args.redirect) {
      // 命令行指定了目标，直接加
      appendRedirect(tocUrl, args.redirect);
    } else if (canAsk && !args.flags.has('yes')) {
      const a = (await ask('是否加 301 跳转到 /archives/ ？(y/N)', 'n')).toLowerCase();
      if (a === 'y' || a === 'yes') appendRedirect(tocUrl, '/archives/');
      else say('  已跳过（没分享过的链接不需要）');
    } else {
      say('  已跳过');
    }
  } else {
    warn('读不到文章日期，无法推导原链接，跳过 301 提示');
  }

  rl.close();

  // ---------------------------------------------------------- 提交推送
  say('');
  say('--- 提交并推送 ---');

  if (args.flags.has('no-push')) {
    warn('按参数要求跳过提交推送（--no-push）');
    say('');
    say('  本地已删除并构建完成，想发布的话执行：');
    say(`    git add -A && git commit -m "post: 删除 ${target.title}" && git push`);
  } else {
    if (!runShell('git add -A')) bail('git add 失败');
    ok('已暂存改动');

    const msgFile = path.join(ROOT, '.git', 'DELPOST_MSG');
    fs.writeFileSync(msgFile, 'post: 删除「' + target.title + '」\n', 'utf8');
    const committed = spawnSync('git', ['commit', '-F', msgFile], { cwd: ROOT, stdio: 'inherit' });
    try { fs.unlinkSync(msgFile); } catch (e) { /* 忽略 */ }
    if (committed.status !== 0) bail('git commit 失败');
    ok('已提交');

    if (!runShell('git push')) bail('git push 失败 —— 本地已提交，网络恢复后手动执行 git push 即可');
    ok('已推送');
  }

  say('');
  say('==============================================================');
  say(' 完成');
  say('==============================================================');
  say(`  已删除：${target.title}`);
  say('  Cloudflare 会在 1~2 分钟内自动重新构建。');
  say('');
})().catch((err) => {
  say('');
  bad('出错了：' + (err && err.message ? err.message : String(err)));
  say('');
  process.exit(1);
});

// 往 _redirects 末尾追加一条规则
function appendRedirect(from, to) {
  try {
    let content = fs.existsSync(REDIRECTS) ? fs.readFileSync(REDIRECTS, 'utf8') : '';
    if (content.length && !content.endsWith('\n')) content += '\n';
    if (content.includes(from + ' ')) {
      warn('_redirects 里已经有 ' + from + ' 的规则，跳过');
      return;
    }
    const line = `${from.padEnd(38)} ${to.padEnd(24)} 301`;
    content += `\n# 删除文章后加的跳转（旧链接不要变死链）\n${line}\n`;
    fs.writeFileSync(REDIRECTS, content, 'utf8');
    ok('已往 _redirects 加一条：' + line.trim());
  } catch (e) {
    warn('写入 _redirects 失败：' + e.message);
  }
}
