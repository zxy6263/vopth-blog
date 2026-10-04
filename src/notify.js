/**
 * 里程碑检测 + 邮件通知
 * ===========================================================================
 *
 * 触发规则（站主定的，但"破纪录"必须加时间盒子，否则永远触发）：
 *
 *   1. 站点总浏览量每跨过一个 10 的整数关        -> 发一封
 *   2. 单篇文章阅读量每跨过一个 10 的整数关      -> 发一封
 *   3. 站点【单日】浏览量创历史新高              -> 发一封（一天最多一次）
 *   4. 单篇文章【单日】阅读量创它自己的新高      -> 发一封（每篇一天最多一次）
 *
 *   为什么 3、4 必须按"单日"：浏览量只增不减，如果按累计值比大小，
 *   那每次访问都是"新纪录"，邮件会把收件箱刷爆。
 *
 * 状态存在哪
 *   复用已有的 KV 命名空间 PAGEVIEWS，键都带 pv: 前缀：
 *     pv:day:<yyyy-MM-dd>             站点当天累计
 *     pv:day:<yyyy-MM-dd>:<path>      某篇当天累计
 *     pv:best:day                     站点历史上最好的单日
 *     pv:best:path:<path>             某篇历史上最好的单日
 *     pv:notified:total               站点总数已经通知到第几个 10
 *     pv:notified:path:<path>         某篇已经通知到第几个 10
 *
 * 出错了怎么办
 *   发信失败【绝不能】影响计数本身 —— 计数是访客能看到的功能，
 *   邮件只是锦上添花。所以所有通知调用都被 try/catch 包住，
 *   失败只写日志。
 */

import { sendMail } from './mail.js';

// --- KV 键 -----------------------------------------------------------------

export const K = {
  day: (d) => 'pv:day:' + d,
  dayPath: (d, p) => 'pv:day:' + d + ':' + p,
  bestDay: 'pv:best:day',
  bestPath: (p) => 'pv:best:path:' + p,
  notifiedTotal: 'pv:notified:total',
  notifiedPath: (p) => 'pv:notified:path:' + p,
  reportTotal: 'pv:report:total'          // 上次报告时的总浏览量（算增量用）
};

export function toInt(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : 0;
}

/** 站点按上海时间算"今天"，避免 UTC 跨天把凌晨的访问算到前一天 */
export function shanghaiDay(date) {
  const d = date || new Date();
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(d);   // en-CA 的输出正好是 YYYY-MM-DD
}

/** 从路径里取一个能看的短名（拿不到标题时的退路） */
function shortName(path) {
  const seg = String(path).split('/').filter(Boolean).pop() || '/';
  return decodeURIComponent(seg);
}

// --- 发信 ------------------------------------------------------------------

function siteUrl(env, path) {
  const base = (env.SITE_ORIGIN || 'https://vopth.xyz').replace(/\/+$/, '');
  return base + (path === '/' ? '/' : path);
}

/**
 * 发一封通知。永不抛错 —— 调用方是在处理访客请求的关键路径上。
 */
async function notify(env, subject, body) {
  const missing = ['SMTP_USER', 'SMTP_PASS', 'MAIL_TO'].filter((k) => !env[k]);
  if (missing.length) {
    console.log('[notify] 跳过：缺少密钥 ' + missing.join(', '));
    return false;
  }
  try {
    await sendMail({
      host: env.SMTP_HOST || 'smtp.qq.com',
      port: Number(env.SMTP_PORT || 465),
      user: env.SMTP_USER,
      pass: env.SMTP_PASS,
      from: env.SMTP_USER,
      to: env.MAIL_TO,
      subject: subject,
      text: body
    });
    console.log('[notify] 已发送：' + subject);
    return true;
  } catch (e) {
    console.log('[notify] 发送失败：' + subject + ' :: ' + (e && e.message));
    return false;
  }
}

// --- 每次访问后的检测 ------------------------------------------------------

/**
 * 在计数完成之后调用。
 * @param {object} env
 * @param {string} path    规范化后的路径
 * @param {object} counts  { views, total } 计数后的最新值
 * @returns {Promise<string[]>} 这次触发了哪些通知（方便测试时看）
 */
export async function checkMilestones(env, path, counts) {
  const fired = [];
  const today = shanghaiDay();
  const kv = env.PAGEVIEWS;

  // --- 1. 记当天的数，并检测站点单日新高 ---
  const dayKey = K.day(today);
  const todayTotal = toInt(await kv.get(dayKey)) + 1;
  await kv.put(dayKey, String(todayTotal));

  const bestDay = toInt(await kv.get(K.bestDay));
  if (bestDay > 0 && todayTotal > bestDay) {
    fired.push('站点单日新高');
    await notify(env, '📈 站点单日访问创新高：' + todayTotal + ' 次',
      '今天是 ' + today + '（上海时间）。\n\n' +
      '今天累计访问：' + todayTotal + ' 次\n' +
      '此前最好的一天：' + bestDay + ' 次\n' +
      '提升：+' + (todayTotal - bestDay) + ' 次\n\n' +
      '站点总浏览量：' + counts.total + ' 次\n' +
      '网址：' + siteUrl(env, '/') + '\n');
  }
  if (todayTotal > bestDay) {
    await kv.put(K.bestDay, String(todayTotal));
  }

  // --- 2. 站点总数每 +10 ---
  const totalStep = Math.floor(counts.total / 10) * 10;
  const notifiedTotal = toInt(await kv.get(K.notifiedTotal));
  if (totalStep > notifiedTotal && totalStep > 0) {
    fired.push('总量 ' + totalStep);
    await notify(env, '🎉 站点总浏览量突破 ' + totalStep,
      '站点总浏览量达到 ' + counts.total + ' 次，跨过了 ' + totalStep + ' 这个整数关。\n\n' +
      '本次访问的页面：' + siteUrl(env, path) + '\n' +
      '该页阅读量：' + counts.views + ' 次\n' +
      '站点总浏览量：' + counts.total + ' 次\n' +
      '统计口径：PV，每个会话每篇只计一次。\n');
    await kv.put(K.notifiedTotal, String(totalStep));
  }

  // --- 3. 单篇阅读量每 +10 ---
  const pathStep = Math.floor(counts.views / 10) * 10;
  const nkPath = K.notifiedPath(path);
  const notifiedPath = toInt(await kv.get(nkPath));
  if (pathStep > notifiedPath && pathStep > 0) {
    fired.push('单篇 ' + pathStep);
    await notify(env, '📄 《' + shortName(path) + '》阅读量突破 ' + pathStep,
      '这篇文章的阅读量达到了 ' + counts.views + ' 次，跨过了 ' + pathStep + '。\n\n' +
      '文章：' + siteUrl(env, path) + '\n' +
      '该页阅读量：' + counts.views + ' 次\n' +
      '站点总浏览量：' + counts.total + ' 次\n');
    await kv.put(nkPath, String(pathStep));
  }

  // --- 4. 单篇【单日】阅读量创新高 ---
  const dpKey = K.dayPath(today, path);
  const todayPath = toInt(await kv.get(dpKey)) + 1;
  await kv.put(dpKey, String(todayPath));

  const bpKey = K.bestPath(path);
  const bestPath = toInt(await kv.get(bpKey));
  if (bestPath > 0 && todayPath > bestPath) {
    fired.push('单篇单日新高');
    await notify(env, '🔥 《' + shortName(path) + '》单日阅读创新高：' + todayPath + ' 次',
      '这篇文章今天被看了 ' + todayPath + ' 次，超过它以往任何一天。\n\n' +
      '文章：' + siteUrl(env, path) + '\n' +
      '今天：' + todayPath + ' 次\n' +
      '此前最好的一天：' + bestPath + ' 次\n' +
      '站点总浏览量：' + counts.total + ' 次\n');
  }
  if (todayPath > bestPath) {
    await kv.put(bpKey, String(todayPath));
  }

  return fired;
}

// --- 状态报告 --------------------------------------------------------------

/** 列出所有页面的阅读量，从多到少 */
async function listPageViews(env) {
  const rows = [];
  let cursor;
  do {
    const res = await env.PAGEVIEWS.list({ prefix: 'pv:/', cursor: cursor });
    for (const k of res.keys) {
      rows.push(k.name.slice(3));      // 去掉 'pv:'，留下路径
    }
    cursor = res.list_complete ? null : res.cursor;
  } while (cursor);

  const out = [];
  for (const p of rows) {
    const v = toInt(await env.PAGEVIEWS.get('pv:' + p));
    out.push({ path: p, views: v });
  }
  out.sort((a, b) => b.views - a.views);
  return out;
}

/** 试着把路径换成文章标题（失败就退回短名，绝不影响报告） */
async function titleOf(env, path) {
  try {
    const res = await fetch(siteUrl(env, path), { cf: { cacheTtl: 300 } });
    if (!res.ok) return shortName(path);
    const html = (await res.text()).slice(0, 20000);
    const m = html.match(/<title>([^<]*)<\/title>/i);
    if (!m) return shortName(path);
    return m[1].split('|')[0].split('-')[0].trim() || shortName(path);
  } catch (e) {
    return shortName(path);
  }
}

/** 最近 N 天的访问趋势 */
async function recentDays(env, n) {
  const out = [];
  const now = Date.now();
  for (let i = n - 1; i >= 0; i--) {
    const d = shanghaiDay(new Date(now - i * 86400000));
    const v = toInt(await env.PAGEVIEWS.get(K.day(d)));
    out.push({ day: d, views: v });
  }
  return out;
}

/** 拉最近的评论（giscus 用的就是这个仓库的 Discussions） */
async function recentComments(env, limit) {
  const repo = env.GISCUS_REPO || 'zxy6263/vopth-blog';
  try {
    const res = await fetch(
      'https://api.github.com/repos/' + repo + '/discussions/comments?per_page=' + (limit || 5),
      { headers: { 'accept': 'application/vnd.github+json', 'user-agent': 'vopth-notifier' } }
    );
    if (!res.ok) return { ok: false, note: 'HTTP ' + res.status };
    const arr = await res.json();
    const items = (Array.isArray(arr) ? arr : []).map((c) => ({
      user: (c.user && c.user.login) || '?',
      body: String(c.body || '').replace(/\s+/g, ' ').slice(0, 80),
      at: c.created_at,
      url: c.html_url
    }));
    items.sort((a, b) => String(b.at).localeCompare(String(a.at)));
    return { ok: true, items: items.slice(0, limit || 5) };
  } catch (e) {
    return { ok: false, note: String(e && e.message) };
  }
}

/**
 * 生成并发送状态报告。给 Cron 触发器调用。
 */
export async function sendStatusReport(env) {
  const started = Date.now();

  // 1. 静态资源自检
  //
  //  ⚠️ 这里【不能】去 fetch 自己域名的首页。
  //     实测：Worker 请求自己所在 zone 的域名会返回 522（Connection timed out），
  //     而且 61ms 就返回了 —— 根本不是超时。原因是请求绕回 Cloudflare 边缘后
  //     要找源站，而这个 Worker 自己就是源站，形成自引用，连不上。
  //     这不是站点故障，是自引用请求的固有行为，写进报告只会天天吓自己。
  //
  //     所以改成用 ASSETS 绑定直接问静态资源层：能拿到 200 且内容不为空，
  //     就说明这次部署的产物是好的、页面能正常吐出来 —— 这才是真正会坏、
  //     也真正需要监控的部分。
  //
  //     诚实说明：这个检查覆盖不到 DNS / 证书 / 边缘节点的故障（那些归
  //     Cloudflare 管，worker 从内部看不到）。
  let online = { ok: false, status: 0, ms: 0, note: '' };
  try {
    const t0 = Date.now();
    const res = await env.ASSETS.fetch(new Request(siteUrl(env, '/'), { method: 'GET' }));
    const body = await res.text();
    online = {
      ok: res.ok && body.length > 200,
      status: res.status,
      ms: Date.now() - t0,
      note: res.ok ? '' : '静态资源层返回异常或内容为空'
    };
  } catch (e) {
    online = { ok: false, status: 0, ms: Date.now() - started, note: String(e && e.message) };
  }

  // 2. 总浏览量 + 增量
  const total = toInt(await env.PAGEVIEWS.get('pv:__total__'));
  const prev = toInt(await env.PAGEVIEWS.get(K.reportTotal));
  const delta = prev > 0 ? total - prev : 0;

  // 3. 文章排行
  const pages = await listPageViews(env);
  const top = pages.slice(0, 5);
  const titles = [];
  for (const p of top) titles.push(await titleOf(env, p.path));

  // 4. 趋势
  const days = await recentDays(env, 7);

  // 5. 评论
  const comments = await recentComments(env, 3);

  // --- 拼邮件 ---
  const L = [];
  L.push('vopth.xyz 状态报告');
  L.push('时间：' + new Date().toISOString() + '（UTC）');
  L.push('      ' + new Date(Date.now() + 8 * 3600000).toISOString().replace('T', ' ').slice(0, 19) + '（北京）');
  L.push('');
  L.push('【1】静态资源自检');
  L.push('  ' + (online.ok ? '✅ 正常' : '❌ 异常') +
         '   HTTP ' + (online.status || '-') + '   耗时 ' + online.ms + ' ms' +
         (online.note ? '   ' + online.note : ''));
  L.push('  （检查的是部署产物本身。Worker 无法从外部访问自己的域名 ——');
  L.push('    自引用请求会返回 522，所以这里不用那种方式，免得天天假警报。）');
  L.push('');
  L.push('【2】浏览量');
  L.push('  总浏览量：' + total + ' 次' + (prev > 0 ? '（比上次报告 +' + delta + '）' : '（首次报告，无对比）'));
  L.push('');
  L.push('【3】文章排行（全部 ' + pages.length + ' 篇，列前 5）');
  if (top.length === 0) {
    L.push('  （还没有数据）');
  } else {
    top.forEach((p, i) => {
      L.push('  ' + (i + 1) + '. ' + titles[i] + '  —— ' + p.views + ' 次');
      L.push('     ' + siteUrl(env, p.path));
    });
  }
  L.push('');
  L.push('【4】访问趋势（最近 7 天）');
  const max = Math.max(1, ...days.map((d) => d.views));
  for (const d of days) {
    const bar = '█'.repeat(Math.max(0, Math.round((d.views / max) * 20)));
    L.push('  ' + d.day + '  ' + String(d.views).padStart(4) + '  ' + bar);
  }
  L.push('');
  L.push('【5】最新评论');
  if (!comments.ok) {
    L.push('  （获取失败：' + comments.note + '）');
  } else if (comments.items.length === 0) {
    L.push('  （还没有评论）');
  } else {
    for (const c of comments.items) {
      L.push('  ' + c.user + ' @ ' + String(c.at).slice(0, 16).replace('T', ' '));
      L.push('    ' + c.body);
    }
  }
  L.push('');
  L.push('——');
  L.push('这封是定时报告（每 3 小时一次）。');
  L.push('统计口径：PV，每个会话每篇只计一次；时间为 Asia/Shanghai。');

  const ok = await notify(env, '📊 vopth.xyz 状态报告（' +
    (online.ok ? '正常' : '异常') + ' · 总浏览 ' + total + '）', L.join('\n'));

  if (ok) await env.PAGEVIEWS.put(K.reportTotal, String(total));
  return { ok: ok, total: total, pages: pages.length, online: online };
}
