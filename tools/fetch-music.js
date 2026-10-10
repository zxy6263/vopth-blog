/* ===========================================================================
 *  拉取网易云歌单的歌曲 ID 列表
 *
 *  为什么需要这个
 *  --------------
 *  悬浮播放器用的是网易官方外链播放器的【单曲模式】（type=2），
 *  每次打开随机挑一首歌 —— 这就需要一个"歌单里所有歌的 ID"列表。
 *
 *  ⚠️ 关键坑：别只看 `tracks`
 *     网易的 /api/v6/playlist/detail 返回里有两个数组：
 *        tracks    —— 只有 10 首（未登录请求会被截断）
 *        trackIds  —— 【全量】336 个 ID（给分页用的）
 *     我第一版只看 tracks，于是得出"接口只给 10 首，随机池太小"的结论，
 *     差点让站主放弃随机播放。实际 trackIds 里一首不少。
 *
 *  产地
 *  ----
 *      source/music/playlist.json   给前端 fetch 的静态数据
 *      （放 source/ 下会被 Hexo 原样复制到 public/，由 Cloudflare 免费静态分发）
 *
 *  ⚠️ 为什么不在构建时自动跑
 *     Cloudflare 的构建机器在海外，访问 music.163.com（国内）容易超时。
 *     让构建依赖外部网络 = 外部一抽风整个部署就挂。
 *     所以改成【本地手动跑】：歌单变了就跑一次，把结果提交进仓库。
 *     这样构建是纯离线的，永远不会因为网易挂了而部署失败。
 *
 *  用法
 *  ----
 *      node tools/fetch-music.js                 # 用配置里的歌单 ID
 *      node tools/fetch-music.js 13567737910     # 指定歌单 ID
 *      node tools/fetch-music.js --url "https://music.163.com/playlist?id=xxx"
 * ========================================================================= */

'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.resolve(__dirname, '..');
const OUT_FILE = path.join(ROOT, 'source', 'music', 'playlist.json');

// 默认歌单 —— 改歌单就在命令行传参数，或者改这一行
const DEFAULT_PLAYLIST_ID = '13567737910';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0 Safari/537.36';

function say(...args) {
  console.log('  ' + args.join(' '));
}

/** 从各种写法里抠出歌单 ID */
function parsePlaylistId(input) {
  if (!input) return DEFAULT_PLAYLIST_ID;
  // 支持 https://music.163.com/playlist?id=123  /  #/playlist?id=123  /  纯数字
  const m = String(input).match(/id=(\d+)/);
  if (m) return m[1];
  const digits = String(input).match(/^(\d+)$/);
  if (digits) return digits[1];
  throw new Error('认不出歌单 ID：' + input);
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          'User-Agent': UA,
          Referer: 'https://music.163.com/',
          Accept: 'application/json, text/plain, */*',
        },
        timeout: 25000,
      },
      (res) => {
        if (res.statusCode !== 200) {
          reject(new Error('HTTP ' + res.statusCode));
          res.resume();
          return;
        }
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(new Error('返回不是 JSON：' + body.slice(0, 120)));
          }
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('请求超时')));
    req.on('error', reject);
  });
}

async function main() {
  const argv = process.argv.slice(2);
  let raw = null;
  const urlIdx = argv.indexOf('--url');
  if (urlIdx >= 0) raw = argv[urlIdx + 1];
  else raw = argv.find((a) => !a.startsWith('--'));

  const playlistId = parsePlaylistId(raw);
  say('歌单 ID:', playlistId);

  const api =
    `https://music.163.com/api/v6/playlist/detail?id=${playlistId}&n=1000`;
  say('请求:', api);

  let json;
  try {
    json = await fetchJson(api);
  } catch (e) {
    say('❌ 拉取失败:', e.message);
    say('  （本地网络问题？歌单是不是被删了？或者设成私密了？）');
    process.exit(1);
  }

  const pl = json && json.playlist;
  if (!pl) {
    say('❌ 返回里没有 playlist 字段，前 200 字：');
    say('  ' + JSON.stringify(json).slice(0, 200));
    process.exit(1);
  }

  // ⚠️ 这里就是那个坑：优先用 trackIds（全量），tracks 只当兜底
  let ids = [];
  if (Array.isArray(pl.trackIds) && pl.trackIds.length) {
    ids = pl.trackIds.map((t) => t && t.id).filter(Boolean);
    say(`trackIds: ${ids.length} 个  ← 用这个（全量）`);
  } else if (Array.isArray(pl.tracks) && pl.tracks.length) {
    ids = pl.tracks.map((t) => t && t.id).filter(Boolean);
    say(`trackIds 缺失，退回 tracks: ${ids.length} 个  ⚠️ 这个通常只有 10 首`);
  }

  if (!ids.length) {
    say('❌ 一个歌曲 ID 都没拿到');
    process.exit(1);
  }

  // 去重（歌单里可能有重复曲目）
  const uniq = Array.from(new Set(ids.map(String))).map(Number);
  if (uniq.length !== ids.length) {
    say(`去重: ${ids.length} -> ${uniq.length}`);
  }

  const out = {
    // 生成信息 —— 方便以后排查"这份数据是什么时候、从哪个歌单来的"
    _comment: '由 tools/fetch-music.js 生成，不要手改',
    generatedAt: new Date().toISOString(),
    playlistId: String(pl.id || playlistId),
    name: pl.name || '',
    trackCount: pl.trackCount || uniq.length,
    trackIds: uniq,
  };

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2) + '\n', 'utf8');

  say('');
  say('✅ 写入', path.relative(ROOT, OUT_FILE));
  say(`   歌单名   : ${out.name}`);
  say(`   trackCount: ${out.trackCount}`);
  say(`   实际 ID 数: ${uniq.length}`);
  say(`   前 3 个   : ${uniq.slice(0, 3).join(', ')}`);
  say('');
  say('   改完记得提交这个文件：');
  say('     git add source/music/playlist.json');
}

main().catch((e) => {
  say('❌ 出错了:', e && e.message ? e.message : e);
  process.exit(1);
});
