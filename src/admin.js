/**
 * 网页后台的服务端逻辑
 * ===========================================================================
 *
 * 五件事，都围绕「站点内容就是那个公开仓库」这个事实：
 *
 *   buildMarkdown(post)   纯函数：拼出文章的 Markdown 全文（front-matter + 正文）
 *   createPost(env, post) 发新文章（可选：先传封面图）
 *   listPosts(env)        列出已有文章（文件名 + sha + 从 search.xml 取的中文标题）
 *   deletePost(env, slug) 删文章（顺手删它自己的封面图）
 *   uploadCover(...)      把封面图写进 source/img/covers/
 *
 * 为什么走 GitHub REST API
 *   Worker 里没有文件系统。站点的内容就是仓库，写文件 = 提交一个文件。
 *   提交完 Cloudflare Workers Builds 自己重建上线，和本地 git push 等价。
 *
 * ⚠️ 删除是不可逆的（除非去 GitHub 历史里捞）。所以：
 *     · 只允许删 source/_posts/<slug>.md，slug 必须过 isValidSlug（只含 [a-z0-9-]，
 *       天然挡掉路径穿越）
 *     · 删封面时只认 source/img/covers/ 下的、且不是 default.jpg / _README.md
 *     · 前端还有一道二次确认
 *
 * ⚠️ 传封面 + 发文章是【两次提交】，会触发两次 Cloudflare 构建。
 *    最终结果是对的（第二次构建覆盖第一次），代价只是多跑一遍。
 *    想合成一次提交要用 Git Data API（blobs + tree + commit + ref），
 *    代码量和出错面都大得多，暂时不值当。
 */

const GITHUB_API = 'https://api.github.com';
const POSTS_DIR = 'source/_posts/';
const COVERS_DIR = 'source/img/covers/';
const ALLOWED_IMAGE_EXT = ['jpg', 'jpeg', 'png', 'webp', 'gif'];
// 别的文章/页面共用这些，绝不能删
const COVER_PROTECTED = ['default.jpg', '_README.md'];
// 单张封面图的 base64 上限。浏览器已缩到 1280 宽，正常 200~500KB；
// 给到 4MB 是留余量，同时挡住有人绕过前端直接 POST 巨物把 GitHub API 撑爆。
const COVER_BASE64_LIMIT = 4 * 1024 * 1024;

const SH_OFFSET_MS = 8 * 60 * 60 * 1000;

/** 上海时间，精确到秒。跟 tools/new-post.js 里 todayStamp() 保持同一套算法。 */
export function shanghaiStamp(date) {
  const d = new Date((date ? date.getTime() : Date.now()) + SH_OFFSET_MS);
  const p = (n) => String(n).padStart(2, '0');
  return (
    d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate()) +
    ' ' + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes()) + ':' + p(d.getUTCSeconds())
  );
}

/**
 * 文件名（也是 URL 的一部分）只允许小写字母、数字、连字符。
 * 这条限制同时是安全边界：不含 / 和 . ，天然写不出路径穿越。
 */
export function isValidSlug(slug) {
  return typeof slug === 'string' && /^[a-z0-9][a-z0-9-]{0,80}$/.test(slug);
}

/** YAML 标量太容易踩坑，所有字符串值一律用双引号包起来并转义 */
function yamlString(v) {
  return '"' + String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, ' ') + '"';
}

/**
 * 拼出完整的 Markdown。
 * @param {{title:string, slug:string, category?:string, tags?:string[],
 *          description?:string, content:string, date?:Date, cover?:string}} post
 */
export function buildMarkdown(post) {
  const tags = (post.tags || []).map((t) => String(t).trim()).filter(Boolean);
  const category = (post.category || '').trim();

  const lines = [];
  lines.push('---');
  lines.push('title: ' + yamlString(post.title));
  // 秒用真实值（和本地发帖工具一致）。注意这与 git 提交时间会差十几秒到半分钟：
  // 这里写的是「按下发布的那一刻」，提交发生在之后。
  lines.push('date: ' + shanghaiStamp(post.date));
  // 不写 updated：由 _config.yml 的 updated_option('date') 兜底成发布日期。
  lines.push('tags:');
  for (const t of tags) lines.push('  - ' + yamlString(t));
  lines.push('categories:');
  if (category) lines.push('  - ' + yamlString(category));
  lines.push('description: ' + (post.description ? yamlString(post.description) : '""'));
  lines.push('cover: ' + (post.cover ? yamlString(post.cover) : '""'));
  lines.push('toc: true');
  lines.push('comments: true');
  lines.push('---');
  lines.push('');
  lines.push(post.content.replace(/\r\n/g, '\n').replace(/\s+$/, ''));
  lines.push('');
  return lines.join('\n');
}

// ------------------------------------------------------------------ 小工具

function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  const CHUNK = 0x8000; // 一次转太多会爆调用栈
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

function base64ToUtf8(b64) {
  const clean = String(b64 || '').replace(/\s/g, '');
  const bin = atob(clean);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function repoOf(env) { return env.GITHUB_REPO || 'zxy6263/vopth-blog'; }
function branchOf(env) { return env.GITHUB_BRANCH || 'main'; }

function ghHeaders(env) {
  return {
    authorization: 'Bearer ' + env.GITHUB_TOKEN,
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'user-agent': 'vopth-admin-worker'
  };
}

function noToken() {
  return { ok: false, status: 500, error: 'GITHUB_TOKEN 没配置（wrangler secret put GITHUB_TOKEN）' };
}

/** 读一个文件（返回 GitHub 的原始对象：含 sha / content），不存在返回 null */
async function getFile(env, path) {
  const res = await fetch(
    `${GITHUB_API}/repos/${repoOf(env)}/contents/${path}?ref=${branchOf(env)}`,
    { headers: ghHeaders(env) }
  );
  if (res.status === 404) return null;
  if (!res.ok) {
    const t = await res.text();
    throw new Error('读 ' + path + ' 失败：HTTP ' + res.status + ' ' + t.slice(0, 200));
  }
  return await res.json();
}

/** 写/更新一个文件。sha 传入表示覆盖已有文件。 */
async function putFile(env, path, base64Content, message, sha) {
  const body = { message: message, content: base64Content, branch: branchOf(env) };
  if (sha) body.sha = sha;
  const res = await fetch(`${GITHUB_API}/repos/${repoOf(env)}/contents/${path}`, {
    method: 'PUT',
    headers: Object.assign(ghHeaders(env), { 'content-type': 'application/json' }),
    body: JSON.stringify(body)
  });
  const text = await res.text();
  let json = {};
  try { json = JSON.parse(text); } catch (e) { /* 原样带出去 */ }
  if (!res.ok) {
    return { ok: false, status: res.status, error: json.message || text.slice(0, 300) };
  }
  return {
    ok: true,
    commit: json.commit && json.commit.sha ? json.commit.sha.slice(0, 7) : '',
    htmlUrl: (json.commit && json.commit.html_url) || ''
  };
}

/** 删一个文件（GitHub 要求带 sha） */
async function deleteFile(env, path, sha, message) {
  const res = await fetch(`${GITHUB_API}/repos/${repoOf(env)}/contents/${path}`, {
    method: 'DELETE',
    headers: Object.assign(ghHeaders(env), { 'content-type': 'application/json' }),
    body: JSON.stringify({ message: message, sha: sha, branch: branchOf(env) })
  });
  const text = await res.text();
  if (!res.ok) {
    let m = text.slice(0, 300);
    try { m = JSON.parse(text).message || m; } catch (e) { /* 忽略 */ }
    return { ok: false, status: res.status, error: m };
  }
  return { ok: true };
}

/** 把 base64 的图片写进 source/img/covers/，已存在就覆盖 */
async function uploadCover(env, slug, ext, base64) {
  const cleanExt = String(ext || '').toLowerCase().replace(/^\./, '');
  if (!ALLOWED_IMAGE_EXT.includes(cleanExt)) {
    return { ok: false, status: 400, error: '不支持的图片格式 ' + ext };
  }
  if (!base64 || typeof base64 !== 'string') {
    return { ok: false, status: 400, error: '封面数据为空' };
  }
  if (base64.length > COVER_BASE64_LIMIT) {
    return {
      ok: false,
      status: 413,
      error: '封面图太大了（base64 后 ' + Math.round(base64.length / 1024) + ' KB）。' +
             '浏览器一般会自动缩到 1280 宽，如果还这么大，说明缩放那步没生效。'
    };
  }

  const path = COVERS_DIR + slug + '.' + cleanExt;
  const existing = await getFile(env, path).catch(() => null);
  const r = await putFile(
    env, path, base64,
    (existing ? 'cover: ' : 'cover: add ') + slug,
    existing ? existing.sha : undefined
  );
  if (!r.ok) return r;
  return { ok: true, path: path, cover: '/img/covers/' + slug + '.' + cleanExt, commit: r.commit };
}

// ------------------------------------------------------------------ 对外接口

/**
 * 发新文章。post.cover = { ext, base64 } 时先传封面，再写文章。
 */
export async function createPost(env, post) {
  if (!env.GITHUB_TOKEN) return noToken();
  if (!post.title || !post.title.trim()) return { ok: false, status: 400, error: '标题不能为空' };
  if (!isValidSlug(post.slug)) {
    return { ok: false, status: 400, error: '文件名只能用小写字母、数字和连字符，且不能以连字符开头' };
  }
  if (!post.content || !post.content.trim()) return { ok: false, status: 400, error: '正文不能为空' };

  // ⚠️ 先传封面再写文章 —— 这样第一次构建就已经有图了。
  //    顺序反过来的话，第一次构建的文章会引用一个还不存在的图。
  let coverPath = '';
  let coverCommit = '';
  if (post.cover && post.cover.base64) {
    const up = await uploadCover(env, post.slug, post.cover.ext, post.cover.base64);
    if (!up.ok) return up;
    coverPath = up.cover;
    coverCommit = up.commit;
  }

  const filePath = POSTS_DIR + post.slug + '.md';
  const markdown = buildMarkdown(Object.assign({}, post, { cover: coverPath }));
  const r = await putFile(env, filePath, utf8ToBase64(markdown), 'post: ' + post.title);
  if (!r.ok) {
    const exists = r.status === 422 || /already exists|sha/i.test(r.error || '');
    return {
      ok: false,
      status: r.status,
      error: exists
        ? `${filePath} 已经存在了。换个文件名，或者去「管理文章」里把它删掉。`
        : (r.error || 'GitHub API 返回 ' + r.status)
    };
  }

  return {
    ok: true,
    path: filePath,
    commit: r.commit,
    cover: coverPath,
    coverCommit: coverCommit,
    markdown: markdown
  };
}

/**
 * 列出已有文章。
 * 文件名和 sha 来自 GitHub（删文章必须带 sha）；
 * 中文标题从静态产物 /search.xml 里取 —— 一次 fetch，不占 GitHub 配额，
 * 而且拿到的就是线上正在用的标题。
 */
export async function listPosts(env, request) {
  if (!env.GITHUB_TOKEN) return noToken();

  let files;
  try {
    const res = await fetch(
      `${GITHUB_API}/repos/${repoOf(env)}/contents/${POSTS_DIR}?ref=${branchOf(env)}`,
      { headers: ghHeaders(env) }
    );
    if (!res.ok) {
      const t = await res.text();
      return { ok: false, status: res.status, error: '列目录失败：HTTP ' + res.status + ' ' + t.slice(0, 200) };
    }
    files = await res.json();
  } catch (e) {
    return { ok: false, status: 500, error: '列目录出错：' + String(e && e.message) };
  }

  // slug -> 标题（从 search.xml）
  const titles = {};
  try {
    const origin = new URL(request.url).origin;
    const sm = await env.ASSETS.fetch(new Request(origin + '/search.xml'));
    if (sm.ok) {
      const xml = await sm.text();
      const re = /<title>([\s\S]*?)<\/title>\s*<url>([\s\S]*?)<\/url>/g;
      let m;
      while ((m = re.exec(xml)) !== null) {
        const url = m[2].trim().replace(/\/$/, '');
        const slug = url.split('/').pop();
        if (slug) titles[slug] = m[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim();
      }
    }
  } catch (e) {
    // search.xml 取不到不影响删文章，只是列表显示文件名而不是标题
  }

  const posts = (Array.isArray(files) ? files : [])
    .filter((f) => f.type === 'file' && /\.md$/i.test(f.name) && !/^_/i.test(f.name))
    .map((f) => {
      const slug = f.name.replace(/\.md$/i, '');
      return {
        slug: slug,
        name: f.name,
        sha: f.sha,
        size: f.size,
        title: titles[slug] || ''
      };
    })
    .sort((a, b) => a.slug.localeCompare(b.slug));

  return { ok: true, count: posts.length, posts: posts };
}

/**
 * 删文章。顺手删掉它自己的封面图（只认 front-matter 里写的、且在 covers 目录下的、
 * 不是共用图的那张）。
 */
export async function deletePost(env, slug) {
  if (!env.GITHUB_TOKEN) return noToken();
  if (!isValidSlug(slug)) {
    return { ok: false, status: 400, error: '文件名不合法（只允许小写字母、数字、连字符）' };
  }

  const filePath = POSTS_DIR + slug + '.md';
  let file;
  try {
    file = await getFile(env, filePath);
  } catch (e) {
    return { ok: false, status: 500, error: String(e && e.message) };
  }
  if (!file) return { ok: false, status: 404, error: `没找到 ${filePath}` };

  // 从 front-matter 里找 cover，只删这个文件自己的封面
  let coverToDelete = '';
  try {
    const text = base64ToUtf8(file.content || '');
    const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
    if (fm) {
      const m = /^cover:\s*"?([^"\r\n]+)"?\s*$/m.exec(fm[1]);
      if (m) {
        let c = m[1].trim().replace(/^\/+/, ''); // img/covers/xxx.jpg
        if (c && !c.includes('..')) {
          const base = c.split('/').pop();
          if (!COVER_PROTECTED.includes(base)) coverToDelete = c;
        }
      }
    }
  } catch (e) {
    // 解析失败就不删封面，只删文章 —— 少删总比误删好
  }

  const r = await deleteFile(env, filePath, file.sha, 'delete: ' + slug);
  if (!r.ok) return { ok: false, status: r.status, error: r.error };

  let coverDeleted = '';
  let coverNote = '';
  if (coverToDelete) {
    try {
      const cf = await getFile(env, coverToDelete);
      if (cf && cf.sha) {
        const cr = await deleteFile(env, coverToDelete, cf.sha, 'delete cover: ' + slug);
        if (cr.ok) coverDeleted = coverToDelete;
        else coverNote = '文章已删，但封面没删掉：' + cr.error;
      }
    } catch (e) {
      coverNote = '文章已删，但封面没删掉：' + String(e && e.message);
    }
  }

  return { ok: true, deleted: filePath, coverDeleted: coverDeleted, note: coverNote };
}
