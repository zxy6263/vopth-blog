/**
 * vopth.xyz 浏览量计数器
 * ===========================================================================
 *
 * 它做什么
 *   两个接口，都挂在 /api/ 下（同一个域名，所以不需要跨域配置）：
 *
 *     GET  /api/views?path=<路径>   读：这篇文章的阅读量 + 站点总访问量
 *     POST /api/views?path=<路径>   写：这篇文章 +1，站点总数 +1
 *
 *   其他所有请求原样交给静态资源（env.ASSETS.fetch），
 *   所以加了这个脚本不影响网站本身。
 *
 * 为什么要自建而不是用 busuanzi
 *   busuanzi 是第三方服务、近年不稳定，而且会引入一次外部请求 ——
 *   这个站一直坚持「零第三方 CDN」，评论也选了数据存在自己仓库的 giscus。
 *   自建的话：走自己的域名、国内可访问、数据在自己账号里、随时能改。
 *
 * 数据存在哪
 *   KV 命名空间 PAGEVIEWS：
 *     pv:<路径>      每篇文章/页面各一个键
 *     pv:__total__   站点总计
 *
 * 计数口径（重要，别误解）
 *   记的是 **PV（浏览次数）**，不是「多少人」。
 *   前端每个会话对同一路径只上报一次（见 source/js/page-views.js），
 *   所以同一篇文章反复刷新不会刷出很多次。
 *   真正的独立访客数看 Cloudflare 仪表盘（那边是按 IP 去重的）。
 *
 * 为什么 key 要归一化路径
 *   /about/ 和 /about/index.html 是同一个页面，不归一化会算成两篇。
 *   这里统一成：带尾斜杠、去掉查询串。
 */

import { sendMail } from './mail.js';

const KV_PREFIX = 'pv:';
const TOTAL_KEY = KV_PREFIX + '__total__';

// 只接受站内路径，避免被人塞进奇怪的 key 把 KV 撑爆
function normalizePath(raw) {
  if (!raw) return null;
  let p;
  try {
    // 允许传完整 URL，也允许只传路径
    p = raw.startsWith('http') ? new URL(raw).pathname : raw;
  } catch (e) {
    return null;
  }

  // 去掉查询串和 hash（保险起见）
  p = p.split('?')[0].split('#')[0];

  // 必须以 / 开头
  if (!p.startsWith('/')) p = '/' + p;

  // 挡掉目录穿越：不是安全问题（它只是个 KV 键），
  // 但不拦的话谁都能往 KV 里塞一堆 "/../x/" 这种垃圾键
  if (p.indexOf('..') !== -1) return null;

  // 挡掉控制字符
  if (/[\u0000-\u001f\u007f]/.test(p)) return null;

  // /about/index.html -> /about/
  p = p.replace(/\/index\.html$/, '/');

  // 统一带尾斜杠（根路径除外）
  if (p !== '/' && !p.endsWith('/')) p = p + '/';

  // 挡掉异常长的路径
  if (p.length > 300) return null;

  return p;
}

function corsHeaders() {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type'
  };
}

function json(body, status, extraHeaders) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: Object.assign(
      {
        'content-type': 'application/json; charset=utf-8',
        // 计数必须实时，绝不能被缓存
        'cache-control': 'no-store, no-cache, must-revalidate'
      },
      corsHeaders(),
      extraHeaders || {}
    )
  });
}

function toInt(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

async function readCounts(env, key) {
  const [pv, total] = await Promise.all([
    env.PAGEVIEWS.get(key),
    env.PAGEVIEWS.get(TOTAL_KEY)
  ]);
  return { views: toInt(pv), total: toInt(total) };
}

async function bump(env, key) {
  const { views, total } = await readCounts(env, key);
  const nextViews = views + 1;
  const nextTotal = total + 1;
  await Promise.all([
    env.PAGEVIEWS.put(key, String(nextViews)),
    env.PAGEVIEWS.put(TOTAL_KEY, String(nextTotal))
  ]);
  return { views: nextViews, total: nextTotal };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const p = url.pathname;

    // ------------------------------------------------------------------
    //  手动触发一封测试信
    //
    //  用 MAIL_TEST_KEY 保护：这是个公开站点，不加保护任何人都能拿它当
    //  发信机用，而发信额度被刷爆之后正事就发不出去了。
    //  用法：/api/mail-test?key=<MAIL_TEST_KEY>
    //  ------------------------------------------------------------------
    if (p === '/api/mail-test') {
      const key = url.searchParams.get('key') || '';
      if (!env.MAIL_TEST_KEY || key !== env.MAIL_TEST_KEY) {
        return json({ error: 'forbidden' }, 403);
      }

      const missing = ['SMTP_USER', 'SMTP_PASS', 'MAIL_TO'].filter((k) => !env[k]);
      if (missing.length) {
        return json({ error: 'secrets not set', missing: missing }, 500);
      }

      try {
        const r = await sendMail({
          host: env.SMTP_HOST || 'smtp.qq.com',
          port: Number(env.SMTP_PORT || 465),
          user: env.SMTP_USER,
          pass: env.SMTP_PASS,
          from: env.SMTP_USER,
          to: env.MAIL_TO,
          subject: '[vopth.xyz] 邮件通道测试',
          text: '如果你收到这封邮件，说明 Cloudflare Worker 直连 QQ SMTP 成功。\n\n' +
                '发送时间：' + new Date().toISOString() + '\n' +
                '收件地址：' + env.MAIL_TO + '\n'
        });
        return json({ ok: true, to: env.MAIL_TO, steps: r.steps });
      } catch (e) {
        return json({ ok: false, error: String(e && e.message) }, 500);
      }
    }

    if (p === '/api/views' || p === '/api/views/') {
      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders() });
      }

      const path = normalizePath(url.searchParams.get('path'));
      if (!path) {
        return json({ error: 'missing or invalid "path" parameter' }, 400);
      }
      const key = KV_PREFIX + path;

      try {
        if (request.method === 'POST') {
          const r = await bump(env, key);
          return json({ path: path, views: r.views, total: r.total });
        }
        if (request.method === 'GET') {
          const r = await readCounts(env, key);
          return json({ path: path, views: r.views, total: r.total });
        }
        return json({ error: 'method not allowed' }, 405);
      } catch (e) {
        // KV 挂了也别让前端一直转圈
        return json({ error: 'storage error', detail: String(e && e.message) }, 500);
      }
    }

    // 其余请求：原样交给静态资源
    return env.ASSETS.fetch(request);
  }
};
