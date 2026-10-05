/**
 * 网页后台的发文逻辑
 * ===========================================================================
 *
 * 两件事，故意分开：
 *
 *   buildMarkdown(post)   纯函数：拼出文章的 Markdown 全文（front-matter + 正文）
 *                         —— 不碰网络、不碰文件，所以能单独测
 *   createPost(env, post) 把内容提交到 GitHub 仓库，触发 Cloudflare 自动构建
 *
 * 为什么不直接写文件
 *   Worker 里没有文件系统。站点的内容就是那个公开仓库，所以「发文章」= 调
 *   GitHub 的 REST API 往 source/_posts/ 里提交一个文件。提交完 Cloudflare
 *   Workers Builds 会自己重建上线（和你在本地 git push 完全等价）。
 *
 * 为什么拒绝覆盖同名文件
 *   仓库里已经有同名的 .md 时，GitHub API 要求带上原文件的 sha 才能更新。
 *   这里**故意不做**：后台只用来发新文章，改名/续写走本地那套工具更安全。
 *   （不查 sha 直接 PUT 会 422，前端会看到明确报错，不会静默覆盖。）
 */

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
 * 中文标题目录里前端拿不到拼音库，所以由使用者手填，这里只负责校验。
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
 *          description?:string, content:string, date?:Date}} post
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
  lines.push('cover: ""');
  lines.push('toc: true');
  lines.push('comments: true');
  lines.push('---');
  lines.push('');
  lines.push(post.content.replace(/\r\n/g, '\n').replace(/\s+$/, ''));
  lines.push('');
  return lines.join('\n');
}

function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  const CHUNK = 0x8000; // 一次转太多会爆调用栈
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

/**
 * 提交到 GitHub。
 * 需要的密钥/变量：
 *   GITHUB_TOKEN  细粒度 PAT，权限只要 Contents: Read and write（wrangler secret put）
 *   GITHUB_REPO   形如 zxy6263/vopth-blog（wrangler.jsonc 的 vars，有默认值）
 *   GITHUB_BRANCH 默认 main
 */
export async function createPost(env, post) {
  const repo = env.GITHUB_REPO || 'zxy6263/vopth-blog';
  const branch = env.GITHUB_BRANCH || 'main';
  const token = env.GITHUB_TOKEN;

  if (!token) {
    return { ok: false, status: 500, error: 'GITHUB_TOKEN 没配置（wrangler secret put GITHUB_TOKEN）' };
  }
  if (!post.title || !post.title.trim()) {
    return { ok: false, status: 400, error: '标题不能为空' };
  }
  if (!isValidSlug(post.slug)) {
    return { ok: false, status: 400, error: '文件名只能用小写字母、数字和连字符，且不能以连字符开头' };
  }
  if (!post.content || !post.content.trim()) {
    return { ok: false, status: 400, error: '正文不能为空' };
  }

  const filePath = 'source/_posts/' + post.slug + '.md';
  const markdown = buildMarkdown(post);

  const res = await fetch(
    `https://api.github.com/repos/${repo}/contents/${filePath}`,
    {
      method: 'PUT',
      headers: {
        authorization: 'Bearer ' + token,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        // GitHub 要求带 User-Agent
        'user-agent': 'vopth-admin-worker',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        message: 'post: ' + post.title,
        content: utf8ToBase64(markdown),
        branch: branch
      })
    }
  );

  const bodyText = await res.text();
  let body = {};
  try { body = JSON.parse(bodyText); } catch (e) { /* 不是 JSON 就原样带出去 */ }

  if (!res.ok) {
    // 422 基本就是文件已存在（GitHub 对已存在的路径要求带 sha）
    const exists = res.status === 422 || /already exists|sha/i.test(bodyText);
    return {
      ok: false,
      status: res.status,
      error: exists
        ? `source/_posts/${post.slug}.md 已经存在了。换个文件名，或去本地工具里改它。`
        : (body.message || bodyText.slice(0, 300) || 'GitHub API 返回 ' + res.status)
    };
  }

  return {
    ok: true,
    path: filePath,
    commit: body.commit && body.commit.sha ? body.commit.sha.slice(0, 7) : '',
    htmlUrl: (body.commit && body.commit.html_url) || '',
    markdown: markdown
  };
}
