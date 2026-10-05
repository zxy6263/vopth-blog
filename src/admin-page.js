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
<title>后台 · vopth</title>
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
  header { display: flex; align-items: baseline; gap: 10px; margin-bottom: 12px; flex-wrap: wrap; }
  h1 { font-size: 20px; margin: 0; letter-spacing: .5px; }
  header .who { color: var(--muted); font-size: 13px; }

  .tabs { display: flex; gap: 8px; margin-bottom: 14px; }
  .tabs button {
    padding: 8px 18px; border-radius: 999px; cursor: pointer; font: inherit; font-weight: 400;
    background: transparent; color: var(--muted); border: 1px solid var(--line);
  }
  .tabs button.on {
    background: linear-gradient(90deg, var(--accent), var(--accent-2));
    color: #fff; border-color: transparent; font-weight: 600;
  }

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
  textarea { min-height: 44vh; resize: vertical; font-family: ui-monospace, Consolas, monospace; font-size: 14px; line-height: 1.7; }
  input[type=file] { font: inherit; color: var(--text); }

  /* Markdown 快捷工具条：往正文里插标签片段 */
  .md-tools { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 8px; }
  .md-tools button {
    padding: 5px 12px; font-size: 13px; font-weight: 400; border-radius: 7px;
    color: var(--text); background: var(--bg); border: 1px solid var(--line);
    box-shadow: none;
  }
  .md-tools button:hover { border-color: var(--accent); color: var(--accent); }
  .md-tools .sep { width: 1px; background: var(--line); margin: 2px 2px; }

  /* 打字时的标签候选 */
  .suggest {
    display: none; margin: 0 0 8px; padding: 6px; border: 1px solid var(--line);
    border-radius: 8px; background: var(--card); max-height: 180px; overflow: auto;
  }
  .suggest.on { display: block; }
  .suggest button {
    display: block; width: 100%; text-align: left; padding: 7px 10px; margin: 0;
    font-size: 13px; font-weight: 400; border-radius: 6px; color: var(--text);
    background: transparent; box-shadow: none;
  }
  .suggest button:hover, .suggest button.sel { background: var(--bg); color: var(--accent); }
  .suggest .tag { font-family: ui-monospace, Consolas, monospace; }
  .suggest .desc { color: var(--muted); font-size: 12px; margin-left: 8px; }

  input[type=datetime-local] {
    width: 100%; padding: 10px 12px; border: 1px solid var(--line); border-radius: 9px;
    background: var(--bg); color: var(--text); font: inherit; outline: none;
  }
  input[type=datetime-local]:focus { border-color: var(--accent); }

  .sched-row {
    display: flex; align-items: center; gap: 10px; padding: 9px 2px;
    border-bottom: 1px solid var(--line);
  }
  .sched-row:last-child { border-bottom: 0; }
  .sched-badge {
    flex: 0 0 auto; font-size: 12px; padding: 2px 8px; border-radius: 999px;
    background: var(--bg); color: var(--muted); border: 1px solid var(--line);
  }
  .hint { font-size: 12px; color: var(--muted); margin-top: 6px; }
  .actions { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
  button {
    padding: 11px 22px; border: 0; border-radius: 9px; font: inherit; font-weight: 600;
    color: #fff; cursor: pointer;
    background: linear-gradient(90deg, var(--accent), var(--accent-2));
  }
  button[disabled] { opacity: .55; cursor: not-allowed; }
  button.ghost { background: transparent; color: var(--muted); border: 1px solid var(--line); font-weight: 400; }
  button.danger { background: none; color: var(--bad); border: 1px solid var(--bad); font-weight: 400; padding: 7px 14px; }

  #msg { margin-top: 14px; padding: 12px 14px; border-radius: 9px; display: none; font-size: 14px; white-space: pre-wrap; word-break: break-word; }
  #msg.ok { display: block; background: rgba(23,166,115,.12); color: var(--ok); }
  #msg.bad { display: block; background: rgba(224,82,77,.12); color: var(--bad); }

  .cover-box { display: flex; gap: 14px; align-items: flex-start; flex-wrap: wrap; }
  .cover-preview {
    width: 160px; height: 96px; border-radius: 9px; border: 1px dashed var(--line);
    background: var(--bg) center/cover no-repeat; display: flex; align-items: center;
    justify-content: center; color: var(--muted); font-size: 12px; flex: 0 0 auto;
  }

  .post-row {
    display: flex; align-items: center; gap: 12px; padding: 11px 2px;
    border-bottom: 1px solid var(--line);
  }
  .post-row:last-child { border-bottom: 0; }
  .post-info { flex: 1 1 auto; min-width: 0; }
  .post-title { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .post-slug { font-size: 12px; color: var(--muted); font-family: ui-monospace, Consolas, monospace; }
  .post-row.gone { opacity: .4; }

  footer { color: var(--muted); font-size: 12px; text-align: center; margin-top: 22px; }
  .draft { font-size: 12px; color: var(--muted); }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>后台</h1>
    <span class="who" id="who">vopth.xyz</span>
  </header>

  <div class="tabs">
    <button id="tabBtnWrite" class="on">写文章</button>
    <button id="tabBtnManage">管理文章</button>
  </div>

  <!-- ================= 写文章 ================= -->
  <div id="tabWrite">
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

      <div class="row" style="margin-top:14px">
        <div>
          <label for="publishAt">定时发布（留空 = 立刻发）</label>
          <input type="datetime-local" id="publishAt">
        </div>
        <div>
          <label for="deleteAt">限时删除（留空 = 不删）</label>
          <input type="datetime-local" id="deleteAt">
        </div>
      </div>
      <div class="hint">
        定时发布：到点之前站上完全看不到这篇。<br>
        限时删除：发出去之后到点自动删掉（比如临时公告）。<br>
        两者都靠 Worker 的定时任务，<b>每 5 分钟检查一次</b>，所以最晚晚 5 分钟 —— 别把时间卡太死。
      </div>
    </div>

    <div class="card">
      <label>封面图</label>
      <div class="cover-box">
        <div class="cover-preview" id="coverPreview">未选择</div>
        <div style="flex:1 1 260px">
          <input type="file" id="coverFile" accept="image/*">
          <div class="hint">
            选好后会在浏览器里自动缩到 1280 宽再上传，手机照片也能用。<br>
            封面不进草稿（太大），刷新页面要重选。留空就用默认封面。
          </div>
          <div style="margin-top:8px"><button class="ghost" id="coverClear" type="button">不用封面</button></div>
        </div>
      </div>
    </div>

    <div class="card">
      <label for="content">正文（Markdown）</label>
      <div class="md-tools" id="mdTools">
        <button type="button" data-insert="skeleton">文章骨架</button>
        <span class="sep"></span>
        <button type="button" data-insert="note-info">提示</button>
        <button type="button" data-insert="note-warning">警告</button>
        <button type="button" data-insert="note-danger">危险</button>
        <button type="button" data-insert="label">标签</button>
        <button type="button" data-insert="btn">按钮</button>
        <button type="button" data-insert="tabs">分栏</button>
        <button type="button" data-insert="hide">折叠</button>
        <span class="sep"></span>
        <button type="button" data-insert="code">代码块</button>
        <button type="button" data-insert="img">图片</button>
      </div>
      <div class="suggest" id="suggest"></div>
      <textarea id="content" placeholder="写点什么…"></textarea>
      <div class="hint">图片请放在仓库 source/img/ 里，正文用 /img/文件名 引用（手机上可以先写文字，图片回电脑补）</div>
    </div>

    <div class="actions">
      <button id="publish">发布</button>
      <button id="clear" class="ghost">清空</button>
      <span class="draft" id="draftInfo"></span>
    </div>
  </div>

  <!-- ================= 管理文章 ================= -->
  <div id="tabManage" style="display:none">
    <div class="card">
      <div class="actions" style="justify-content:space-between">
        <span id="listInfo" class="hint" style="margin:0">正在读取…</span>
        <button class="ghost" id="refresh">刷新</button>
      </div>
      <div id="list" style="margin-top:10px"></div>
      <div class="hint" style="margin-top:12px">
        删除会同时删掉这篇自己的封面图（共用的默认封面不会被碰）。删完约 1~2 分钟下线。<br>
        想改已发表的文章，请回本地用编辑器改 —— 后台只负责发新的和删旧的。
      </div>
    </div>

    <div class="card">
      <div class="actions" style="justify-content:space-between">
        <span id="schedInfo" class="hint" style="margin:0">正在读取排期…</span>
        <span>
          <button class="ghost" id="schedRun">立即执行一次</button>
          <button class="ghost" id="schedRefresh">刷新</button>
        </span>
      </div>
      <div id="schedList" style="margin-top:10px"></div>
      <div class="hint" id="cronInfo" style="margin-top:10px"></div>
      <div class="hint" style="margin-top:10px">
        这里是还没执行的定时任务（定时发布 / 限时删除）。Worker 每 5 分钟检查一次。<br>
        「立即执行一次」是手动跑同一段逻辑 —— 如果手动能跑、定时不跑，那就是 cron 没生效。
      </div>
    </div>
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
  var pickedCover = null;

  function say(kind, text) {
    msg.className = kind || '';
    msg.textContent = text || '';
  }

  // ---------------------------------------------------------- 标签页
  function switchTab(which) {
    var write = which === 'write';
    $('tabWrite').style.display = write ? '' : 'none';
    $('tabManage').style.display = write ? 'none' : '';
    $('tabBtnWrite').className = write ? 'on' : '';
    $('tabBtnManage').className = write ? '' : 'on';
    if (!write) { loadPosts(); loadSched(); }
  }
  $('tabBtnWrite').addEventListener('click', function () { switchTab('write'); });
  $('tabBtnManage').addEventListener('click', function () { switchTab('manage'); });

  // ---------------------------------------------------------- 草稿（只存文字，不存封面）
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

  // ---------------------------------------------------------- 封面：先在浏览器里缩小
  //
  // 手机照片动辄 5~10MB，直接 base64 上传会把请求和 GitHub API 都撑爆。
  // 用 canvas 缩到 1280 宽、输出 JPEG 0.85，通常落到 200~500KB。
  // 浏览器会自动应用 EXIF 旋转，所以竖着拍的照片不会躺倒。
  function shrinkImage(file) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      var url = URL.createObjectURL(file);
      img.onload = function () {
        try {
          var maxW = 1280;
          var w = img.naturalWidth || img.width;
          var h = img.naturalHeight || img.height;
          if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
          var c = document.createElement('canvas');
          c.width = w; c.height = h;
          c.getContext('2d').drawImage(img, 0, 0, w, h);
          URL.revokeObjectURL(url);
          var dataUrl = c.toDataURL('image/jpeg', 0.85);
          var b64 = dataUrl.split(',')[1] || '';
          resolve({ ext: 'jpg', base64: b64, bytes: Math.round(b64.length * 3 / 4), w: w, h: h, name: file.name });
        } catch (e) {
          URL.revokeObjectURL(url);
          reject(e);
        }
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error('这张图片读不出来，换个格式试试'));
      };
      img.src = url;
    });
  }

  $('coverFile').addEventListener('change', function () {
    var f = this.files && this.files[0];
    if (!f) return;
    say('', '正在处理图片…');
    shrinkImage(f).then(function (r) {
      pickedCover = r;
      $('coverPreview').style.backgroundImage = 'url(data:image/jpeg;base64,' + r.base64 + ')';
      $('coverPreview').textContent = '';
      say('ok', '封面已就绪：' + r.w + 'x' + r.h + '，约 ' + Math.round(r.bytes / 1024) + ' KB（已从原图缩小）');
    }).catch(function (e) {
      say('bad', '封面处理失败：' + (e && e.message ? e.message : e));
    });
  });
  $('coverClear').addEventListener('click', function () {
    pickedCover = null;
    $('coverFile').value = '';
    $('coverPreview').style.backgroundImage = '';
    $('coverPreview').textContent = '未选择';
    say('', '');
  });

  // ---------------------------------------------------------- Markdown 快捷插入
  //
  // 语法全部照抄站点里那篇《Hexo 写作速查》，不凭记忆写 —— 主题版本不同语法会有差异。
  // 行为：把片段插到光标处（有选中文字就用选中的文字替换占位），插完选中占位文字，
  // 这样直接打字就能盖掉它，不用手动删。
  // ⚠️ 三个反引号必须这样拼出来，不能直接写。
  //    这个文件整体包在模板字符串里（String.raw 那种），直接写反引号会把模板
  //    提前结束，整份文件变成语法错误。
  //    2026-10-06 连踩两次：第一次是在代码块片段里写了三个反引号；
  //    第二次更离谱 —— 是在【解释这件事的注释】里写了反引号当例子。
  //    所以这段注释里一个反引号都不能有，只能说"反引号"三个字。
  //    幸好 tools/check-admin-page.js 能查出来（现在它会先查文本再导入，
  //    否则会先炸在导入阶段、给出看不懂的错误）。
  var FENCE = '\u0060\u0060\u0060';

  var SNIPPETS = {
    'note-info':    { pre: '{% note info flat %}\n',    post: '\n{% endnote %}',  ph: '这里写提示内容' },
    'note-warning': { pre: '{% note warning flat %}\n', post: '\n{% endnote %}',  ph: '这里写警告内容' },
    'note-danger':  { pre: '{% note danger flat %}\n',  post: '\n{% endnote %}',  ph: '这里写危险内容' },
    'label':        { pre: '{% label ',                post: ' primary %}',      ph: '文字' },
    'btn':          { pre: "{% btn '",                  post: "',链接文字,fas fa-link,outline %}", ph: 'https://example.com' },
    'tabs':         { pre: '{% tabs 组名, 1 %}\n<!-- tab 标签一 -->\n',
                      post: '\n<!-- endtab -->\n\n<!-- tab 标签二 -->\n内容二\n<!-- endtab -->\n{% endtabs %}',
                      ph: '内容一' },
    'hide':         { pre: '{% hideToggle ',            post: ' %}\n这里写被折叠的内容\n{% endhideToggle %}', ph: '点击展开' },
    'code':         { pre: FENCE + '\n',                post: '\n' + FENCE,      ph: '代码' },
    'img':          { pre: '![',                        post: '](/img/图片文件名)', ph: '图片描述' }
  };

  var SKELETON = [
    '先用一两句话把事情说清楚：发生了什么、结论是什么。',
    '',
    '## 背景',
    '',
    '为什么要写这篇。',
    '',
    '## 正文',
    '',
    '主体内容。',
    '',
    '## 最后',
    '',
    '收个尾，或者留个待办。'
  ].join('\n');

  function insertInto(textarea, text, selStart, selEnd, selectFrom, selectTo) {
    var before = textarea.value.slice(0, selStart);
    var after = textarea.value.slice(selEnd);
    textarea.value = before + text + after;
    textarea.focus();
    var a = selStart + selectFrom;
    var b = selStart + selectTo;
    textarea.setSelectionRange(a, b);
    // 手动触发一次 input，让草稿保存跟上
    textarea.dispatchEvent(new Event('input'));
  }

  $('mdTools').addEventListener('click', function (ev) {
    var btn = ev.target.closest ? ev.target.closest('button[data-insert]') : null;
    if (!btn) return;
    var key = btn.getAttribute('data-insert');
    var ta = $('content');
    var s = ta.selectionStart;
    var e = ta.selectionEnd;
    var selected = ta.value.slice(s, e);

    if (key === 'skeleton') {
      if (ta.value.trim() && !confirm('正文里已经有内容了，确定插入骨架吗？（会插在光标处）')) return;
      insertInto(ta, SKELETON, s, e, 0, SKELETON.length);
      return;
    }

    var snap = SNIPPETS[key];
    if (!snap) return;
    var body = selected || snap.ph;
    var text = snap.pre + body + snap.post;
    // 有选中文字就整段选中插进去的内容，没选中就只选中占位文字方便直接改写
    if (selected) insertInto(ta, text, s, e, 0, text.length);
    else insertInto(ta, text, s, e, snap.pre.length, snap.pre.length + snap.ph.length);
  });

  // ---------------------------------------------------------- 打字时的标签候选
  //
  // 在正文里敲 {%、{% no 这种就弹候选，回车 / Tab / 点击补全。
  // 只在"光标前面正好是 {% + 可选的部分标签名"时才弹，其余时候一律不打扰。
  // 候选框故意放在正文上方（而不是跟着光标浮动）—— 手机上软键盘一弹，
  // 跟着光标走的小浮层很容易被挡住或错位，固定位置反而好用。
  var TAG_LIST = [
    ['note', '提示框 {% note info flat %}'],
    ['endnote', '结束提示框'],
    ['label', '行内标签'],
    ['btn', '按钮'],
    ['tabs', '分栏'],
    ['tab', '分栏里的一栏'],
    ['endtab', '结束一栏'],
    ['endtabs', '结束分栏'],
    ['hideToggle', '折叠块'],
    ['endhideToggle', '结束折叠'],
    ['timeline', '时间线'],
    ['series', '系列'],
    ['score', '评分'],
    ['asset_img', '文章资源图片'],
    ['inlineImg', '行内图片'],
    ['raw', '不解析的内容'],
    ['endraw', '结束 raw']
  ];
  // 标签名 -> 工具条里那套片段（不是每个标签都有完整片段，没有的就只补名字）
  var SNAP_BY_TAG = {
    note: 'note-info',
    label: 'label',
    btn: 'btn',
    tabs: 'tabs',
    hideToggle: 'hide'
  };
  var sugHits = [];
  var sugIdx = -1;

  function hideSuggest() {
    sugHits = [];
    sugIdx = -1;
    var box = $('suggest');
    box.className = 'suggest';
    box.innerHTML = '';
  }

  function markSuggest() {
    var btns = $('suggest').children;
    for (var i = 0; i < btns.length; i++) btns[i].className = (i === sugIdx ? 'sel' : '');
  }

  function showSuggest() {
    var ta = $('content');
    var m = /\{%\s*([a-zA-Z_]*)$/.exec(ta.value.slice(0, ta.selectionStart));
    if (!m) { hideSuggest(); return; }
    var q = m[1].toLowerCase();
    var hits = TAG_LIST.filter(function (t) { return t[0].toLowerCase().indexOf(q) === 0; });
    if (!hits.length) { hideSuggest(); return; }

    sugHits = hits;
    sugIdx = 0;
    var box = $('suggest');
    box.innerHTML = '';
    hits.forEach(function (t, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = i === 0 ? 'sel' : '';
      var s1 = document.createElement('span');
      s1.className = 'tag';
      s1.textContent = '{% ' + t[0] + ' %}';
      var s2 = document.createElement('span');
      s2.className = 'desc';
      s2.textContent = t[1];
      b.appendChild(s1);
      b.appendChild(s2);
      b.addEventListener('click', function () { applySuggest(i); });
      box.appendChild(b);
    });
    box.className = 'suggest on';
  }

  function applySuggest(i) {
    if (i < 0 || i >= sugHits.length) { hideSuggest(); return; }
    var ta = $('content');
    var name = sugHits[i][0];
    var snapKey = SNAP_BY_TAG[name];
    var snap = snapKey ? SNIPPETS[snapKey] : null;
    var text, from, to;
    if (snap) {
      text = snap.pre + snap.ph + snap.post;
      from = snap.pre.length;
      to = snap.pre.length + snap.ph.length;
    } else {
      text = name;
      from = text.length;
      to = text.length;
    }
    // 把光标前那段 "{%xxx" 一起替换成完整片段
    var start = ta.value.lastIndexOf('{%', ta.selectionStart);
    if (start < 0) start = ta.selectionStart;
    var caret = ta.selectionStart;
    ta.value = ta.value.slice(0, start) + text + ta.value.slice(caret);
    ta.focus();
    ta.setSelectionRange(start + from, start + to);
    ta.dispatchEvent(new Event('input'));
    hideSuggest();
  }

  $('content').addEventListener('input', showSuggest);
  $('content').addEventListener('blur', function () { setTimeout(hideSuggest, 250); });
  $('content').addEventListener('keydown', function (ev) {
    if (!sugHits.length) return;
    if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      sugIdx = (sugIdx + 1) % sugHits.length;
      markSuggest();
    } else if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      sugIdx = (sugIdx - 1 + sugHits.length) % sugHits.length;
      markSuggest();
    } else if (ev.key === 'Enter' || ev.key === 'Tab') {
      ev.preventDefault();
      applySuggest(sugIdx);
    } else if (ev.key === 'Escape') {
      hideSuggest();
    }
  });

  // ---------------------------------------------------------- 清空 / 发布
  $('clear').addEventListener('click', function () {
    if (!confirm('清空当前内容和草稿？')) return;
    FIELDS.forEach(function (f) { $(f).value = ''; });
    try { localStorage.removeItem(KEY); } catch (e) {}
    $('draftInfo').textContent = '';
    say('', '');
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

    var body = {
      title: data.title.trim(),
      slug: data.slug.trim(),
      category: data.category.trim(),
      tags: data.tags.split(/[,，]/).map(function (t) { return t.trim(); }).filter(Boolean),
      description: data.desc.trim(),
      content: data.content
    };
    if (pickedCover) body.cover = { ext: pickedCover.ext, base64: pickedCover.base64 };

    // 定时发布 / 限时删除。
    // datetime-local 的值形如 2026-10-07T14:30；new Date(...) 按【本机时区】解释，
    // 转成 epoch 秒发给 Worker（Worker 那边不猜时区，避免两端各解释一次）。
    var pubRaw = $('publishAt').value;
    var delRaw = $('deleteAt').value;
    var publishAt = pubRaw ? Math.floor(new Date(pubRaw).getTime() / 1000) : 0;
    var deleteAt = delRaw ? Math.floor(new Date(delRaw).getTime() / 1000) : 0;
    var nowSec = Math.floor(Date.now() / 1000);

    if (publishAt && !(publishAt > nowSec)) { say('bad', '定时发布的时间必须是将来'); return; }
    if (deleteAt && !(deleteAt > nowSec)) { say('bad', '限时删除的时间必须是将来'); return; }
    if (publishAt && deleteAt && deleteAt <= publishAt) { say('bad', '删除时间必须晚于发布时间'); return; }
    if (publishAt) body.publishAt = publishAt;

    var btn = $('publish');
    btn.disabled = true;
    say('', publishAt
      ? '正在排期（定时发布）…'
      : (pickedCover ? '正在上传封面并提交文章…' : '正在提交…'));

    fetch(publishAt ? '/admin/api/schedule' : '/admin/api/post', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(body)
    }).then(function (r) {
      return r.json().then(function (j) { return { status: r.status, body: j }; });
    }).then(function (res) {
      if (!res.body || !res.body.ok) {
        btn.disabled = false;
        say('bad', (publishAt ? '排期失败：' : '提交失败：') + ((res.body && res.body.error) || ('HTTP ' + res.status)));
        return;
      }
      try { localStorage.removeItem(KEY); } catch (e) {}
      $('draftInfo').textContent = '';

      if (publishAt) {
        // 定时发布：还没提交，先把排期结果说清楚
        $('publishAt').value = '';
        btn.disabled = false;
        var st = '已排期：' + new Date(publishAt * 1000).toLocaleString('zh-CN', { hour12: false }) + ' 自动发布';
        if (deleteAt) st += '\n并会在 ' + new Date(deleteAt * 1000).toLocaleString('zh-CN', { hour12: false }) + ' 自动删除';
        st += '\n\n到点之前站上完全看不到这篇。Worker 每 5 分钟检查一次，最晚晚 5 分钟。';
        say('ok', st);
        return;
      }

      // 立即发布成功。若还设了"限时删除"，接着排一个删除任务
      var t = '提交成功（' + res.body.path + '，commit ' + res.body.commit + '）';
      if (res.body.cover) t += '\n封面也传好了：' + res.body.cover;
      if (deleteAt) {
        say('', '文章已提交，正在排「限时删除」…');
        fetch('/admin/api/schedule-delete', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ slug: body.slug, deleteAt: deleteAt })
        }).then(function (r2) {
          return r2.json().then(function (j) { return { status: r2.status, body: j }; });
        }).then(function (r2) {
          btn.disabled = false;
          if (r2.body && r2.body.ok) {
            $('deleteAt').value = '';
            t += '\n并已排期：' + new Date(deleteAt * 1000).toLocaleString('zh-CN', { hour12: false }) + ' 自动删除';
          } else {
            t += '\n⚠️ 但「限时删除」没排上：' + ((r2.body && r2.body.error) || ('HTTP ' + r2.status));
          }
          t += '\n\nCloudflare 正在构建，约 1~2 分钟后上线。';
          say('ok', t);
        }).catch(function (e) {
          btn.disabled = false;
          say('bad', t + '\n⚠️ 但「限时删除」请求出错：' + (e && e.message ? e.message : e));
        });
        return;
      }

      btn.disabled = false;
      t += '\n\nCloudflare 正在构建，约 1~2 分钟后上线。';
      say('ok', t);
    }).catch(function (e) {
      btn.disabled = false;
      say('bad',
        '请求出错：' + (e && e.message ? e.message : e) + '\n\n' +
        '最可能的原因：这个请求又被 Cloudflare Access 拦了一次（跳去了登录页）。\n' +
        '按 F12 → Network，看那条请求是不是 302 到 cloudflareaccess.com ——\n' +
        '如果是，说明页面和接口挂在了两个不同的 Access 应用上（同一个域名下会互相抢登录 cookie）。');
    });
  });

  // ---------------------------------------------------------- 管理：列出文章
  function loadPosts() {
    $('listInfo').textContent = '正在读取…';
    $('list').innerHTML = '';
    fetch('/admin/api/posts', { credentials: 'same-origin' })
      .then(function (r) { return r.json().then(function (j) { return { status: r.status, body: j }; }); })
      .then(function (res) {
        if (!res.body || !res.body.ok) {
          $('listInfo').textContent = '读取失败：' + ((res.body && res.body.error) || ('HTTP ' + res.status));
          return;
        }
        renderPosts(res.body.posts || []);
      })
      .catch(function (e) {
        $('listInfo').textContent = '请求出错：' + (e && e.message ? e.message : e);
      });
  }
  $('refresh').addEventListener('click', loadPosts);

  function renderPosts(posts) {
    var list = $('list');
    list.innerHTML = '';
    $('listInfo').textContent = '共 ' + posts.length + ' 篇';
    if (!posts.length) {
      var p = document.createElement('div');
      p.className = 'hint';
      p.textContent = '还没有文章';
      list.appendChild(p);
      return;
    }
    posts.forEach(function (item) {
      var row = document.createElement('div');
      row.className = 'post-row';

      var info = document.createElement('div');
      info.className = 'post-info';
      var t = document.createElement('div');
      t.className = 'post-title';
      // 用 textContent 而不是 innerHTML —— 标题是仓库里的数据，
      // 哪怕是自己写的也不该当 HTML 解析
      t.textContent = item.title || item.slug;
      var s = document.createElement('div');
      s.className = 'post-slug';
      s.textContent = item.slug + '.md · ' + Math.round((item.size || 0) / 1024) + ' KB';
      info.appendChild(t);
      info.appendChild(s);

      var btn = document.createElement('button');
      btn.className = 'danger';
      btn.textContent = '删除';
      btn.addEventListener('click', function () { delPost(item, row, btn); });

      row.appendChild(info);
      row.appendChild(btn);
      list.appendChild(row);
    });
  }

  function delPost(item, row, btn) {
    var label = item.title || item.slug;
    if (!confirm('确定删除《' + label + '》？\n\n文件名：' + item.slug + '.md\n' +
                 '会连同它自己的封面图一起删掉，后台无法撤销（要找回得去 GitHub 历史里捞）。')) return;
    btn.disabled = true;
    btn.textContent = '删除中…';
    fetch('/admin/api/delete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ slug: item.slug })
    }).then(function (r) {
      return r.json().then(function (j) { return { status: r.status, body: j }; });
    }).then(function (res) {
      if (res.body && res.body.ok) {
        row.className = 'post-row gone';
        btn.textContent = '已删除';
        var t = '已删除 ' + res.body.deleted;
        if (res.body.coverDeleted) t += '\n封面也删了：' + res.body.coverDeleted;
        if (res.body.note) t += '\n' + res.body.note;
        t += '\n\n约 1~2 分钟后从线上消失。';
        say('ok', t);
      } else {
        btn.disabled = false;
        btn.textContent = '删除';
        say('bad', '删除失败：' + ((res.body && res.body.error) || ('HTTP ' + res.status)));
      }
    }).catch(function (e) {
      btn.disabled = false;
      btn.textContent = '删除';
      say('bad', '请求出错：' + (e && e.message ? e.message : e));
    });
  }

  loadDraft();

  // ---------------------------------------------------------- 管理：排期列表
  function loadSched() {
    $('schedInfo').textContent = '正在读取排期…';
    $('schedList').innerHTML = '';
    fetch('/admin/api/schedule', { credentials: 'same-origin' })
      .then(function (r) { return r.json().then(function (j) { return { status: r.status, body: j }; }); })
      .then(function (res) {
        if (!res.body || !res.body.ok) {
          $('schedInfo').textContent = '读取失败：' + ((res.body && res.body.error) || ('HTTP ' + res.status));
          return;
        }
        renderSched(res.body.items || []);
        var lr = res.body.lastRun;
        var line = $('cronInfo');
        if (lr && lr.failedToRun) {
          line.textContent = '⚠️ 上次执行【抛异常了】：' + lr.failedToRun
            + '\n时间：' + fmtTime(lr.at) + '（' + (lr.via || '未知') + '）'
            + (lr.lastOkAt ? '\n上次成功：' + fmtTime(lr.lastOkAt) : '\n从来没有成功执行过');
        } else if (lr && lr.at) {
          var viaText = lr.via === 'cron' ? '定时任务'
            : (lr.via === 'manual' ? '你手动点的那次' : (lr.via === 'lazy' ? '访客触发的兜底检查' : (lr.via || '未知')));
          line.textContent = '上次执行：' + fmtTime(lr.at) + '（由「' + viaText + '」触发）'
            + '  检查 ' + lr.checked + ' 条，完成 ' + ((lr.done || []).length)
            + '，失败 ' + ((lr.failed || []).length);
          if (lr.via !== 'cron') {
            line.textContent += '\n⚠️ 最近一次不是 cron 触发的 —— 说明定时触发器还没生效，'
              + '目前靠"访客访问时兜底"在跑。想更准可以点右边手动执行，或去控制台看 Cron Triggers。';
          }
        } else {
          line.textContent = '⚠️ 从来没执行过 —— 既没有 cron 触发，也没有访客触发过兜底。'
            + '先点右边「立即执行一次」手动跑，能跑通就说明是触发的问题。';
        }
      })
      .catch(function (e) {
        $('schedInfo').textContent = '请求出错：' + (e && e.message ? e.message : e);
      });
  }
  $('schedRefresh').addEventListener('click', loadSched);
  $('schedRun').addEventListener('click', function () {
    var btn = $('schedRun');
    btn.disabled = true;
    say('', '正在手动执行一次定时任务…');
    fetch('/admin/api/schedule-run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: '{}'
    }).then(function (r) {
      return r.json().then(function (j) { return { status: r.status, body: j }; });
    }).then(function (res) {
      btn.disabled = false;
      if (res.body && res.body.ok) {
        var t = '手动执行完成：检查 ' + res.body.checked + ' 条';
        if (res.body.done.length) t += '\n已完成：' + res.body.done.join('；');
        if (res.body.failed.length) t += '\n失败（会重试）：' + res.body.failed.join('；');
        if (res.body.givenUp.length) t += '\n已放弃：' + res.body.givenUp.join('；');
        if (!res.body.done.length && !res.body.failed.length) t += '\n（没有到点的任务）';
        say('ok', t);
        loadSched();
      } else {
        say('bad', '执行失败：' + ((res.body && res.body.error) || ('HTTP ' + res.status)));
      }
    }).catch(function (e) {
      btn.disabled = false;
      say('bad', '请求出错：' + (e && e.message ? e.message : e));
    });
  });

  function fmtTime(sec) {
    return new Date(sec * 1000).toLocaleString('zh-CN', { hour12: false });
  }

  function renderSched(items) {
    var box = $('schedList');
    box.innerHTML = '';
    if (!items.length) {
      $('schedInfo').textContent = '没有待执行的排期';
      var p = document.createElement('div');
      p.className = 'hint';
      p.textContent = '（在「写文章」里设了定时发布或限时删除，这里就会出现）';
      box.appendChild(p);
      return;
    }
    $('schedInfo').textContent = '共 ' + items.length + ' 条待执行';
    items.forEach(function (it) {
      var row = document.createElement('div');
      row.className = 'sched-row';

      var badge = document.createElement('span');
      badge.className = 'sched-badge';
      badge.textContent = (it.type === 'publish' ? '定时发布' : '限时删除');

      var info = document.createElement('div');
      info.className = 'post-info';
      var t = document.createElement('div');
      t.className = 'post-title';
      t.textContent = (it.title || it.slug) + (it.hasCover ? '（含封面）' : '');
      var s = document.createElement('div');
      s.className = 'post-slug';
      s.textContent = fmtTime(it.at) + (it.tries ? ' · 已重试 ' + it.tries + ' 次' : '');
      info.appendChild(t);
      info.appendChild(s);

      var btn = document.createElement('button');
      btn.className = 'danger';
      btn.textContent = '取消';
      btn.addEventListener('click', function () {
        if (!confirm('取消这条排期？\n\n' + (it.type === 'publish' ? '不再自动发布 ' : '不再自动删除 ') + it.slug)) return;
        btn.disabled = true;
        btn.textContent = '取消中…';
        fetch('/admin/api/schedule-cancel', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ key: it.key })
        }).then(function (r) {
          return r.json().then(function (j) { return { status: r.status, body: j }; });
        }).then(function (res) {
          if (res.body && res.body.ok) { row.className = 'sched-row gone'; setTimeout(loadSched, 400); }
          else { btn.disabled = false; btn.textContent = '取消'; say('bad', '取消失败：' + ((res.body && res.body.error) || ('HTTP ' + res.status))); }
        }).catch(function (e) {
          btn.disabled = false;
          btn.textContent = '取消';
          say('bad', '请求出错：' + (e && e.message ? e.message : e));
        });
      });

      row.appendChild(badge);
      row.appendChild(info);
      row.appendChild(btn);
      box.appendChild(row);
    });
  }
})();
</script>
</body>
</html>
`;
