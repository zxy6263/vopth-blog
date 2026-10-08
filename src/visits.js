/**
 * 访客记录（存 D1）
 * ===========================================================================
 *
 *  为什么需要
 *    Cloudflare 自带的日志保留期很短，百度统计只给地区不给 IP。
 *    站主想知道"都有谁来过"，所以自己记一份。
 *
 *  记在哪
 *    挂在现成的 /api/views 上（page-views.js 在【每次页面加载】都会有请求，
 *    而且 /api/views 本来就在 wrangler.jsonc 的 run_worker_first 列表里）。
 *    这样不用新增前端请求、不用改 run_worker_first、不影响静态资源的免费额度。
 *
 *  为什么用 D1 而不是 KV
 *    ⚠️ KV 免费版只有 1000 次写/天，而浏览量计数已经在用 ——
 *       记录每次访问会立刻把额度打爆，顺手把浏览量功能一起搞挂。
 *    D1（SQLite）免费额度是 5GB 存储 + 每天 10 万行写入，够用得多，
 *    而且能按条件查询（KV 只能按 key 读，做不了"最近 100 条"这种）。
 *
 *  隐私
 *    存了原始 IP。个人博客自己看没问题，但这是个人信息，
 *    对外最好有一句说明（页脚或隐私页）。
 *
 *  表结构自动创建
 *    每个 isolate 首次用到时跑一次 CREATE TABLE IF NOT EXISTS。
 *    好处：站主只需要在控制台建一个【空】数据库，不用手写 SQL。
 */

// UA / 来源页都截断再存 —— 防着有人塞个几 KB 的 UA 把表撑大
const MAX_UA = 200;
const MAX_REF = 300;

// 保留天数。cron 里会删更早的（D1 不会自动过期）
export const KEEP_DAYS = 90;

// 明显的爬虫 / 监控探针不记。
// 不追求完备 —— 只是别让搜索引擎和各类 uptime 机器人把表填满。
const BOT_RE = /bot|crawl|spider|slurp|preview|fetcher|monitor|scan|curl|wget|python|headless|lighthouse|pingdom|uptime|statuscake|nagios|zabbix|semrush|ahrefs|mj12|dotbot/i;

/**
 * 模块级标记：同一个 isolate 里只建一次表。
 * 部署新版本时 isolate 会重启，就再建一次（IF NOT EXISTS，无害）。
 */
let schemaReady = false;

/**
 * 建表。幂等，失败不抛异常（下次调用再试）。
 */
async function ensureSchema(db) {
  if (schemaReady) return;
  try {
    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS visits (
           id       INTEGER PRIMARY KEY AUTOINCREMENT,
           at       INTEGER NOT NULL,
           path     TEXT    NOT NULL,
           ip       TEXT,
           country  TEXT,
           region   TEXT,
           city     TEXT,
           asn      INTEGER,
           org      TEXT,
           ua       TEXT,
           referer  TEXT,
           colo     TEXT
         )`
      )
      .run();
    await db.prepare('CREATE INDEX IF NOT EXISTS idx_visits_at ON visits(at)').run();
    await db.prepare('CREATE INDEX IF NOT EXISTS idx_visits_ip ON visits(ip)').run();
    schemaReady = true;
  } catch (e) {
    // 建表失败不能影响访客请求 —— 下次再试
    console.log('[visits] 建表失败：' + (e && e.message));
  }
}

/**
 * 从请求里取出访客信息。
 * geo 那几个字段是 Cloudflare 免费送的（request.cf），不用调第三方接口。
 */
export function visitorInfo(request) {
  const cf = (request && request.cf) || {};
  const h = request.headers;
  return {
    ip: h.get('CF-Connecting-IP') || h.get('X-Forwarded-For') || '',
    country: cf.country || '',
    region: cf.region || '',
    city: cf.city || '',
    asn: cf.asn || 0,
    org: cf.asOrganization || '',
    colo: cf.colo || '',
    ua: (h.get('User-Agent') || '').slice(0, MAX_UA),
    referer: (h.get('Referer') || '').slice(0, MAX_REF),
  };
}

export function isBot(ua) {
  return BOT_RE.test(String(ua || ''));
}

/**
 * 记一条访问。调用方用 ctx.waitUntil，别挡访客请求。
 * 没绑 D1（env.VISITS 为空）时静默跳过，不影响原有功能。
 */
export async function recordVisit(env, request, path) {
  const db = env && env.VISITS;
  if (!db) return;

  const v = visitorInfo(request);
  if (isBot(v.ua)) return; // 爬虫不记

  await ensureSchema(db);
  try {
    await db
      .prepare(
        `INSERT INTO visits (at, path, ip, country, region, city, asn, org, ua, referer, colo)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        Math.floor(Date.now() / 1000),
        path,
        v.ip,
        v.country,
        v.region,
        v.city,
        v.asn,
        v.org,
        v.ua,
        v.referer,
        v.colo
      )
      .run();
  } catch (e) {
    console.log('[visits] 写入失败：' + (e && e.message));
  }
}

/**
 * 删掉超过保留期的记录。给 cron 用。
 */
export async function cleanupVisits(env, days = KEEP_DAYS) {
  const db = env && env.VISITS;
  if (!db) return { ok: false, error: '没绑 D1' };
  await ensureSchema(db);
  const before = Math.floor(Date.now() / 1000) - days * 86400;
  try {
    const r = await db.prepare('DELETE FROM visits WHERE at < ?').bind(before).run();
    const n = (r.meta && r.meta.changes) || 0;
    if (n > 0) console.log(`[visits] 清理了 ${n} 条超过 ${days} 天的记录`);
    return { ok: true, deleted: n };
  } catch (e) {
    return { ok: false, error: String(e && e.message) };
  }
}

// ---------------------------------------------------------------- 查询（后台用）

const pad = (n) => String(n).padStart(2, '0');
function fmtTime(sec) {
  const d = new Date(sec * 1000);
  const local = new Date(d.getTime() + 8 * 3600 * 1000); // 固定北京时间，免得跟着服务器时区变
  return (
    local.getUTCFullYear() +
    '-' + pad(local.getUTCMonth() + 1) +
    '-' + pad(local.getUTCDate()) +
    ' ' + pad(local.getUTCHours()) +
    ':' + pad(local.getUTCMinutes()) +
    ':' + pad(local.getUTCSeconds())
  );
}

/**
 * 后台查询。一次返回四块，界面上一屏看完：
 *   recent  最近 N 条明细（谁、什么时候、看了哪页）
 *   uniques 按 IP 聚合的独立访客（次数、首次/最后、地点、运营商）
 *   daily   按天统计
 *   pages   按页面统计
 */
export async function queryVisits(env, opts = {}) {
  const db = env && env.VISITS;
  if (!db) {
    return { ok: false, error: '没有绑定 D1 数据库（wrangler.jsonc 里的 d1_databases）' };
  }
  await ensureSchema(db);

  const days = Math.min(Math.max(parseInt(opts.days, 10) || 7, 1), 365);
  const limit = Math.min(Math.max(parseInt(opts.limit, 10) || 100, 1), 500);
  const since = Math.floor(Date.now() / 1000) - days * 86400;

  try {
    const [recentR, uniquesR, dailyR, pagesR, totalR] = await Promise.all([
      db
        .prepare(
          `SELECT at, path, ip, country, region, city, org, ua, referer, colo
             FROM visits WHERE at >= ? ORDER BY at DESC LIMIT ?`
        )
        .bind(since, limit)
        .all(),
      db
        .prepare(
          `SELECT ip,
                  COUNT(*)        AS hits,
                  MIN(at)         AS first_at,
                  MAX(at)         AS last_at,
                  MAX(country)    AS country,
                  MAX(region)     AS region,
                  MAX(city)       AS city,
                  MAX(org)        AS org,
                  COUNT(DISTINCT path) AS pages,
                  MAX(ua)         AS ua
             FROM visits WHERE at >= ? AND ip != ''
             GROUP BY ip ORDER BY last_at DESC LIMIT ?`
        )
        .bind(since, limit)
        .all(),
      db
        .prepare(
          `SELECT (at / 86400) * 86400 AS day, COUNT(*) AS hits, COUNT(DISTINCT ip) AS visitors
             FROM visits WHERE at >= ? GROUP BY day ORDER BY day DESC`
        )
        .bind(since)
        .all(),
      db
        .prepare(
          `SELECT path, COUNT(*) AS hits, COUNT(DISTINCT ip) AS visitors
             FROM visits WHERE at >= ? GROUP BY path ORDER BY hits DESC LIMIT 50`
        )
        .bind(since)
        .all(),
      db.prepare('SELECT COUNT(*) AS n FROM visits').all(),
    ]);

    return {
      ok: true,
      days,
      generatedAt: fmtTime(Math.floor(Date.now() / 1000)),
      totalRows: (totalR.results && totalR.results[0] && totalR.results[0].n) || 0,
      recent: (recentR.results || []).map((r) => ({ ...r, atText: fmtTime(r.at) })),
      uniques: (uniquesR.results || []).map((r) => ({
        ...r,
        firstText: fmtTime(r.first_at),
        lastText: fmtTime(r.last_at),
      })),
      daily: (dailyR.results || []).map((r) => ({ ...r, dayText: fmtTime(r.day).slice(0, 10) })),
      pages: pagesR.results || [],
    };
  } catch (e) {
    return { ok: false, error: String(e && e.message) };
  }
}
