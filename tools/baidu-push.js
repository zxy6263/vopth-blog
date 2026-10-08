#!/usr/bin/env node
/**
 * 百度搜索资源平台 —— 普通收录主动推送
 * ===========================================================================
 *
 *  它做什么
 *    把 public/sitemap.xml 里的 URL 推给百度，缩短爬虫发现新文章的时间。
 *    百度那边有配额（按站点、按天，不可累计），配额用完会返回 over quota，
 *    这不是错误 —— 明天会自动恢复。
 *
 *  ⚠️ 和 IndexNow 的区别
 *    IndexNow 覆盖 Bing / Yandex 等，【不含百度】；百度要单独推。
 *
 *  ⚠️ 三个踩过的坑（2026-10-08 实测出来的）
 *    1. site 参数【不能带协议头】。写 www.vopth.xyz 才行；
 *       写 https://www.vopth.xyz 会返回 site init fail（官方文档的 curl 示例
 *       里带了协议头，照抄会中招）。
 *    2. 提交的 URL 必须属于【已验证的那个站点】。本站 sitemap 用的是
 *       vopth.xyz（不带 www），而百度验证的是 www.vopth.xyz ——
 *       域名对不上会报 over quota 或 site init fail。所以这里会把 URL 的
 *       主机名统一换成 BAIDU_SITE 指定的那个。
 *    3. 配额很小且当天有效。第一次配好别反复试，试几次就没了。
 *
 *  怎么配置（密钥不进仓库！）
 *    在 Cloudflare Workers 构建环境里加两个变量：
 *      BAIDU_PUSH_TOKEN   百度站长 → 普通收录 → 推送接口 → 准入密钥
 *      BAIDU_SITE         已验证的站点，不带协议，默认 www.vopth.xyz
 *    设置位置：Workers & Pages → vopth-blog → Settings → Build →
 *              Environment variables（构建时变量，不是运行时）
 *    没配 token 时本脚本自动跳过，不会让部署失败。
 *
 *  什么时候跑
 *    挂在 npm run build 最后。本地构建默认跳过（和 indexnow 一致），
 *    想手动跑加 --force，想先看要推什么加 --dry-run。
 *
 *  ⚠️ 永远以退出码 0 结束 —— 推送失败绝不能把整次部署搞挂。
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SITEMAP = path.join(ROOT, 'public', 'sitemap.xml');
const ENDPOINT = 'http://data.zz.baidu.com/urls';

const argv = process.argv.slice(2);
const FORCE = argv.includes('--force');
const DRY = argv.includes('--dry-run');

function say(m = '') { console.log(m); }

function inCI() {
  return Boolean(process.env.WORKERS_CI || process.env.CI || process.env.CF_PAGES);
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

/** 按百度返回的错误码给出人话解释 */
function explain(code, message) {
  const m = String(message || '');
  if (/over quota/i.test(m)) {
    return '今天的配额用完了（按天计算、不可累计）。不是错误，明天自动恢复。';
  }
  if (/site init fail/i.test(m)) {
    return 'site 参数写法不对：不能带 https:// 前缀，要写 www.vopth.xyz 这种。';
  }
  if (/site error/i.test(m)) {
    return '这个站点在百度那边没有验证过。要么先去验证它，要么把 BAIDU_SITE 改成已验证的那个。';
  }
  if (/not_valid/i.test(m)) return '有 URL 格式不合法（一般是重复或带了查询参数）。';
  return '未识别的错误码 ' + code + '：' + m;
}

(async function main() {
  say('');
  say('=== 百度主动推送 ===');

  const token = process.env.BAIDU_PUSH_TOKEN;
  // 百度要求不带协议头。默认按已验证的 www 站点来。
  const site = (process.env.BAIDU_SITE || 'www.vopth.xyz').replace(/^https?:\/\//i, '').replace(/\/+$/, '');

  if (!token) {
    say('  没有配置 BAIDU_PUSH_TOKEN，跳过（这是预期行为，不是故障）');
    say('  配置位置：Cloudflare → Workers & Pages → vopth-blog → Settings → Build → Environment variables');
    return;
  }

  if (!inCI() && !FORCE) {
    say('  本地构建，跳过推送（想手动跑：node tools/baidu-push.js --force）');
    return;
  }

  const urls = readSitemapUrls();
  if (urls.length === 0) {
    say('  [WARN] sitemap 里没有 URL，跳过');
    return;
  }

  // 把 URL 的主机名统一成百度已验证的那个站点。
  // 本站 sitemap 是 vopth.xyz，而百度验证的是 www.vopth.xyz —— 不换会判"非本站"。
  const fixed = urls.map((u) => {
    try {
      const x = new URL(u);
      return x.protocol + '//' + site + x.pathname + x.search;
    } catch (e) {
      return u;
    }
  });
  const dedup = Array.from(new Set(fixed));

  say('  site       : ' + site);
  say('  待推 URL   : ' + dedup.length + ' 条' + (dedup.length !== urls.length ? '（去重前 ' + urls.length + '）' : ''));
  say('  形如       : ' + dedup[0]);

  const apiUrl = ENDPOINT + '?site=' + encodeURIComponent(site) + '&token=' + encodeURIComponent(token);

  if (DRY) {
    say('  --dry-run：不发请求。将要提交的内容：');
    dedup.slice(0, 10).forEach((u) => say('    ' + u));
    if (dedup.length > 10) say('    …（还有 ' + (dedup.length - 10) + ' 条）');
    return;
  }

  try {
    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: dedup.join('\n') + '\n'
    });
    const text = (await res.text().catch(() => '')).slice(0, 400);
    say('  响应: HTTP ' + res.status + '  ' + text);

    let data = null;
    try { data = JSON.parse(text); } catch (e) { /* 不是 JSON 就算了 */ }

    if (data && typeof data.success === 'number') {
      say('  ✅ 成功推送 ' + data.success + ' 条，今日剩余 ' + data.remain + ' 条');
      if (data.not_same_site && data.not_same_site.length) {
        say('  [WARN] 有 ' + data.not_same_site.length + ' 条被判为非本站 URL（域名和已验证站点不一致）');
      }
      if (data.not_valid && data.not_valid.length) {
        say('  [WARN] 有 ' + data.not_valid.length + ' 条不合法');
      }
    } else if (data && data.error) {
      // 配额用完是最常见的情况，别当成故障刷屏
      say('  [WARN] ' + explain(data.error, data.message));
    } else if (res.status !== 200) {
      say('  [WARN] HTTP ' + res.status + '，这次跳过，下次构建会重试');
    }
  } catch (e) {
    // CI 的构建机器在海外，访问 data.zz.baidu.com 可能超时 —— 绝不能让部署挂掉
    say('  [WARN] 推送失败：' + (e && e.message ? e.message : String(e)));
    say('          （构建机在海外，访问百度接口偶尔会超时；下次构建会重试）');
  }
  say('');
})().catch((e) => {
  console.log('  [WARN] 百度推送脚本异常：' + (e && e.message ? e.message : String(e)));
}).finally(() => {
  process.exitCode = 0;
});
