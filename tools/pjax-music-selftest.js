#!/usr/bin/env node
/**
 * 悬浮播放器 + PJAX 自测（CDP 驱动真实 Edge）
 * ===========================================================================
 *
 * 用法
 *   node tools/pjax-music-selftest.js                     # 测本地 :4000
 *   node tools/pjax-music-selftest.js https://vopth.xyz    # 直接测线上
 *
 * 为什么用 Node 写（而不是 Python）
 *   vopth-blog 是 Node 项目，tools/ 下全是 .js。
 *   第一版我用 Python 写的，还借了 D:\esp32\venv 里的 websockets ——
 *   那是给 ESP32 建的环境，跟博客毫无关系。站主一句
 *   「博客的脚本和 esp32 有什么关系？」把这个搭便车点破了。
 *   现在用 Node 内置的 WebSocket（Node 21+）+ 内置 fetch，
 *   【零第三方依赖】，环境就是项目自己的环境。
 *
 * 为什么要跑这个（而不是靠肉眼）
 *   PJAX 会替换 #body-wrap（整个页面主体）。失效方式是「某个效果悄悄没了」：
 *   首页简介卡片不出现、阅读进度条不撤、banner 视频没了、音乐断了 ——
 *   全都只有 4 个字母的差别，肉眼对着看根本发现不了。
 *
 * 关键判据：引用相等
 *   「播放器有没有被 PJAX 换掉」不能只看元素存不存在（新页面可能又建一个）。
 *   要在翻页前把元素存进 window.__ref，翻页后比较
 *     document.getElementById('vopth-music') === window.__ref
 *   同一个对象 = 没被替换 = iframe 没重载 = 音乐没断。
 *
 * ⚠️ 两个把我坑过的测试自身缺陷（都已在代码里处理）
 *   1) 调试端口不能写死。Edge 被 kill 后子进程还占着端口，下一轮
 *      fetch /json/version 会连到【上一轮那个旧浏览器】，页面停在空白，
 *      表现成"整站全崩"（38 项挂 26 项）。→ 每轮用 freePort() 要一个空闲端口。
 *   2) 收尾必须杀整棵进程树 + 按配置目录名兜底。只 kill 父进程会残留
 *      二十来个 msedge（Edge 的子进程会被重新挂到别的父进程下）。
 *   3) 判据要等状态，不能等时间。用 sleep(3) 就断言，赶上环境繁忙时
 *      pjax.min.js 还没执行完，点链接走的是普通整页跳转 → 一串 FAIL +
 *      "Pjax is not defined"。→ waitReady() 轮询到 pjax 就绪再往下。
 *
 * ⚠️ 只读：它不改任何仓库文件，只启一个临时 Edge 实例读页面状态。
 *    （测线上时会让 page-views.js 记一两次 PV —— 就一两次，无感。）
 */

'use strict';

const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const SITE = process.argv[2] || 'http://127.0.0.1:4000';

/* ---------------------------------------------------------------- 小工具 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 要一个空闲端口。⚠️ 必须动态要 —— 写死端口会连到上一轮的旧浏览器 */
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
  });
}

/** 杀进程树（快路径） */
function killTree(pid) {
  try {
    spawnSync('taskkill', ['/F', '/T', '/PID', String(pid)], { stdio: 'ignore', timeout: 15000 });
  } catch (e) { /* 忽略 */ }
}

/**
 * 按配置目录名杀 msedge，返回还剩几个。
 * ⚠️ 光靠 killTree 不够：Edge 的子进程会被重新挂到别的父进程下，
 *    实测每跑一轮残留 20 个。标记用本次随机的配置目录名，
 *    所以只会命中我们自己起的实例，不会误伤用户正在用的 Edge。
 */
function killByProfile(marker) {
  const ps =
    "Get-CimInstance Win32_Process -Filter \"Name='msedge.exe'\" -ErrorAction SilentlyContinue" +
    ` | Where-Object { $_.CommandLine -like '*${marker}*' }` +
    ' | ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop } catch {} }';
  try {
    spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], {
      stdio: 'ignore', timeout: 40000,
    });
  } catch (e) { /* 忽略 */ }
  try {
    const r = spawnSync('powershell', [
      '-NoProfile', '-NonInteractive', '-Command',
      "(Get-CimInstance Win32_Process -Filter \"Name='msedge.exe'\" -ErrorAction SilentlyContinue" +
      ` | Where-Object { $_.CommandLine -like '*${marker}*' }).Count`,
    ], { encoding: 'utf8', timeout: 30000 });
    return parseInt(String(r.stdout || '0').trim(), 10) || 0;
  } catch (e) {
    return -1;
  }
}

/* ---------------------------------------------------------------- 结果收集 */

const results = [];

function check(ok, name, detail) {
  results.push({ ok: !!ok, name, detail: detail == null ? '' : String(detail) });
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? '   ' + detail : ''}`);
}

/* ---------------------------------------------------------------- CDP */

class CDP {
  constructor(ws) {
    this.ws = ws;
    this._id = 0;
    this._pending = new Map();
    // ⚠️ 必须收这个。有个 bug 在界面上【毫无反应】，唯一现象就是控制台
    //    一条 TypeError（var close 覆盖了 function close）。只看 DOM 状态抓不到。
    this.exceptions = [];
    ws.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (msg.method === 'Runtime.exceptionThrown') {
        const d = (msg.params && msg.params.exceptionDetails) || {};
        const text = (d.exception && d.exception.description) || d.text || '?';
        this.exceptions.push(String(text).split('\n')[0]);
      }
      if (msg.id && this._pending.has(msg.id)) {
        const p = this._pending.get(msg.id);
        clearTimeout(p.timer);
        this._pending.delete(msg.id);
        p.resolve(msg);
      }
    });
  }

  send(method, params, sessionId, timeoutMs) {
    const id = ++this._id;
    const msg = { id, method, params: params || {} };
    if (sessionId) msg.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pending.delete(id);
        reject(new Error('CDP 超时: ' + method));
      }, timeoutMs || 25000);
      this._pending.set(id, { resolve, timer });
      this.ws.send(JSON.stringify(msg));
    });
  }

  async ev(sessionId, expr) {
    const r = await this.send('Runtime.evaluate', {
      expression: expr, returnByValue: true, awaitPromise: true,
    }, sessionId);
    const res = r.result || {};
    if (res.exceptionDetails) return { __error: JSON.stringify(res.exceptionDetails) };
    return res.result ? res.result.value : undefined;
  }
}

/* ---------------------------------------------------------------- 等待 */

async function waitUrl(cdp, session, needle, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < (timeoutMs || 12000)) {
    const u = await cdp.ev(session, 'location.pathname');
    if (typeof u === 'string' && u.indexOf(needle) >= 0) return true;
    await sleep(250);
  }
  return false;
}

/**
 * 等页面真正就绪：pjax 库已加载 + 播放器已挂载。
 * ⚠️ 不能用固定 sleep —— 这是第一版踩过的坑，见文件头。
 */
async function waitReady(cdp, session, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < (timeoutMs || 20000)) {
    const ok = await cdp.ev(
      session,
      "typeof window.Pjax === 'function' && !!document.getElementById('vopth-music')"
    );
    if (ok) return true;
    await sleep(250);
  }
  return false;
}

/* ---------------------------------------------------------------- 主流程 */

async function main() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-'));
  const profileName = path.basename(profile);
  const port = await freePort();
  console.log(`  （站点 ${SITE}，调试端口 ${port}，配置目录 ${profileName}）`);

  const proc = spawn(EDGE, [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--window-size=1400,900',
    'about:blank',
  ], { stdio: 'ignore', detached: false });

  try {
    // ---- 等 CDP 就绪
    let wsUrl = null;
    for (let i = 0; i < 50; i++) {
      try {
        const r = await fetch(`http://127.0.0.1:${port}/json/version`);
        const j = await r.json();
        wsUrl = j.webSocketDebuggerUrl;
        break;
      } catch (e) { await sleep(400); }
    }
    if (!wsUrl) {
      console.log('  [!] CDP 起不来');
      return 1;
    }

    const ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', () => reject(new Error('WebSocket 连不上')), { once: true });
    });

    const cdp = new CDP(ws);

    const t = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const targetId = t.result.targetId;
    const a = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    const session = a.result.sessionId;

    await cdp.send('Page.enable', {}, session);
    await cdp.send('Runtime.enable', {}, session);

    const state = async () =>
      String(await cdp.ev(session, "document.getElementById('vopth-music').dataset.state"));
    const frameSrc = async () =>
      String(await cdp.ev(session, "(document.querySelector('.vopth-music-frame')||{}).src || ''"));

    /* ============================================================ 1) 首页 */
    console.log('\n' + '='.repeat(66));
    console.log('  1) 首页加载');
    console.log('='.repeat(66));

    await cdp.send('Page.navigate', { url: SITE + '/' }, session);
    check(await waitReady(cdp, session), '页面就绪（Pjax 库已加载 + 播放器已挂载）');

    check(await cdp.ev(session, "!!document.getElementById('vopth-music')"), '播放器 DOM 存在');
    check(await cdp.ev(session, "!!document.querySelector('.vopth-music-toggle')"), '悬浮按钮存在');
    let s = await state();
    check(s === 'closed', '初始是收起状态', `data-state=${s}`);
    check(
      await cdp.ev(session, "document.querySelectorAll('.vopth-music-frame').length === 0"),
      '初始没有创建 iframe（懒加载）'
    );
    check(
      await cdp.ev(session, "document.getElementById('vopth-music').parentElement === document.body"),
      '播放器挂在 body 直属下（PJAX 碰不到）'
    );
    check(await cdp.ev(session, "!!document.querySelector('.ph-card')"), '首页简介卡片存在（profile-hero 正常）');

    /* ============================================================ 2) 展开 */
    console.log('\n' + '='.repeat(66));
    console.log('  2) 点击悬浮按钮 → 展开并创建 iframe');
    console.log('='.repeat(66));

    await cdp.ev(session, "document.querySelector('.vopth-music-toggle').click()");
    for (let i = 0; i < 48; i++) {
      if (await cdp.ev(session, "!!document.querySelector('.vopth-music-frame')")) break;
      await sleep(250);
    }

    s = await state();
    check(s === 'open', '点开后是展开状态', `data-state=${s}`);
    let src = await frameSrc();
    check(!!src, 'iframe 已创建');
    check(src.indexOf('music.163.com/outchain/player') >= 0, 'iframe 指向网易官方外链', src.slice(0, 100));
    check(src.indexOf('type=2') >= 0, '用的是单曲模式（type=2，随机播放的前提）');
    check(/[?&]id=\d{5,}/.test(src), 'id 是具体的歌曲 ID（不是歌单 ID）');
    check(
      await cdp.ev(session,
        "(document.querySelector('.vopth-music-frame')||{}).getAttribute" +
        " && document.querySelector('.vopth-music-frame').getAttribute('allow').indexOf('autoplay') >= 0"),
      'iframe 带 allow=autoplay'
    );
    const nIds = await cdp.ev(session,
      "fetch('/music/playlist.json').then(r=>r.json()).then(j=>(j.trackIds||[]).length).catch(()=>-1)");
    check(typeof nIds === 'number' && nIds > 1, '歌单数据可读且多首（随机池够大）', `trackIds=${nIds}`);
    check(
      (await cdp.ev(session, "localStorage.getItem('vopth:music:on')")) === '1',
      '记住了访客选择'
    );

    /* ============================================================ 2a) 换一首 */
    console.log('\n' + '='.repeat(66));
    console.log('  2a) 换一首：每次都要换到不同的歌');
    console.log('='.repeat(66));

    const firstSrc = src;
    let changed = false;
    let tries = 0;
    for (; tries < 6 && !changed; tries++) {
      await cdp.ev(session, "document.querySelectorAll('.vopth-music-iconbtn')[0].click()");
      for (let i = 0; i < 24; i++) {
        await sleep(250);
        const now = await frameSrc();
        if (now && now !== firstSrc) { changed = true; break; }
      }
    }
    check(changed, '★ 点「换一首」能换到别的歌', `尝试 ${tries} 次`);
    check((await frameSrc()).indexOf('type=2') >= 0, '换歌后仍是单曲模式');

    /* ============================================================ 2b) 关闭 */
    console.log('\n' + '='.repeat(66));
    console.log('  2b) 关闭路径（三条都要能关）');
    console.log('='.repeat(66));
    // ⚠️ 这一节是补的。第一版漏测关闭，于是上线过「打开就关不掉」的 bug：
    //    关闭按钮的变量名和关闭函数都叫 close，var 把 function 覆盖掉，
    //    每次点击抛 TypeError —— 界面毫无反应，控制台只有一条错。

    await cdp.ev(session, "document.querySelector('.vopth-music-toggle').click()");
    await sleep(800);
    s = await state();
    check(s === 'closed', '① 再点悬浮按钮能关掉', `data-state=${s}`);
    check(
      (await cdp.ev(session,
        "getComputedStyle(document.querySelector('.vopth-music-panel')).visibility")) === 'hidden',
      '① 关掉后面板确实不可见'
    );

    await cdp.ev(session, "document.querySelector('.vopth-music-toggle').click()");
    await sleep(800);
    s = await state();
    check(s === 'open', '② 重新打开成功', `data-state=${s}`);
    await cdp.ev(session, "document.querySelector('.vopth-music-close').click()");
    await sleep(800);
    s = await state();
    check(s === 'closed', '② 点 × 能关掉', `data-state=${s}`);

    await cdp.ev(session, "document.querySelector('.vopth-music-toggle').click()");
    await sleep(800);
    await cdp.ev(session, "document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));true");
    await sleep(800);
    s = await state();
    check(s === 'closed', '③ Esc 能关掉', `data-state=${s}`);

    check(await cdp.ev(session, "!!document.querySelector('.vopth-music-frame')"),
      '关掉后 iframe 仍在（音乐不会被切断）');
    check(cdp.exceptions.length === 0, '没有未捕获的 JS 异常', cdp.exceptions.slice(0, 3).join('; ').slice(0, 120));

    await cdp.ev(session, "document.querySelector('.vopth-music-toggle').click()");
    await sleep(1200);
    s = await state();
    check(s === 'open', '④ 再次打开正常（准备做 PJAX 测试）', `data-state=${s}`);

    /* ============================================================ 3) PJAX */
    console.log('\n' + '='.repeat(66));
    console.log('  3) PJAX 翻页：播放器必须【是同一个元素】');
    console.log('='.repeat(66));

    await cdp.ev(session,
      "window.__ref = document.getElementById('vopth-music');" +
      "window.__frame = document.querySelector('.vopth-music-frame');" +
      "window.__navmark = 'alive'; true");

    const href = await cdp.ev(session,
      "(function(){var a=document.querySelector('#recent-posts a[href*=\"/20\"]');" +
      "return a ? a.getAttribute('href') : null;})()");
    console.log(`    目标链接: ${href}`);
    await cdp.ev(session,
      "var a=document.querySelector('#recent-posts a[href*=\"/20\"]'); if(a) a.click(); true");
    await waitUrl(cdp, session, '/20');

    const p1 = await cdp.ev(session, 'location.pathname');
    check(typeof p1 === 'string' && p1.indexOf('/20') >= 0, 'URL 已经变到文章页（PJAX 生效）', `path=${p1}`);
    check(await cdp.ev(session, "window.__navmark === 'alive'"), '★ 没有整页刷新（window 变量还在）');
    check(await cdp.ev(session, "document.getElementById('vopth-music') === window.__ref"),
      '★ 播放器是同一个 DOM 元素（没被 PJAX 换掉）');
    check(await cdp.ev(session, "document.querySelector('.vopth-music-frame') === window.__frame"),
      '★ iframe 是同一个对象（音乐不会重载）');
    s = await state();
    check(s === 'open', '翻页后仍然展开着', `data-state=${s}`);

    /* ============================================================ 4) 其它脚本 */
    console.log('\n' + '='.repeat(66));
    console.log('  4) 其他脚本在 PJAX 后有没有重跑');
    console.log('='.repeat(66));

    check(await cdp.ev(session, "!!document.querySelector('.reading-progress')"), '文章页出现阅读进度条');
    check(await cdp.ev(session, "!document.querySelector('.ph-card')"), '文章页没有首页简介卡片');
    check(await cdp.ev(session,
      "document.querySelector('.reading-progress')" +
      " && document.querySelector('.reading-progress').parentElement === document.body"),
      '进度条挂在 body 直属下');

    await cdp.ev(session, "var a=document.querySelector('a[href=\"/\"]'); if(a) a.click(); true");
    for (let i = 0; i < 48; i++) {
      const p = await cdp.ev(session, 'location.pathname');
      if (p === '/' || p === '') break;
      await sleep(250);
    }
    const p2 = await cdp.ev(session, 'location.pathname');
    check(p2 === '/' || p2 === '', '已回到首页', `path=${p2}`);
    check(await cdp.ev(session, "!!document.querySelector('.ph-card')"),
      '★ 回首页后简介卡片重新出现（profile-hero 重跑了）');
    check(await cdp.ev(session, "!document.querySelector('.reading-progress')"),
      '★ 回首页后进度条被撤掉（reading-progress 重跑了）');
    check(await cdp.ev(session, "document.getElementById('vopth-music') === window.__ref"),
      '★ 绕了两页播放器依然是同一个元素');

    /* ============================================================ 5) 栏目页 */
    console.log('\n' + '='.repeat(66));
    console.log('  5) 栏目页：banner 视频 + 后台入口');
    console.log('='.repeat(66));

    await cdp.send('Page.navigate', { url: SITE + '/about/' }, session);
    await waitReady(cdp, session);
    check(await cdp.ev(session, "!!document.querySelector('.banner-video')"), '关于页 banner 视频已插入');
    check(await cdp.ev(session, "!!document.getElementById('admin-entry')"), '右下角后台入口存在');
    check(await cdp.ev(session, "!!(window.btf && typeof window.btf.addEventListenerPjax === 'function')"),
      '主题 btf 工具可用');

    await cdp.ev(session, "var a=document.querySelector('a[href=\"/archives/\"]'); if(a) a.click(); true");
    await waitUrl(cdp, session, '/archives');
    check(await cdp.ev(session, "location.pathname.indexOf('/archives') === 0"),
      'PJAX 到归档页', await cdp.ev(session, 'location.pathname'));
    check(await cdp.ev(session, "!!document.querySelector('.banner-video')"),
      '★ 归档页也有 banner 视频（banner-video 重跑了）');

    console.log(`\n    （未捕获异常收集: ${cdp.exceptions.length ? cdp.exceptions.join(' | ') : '无'}）`);
  } finally {
    killTree(proc.pid);
    const left = killByProfile(profileName);
    if (left > 0) console.log(`  [!] 仍有 ${left} 个 msedge 没清掉（配置目录 ${profileName}）`);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* 忽略 */ }
  }

  const passed = results.filter((r) => r.ok).length;
  console.log('\n' + '='.repeat(66));
  console.log(`  结果：${passed}/${results.length} 通过`);
  console.log('='.repeat(66));
  results.filter((r) => !r.ok).forEach((r) => console.log(`  ❌ ${r.name}   ${r.detail}`));
  return passed === results.length ? 0 : 2;
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error('  ❌ 出错了:', (e && e.stack) || e);
    process.exit(1);
  });
