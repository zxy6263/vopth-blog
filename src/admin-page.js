/**
 * 网页后台的页面本体
 * ===========================================================================
 *
 * 为什么把 HTML 放在 Worker 里，而不是放进 source/ 当静态页
 *   1) 放进 source/ 就会出现在公开仓库和公开站点上。虽然页面里没有密钥，
 *      但「后台入口」暴露给所有人扫，只会招来无谓的尝试。
 *   2) 放在 Worker 里，就能在**返回页面之前**先校验 Cloudflare Access ——
 *      没通过鉴权的人连这个页面的 HTML 都拿不到（不是"能打开但点了没用"）。
 *   3) 代价只有一个：/admin/ 的请求算 Worker 请求（会计费），而它一天也开不了几次。
 *
 * 注意：下面的 HTML/JS 里刻意不用模板字符串（反引号），
 * 因为这个文件本身就是用模板字符串包起来的，嵌套会打架。一律用 + 拼接。
 *
 * ⚠️ 用 String.raw 而不是普通模板字符串 —— 这一条是血的教训（2026-10-06）：
 *    页面脚本里有 '\n\n' 这种换行转义，普通模板字符串会把它【求值成真正的换行】，
 *    于是产出的 <script> 里字符串中间出现裸换行 → SyntaxError → 整段脚本不执行。
 *    症状是「按钮全按不了、自动保存也没了」，而页面看起来完全正常，静态读代码
 *    也看不出来。String.raw 保留反斜杠原样，'\n' 就真的是 JS 的换行转义了。
 *
 *    配套：tools/check-admin-page.js 会把产出的 <script> 抽出来做语法检查，
 *    改完这个文件务必跑一次（npm run check:admin）。
 */

export const ADMIN_PAGE = String.raw`<!doctype html>
<html lang="zh-CN" data-theme="auto">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<title>发文章 · vopth</title>
<style>
  :root {
    --bg: #f6f7fb; --card: #fff; --text: #2c2f38; --muted: #8a8f9c;
    --line: #e6e8ef; --accent: #4a6cf7; --accent-2: #7c5cff;
    --ok: #17a673; --bad: #e0524d;
  }
  html[data-theme="dark"] {
    --bg: #16181d; --card: #1e2128; --text: #e6e8ef; --muted: #8a8f9c;
    --line: #2c3038;
  }
  @media (prefers-color-scheme: dark) {
    html[data-theme="auto"] {
      --bg: #16181d; --card: #1e2128; --text: #e6e8ef; --muted: #8a8f9c;
      --line: #2c3038;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 16px 14px 60px; background: var(--bg); color: var(--text);
    font: 15px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
    -webkit-text-size-adjust: 100%;
  }
  .wrap { max-width: 820px; margin: 0 auto; }
  header { display: flex; align-items: baseline; gap: 10px; margin-bottom: 16px; flex-wrap: wrap; }
  h1 { font-size: 20px; margin: 0; letter-spacing: .5px; }
  header .who { color: var(--muted); font-size: 13px; }
  .card {
    background: var(--card); border: 1px solid var(--line); border-radius: 12px;
    padding: 16px; margin-bottom: 14px;
  }
  label { display: block; font-size: 13px; color: var(--muted); margin: 0 0 6px; }
  .row { display: flex; gap: 12px; flex-wrap: wrap; }
  .row > div { flex: 1 1 220px; }
  input[type=text], textarea {
    width: 100%; padding: 11px 12px; border: 1px solid var(--line); border-radius: 9px;
    background: var(--bg); color: var(--text); font: inherit; outline: none;
  }
  input[type=text]:focus, textarea:focus { border-color: var(--accent); }
  textarea { min-height: 46vh; resize: vertical; font-family: ui-monospace, Consolas, monospace; font-size: 14px; line-height: 1.7; }
  .hint { font-size: 12px; color: var(--muted); margin-top: 6px; }
  .actions { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
  button {
    padding: 11px 22px; border: 0; border-radius: 9px; font: inherit; font-weight: 600;
    color: #fff; cursor: pointer;
    background: linear-gradient(90deg, var(--accent), var(--accent-2));
  }
  button[disabled] { opacity: .55; cursor: not-allowed; }
  button.ghost { background: transparent; color: var(--muted); border: 1px solid var(--line); font-weight: 400; }
  #msg { margin-top: 14px; padding: 12px 14px; border-radius: 9px; display: none; font-size: 14px; white-space: pre-wrap; word-break: break-word; }
  #msg.ok { display: block; background: rgba(23,166,115,.12); color: var(--ok); }
  #msg.bad { display: block; background: rgba(224,82,77,.12); color: var(--bad); }
  #msg a { color: inherit; }
  footer { color: var(--muted); font-size: 12px; text-align: center; margin-top: 22px; }
  .draft { font-size: 12px; color: var(--muted); }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>发文章</h1>
    <span class="who" id="who"></span>
  </header>

  <div class="card">
    <label for="title">标题</label>
    <input type="text" id="title" placeholder="文章标题" autocomplete="off">

    <div class="row" style="margin-top:14px">
      <div>
        <label for="slug">文件名（URL 的一部分）</label>
        <input type="text" id="slug" placeholder="my-post" autocomplete="off">
        <div class="hint">小写字母、数字、连字符</div>
      </div>
      <div>
        <label for="category">分类</label>
        <input type="text" id="category" placeholder="随笔" autocomplete="off">
      </div>
    </div>

    <div class="row" style="margin-top:14px">
      <div>
        <label for="tags">标签（逗号分隔）</label>
        <input type="text" id="tags" placeholder="折腾记录, Cloudflare" autocomplete="off">
      </div>
      <div>
        <label for="desc">摘要</label>
        <input type="text" id="desc" placeholder="留空则用正文开头" autocomplete="off">
      </div>
    </div>
  </div>

  <div class="card">
    <label for="content">正文（Markdown）</label>
    <textarea id="content" placeholder="写点什么…"></textarea>
    <div class="hint">图片请放在仓库 source/img/ 里，正文用 /img/文件名 引用（手机上可以先写文字，图片回电脑补）</div>
  </div>

  <div class="actions">
    <button id="publish">发布</button>
    <button id="clear" class="ghost">清空</button>
    <span class="draft" id="draftInfo"></span>
  </div>

  <div id="msg"></div>

  <footer>提交后会推送到 GitHub，Cloudflare 自动构建，约 1~2 分钟上线</footer>
</div>

<script>
(function () {
  'use strict';
  var KEY = 'vopth-admin-draft';
  var FIELDS = ['title', 'slug', 'category', 'tags', 'desc', 'content'];
  var $ = function (id) { return document.getElementById(id); };
  var msg = $('msg');

  function say(kind, text, linkHtml) {
    msg.className = kind;
    msg.textContent = text;
    if (linkHtml) { msg.innerHTML = ''; msg.appendChild(document.createTextNode(text + ' ')); msg.insertAdjacentHTML('beforeend', linkHtml); }
  }

  function collect() {
    var o = {};
    FIELDS.forEach(function (f) { o[f] = $(f).value; });
    return o;
  }

  function saveDraft() {
    try {
      localStorage.setItem(KEY, JSON.stringify(collect()));
      $('draftInfo').textContent = '草稿已自动保存在这台设备上（' + new Date().toLocaleTimeString('zh-CN', { hour12: false }) + '）';
    } catch (e) {
      $('draftInfo').textContent = '（这台设备不让存草稿，注意别刷新）';
    }
  }

  function loadDraft() {
    var raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) { return; }
    if (!raw) return;
    try {
      var o = JSON.parse(raw);
      FIELDS.forEach(function (f) { if (o[f] !== undefined) $(f).value = o[f]; });
      $('draftInfo').textContent = '已恢复上次未发布的草稿';
    } catch (e) { /* 草稿坏了就当没有 */ }
  }

  FIELDS.forEach(function (f) {
    $(f).addEventListener('input', function () {
      clearTimeout(window.__draftTimer);
      window.__draftTimer = setTimeout(saveDraft, 600);
    });
  });

  $('clear').addEventListener('click', function () {
    if (!confirm('清空当前内容和草稿？')) return;
    FIELDS.forEach(function (f) { $(f).value = ''; });
    try { localStorage.removeItem(KEY); } catch (e) {}
    $('draftInfo').textContent = '';
    msg.className = '';
  });

  $('publish').addEventListener('click', function () {
    var data = collect();
    if (!data.title.trim()) { say('bad', '标题不能为空'); return; }
    if (!data.slug.trim()) { say('bad', '文件名不能为空'); return; }
    if (!data.content.trim()) { say('bad', '正文不能为空'); return; }
    if (!/^[a-z0-9][a-z0-9-]*$/.test(data.slug.trim())) {
      say('bad', '文件名只能用小写字母、数字和连字符，且不能以连字符开头');
      return;
    }

    var btn = $('publish');
    btn.disabled = true;
    say('', '正在提交…');
    msg.className = '';

    fetch('/admin/api/post', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        title: data.title.trim(),
        slug: data.slug.trim(),
        category: data.category.trim(),
        tags: data.tags.split(/[,，]/).map(function (t) { return t.trim(); }).filter(Boolean),
        description: data.desc.trim(),
        content: data.content
      })
    }).then(function (r) {
      return r.json().then(function (j) { return { status: r.status, body: j }; });
    }).then(function (res) {
      btn.disabled = false;
      if (res.body && res.body.ok) {
        try { localStorage.removeItem(KEY); } catch (e) {}
        $('draftInfo').textContent = '';
        say('ok', '提交成功（' + res.body.path + '，commit ' + res.body.commit + '）。Cloudflare 正在构建，约 1~2 分钟后上线。');
      } else {
        say('bad', '提交失败：' + ((res.body && res.body.error) || ('HTTP ' + res.status)));
      }
    }).catch(function (e) {
      btn.disabled = false;
      // 「Failed to fetch」这个原生报错对使用者毫无信息量，所以补上最可能的原因。
      // 最常见的一种：请求被 Cloudflare Access 又拦了一次、跳去了登录页，
      // 而那个地址是跨域的，浏览器就只报一句 Failed to fetch。
      say('bad',
        '请求出错：' + (e && e.message ? e.message : e) + '\n\n' +
        '最可能的原因：这个请求又被 Cloudflare Access 拦了一次（跳去了登录页）。\n' +
        '按 F12 → Network，看那条请求是不是 302 到 cloudflareaccess.com ——\n' +
        '如果是，说明页面和接口挂在了两个不同的 Access 应用上（同一个域名下会互相抢登录 cookie）。');
    });
  });

  loadDraft();
})();
</script>
</body>
</html>
`;
