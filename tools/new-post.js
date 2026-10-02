#!/usr/bin/env node
/**
 * 一键发文章
 * ===========================================================================
 *
 * 它做什么
 *   问几个问题（标题、文件名、分类、标签、摘要、封面图）
 *   -> 生成 source/_posts/<文件名>.md
 *   -> 自动处理封面图（复制 / 缩放 / 命名成约定格式）
 *   -> 打开编辑器让你写正文
 *   -> 构建并校验文章真的生成了
 *   -> git commit + push（Cloudflare 会自动部署）
 *
 * 发帖方式没有变
 *   依然是「Markdown 文件 + git push + Cloudflare 自动构建」。
 *   这个脚本只是把手动步骤串起来，没有引入任何新机制、新服务、新依赖到构建里。
 *
 * 用法
 *   npm run new-post                  # 交互式（推荐）
 *   双击仓库根目录的「发文章.cmd」      # 同样效果
 *
 *   # 也可以完全不交互（方便脚本化 / 测试）
 *   node tools/new-post.js --title "标题" --slug my-post --no-edit --no-push
 *
 * 参数
 *   --title <文字>      标题
 *   --slug <英文>       文件名（也是 URL 的一部分）
 *   --category <文字>   分类
 *   --tags <a,b>        标签，逗号分隔
 *   --desc <文字>       摘要（用于首页和 SEO）
 *   --cover <路径>      封面图路径
 *   --no-edit           不打开编辑器（先建空文件，之后再写）
 *   --no-push           只生成 + 构建，不提交推送
 *   --help              看帮助
 *
 * 环境变量
 *   NEW_POST_EDITOR     指定编辑器（完整路径），不设则自动找 VS Code / 记事本
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

let { pinyin } = {};
try {
  ({ pinyin } = require('pinyin-pro'));
} catch (e) {
  pinyin = null; // 没装也能用，只是不能自动生成拼音文件名
}

// ------------------------------------------------------------------ 输出
const say = (m = '') => console.log(m);
const ok = (m) => console.log('[ OK ] ' + m);
const warn = (m) => console.log('[WARN] ' + m);
const bad = (m) => console.log('[FAIL] ' + m);
const step = (i, n, m) => { say(''); say(`--- [${i}/${n}] ${m} ---`); };
const bail = (m) => { say(''); bad(m); say(''); process.exit(1); };

// ------------------------------------------------------------------ 系统
// Windows 的 .cmd / .bat 不能用 spawnSync 直接跑，得走 shell
function runShell(command) {
  const r = spawnSync(command, { cwd: ROOT, stdio: 'inherit', shell: true });
  return r.status === 0;
}

// 捕获型调用（只用于很短的命令，比如 git status）
function capture(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8' });
  if (r.error || r.status !== 0) return null;
  return (r.stdout || '').trim();
}

function findExecutable(name, extraDirs = []) {
  const exts = (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean);
  const dirs = (process.env.PATH || '').split(path.delimiter).concat(extraDirs).filter(Boolean);
  for (const dir of dirs) {
    for (const ext of exts) {
      for (const e of [ext.toLowerCase(), ext.toUpperCase()]) {
        const p = path.join(dir, name + e);
        if (fs.existsSync(p)) return p;
      }
    }
  }
  return null;
}

function findFfmpeg() {
  return findExecutable('ffmpeg', [
    path.join(process.env.USERPROFILE || '', 'AppData', 'Local', 'Programs', 'Python', 'Python310', 'Scripts')
  ]);
}

// ------------------------------------------------------------------ 编辑器
function resolveEditor() {
  const custom = process.env.NEW_POST_EDITOR;
  if (custom && fs.existsSync(custom)) return custom;

  const local = process.env.LOCALAPPDATA || '';
  const pf = process.env.ProgramFiles || 'C:\\Program Files';
  const candidates = [
    path.join(local, 'Programs', 'Microsoft VS Code', 'Code.exe'),
    path.join(pf, 'Microsoft VS Code', 'Code.exe'),
    path.join(local, 'Programs', 'cursor', 'Cursor.exe')
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;

  const onPath = findExecutable('Code') || findExecutable('notepad');
  if (onPath) return onPath;

  return 'notepad.exe';
}

function openEditor(file) {
  const editor = resolveEditor();
  const base = path.basename(editor).toLowerCase();
  // VS Code / Cursor 需要 --wait 才会等文件被关闭；记事本本身就会阻塞
  const args = /^(code|cursor)/.test(base) ? ['--wait', file] : [file];
  say(`  用 ${path.basename(editor)} 打开，写完【保存并关闭】它就会继续...`);
  const r = spawnSync(editor, args, { cwd: ROOT, stdio: 'inherit' });
  return !r.error;
}

// ------------------------------------------------------------------ 参数
function parseArgs(argv) {
  const out = { flags: new Set() };
  const keys = ['title', 'slug', 'category', 'tags', 'desc', 'cover'];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { out.flags.add('help'); continue; }
    if (a === '--no-edit') { out.flags.add('no-edit'); continue; }
    if (a === '--no-push') { out.flags.add('no-push'); continue; }
    const m = /^--([a-z]+)$/.exec(a);
    if (m && keys.includes(m[1])) { out[m[1]] = argv[++i] || ''; continue; }
  }
  return out;
}

const HELP = `
一键发文章

  npm run new-post                              交互式（推荐）
  双击仓库根目录的「发文章.cmd」                 同样效果

非交互用法：
  node tools/new-post.js --title "标题" --slug my-post
       [--category 分类] [--tags 标签1,标签2] [--desc 摘要]
       [--cover 图片路径] [--no-edit] [--no-push]

  --no-edit   不打开编辑器（先把文件建好，正文之后再写）
  --no-push   只生成并构建，不提交推送（演练用）

环境变量：
  NEW_POST_EDITOR   指定编辑器完整路径（默认自动找 VS Code，找不到用记事本）
`;

// ------------------------------------------------------------------ 工具
function slugify(title) {
  if (!pinyin) return '';
  let s = pinyin(title, { toneType: 'none', type: 'array', nonZh: 'consecutive' }).join('-');
  s = s.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
  if (s.length > 60) s = s.slice(0, 60).replace(/-+$/g, '');
  return s;
}

function todayStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return {
    date: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:00`,
    compact: `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`
  };
}

/**
 * 找出 front-matter 里 date 在【未来】的文章。
 *
 * 为什么需要这个检查：
 *   新文章的日期是"此刻"，如果仓库里已有文章的日期比此刻还晚，
 *   那篇新文章就会排到它们下面 —— 表现是「刚发的文章跑到列表中间/最后了」。
 *   这类问题不报错、只能靠肉眼发现，所以这里主动检查并大声提示。
 */
function findFutureDatedPosts() {
  const now = Date.now();
  const out = [];
  if (!fs.existsSync(POSTS_DIR)) return out;

  for (const f of fs.readdirSync(POSTS_DIR)) {
    if (!f.toLowerCase().endsWith('.md')) continue;
    const raw = fs.readFileSync(path.join(POSTS_DIR, f), 'utf8');
    const head = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw);
    const m = head && /^date:\s*(.+?)\s*$/m.exec(head[1]);
    if (!m) continue;
    const t = Date.parse(m[1].replace(/-/g, '/'));
    if (!Number.isNaN(t) && t > now) {
      out.push({ slug: f.replace(/\.md$/i, ''), date: m[1], t });
    }
  }
  return out.sort((a, b) => b.t - a.t);
}

// 从终端拖文件进来会带上引号，去掉
function cleanPath(p) {
  let s = String(p || '').trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1);
  }
  return s.trim();
}

function imageSize(file) {
  const ffmpeg = findFfmpeg();
  if (!ffmpeg) return null;
  const ffprobe = ffmpeg.replace(/ffmpeg(\.exe)?$/i, 'ffprobe$1');
  if (!fs.existsSync(ffprobe)) return null;
  const w = capture(ffprobe, ['-v', 'error', '-show_entries', 'stream=width', '-of', 'default=noprint_wrappers=1:nokey=1', file]);
  const h = capture(ffprobe, ['-v', 'error', '-show_entries', 'stream=height', '-of', 'default=noprint_wrappers=1:nokey=1', file]);
  if (!w || !h) return null;
  return { width: parseInt(w, 10), height: parseInt(h, 10) };
}

// 处理封面：复制/缩放到 source/img/covers/<slug>.<ext>，返回可供 front-matter 用的路径
function processCover(srcInput, slug) {
  const src = cleanPath(srcInput);
  if (!src) return { value: '', note: '' };

  if (!fs.existsSync(src)) return { error: `找不到图片：${src}` };

  let ext = path.extname(src).toLowerCase();
  const allowed = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
  if (!allowed.includes(ext)) {
    return { error: `不支持的图片格式 ${ext}（支持 ${allowed.join(' ')}）` };
  }

  fs.mkdirSync(COVERS_DIR, { recursive: true });
  const target = path.join(COVERS_DIR, slug + ext);

  // 先清掉同名的其他扩展名，避免 post-cover.js 匹配到旧图
  for (const e of allowed) {
    const other = path.join(COVERS_DIR, slug + e);
    if (other !== target && fs.existsSync(other)) fs.unlinkSync(other);
  }

  const size = fs.statSync(src).size;
  const dim = imageSize(src);
  const tooBig = size > 400 * 1024;
  const tooWide = dim && dim.width > 1600;

  if ((tooBig || tooWide) && findFfmpeg()) {
    const ffmpeg = findFfmpeg();
    // 缩到 1280 宽，保持比例；保持原格式
    const r = spawnSync(ffmpeg, ['-y', '-loglevel', 'error', '-i', src, '-vf', 'scale=1280:-1', '-q:v', '3', target], { stdio: 'inherit' });
    if (r.status === 0 && fs.existsSync(target)) {
      const after = Math.round(fs.statSync(target).size / 1024);
      const before = Math.round(size / 1024);
      return {
        value: `/img/covers/${slug}${ext}`,
        note: `已缩放：${before} KB -> ${after} KB${dim ? `（原 ${dim.width}x${dim.height} -> 1280 宽）` : ''}`
      };
    }
    warn('缩放失败，改为直接复制原图');
  }

  fs.copyFileSync(src, target);
  return { value: `/img/covers/${slug}${ext}`, note: `已复制（${Math.round(size / 1024)} KB）` };
}

// ------------------------------------------------------------------ 主流程
(async function main() {
  // 控制台切 UTF-8，否则中文在 GBK 代码页下会乱码
  if (process.platform === 'win32' && process.stdout.isTTY) {
    spawnSync('chcp.com', ['65001'], { stdio: 'ignore' });
  }

  const args = parseArgs(process.argv.slice(2));
  if (args.flags.has('help')) { say(HELP); return; }

  say('');
  say('==============================================================');
  say(' 一键发文章');
  say('==============================================================');

  // 提前建好交互接口 —— 前置检查里可能也要问问题
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const canAsk = !!process.stdin.isTTY;
  const ask = async (q, def) => {
    const hint = def ? ` [${def}]` : '';
    const a = (await rl.question(`${q}${hint}: `)).trim();
    return a || def || '';
  };

  // ---------------------------------------------------------- 1. 前置检查
  step(1, 7, '环境检查');

  if (!fs.existsSync(path.join(ROOT, '.git'))) bail('这里不是 git 仓库，脚本要在博客项目根目录下运行。');
  if (!fs.existsSync(POSTS_DIR)) bail('找不到 source/_posts 目录，路径不对？');
  ok('git 仓库正常');

  const dirty = capture('git', ['status', '--porcelain']);
  if (dirty === null) {
    warn('读不到 git 状态，跳过「工作区是否干净」检查');
  } else if (dirty) {
    const lines = dirty.split(/\r?\n/);
    warn('工作区有未提交的改动：');
    lines.slice(0, 10).forEach((l) => say('        ' + l));
    if (lines.length > 10) say('        ...（共 ' + lines.length + ' 项）');
    say('');
    say('  继续的话，这些改动会和你的新文章【一起被提交】。');
    if (canAsk) {
      const a = (await ask('确认继续？(y/N)', 'n')).toLowerCase();
      if (a !== 'y' && a !== 'yes') {
        rl.close();
        say('');
        say('  已取消，什么都没做。');
        say('  建议先在终端执行 git status 看清是什么改动，处理干净再发文章。');
        say('');
        process.exit(0);
      }
    } else {
      warn('非交互模式，直接继续');
    }
  } else {
    ok('工作区干净');
  }

  // ---------------------------------------------------------- 2. 收集信息
  step(2, 7, '填写信息');
  say('  （直接回车 = 用中括号里的默认值；封面图可以【把文件拖进这个窗口】）');
  say('');

  // 非交互模式（终端被重定向 / 管道）下不能提问，所以必填项必须靠参数给
  if (!canAsk && (!args.title || !args.slug)) {
    bail('当前终端不能交互输入（被重定向了？），所以必须把标题和文件名都作为参数传进来：\n'
       + '       node tools/new-post.js --title "标题" --slug my-post');
  }

  // 可选项：交互模式就提问，非交互模式直接用默认值
  const askOpt = async (q, def) => (canAsk ? ask(q, def) : (def || ''));

  let title = args.title;
  while (!title) {
    title = await ask('文章标题');
    if (!title) warn('标题不能为空');
  }

  const guess = slugify(title);
  let slug = (args.slug || '').trim().toLowerCase();
  while (true) {
    if (slug && /^[a-z0-9][a-z0-9-]*$/.test(slug)) break;
    if (!canAsk) {
      bail(`文件名不合法或缺失：${slug || '(空)'}\n       只能用小写字母、数字和连字符，且不能以连字符开头`);
    }
    if (slug) warn('只能用小写字母、数字和连字符，且不能以连字符开头');
    slug = (await ask('文件名（英文，同时是 URL 的一部分）', guess || `post-${todayStamp().compact}`)).trim().toLowerCase();
  }

  const postFile = path.join(POSTS_DIR, slug + '.md');
  if (fs.existsSync(postFile)) bail(`已存在同名文章：source/_posts/${slug}.md\n       换个文件名，或先删掉旧文件。`);
  ok(`文件名可用：${slug}.md`);

  const category = args.category !== undefined ? args.category : await askOpt('分类（留空则不填）', '随笔');
  const tags = args.tags !== undefined ? args.tags : await askOpt('标签（多个用逗号分隔，留空则不填）', '');
  const desc = args.desc !== undefined ? args.desc : await askOpt('摘要（用于首页和搜索，留空则自动截取）', '');

  let coverInput = args.cover !== undefined ? args.cover : await askOpt('封面图路径（留空则用默认封面）', '');
  let cover = { value: '', note: '' };
  if (coverInput) {
    cover = processCover(coverInput, slug);
    if (cover.error) {
      warn(cover.error);
      if (canAsk) {
        const retry = await ask('重新输入封面路径（留空跳过）', '');
        cover = retry ? processCover(retry, slug) : { value: '', note: '' };
      }
      if (cover.error) { warn('已跳过封面'); cover = { value: '', note: '' }; }
    }
    if (cover.note) ok('封面：' + cover.note);
  }
  rl.close();

  // ---------------------------------------------------------- 3. 生成文件
  step(3, 7, '生成 Markdown');

  const stamps = todayStamp();

  // 主动查找「日期在未来」的文章 —— 否则这篇会莫名其妙排到它们下面
  const futurePosts = findFutureDatedPosts();
  if (futurePosts.length) {
    warn(`发现 ${futurePosts.length} 篇文章的日期在【未来】：`);
    futurePosts.slice(0, 5).forEach((p) => say(`        ${p.slug}   date: ${p.date}`));
    if (futurePosts.length > 5) say(`        ...（共 ${futurePosts.length} 篇）`);
    say('');
    say(`  当前真实时间：${new Date().toLocaleString('zh-CN', { hour12: false })}`);
    say(`  本篇的日期　：${stamps.date}`);
    say('');
    say('  ⚠️ 那几篇的日期比你新发的还晚，所以你这篇会排在它们【下面】。');
    say('     修法：把它们的 date 改成过去的时间。');
    say('     （顺带一提：置顶字段是 sticky: 100，不是 top）');
    say('');
  }

  const tagLines = tags
    ? tags.split(/[,，]/).map((t) => t.trim()).filter(Boolean).map((t) => '  - ' + t).join('\n')
    : '';
  const catLines = category ? '  - ' + category : '';

  const frontMatter = [
    '---',
    'title: ' + title,
    'date: ' + stamps.date,
    // 不写 updated：由 _config.yml 的 updated_option ('date') 兜底成发布日期。
    // 不用 mtime，因为 CI 每次都是全新 checkout，mtime 会变成构建时刻。
    // 以后修订文章时，再手动加一行 updated: 新日期。
    tagLines ? 'tags:\n' + tagLines : 'tags:',
    catLines ? 'categories:\n' + catLines : 'categories:',
    desc ? 'description: ' + desc : 'description:',
    cover.value ? 'cover: ' + cover.value : 'cover:',
    'toc: true',
    'comments: true',
    '---',
    '',
    '<!-- 写正文吧。写完【保存并关闭编辑器】，脚本会自动构建并推送。',
    '',
    '     小提示：',
    '     · 图片放在 source/img/ 目录，正文里用 /img/文件名 引用',
    '     · 想让首页摘要在这里截断，可以插入 Hexo 的 more 标记',
    '       （写法见《Hexo 写作速查》那篇）',
    '     · 摘要也可以直接写在 front-matter 的 description 里',
    '-->',
    '',
    ''
  ].join('\n');

  fs.writeFileSync(postFile, frontMatter, 'utf8');
  ok('已生成 source/_posts/' + slug + '.md');

  // ---------------------------------------------------------- 4. 写正文
  step(4, 7, '写正文');
  if (args.flags.has('no-edit')) {
    warn('按参数要求跳过打开编辑器（--no-edit）');
  } else {
    openEditor(postFile);
    ok('编辑器已关闭');
  }

  // ---------------------------------------------------------- 5. 构建校验
  step(5, 7, '构建并校验');
  say('  正在执行 npm run build ...');
  if (!runShell('npm run build')) {
    bail('构建失败，已中止（没有提交、没有推送）。\n       你的文章文件还在：source/_posts/' + slug + '.md');
  }
  ok('构建成功');

  // 校验文章真的生成了 —— 只信退出码是不够的
  let found = false;
  if (fs.existsSync(SITEMAP)) {
    found = fs.readFileSync(SITEMAP, 'utf8').includes(slug);
  }
  if (found) {
    ok('已在 sitemap 中确认这篇文章生成成功');
  } else {
    warn('没在 sitemap 里找到这篇文章，请人工确认一下');
  }

  // ---------------------------------------------------------- 6. 提交推送
  step(6, 7, '提交并推送');

  if (args.flags.has('no-push')) {
    warn('按参数要求跳过提交推送（--no-push）');
    say('');
    say('  本地准备好了，但没有推送。想发布的话执行：');
    say('    git add -A && git commit -m "post: ' + title + '" && git push');
  } else {
    if (!runShell('git add -A')) bail('git add 失败');
    ok('已暂存改动');

    // 用 -F 传消息，避免中文和特殊符号在命令行里被转义搞坏
    const msgFile = path.join(ROOT, '.git', 'NEWPOST_MSG');
    fs.writeFileSync(msgFile, 'post: ' + title + '\n', 'utf8');
    const committed = spawnSync('git', ['commit', '-F', msgFile], { cwd: ROOT, stdio: 'inherit' });
    try { fs.unlinkSync(msgFile); } catch (e) { /* 忽略 */ }
    if (committed.status !== 0) bail('git commit 失败（可能是没有任何改动）');
    ok('已提交');

    if (!runShell('git push')) bail('git push 失败 —— 本地已提交，网络恢复后手动执行 git push 即可');
    ok('已推送');
  }

  // ---------------------------------------------------------- 7. 完成
  step(7, 7, '完成');
  say('');
  say('  标题 : ' + title);
  say('  文件 : source/_posts/' + slug + '.md');
  say('  封面 : ' + (cover.value || '（用默认封面）'));
  say('');
  if (!args.flags.has('no-push')) {
    say('  Cloudflare 会在 1~2 分钟内自动重新构建并发布。');
    say('  本地预览：npm run server  ->  http://localhost:4000');
  }
  say('');
})().catch((err) => {
  say('');
  bad('出错了：' + (err && err.message ? err.message : String(err)));
  say('');
  process.exit(1);
});
