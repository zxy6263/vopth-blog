#!/usr/bin/env node
/**
 * IndexNow 主动推送
 * ===========================================================================
 *
 * 它做什么
 *   把 public/sitemap.xml 里的所有 URL 主动推给 IndexNow，
 *   让 Bing / Yandex / Naver / Seznam 不用等爬虫自己发现就能知道有新内容。
 *
 *   ⚠️ Google 不支持 IndexNow —— Google 那边只能靠 Search Console 提交 sitemap。
 *
 * 为什么需要那个 key 文件
 *   IndexNow 要求「证明你控制这个域名」：在站点根目录放一个
 *   <key>.txt，内容就是 key 本身。所以 source/ 下有一个这样的文件，
 *   构建后它会被复制到 public/，线上就能访问到。
 *   这个脚本不去猜 key —— 它在 public/ 里找那个文件，文件名去掉 .txt
 *   必须等于文件内容，这正好就是 IndexNow 的校验规则。
 *
 * 什么时候跑
 *   挂在 npm run build 的最后一步。注意：
 *     · 只有设了 CI 相关环境变量时才真的推送，本地构建默认跳过
 *       （避免每次本地预览都去骚扰搜索引擎）
 *     · 想手动跑加 --force
 *     · 【永远以退出码 0 结束】—— 推送失败绝不能把整次部署搞挂
 *
 * 用法
 *   node tools/indexnow.js             # 只在 CI 里真跑
 *   node tools/indexnow.js --force     # 本地也跑（部署完之后手动补推时用）
 *   node tools/indexnow.js --dry-run   # 只打印要推什么，不发请求
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const SITEMAP = path.join(PUBLIC_DIR, 'sitemap.xml');
const ENDPOINT = 'https://api.indexnow.org/indexnow';

const argv = process.argv.slice(2);
const FORCE = argv.includes('--force');
const DRY = argv.includes('--dry-run');

function say(m = '') { console.log(m); }

// --- 判断是不是在 CI 里 -----------------------------------------------------
//   Cloudflare Workers Builds 会设 WORKERS_CI；多数 CI 会设 CI。
function inCI() {
  return Boolean(process.env.WORKERS_CI || process.env.CI || process.env.CF_PAGES);
}

/**
 * 找出 IndexNow 的 key。
 * 规则：在 public/ 里找一个 .txt，其【文件名去掉扩展名】等于【文件内容】。
 */
function findKey() {
  if (!fs.existsSync(PUBLIC_DIR)) return null;
  const entries = fs.readdirSync(PUBLIC_DIR, { withFileTypes: true });
  for (const e of entries) {
    if (!e.isFile()) continue;
    if (!/\.txt$/i.test(e.name)) continue;
    const name = e.name.replace(/\.txt$/i, '');
    if (!/^[A-Za-z0-9-]{8,128}$/.test(name)) continue;
    const content = fs.readFileSync(path.join(PUBLIC_DIR, e.name), 'utf8').trim();
    if (content === name) return { key: name, file: e.name };
  }
  return null;
}

function readSitemapUrls() {
  if (!fs.existsSync(SITEMAP)) return [];
  const xml = fs.readFileSync(SITEMAP, 'utf8');
  const out = [];
  const re = /<loc>\s*([^<\s]+)\s*<\/loc>/g;
  let m;
  while ((m = re.exec(xml)) !== null) out.push(m[1]);
  return out;
}

(async function main() {
  say('');
  say('=== IndexNow ===');

  if (!inCI() && !FORCE) {
    say('  本地构建，跳过推送（想手动跑：node tools/indexnow.js --force）');
    return;
  }

  const found = findKey();
  if (!found) {
    say('  [WARN] 没在 public/ 里找到符合规则的 key 文件，跳过');
    say('         规则：<key>.txt 的文件名（去掉 .txt）要等于文件内容');
    return;
  }

  const urls = readSitemapUrls();
  if (urls.length === 0) {
    say('  [WARN] sitemap 里没有 URL，跳过');
    return;
  }

  // sitemap 里用的是 https://vopth.xyz/...，这里取出主机名
  let host;
  try {
    host = new URL(urls[0]).host;
  } catch (e) {
    say('  [WARN] sitemap 里的 URL 解析不出主机名，跳过');
    return;
  }

  const payload = {
    host: host,
    key: found.key,
    keyLocation: 'https://' + host + '/' + found.file,
    urlList: urls
  };

  say('  key        : ' + found.key + '  (来自 ' + found.file + ')');
  say('  host       : ' + host);
  say('  待推送 URL : ' + urls.length + ' 条');

  if (DRY) {
    say('  --dry-run：不发请求。payload 如下：');
    say(JSON.stringify(payload, null, 2));
    return;
  }

  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify(payload)
    });

    // 官方返回码：200/202 = 接受；400 = 格式错；403 = key 无效；
    //             422 = URL 不属于该 host / key 不匹配；429 = 请求过频
    const text = (await res.text().catch(() => '')).slice(0, 300);
    say('  响应: HTTP ' + res.status + (text ? '  ' + text : ''));

    if (res.status === 200 || res.status === 202) {
      say('  ✅ 已提交给 IndexNow');
    } else if (res.status === 403 || res.status === 422) {
      // 最常见的原因：key 文件还没部署上线，引擎抓不到它。
      // 这不是错误，下次构建时会自动重试。
      say('  [WARN] 被拒（多半是 key 文件还没上线）。这次跳过，下次构建会自动重试。');
    } else {
      say('  [WARN] 意外的响应码，跳过');
    }
  } catch (e) {
    say('  [WARN] 推送失败：' + (e && e.message ? e.message : String(e)));
  }
  say('');
})().catch((e) => {
  // 兜底：任何意外都不许影响部署
  console.log('  [WARN] IndexNow 脚本异常：' + (e && e.message ? e.message : String(e)));
}).finally(() => {
  process.exitCode = 0;
});
