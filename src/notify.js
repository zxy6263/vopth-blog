/**
 * 里程碑检测 + 邮件通知（HTML 版）
 * ===========================================================================
 *
 * 触发规则（站主定的，"破纪录"必须加时间盒子，否则永远触发）：
 *   1. 站点总浏览量每跨过一个 10 的整数关
 *   2. 单篇文章阅读量每跨过一个 10 的整数关
 *   3. 站点【单日】浏览量创历史新高
 *   4. 单篇文章【单日】阅读量创它自己的新高
 *
 * 为什么 3、4 必须按"单日"：浏览量只增不减，拿累计值比大小的话，
 * 每次访问都是"新纪录"，邮件会把收件箱刷爆。
 *
 * 状态存在 KV（复用已有的 PAGEVIEWS 命名空间）：
 *   pv:day:<yyyy-MM-dd>           站点当天累计
 *   pv:day:<yyyy-MM-dd>:<path>    某篇当天累计
 *   pv:h:<yyyy-MM-dd-HH>          站点当小时累计（只留 14 天，用于画 24 小时曲线）
 *   pv:best:day                   站点历史最好单日
 *   pv:best:path:<path>           某篇历史最好单日
 *   pv:notified:total             站点总数已通知到第几个 10
 *   pv:notified:path:<path>       某篇已通知到第几个 10
 *   pv:report:total               上次报告时的总浏览量（算增量）
 *   pv:report:at                  上次报告的 ISO 时间
 *
 * 邮件长什么样
 *   HTML（多部分邮件，带纯文本兜底）。为了在 163 / QQ / 手机客户端里都能正常
 *   渲染，全部用【内联样式 + table 布局】—— 邮件客户端普遍不支持 <style> 块、
 *   flex 和外部 CSS。柱状图用固定高度的 div 拼，不依赖 JS。
 *
 * 出错了怎么办
 *   发信失败【绝不能】影响计数。所有通知都被 try/catch 包住，失败只写日志。
 */

import { sendMail } from './mail.js';

// --- KV 键 -----------------------------------------------------------------

export const K = {
  day: (d) => 'pv:day:' + d,
  dayPath: (d, p) => 'pv:day:' + d + ':' + p,
  hour: (h) => 'pv:h:' + h,
  bestDay: 'pv:best:day',
  bestPath: (p) => 'pv:best:path:' + p,
  notifiedTotal: 'pv:notified:total',
  notifiedPath: (p) => 'pv:notified:path:' + p,
  reportTotal: 'pv:report:total',
  reportAt: 'pv:report:at'
};

const HOUR_TTL = 60 * 60 * 24 * 14;   // 小时数据留 14 天足够画曲线

export function toInt(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : 0;
}

function parts(date) {
  const d = date || new Date();
  const arr = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', hour12: false
  }).formatToParts(d);
  const get = (t) => (arr.find((p) => p.type === t) || {}).value || '00';
  let hh = get('hour');
  if (hh === '24') hh = '00';        // 某些实现把午夜给成 24
  return { date: get('year') + '-' + get('month') + '-' + get('day'), hour: hh };
}

/** 上海时间的今天（yyyy-MM-dd） */
export function shanghaiDay(date) {
  return parts(date).date;
}

/** 上海时间的"年-月-日-时"，用作小时桶的键 */
export function shanghaiHour(date) {
  const p = parts(date);
  return p.date + '-' + p.hour;
}

/** 北京时间可读串 */
function bjNow() {
  return new Date(Date.now() + 8 * 3600000).toISOString().replace('T', ' ').slice(0, 19);
}

function shortName(path) {
  const seg = String(path).split('/').filter(Boolean).pop() || '/';
  try { return decodeURIComponent(seg); } catch (e) { return seg; }
}

function siteUrl(env, path) {
  const base = (env.SITE_ORIGIN || 'https://vopth.xyz').replace(/\/+$/, '');
  return base + (path === '/' ? '/' : path);
}

/** HTML 转义：文章标题里可能有 < & 之类 */
function esc(s) {
  return String(s === undefined || s === null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// --- HTML 积木（全部内联样式 + table 布局）---------------------------------

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif";

/** 整封信的外壳 */
function shell(title, subtitle, sections) {
  return '' +
  '<div style="margin:0;padding:16px 0;background:#f6f7f9;">' +
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:640px;margin:0 auto;border-collapse:collapse;font-family:' + FONT + ';">' +
      '<tr><td style="background:#4A6CF7;background-image:linear-gradient(135deg,#4A6CF7,#7C5CFF);border-radius:12px 12px 0 0;padding:20px 24px;color:#ffffff;">' +
        '<div style="font-size:19px;font-weight:700;letter-spacing:.2px;">' + esc(title) + '</div>' +
        '<div style="font-size:13px;opacity:.9;margin-top:5px;">' + esc(subtitle) + '</div>' +
      '</td></tr>' +
      '<tr><td style="background:#ffffff;border:1px solid #e6e8eb;border-top:none;border-radius:0 0 12px 12px;padding:20px 24px;">' +
        sections +
      '</td></tr>' +
      '<tr><td style="padding:14px 8px 4px;font-size:12px;color:#8b949e;text-align:center;line-height:1.7;">' +
        '本邮件由博客自己的 Cloudflare Worker 发出，数据存在自己的 KV 里。<br>' +
        '口径：PV（每个会话每篇只计一次）· 时间为北京时间（Asia/Shanghai）' +
      '</td></tr>' +
    '</table>' +
  '</div>';
}

/** 小标题 */
function h2(text) {
  return '<div style="font-size:13px;font-weight:700;color:#4A6CF7;letter-spacing:.5px;' +
         'margin:22px 0 10px;padding-bottom:6px;border-bottom:1px solid #eef0f3;">' + esc(text) + '</div>';
}

/** 一排数字卡片（2 列，手机上也不会挤）*/
function statGrid(items) {
  let out = '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:separate;border-spacing:0 8px;">';
  for (let i = 0; i < items.length; i += 2) {
    out += '<tr>';
    for (let j = i; j < i + 2; j++) {
      const it = items[j];
      if (!it) { out += '<td width="50%"></td>'; continue; }
      const color = it.color || '#1f2328';
      const sub = it.sub ? '<div style="font-size:12px;color:#8b949e;margin-top:3px;">' + esc(it.sub) + '</div>' : '';
      out += '<td width="50%" style="padding:0 5px;vertical-align:top;">' +
        '<div style="background:#f8f9fb;border:1px solid #eef0f3;border-radius:9px;padding:12px 14px;">' +
          '<div style="font-size:12px;color:#6b7280;">' + esc(it.label) + '</div>' +
          '<div style="font-size:24px;font-weight:700;color:' + color + ';line-height:1.25;margin-top:2px;">' + esc(it.value) + '</div>' +
          sub +
        '</div></td>';
    }
    out += '</tr>';
  }
  return out + '</table>';
}

/** 柱状图：给一串 {label, v}，画成等宽柱子（不依赖 JS，纯 div 高度）*/
function bars(items, opt) {
  const o = opt || {};
  const max = Math.max(1, ...items.map((d) => d.v));
  const barH = o.height || 64;
  let cells = '';
  for (const it of items) {
    const hgt = it.v === 0 ? 2 : Math.max(3, Math.round((it.v / max) * barH));
    const color = it.v === 0 ? '#e9ecef' : (o.accent && it.v === max ? '#7C5CFF' : '#4A6CF7');
    const tip = (o.titlePrefix || '') + it.label + (o.titleSuffix || '') + '：' + it.v + (o.unit || '');
    cells += '<td valign="bottom" align="center" height="' + barH + '" style="height:' + barH + 'px;padding:0 1px;" title="' + esc(tip) + '">' +
      '<div style="height:' + hgt + 'px;background:' + color + ';border-radius:2px 2px 0 0;font-size:0;line-height:0;">&nbsp;</div>' +
      '</td>';
  }
  const axis = (o.axis || []).map((t) => '<td align="center" style="font-size:10px;color:#9aa3ad;padding-top:4px;">' + esc(t) + '</td>').join('');
  return '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;table-layout:fixed;">' +
    '<tr>' + cells + '</tr>' + (axis ? '<tr>' + axis + '</tr>' : '') + '</table>';
}

/** 文章明细表：名称 / 今日 / 累计 / 占比条 */
function articleTable(rows, maxViews) {
  let out = '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;font-size:13px;">' +
    '<tr>' +
      '<td style="padding:0 0 8px;color:#8b949e;font-size:12px;">文章</td>' +
      '<td width="52" align="right" style="padding:0 0 8px;color:#8b949e;font-size:12px;">今日</td>' +
      '<td width="58" align="right" style="padding:0 0 8px;color:#8b949e;font-size:12px;">累计</td>' +
    '</tr>';
  for (const r of rows) {
    const pct = maxViews > 0 ? Math.round((r.total / maxViews) * 100) : 0;
    const today = r.today > 0 ? '<span style="color:#16a34a;font-weight:600;">+' + r.today + '</span>' : '<span style="color:#c3c8ce;">—</span>';
    out += '<tr>' +
      '<td style="padding:7px 0;border-top:1px solid #f1f3f5;">' +
        '<a href="' + esc(r.url) + '" style="color:#1f2328;text-decoration:none;font-weight:500;">' + esc(r.title) + '</a>' +
        '<div style="margin-top:5px;height:4px;background:#eef0f3;border-radius:2px;">' +
          '<div style="width:' + pct + '%;height:4px;background:#4A6CF7;border-radius:2px;font-size:0;line-height:0;">&nbsp;</div>' +
        '</div>' +
      '</td>' +
      '<td align="right" style="padding:7px 0;border-top:1px solid #f1f3f5;vertical-align:top;">' + today + '</td>' +
      '<td align="right" style="padding:7px 0;border-top:1px solid #f1f3f5;font-weight:700;vertical-align:top;">' + r.total + '</td>' +
    '</tr>';
  }
  return out + '</table>';
}

// --- 发信 ------------------------------------------------------------------

async function notify(env, subject, html, text) {
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
      text: text || '',
      html: html || ''
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
 * 计数完成后调用。
 * @returns {Promise<string[]>} 这次触发了哪些通知
 */
export async function checkMilestones(env, path, counts) {
  const fired = [];
  const today = shanghaiDay();
  const kv = env.PAGEVIEWS;

  // --- 站点当天累计 + 单日新高 ---
  const dayKey = K.day(today);
  const todayTotal = toInt(await kv.get(dayKey)) + 1;
  await kv.put(dayKey, String(todayTotal));

  // --- 当小时累计（画 24 小时曲线用，带 TTL 免得无限增长）---
  const hKey = K.hour(shanghaiHour());
  const hourCount = toInt(await kv.get(hKey)) + 1;
  await kv.put(hKey, String(hourCount), { expirationTtl: HOUR_TTL });

  const bestDay = toInt(await kv.get(K.bestDay));
  if (bestDay > 0 && todayTotal > bestDay) {
    fired.push('站点单日新高');
    await notify(env,
      '📈 站点单日访问创新高：' + todayTotal + ' 次',
      shell('📈 单日访问创新高', today + '（北京时间）',
        '<div style="font-size:15px;color:#374151;line-height:1.8;">今天累计访问已经超过以往任何一天。</div>' +
        statGrid([
          { label: '今天', value: todayTotal + ' 次', color: '#4A6CF7', sub: '新高' },
          { label: '此前最好', value: bestDay + ' 次' },
          { label: '提升', value: '+' + (todayTotal - bestDay) + ' 次', color: '#16a34a' },
          { label: '站点总计', value: counts.total + ' 次' }
        ]) +
        h2('触发这一封的访问') +
        '<div style="font-size:13px;color:#374151;line-height:1.9;">' +
          '<a href="' + esc(siteUrl(env, path)) + '" style="color:#4A6CF7;">' + esc(siteUrl(env, path)) + '</a><br>' +
          '该页累计阅读：<b>' + counts.views + '</b> 次' +
        '</div>'),
      '站点单日访问创新高：' + todayTotal + ' 次\n' +
      '今天 ' + today + '，此前最好 ' + bestDay + ' 次，提升 +' + (todayTotal - bestDay) + '\n' +
      '站点总浏览量：' + counts.total + ' 次\n');
  }
  if (todayTotal > bestDay) await kv.put(K.bestDay, String(todayTotal));

  // --- 站点总数每 +10 ---
  const totalStep = Math.floor(counts.total / 10) * 10;
  const notifiedTotal = toInt(await kv.get(K.notifiedTotal));
  if (totalStep > notifiedTotal && totalStep > 0) {
    fired.push('总量 ' + totalStep);
    await notify(env,
      '🎉 站点总浏览量突破 ' + totalStep,
      shell('🎉 里程碑达成', '总浏览量跨过 ' + totalStep + ' 这个整数关',
        '<div style="text-align:center;padding:6px 0 2px;">' +
          '<div style="font-size:44px;font-weight:800;color:#4A6CF7;line-height:1.1;">' + counts.total + '</div>' +
          '<div style="font-size:13px;color:#8b949e;margin-top:4px;">站点总浏览量（次）</div>' +
        '</div>' +
        statGrid([
          { label: '本次访问的页面', value: shortName(path) },
          { label: '该页累计阅读', value: counts.views + ' 次' },
          { label: '今天累计', value: todayTotal + ' 次' },
          { label: '历史最好单日', value: Math.max(bestDay, todayTotal) + ' 次' }
        ]) +
        '<div style="margin-top:14px;font-size:13px;">' +
          '<a href="' + esc(siteUrl(env, path)) + '" style="color:#4A6CF7;">' + esc(siteUrl(env, path)) + '</a>' +
        '</div>'),
      '站点总浏览量突破 ' + totalStep + '，当前 ' + counts.total + ' 次。\n' +
      '本次访问：' + siteUrl(env, path) + '\n该页累计：' + counts.views + ' 次\n');
    await kv.put(K.notifiedTotal, String(totalStep));
  }

  // --- 单篇阅读量每 +10 ---
  const pathStep = Math.floor(counts.views / 10) * 10;
  const nkPath = K.notifiedPath(path);
  const notifiedPath = toInt(await kv.get(nkPath));
  if (pathStep > notifiedPath && pathStep > 0) {
    fired.push('单篇 ' + pathStep);
    await notify(env,
      '📄 《' + shortName(path) + '》阅读量突破 ' + pathStep,
      shell('📄 单篇里程碑', '《' + shortName(path) + '》阅读量跨过 ' + pathStep,
        '<div style="text-align:center;padding:6px 0 2px;">' +
          '<div style="font-size:44px;font-weight:800;color:#4A6CF7;line-height:1.1;">' + counts.views + '</div>' +
          '<div style="font-size:13px;color:#8b949e;margin-top:4px;">这篇文章的累计阅读（次）</div>' +
        '</div>' +
        statGrid([
          { label: '这篇今天', value: toInt(await kv.get(K.dayPath(today, path))) + ' 次' },
          { label: '站点总浏览量', value: counts.total + ' 次' }
        ]) +
        '<div style="margin-top:14px;font-size:13px;">' +
          '<a href="' + esc(siteUrl(env, path)) + '" style="color:#4A6CF7;">' + esc(siteUrl(env, path)) + '</a>' +
        '</div>'),
      '《' + shortName(path) + '》阅读量突破 ' + pathStep + '，当前 ' + counts.views + ' 次。\n' +
      siteUrl(env, path) + '\n');
    await kv.put(nkPath, String(pathStep));
  }

  // --- 单篇【单日】新高 ---
  const dpKey = K.dayPath(today, path);
  const todayPath = toInt(await kv.get(dpKey)) + 1;
  await kv.put(dpKey, String(todayPath));

  const bpKey = K.bestPath(path);
  const bestPath = toInt(await kv.get(bpKey));
  if (bestPath > 0 && todayPath > bestPath) {
    fired.push('单篇单日新高');
    await notify(env,
      '🔥 《' + shortName(path) + '》单日阅读创新高：' + todayPath + ' 次',
      shell('🔥 单篇单日新高', '《' + shortName(path) + '》今天超过它以往任何一天',
        statGrid([
          { label: '今天', value: todayPath + ' 次', color: '#4A6CF7', sub: '新高' },
          { label: '此前最好', value: bestPath + ' 次' },
          { label: '提升', value: '+' + (todayPath - bestPath) + ' 次', color: '#16a34a' },
          { label: '这篇累计', value: counts.views + ' 次' }
        ]) +
        '<div style="margin-top:14px;font-size:13px;">' +
          '<a href="' + esc(siteUrl(env, path)) + '" style="color:#4A6CF7;">' + esc(siteUrl(env, path)) + '</a>' +
        '</div>'),
      '《' + shortName(path) + '》单日阅读创新高：' + todayPath + ' 次（此前最好 ' + bestPath + ' 次）\n' +
      siteUrl(env, path) + '\n');
  }
  if (todayPath > bestPath) await kv.put(bpKey, String(todayPath));

  return fired;
}

// --- 状态报告 --------------------------------------------------------------

async function listPageViews(env) {
  const paths = [];
  let cursor;
  do {
    const res = await env.PAGEVIEWS.list({ prefix: 'pv:/', cursor: cursor });
    for (const k of res.keys) paths.push(k.name.slice(3));
    cursor = res.list_complete ? null : res.cursor;
  } while (cursor);

  const out = [];
  for (const p of paths) {
    out.push({ path: p, views: toInt(await env.PAGEVIEWS.get('pv:' + p)) });
  }
  out.sort((a, b) => b.views - a.views);
  return out;
}

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

/** 最近 n 小时的小时桶 */
async function recentHours(env, n) {
  const out = [];
  const now = Date.now();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now - i * 3600000);
    const key = shanghaiHour(d);
    out.push({ label: key.slice(11), v: toInt(await env.PAGEVIEWS.get(K.hour(key))) });
  }
  return out;
}

/** 最近 n 天 */
async function recentDays(env, n) {
  const out = [];
  const now = Date.now();
  for (let i = n - 1; i >= 0; i--) {
    const d = shanghaiDay(new Date(now - i * 86400000));
    out.push({ label: d.slice(5), v: toInt(await env.PAGEVIEWS.get(K.day(d))) });
  }
  return out;
}

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
      body: String(c.body || '').replace(/\s+/g, ' ').slice(0, 100),
      at: c.created_at,
      title: (c.discussion && c.discussion.title) || '',
      url: c.html_url
    }));
    items.sort((a, b) => String(b.at).localeCompare(String(a.at)));
    return { ok: true, items: items.slice(0, limit || 5) };
  } catch (e) {
    return { ok: false, note: String(e && e.message) };
  }
}

/** 生成并发送状态报告（Cron 每个整 3 小时调用一次）*/
export async function sendStatusReport(env) {
  const started = Date.now();

  // 1. 静态资源自检（不能用 fetch 自己域名 —— 自引用请求会 522）
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

  // 2. 总量与增量
  const total = toInt(await env.PAGEVIEWS.get('pv:__total__'));
  const prev = toInt(await env.PAGEVIEWS.get(K.reportTotal));
  const prevAt = (await env.PAGEVIEWS.get(K.reportAt)) || '';
  const delta = prev > 0 ? total - prev : 0;

  // 3. 今天 / 昨天 / 历史最好
  const today = shanghaiDay();
  const yesterday = shanghaiDay(new Date(Date.now() - 86400000));
  const todayTotal = toInt(await env.PAGEVIEWS.get(K.day(today)));
  const yTotal = toInt(await env.PAGEVIEWS.get(K.day(yesterday)));
  const bestDay = Math.max(toInt(await env.PAGEVIEWS.get(K.bestDay)), todayTotal);

  // 4. 文章明细（全部，带今日增量）
  const pages = await listPageViews(env);
  const arts = [];
  for (const p of pages) {
    arts.push({
      path: p.path,
      total: p.views,
      today: toInt(await env.PAGEVIEWS.get(K.dayPath(today, p.path))),
      title: await titleOf(env, p.path),
      url: siteUrl(env, p.path)
    });
  }
  const maxViews = arts.length ? arts[0].total : 0;

  // 5. 趋势
  const hours = await recentHours(env, 24);
  const days = await recentDays(env, 7);
  const h24 = hours.reduce((a, b) => a + b.v, 0);
  const peak = hours.reduce((a, b) => (b.v > a.v ? b : a), { label: '-', v: 0 });

  // 6. 评论
  const comments = await recentComments(env, 3);

  // --- 拼 HTML ---
  const vs = yTotal > 0 ? (todayTotal - yTotal) : 0;
  const vsText = yTotal === 0 ? '昨天无数据'
    : (vs > 0 ? '比昨天多 ' + vs + ' 次' : (vs < 0 ? '比昨天少 ' + Math.abs(vs) + ' 次' : '和昨天持平'));

  let html = '';
  html += h2('概览');
  html += statGrid([
    { label: '总浏览量', value: String(total), color: '#4A6CF7', sub: prev > 0 ? '比上次报告 +' + delta : '首次报告' },
    { label: '今天', value: String(todayTotal), sub: vsText },
    { label: '昨天', value: yTotal > 0 ? String(yTotal) : '—' },
    { label: '单日最好', value: String(bestDay), sub: bestDay === todayTotal && todayTotal > 0 ? '就是今天 🎉' : '' }
  ]);

  html += h2('最近 24 小时（逐小时）');
  html += '<div style="font-size:13px;color:#374151;margin-bottom:10px;">' +
            '合计 <b>' + h24 + '</b> 次' +
            ' · 峰值 <b>' + esc(peak.label) + ':00</b>（' + peak.v + ' 次）' +
          '</div>';
  html += bars(hours, {
    height: 64, accent: true, unit: ' 次',
    titlePrefix: '北京时间 ',
    axis: hours.map((h, i) => (i % 6 === 0 ? h.label : ''))
  });

  html += h2('最近 7 天');
  html += bars(days, {
    height: 48, accent: true, unit: ' 次',
    titlePrefix: ' ',
    axis: days.map((d) => d.label)
  });

  html += h2('文章明细（共 ' + arts.length + ' 篇）');
  if (arts.length === 0) {
    html += '<div style="font-size:13px;color:#8b949e;">还没有数据</div>';
  } else {
    html += articleTable(arts, maxViews);
  }

  html += h2('最新评论');
  if (!comments.ok) {
    html += '<div style="font-size:13px;color:#b45309;">获取失败：' + esc(comments.note) + '</div>';
  } else if (comments.items.length === 0) {
    html += '<div style="font-size:13px;color:#8b949e;">还没有评论</div>';
  } else {
    for (const c of comments.items) {
      html += '<div style="border-left:3px solid #e6e8eb;padding:2px 0 2px 12px;margin:10px 0;">' +
        '<div style="font-size:12px;color:#8b949e;">' +
          '<b style="color:#4A6CF7;">' + esc(c.user) + '</b> · ' +
          esc(String(c.at).slice(0, 16).replace('T', ' ')) +
          (c.title ? ' · ' + esc(c.title) : '') +
        '</div>' +
        '<div style="font-size:13px;color:#374151;margin-top:4px;line-height:1.6;">' + esc(c.body) + '</div>' +
        (c.url ? '<div style="font-size:12px;margin-top:3px;"><a href="' + esc(c.url) + '" style="color:#4A6CF7;">查看</a></div>' : '') +
      '</div>';
    }
  }

  html += h2('运行状态');
  html += '<div style="font-size:13px;color:#374151;line-height:1.9;">' +
    (online.ok ? '✅ 静态资源正常' : '❌ 静态资源异常') +
    ' · HTTP ' + (online.status || '-') + ' · ' + online.ms + ' ms' +
    (online.note ? ' · ' + esc(online.note) : '') + '<br>' +
    '<span style="color:#8b949e;font-size:12px;">Worker 无法从外部访问自己的域名（自引用请求会返回 522），所以这里检查的是部署产物本身。</span>' +
  '</div>';

  const title = 'vopth.xyz 状态报告';
  const sub = bjNow() + '（北京时间）' +
    (prevAt ? ' · 上次报告 ' + prevAt.replace('T', ' ').slice(0, 16) + '' : '');
  const rich = shell(title, sub, html);

  // --- 纯文本兜底 ---
  const T = [];
  T.push('vopth.xyz 状态报告');
  T.push(bjNow() + '（北京时间）');
  T.push('');
  T.push('【概览】');
  T.push('  总浏览量 ' + total + (prev > 0 ? '（比上次报告 +' + delta + '）' : ''));
  T.push('  今天 ' + todayTotal + ' · 昨天 ' + (yTotal || '—') + ' · 单日最好 ' + bestDay);
  T.push('');
  T.push('【最近 24 小时】合计 ' + h24 + '，峰值 ' + peak.label + ':00（' + peak.v + ' 次）');
  T.push('  ' + hours.map((h) => h.label + ':' + h.v).join('  '));
  T.push('');
  T.push('【最近 7 天】');
  for (const d of days) T.push('  ' + d.label + '  ' + String(d.v).padStart(4));
  T.push('');
  T.push('【文章明细】共 ' + arts.length + ' 篇');
  arts.forEach((a, i) => {
    T.push('  ' + (i + 1) + '. ' + a.title + '  累计 ' + a.total + '（今日 +' + a.today + '）');
    T.push('     ' + a.url);
  });
  T.push('');
  T.push('【最新评论】');
  if (!comments.ok) T.push('  获取失败：' + comments.note);
  else if (comments.items.length === 0) T.push('  还没有评论');
  else for (const c of comments.items) T.push('  ' + c.user + ' @ ' + String(c.at).slice(0, 16) + '\n    ' + c.body);
  T.push('');
  T.push('【运行状态】' + (online.ok ? '静态资源正常' : '静态资源异常') +
         '  HTTP ' + (online.status || '-') + '  ' + online.ms + ' ms');

  const subject = '📊 vopth.xyz 状态报告（' + (online.ok ? '正常' : '异常') +
    ' · 今日 ' + todayTotal + ' · 总 ' + total + '）';

  const ok = await notify(env, subject, rich, T.join('\n'));

  if (ok) {
    await env.PAGEVIEWS.put(K.reportTotal, String(total));
    await env.PAGEVIEWS.put(K.reportAt, new Date().toISOString());
  }
  return { ok: ok, total: total, pages: pages.length, online: online, html: rich, text: T.join('\n') };
}
