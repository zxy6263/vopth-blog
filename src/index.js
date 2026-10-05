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
import { checkMilestones, sendStatusReport } from './notify.js';
import { verifyAccess } from './access.js';
import {
  createPost, buildMarkdown, listPosts, deletePost,
  scheduleCreate, scheduleDelete, listScheduled, cancelScheduled,
  runDueSchedules, runSchedulesNow, maybeRunSchedules, recordCronFailure, scheduleStatus
} from './admin.js';
import { ADMIN_PAGE } from './admin-page.js';

// 每 3 小时那条 cron 用来发状态报告；其余（每 5 分钟那条）用来跑定时文章。
const REPORT_CRON = '0 */3 * * *';

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
  async fetch(request, env, ctx) {
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

      // 限流：一分钟最多触发一次。
      // MAIL_TEST_KEY 万一外泄，别人也不能拿它当发信机刷 —— 刷爆发信额度会让
      // 正事的邮件发不出去，而大量异常发信还可能让 QQ 邮箱把账号风控掉。
      const rlKey = 'pv:rl:mail-test';
      if (await env.PAGEVIEWS.get(rlKey)) {
        return json({ error: 'too many requests', retryAfterSeconds: 60 }, 429);
      }
      await env.PAGEVIEWS.put(rlKey, '1', { expirationTtl: 60 });

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
        // 不回显收件地址：它含手机号，而这个站点是公开的。
        // （地址只出现在真正发出去的那封信的正文里，那只有收件人本人看得到。）
        return json({ ok: true, steps: r.steps });
      } catch (e) {
        return json({ ok: false, error: String(e && e.message) }, 500);
      }
    }

    // ------------------------------------------------------------------
    //  手动触发一封状态报告（同样是测试用，受 MAIL_TEST_KEY 保护）
    //  用法：/api/report-test?key=<MAIL_TEST_KEY>
    //  ------------------------------------------------------------------
    if (p === '/api/report-test') {
      const rk = url.searchParams.get('key') || '';
      if (!env.MAIL_TEST_KEY || rk !== env.MAIL_TEST_KEY) {
        return json({ error: 'forbidden' }, 403);
      }

      // 同 mail-test 的限流理由；报告会遍历整站并抓标题，更贵，所以给 5 分钟
      const rlKey2 = 'pv:rl:report-test';
      if (await env.PAGEVIEWS.get(rlKey2)) {
        return json({ error: 'too many requests', retryAfterSeconds: 300 }, 429);
      }
      await env.PAGEVIEWS.put(rlKey2, '1', { expirationTtl: 300 });
      try {
        const r = await sendStatusReport(env);
        const out = { ok: r.ok, total: r.total, pages: r.pages, online: r.online };
        // preview=1 时把生成的邮件内容也返回，方便在浏览器里直接看排版
        // （内容只有自己的统计数据，不含任何凭据）
        if (url.searchParams.get('preview') === '1') {
          out.html = r.html;
          out.text = r.text;
        }
        return json(out);
      } catch (e) {
        return json({ ok: false, error: String(e && e.message) }, 500);
      }
    }

    // ------------------------------------------------------------------
    //  网页后台（发文章）
    //
    //  页面本身由 Worker 返回，而不是放进 source/ 当静态页 —— 这样就能在
    //  返回 HTML 之前先校验 Cloudflare Access：没通过鉴权的人连页面都拿不到，
    //  而不是「能打开但点了没用」。
    //
    //  鉴权用真正的 JWT 签名校验（见 src/access.js）。没配好 ACCESS_TEAM_DOMAIN
    //  或 ACCESS_AUD 时一律 403（fail closed）—— 宁可后台打不开，也不能让
    //  没鉴权的请求有机会去动仓库。
    //  ------------------------------------------------------------------
    if (p === '/admin' || p === '/admin/') {
      const auth = await verifyAccess(request, env);
      if (!auth.ok) {
        return new Response(
          '后台未启用或未通过 Cloudflare Access 鉴权。\n\n原因：' + auth.reason +
          '\n\n配置见仓库 README 里「网页后台」一节。\n',
          {
            status: 403,
            headers: {
              'content-type': 'text/plain; charset=utf-8',
              'cache-control': 'no-store',
              'x-robots-tag': 'noindex, nofollow'
            }
          }
        );
      }
      return new Response(ADMIN_PAGE, {
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
          'x-robots-tag': 'noindex, nofollow',
          'referrer-policy': 'same-origin'
        }
      });
    }

    // ------------------------------------------------------------------
    //  后台的接口。全部挂在 /admin/api/ 下，全部必须通过 Access 鉴权。
    //
    //    GET  /admin/api/posts     列出已有文章（名字 + sha + 从 search.xml 取的中文标题）
    //    POST /admin/api/post      发新文章（可带封面 { ext, base64 }）
    //    POST /admin/api/dry-run   干跑：只返回生成好的 Markdown，不提交
    //    POST /admin/api/delete    删文章（body: { slug }，顺手删它自己的封面）
    //
    //  ⚠️ 路径刻意放在 /admin/ 下面，而不是 /api/admin/。
    //     原因：Cloudflare Access 的 CF_Authorization cookie 是存在【域名】上的，
    //     而它带着 AUD。如果页面和接口挂在两个不同的 Access 应用上，登录页面
    //     拿到的 cookie 对接口那个应用是"aud 不匹配"的，于是接口又把你踢去登录页 ——
    //     fetch 跟着跳到一个跨域地址，浏览器判定 CORS 失败，前端只看到
    //     "Failed to fetch"。放在 /admin/ 下就只有一个 Access 应用、一个会话，
    //     没这个问题（Access 的路径是前缀匹配，配了 admin 就覆盖 admin/api/*）。
    //  ------------------------------------------------------------------
    if (p.indexOf('/admin/api/') === 0) {
      const auth = await verifyAccess(request, env);
      if (!auth.ok) {
        return json({ error: 'forbidden', reason: auth.reason }, 403);
      }

      const action = p.slice('/admin/api/'.length);
      const isPost = request.method === 'POST';

      // 列出文章（只读，用 GET）
      if (action === 'posts') {
        if (request.method !== 'GET') return json({ error: 'method not allowed' }, 405);
        try {
          return json(await listPosts(env, request));
        } catch (e) {
          return json({ ok: false, error: '列文章出错：' + String(e && e.message) }, 500);
        }
      }

      // 排期：GET 列出，POST 新建。
      //   POST /admin/api/schedule         body: 文章数据 + publishAt(epoch秒) [+ deleteAt]
      //   POST /admin/api/schedule-delete  body: { slug, deleteAt }
      //   POST /admin/api/schedule-cancel  body: { key }
      if (action === 'schedule') {
        if (request.method === 'GET') {
          try {
            return json(await listScheduled(env));
          } catch (e) {
            return json({ ok: false, error: '列排期出错：' + String(e && e.message) }, 500);
          }
        }
        if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);
        let b;
        try { b = await request.json(); } catch (e) { return json({ error: '请求体不是合法 JSON' }, 400); }
        const cv = b.cover && b.cover.base64
          ? { ext: String(b.cover.ext || 'jpg'), base64: String(b.cover.base64) }
          : null;
        try {
          const r = await scheduleCreate(env, {
            title: String(b.title || '').trim(),
            slug: String(b.slug || '').trim().toLowerCase(),
            category: String(b.category || '').trim(),
            tags: Array.isArray(b.tags) ? b.tags : [],
            description: String(b.description || '').trim(),
            content: String(b.content || ''),
            cover: cv
          }, Number(b.publishAt), b.deleteAt ? Number(b.deleteAt) : 0);
          return json(r, r.ok ? 200 : (r.status && r.status >= 400 && r.status < 600 ? r.status : 500));
        } catch (e) {
          return json({ ok: false, error: '排期失败：' + String(e && e.message) }, 500);
        }
      }

      // 其余几个都是写操作，必须是 POST
      if (['post', 'dry-run', 'delete', 'schedule-delete', 'schedule-cancel', 'schedule-run'].indexOf(action) === -1) {
        return json({ error: 'unknown action' }, 404);
      }
      if (!isPost) return json({ error: 'method not allowed' }, 405);

      let body;
      try {
        body = await request.json();
      } catch (e) {
        return json({ error: '请求体不是合法 JSON' }, 400);
      }

      // 给已发表的文章排一个到点删除
      if (action === 'schedule-delete') {
        try {
          // fromPost=true 表示"这是我刚亲手提交的文章"，跳过存在性检查 ——
          // 刚提交完立刻查 GitHub，contents API 可能还没同步到，会误判成不存在，
          // 于是排期静默没建上（实际踩过）。
          const r = await scheduleDelete(
            env,
            String(body.slug || '').trim().toLowerCase(),
            Number(body.deleteAt),
            !!body.fromPost
          );
          return json(r, r.ok ? 200 : (r.status && r.status >= 400 && r.status < 600 ? r.status : 500));
        } catch (e) {
          return json({ ok: false, error: '排期失败：' + String(e && e.message) }, 500);
        }
      }

      // 立刻手动跑一遍到点的排期（验证 cron 是否正常，不用等 5 分钟）
      if (action === 'schedule-run') {
        try {
          const r = await runSchedulesNow(env);
          return json(r, r.ok ? 200 : 500);
        } catch (e) {
          return json({ ok: false, error: '执行失败：' + String(e && e.message) }, 500);
        }
      }

      // 取消一条排期
      if (action === 'schedule-cancel') {
        try {
          const r = await cancelScheduled(env, String(body.key || ''));
          return json(r, r.ok ? 200 : (r.status && r.status >= 400 && r.status < 600 ? r.status : 500));
        } catch (e) {
          return json({ ok: false, error: '取消失败：' + String(e && e.message) }, 500);
        }
      }

      // 删文章：只认 slug，别的都不看（安全边界见 src/admin.js）
      if (action === 'delete') {
        try {
          const r = await deletePost(env, String(body.slug || '').trim().toLowerCase());
          return json(r, r.ok ? 200 : (r.status && r.status >= 400 && r.status < 600 ? r.status : 500));
        } catch (e) {
          return json({ ok: false, error: '删除失败：' + String(e && e.message) }, 500);
        }
      }

      const cover = body.cover && body.cover.base64
        ? { ext: String(body.cover.ext || 'jpg'), base64: String(body.cover.base64) }
        : null;

      const post = {
        title: String(body.title || '').trim(),
        slug: String(body.slug || '').trim().toLowerCase(),
        category: String(body.category || '').trim(),
        tags: Array.isArray(body.tags) ? body.tags : [],
        description: String(body.description || '').trim(),
        content: String(body.content || ''),
        cover: cover
      };

      if (action === 'dry-run') {
        // 干跑时封面还没上传，但要让使用者看到 front-matter 里那行会长什么样
        const coverPath = cover ? '/img/covers/' + post.slug + '.' + cover.ext.toLowerCase().replace(/^\./, '') : '';
        return json({
          ok: true,
          dryRun: true,
          path: 'source/_posts/' + post.slug + '.md',
          coverPath: coverPath,
          markdown: buildMarkdown(Object.assign({}, post, { cover: coverPath }))
        });
      }

      try {
        const r = await createPost(env, post);
        return json(r, r.ok ? 200 : (r.status && r.status >= 400 && r.status < 600 ? r.status : 500));
      } catch (e) {
        return json({ ok: false, error: '提交失败：' + String(e && e.message) }, 500);
      }
    }

    // 公开的排期健康检查。故意不鉴权 —— 排期有没有存下、cron 有没有在跑、
    // 上次执行有没有抛异常，这三件事原来只能在有 Access 的后台看，
    // 每次排查都要人肉念一遍，太慢。这里只给"数量和时刻"，不给 slug / 标题。
    if (p === '/api/sched-status' || p === '/api/sched-status/') {
      try {
        // ⭐ 顺手跑一次到期检查。为什么挂在这个接口上：
        //   GitHub Actions 的 uptime workflow 每 5 分钟请求一次这里，请求是从
        //   GitHub 的服务器发出的 —— 不依赖访客、不依赖 cron。
        //   实测 Cloudflare 的 Cron 触发器在控制台里显示正常、"下次运行"时间也对，
        //   但 Worker 的 scheduled() 从来没被调用过（心跳里 failedToRun 一直是空）。
        //   在这条腿修好之前，这个由外部定时器驱动的入口就是最可靠的一条。
        //   刻意 await（而不是丢 waitUntil）：这样返回给调用方的就是跑完后的状态，
        //   排查时一次请求就能看到结果。到点需要跑时最坏多花一两秒（要提交 GitHub）。
        try {
          await maybeRunSchedules(env);
        } catch (e) {
          console.log('[sched] sched-status 兜底异常：' + (e && e.message));
        }
        const st = await scheduleStatus(env);
        // 部署标记：用来确认"新代码到底上线了没有"。旧版本没有这个字段。
        st.build = '2026-10-06-lazyonstatus';
        return json(st, 200, { 'cache-control': 'no-store' });
      } catch (e) {
        return json({ ok: false, error: String(e && e.message) }, 500, { 'cache-control': 'no-store' });
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
          // 里程碑检测（可能发信，几秒钟）不要挡在访客请求的前面：
          // 丢进 waitUntil，响应立刻返回，发信在后台继续。
          if (ctx && typeof ctx.waitUntil === 'function') {
            ctx.waitUntil(
              checkMilestones(env, path, r).catch((e) => {
                console.log('[notify] checkMilestones 异常：' + (e && e.message));
              })
            );
            // 兜底跑定时文章：cron 万一没生效，只要有访客就还能执行。
            // 同样丢进 waitUntil，绝不挡住访客的计数响应。
            ctx.waitUntil(
              maybeRunSchedules(env).catch((e) => {
                console.log('[sched] 兜底检查异常：' + (e && e.message));
              })
            );
          }
          return json({ path: path, views: r.views, total: r.total });
        }
        if (request.method === 'GET') {
          const r = await readCounts(env, key);
          // ⚠️ 兜底在 GET 上【也必须】跑。
          // 原来只挂在 POST（+1）分支上，2026-10-06 查 cron 时发现这是个漏洞：
          // Cloudflare 的 HTTP 日志里全是 GET /api/views，POST 一次都没出现
          // （列表页/首页只读计数不 +1，page-views.js 的 +1 请求未必发出/未必成功），
          // 结果"靠访客兜底"这条路实际上等于没有 —— 心跳 57 分钟没动过一次。
          // 代价：每次读文章多一次 KV 读（间隔没到就直接返回，不写）；读额度 10 万/天，够用。
          if (ctx && typeof ctx.waitUntil === 'function') {
            ctx.waitUntil(
              maybeRunSchedules(env).catch((e) => {
                console.log('[sched] 兜底检查异常：' + (e && e.message));
              })
            );
          }
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
  },

  /**
   * 定时任务（wrangler.jsonc 里的 triggers.crons 配的）
   *   0 *&#47;3 * * *   每 3 小时：发一封站点状态报告
   *   *&#47;5 * * * *    每 5 分钟：跑定时文章（到点发布 / 到点删除）
   *
   * 用 event.cron 区分是哪条触发的。故意把"报告"写成已知的那一条、
   * 其余一律走排期处理 —— 这样以后再加 cron 不会漏掉新任务。
   */
  async scheduled(event, env, ctx) {
    const cron = event && event.cron;
    const run = (async () => {
      if (cron === REPORT_CRON) {
        await sendStatusReport(env);
        return;
      }
      // 定时文章：到点的发布/删除
      const r = await runDueSchedules(env, 'cron');
      if (r.done.length || r.failed.length || r.givenUp.length) {
        console.log('[sched] ' + JSON.stringify(r));
      }
    })().catch(async (e) => {
      console.log('[cron] 任务失败（' + cron + '）：' + (e && e.message));
      // 失败也留痕 —— 否则界面上只有"从来没跑过"，分不清是没触发还是跑了就炸
      try {
        await recordCronFailure(env, cron === REPORT_CRON ? 'cron-report' : 'cron', e);
      } catch (e2) { /* 忽略 */ }
    });

    if (ctx && typeof ctx.waitUntil === 'function') {
      ctx.waitUntil(run);
    } else {
      await run;
    }
  }
};
