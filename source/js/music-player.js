/* ===========================================================================
 *  悬浮音乐播放器（网易云官方外链 · 单曲随机模式）
 *
 *  它做什么
 *  --------
 *    左下角一个音符按钮 → 点开是一个紧凑的小播放器（330 × 130）
 *    每次打开【随机】从歌单里挑一首，所以每次进站听到的都不一样
 *
 *  为什么用「官方外链 iframe」而不是自己拉音频
 *  ------------------------------------------
 *    ① 版权 —— 音频由网易自己提供，试听/下架/地区限制都由它处理，与本站无关
 *    ② 成本 —— iframe 内容从 music.163.com 直接加载，【不经过 Cloudflare】：
 *       零 Worker 请求、零带宽、不涉及 ToS
 *    ③ 稳定性 —— 自己解析的直链有时效和 IP 绑定，今天能放明天就 404
 *
 *  ⚠️ 代价（必须知道）
 *    iframe 跟我们不同源，拿不到它的任何状态：读不到在播哪首、
 *    读不到进度、也控制不了播放/暂停。所以这是个"悬浮开关 + 官方播放器"，
 *    不是自定义播放器。
 *
 *  数据从哪来
 *  ----------
 *    /music/playlist.json  —— 由 tools/fetch-music.js 生成，提交在仓库里。
 *    里面是歌单的【全部】歌曲 ID（336 个）。
 *
 *    ⚠️ 为什么不在浏览器里直接请求网易接口：
 *       网易那个接口不返回 CORS 头，浏览器跨域取不到。
 *    为什么不在构建时自动跑 fetch-music：
 *       Cloudflare 的构建机在海外，访问 music.163.com（国内）容易超时，
 *       让构建依赖外部网络 = 网易一抽风整个部署就挂。
 *       所以是【本地手动跑一次，结果提交进仓库】，构建纯离线。
 *
 *  ⚠️ 为什么整块 DOM 挂在 <body> 直属下、不放进 #body-wrap
 *    主题的 PJAX 会替换这几个选择器：
 *        ['head > title', '#config-diff', '#body-wrap',
 *         '#rightside-config-hide', '#rightside-config-show', '.js-pjax']
 *    #body-wrap 是【整个页面主体】。播放器只要不在这些容器里，
 *    PJAX 翻页时就不会被替换 → iframe 不重载 → 音乐跨页不断。
 *
 *  自动播放怎么实现（浏览器强制禁止带声音的自动播放）
 *    第一次访问 → 访客点一下悬浮按钮（真实用户手势）→ 这一刻才创建 iframe
 *    之后翻页 / 回访 → 从 localStorage 读到"他想听" → 自动展开
 *                 → 此时浏览器已放行，真的能出声
 *    所以"自动播放"是靠【记住访客的意愿】实现的，不是硬闯浏览器策略。
 *
 *  ⚠️⚠️ 两个踩过的坑（别再犯）
 *
 *    1) 变量名把同名的函数覆盖掉
 *         var close = document.createElement('button');  // 关闭按钮
 *         function close() { ... }                       // 关闭函数，同名！
 *       var 声明会覆盖函数声明。于是 click 里 `close(true)` 变成"把 DOM 元素
 *       当函数调用"，每次都抛 TypeError。
 *       **表现：点悬浮按钮能打开，但再点、点 × 都毫无反应，界面上看不出异常。**
 *       所以下面一律用 closePanel / openPanel / closeBtn，名字不许重。
 *
 *    2) "点面板外面关闭"
 *       看着贴心，实则灾难：点导航链接就是点在容器外面 → 播放器被关掉
 *       → PJAX 翻页后自己收起来。加了白名单也不稳（主题里有 JS 驱动的导航）。
 *       所以干脆不做这一条。
 * ========================================================================= */

(function () {
  'use strict';

  /* ---------------------------------------------------------------- 配置 */

  var CONFIG = {
    // 歌单数据（tools/fetch-music.js 生成）
    dataUrl: '/music/playlist.json',

    // 拿不到数据时的退路：用歌单模式（type=0），至少还有音乐
    fallbackPlaylistId: '13567737910',

    // 面板标题
    title: '随机播放',

    // 单曲播放器（type=2）的尺寸。
    // 实测：iframe 高 130 + src 的 height=110 → 封面 + 歌名 + 进度条 +
    // 上一首/播放/下一首/列表，一个都不少，而且很紧凑。
    frameWidth: 330,
    frameHeight: 130,
    frameInnerHeight: 110,

    // 只在首页显示？false = 全站（配合 PJAX 音乐跨页不断）
    homeOnly: false,

    // iframe 里带 auto=1
    autoPlay: true,

    // 首次来访飘一个"点这里放音乐"的小气泡
    hint: true,

    // 尽量避免连着两次放同一首
    avoidRepeat: true,

    storageKey: 'vopth:music:on',
    hintKey: 'vopth:music:hint',
    lastKey: 'vopth:music:last',

    debug: false,
  };

  /* ---------------------------------------------------------------- 工具 */

  function log() {
    if (CONFIG.debug && window.console) {
      console.log.apply(console, ['[music]'].concat([].slice.call(arguments)));
    }
  }

  function store(key, val) {
    try { localStorage.setItem(key, val); } catch (e) { /* 隐私模式忽略 */ }
  }
  function read(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }

  function shouldShow() {
    if (!CONFIG.homeOnly) return true;
    var p = window.location.pathname.replace(/index\.html$/, '');
    return p === '' || p === '/';
  }

  function isAdmin() {
    return window.location.pathname.indexOf('/admin') === 0;
  }

  /* ---------------------------------------------------------------- 图标 */

  /* 双八分音符（♫）—— 一眼就知道是音乐。
     以前用的是同心圆（想画黑胶唱片），缩到 22px 看着像靶心，
     站主原话："这也看不出来是音频播放器啊"。 */
  var ICON_NOTE =
    '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">' +
    '<path d="M9.4 17.2V6.6l8.8-1.9v10.6" fill="none" stroke="currentColor" ' +
    'stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<path d="M9.4 6.6l8.8-1.9" fill="none" stroke="currentColor" ' +
    'stroke-width="2.8" stroke-linecap="round"/>' +
    '<ellipse cx="7" cy="17.6" rx="2.5" ry="2" fill="currentColor" ' +
    'transform="rotate(-16 7 17.6)"/>' +
    '<ellipse cx="15.8" cy="15.7" rx="2.5" ry="2" fill="currentColor" ' +
    'transform="rotate(-16 15.8 15.7)"/>' +
    '</svg>';

  var ICON_SHUFFLE =
    '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">' +
    '<path d="M16 3h5v5M4 20l16.5-16.5M21 16v5h-5M15 15l6 6M4 4l5 5" ' +
    'fill="none" stroke="currentColor" stroke-width="1.7" ' +
    'stroke-linecap="round" stroke-linejoin="round"/></svg>';

  var ICON_CLOSE =
    '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">' +
    '<path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" ' +
    'stroke-width="1.9" stroke-linecap="round"/></svg>';

  /* ------------------------------------------------------- 歌单数据 */

  var playlistCache = null;     // {trackIds: [...], ...}
  var playlistPromise = null;

  function loadPlaylist() {
    if (playlistCache) return Promise.resolve(playlistCache);
    if (playlistPromise) return playlistPromise;

    playlistPromise = fetch(CONFIG.dataUrl, { cache: 'force-cache' })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (json) {
        if (!json || !json.trackIds || !json.trackIds.length) {
          throw new Error('playlist.json 里没有 trackIds');
        }
        playlistCache = json;
        log('歌单载入:', json.trackIds.length, '首 |', json.name);
        return json;
      })
      .catch(function (err) {
        log('歌单载入失败:', err && err.message);
        playlistPromise = null;      // 允许下次重试
        throw err;
      });

    return playlistPromise;
  }

  /** 随机挑一首（尽量不和上首重复） */
  function pickRandomId(trackIds) {
    if (!trackIds || !trackIds.length) return null;
    if (trackIds.length === 1) return String(trackIds[0]);

    var last = read(CONFIG.lastKey);
    for (var i = 0; i < 8; i++) {
      var id = String(trackIds[Math.floor(Math.random() * trackIds.length)]);
      if (!CONFIG.avoidRepeat || id !== last) {
        store(CONFIG.lastKey, id);
        return id;
      }
    }
    // 连抽 8 次都撞上同一首（池子太小），那就认了
    var fallback = String(trackIds[Math.floor(Math.random() * trackIds.length)]);
    store(CONFIG.lastKey, fallback);
    return fallback;
  }

  function singleSongUrl(songId) {
    return (
      'https://music.163.com/outchain/player?type=2&id=' +
      encodeURIComponent(songId) +
      '&auto=' + (CONFIG.autoPlay ? '1' : '0') +
      '&height=' + CONFIG.frameInnerHeight
    );
  }

  function playlistUrl(playlistId) {
    return (
      'https://music.163.com/outchain/player?type=0&id=' +
      encodeURIComponent(playlistId) +
      '&auto=' + (CONFIG.autoPlay ? '1' : '0') +
      '&height=430'
    );
  }

  /* ---------------------------------------------------------------- 构建 */

  function build() {
    var root = document.createElement('div');
    root.id = 'vopth-music';
    root.className = 'vopth-music';
    root.setAttribute('data-state', 'closed');

    /* ---- 面板 ---- */
    var panel = document.createElement('div');
    panel.className = 'vopth-music-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', '音乐播放器');

    var head = document.createElement('div');
    head.className = 'vopth-music-head';

    var cap = document.createElement('span');
    cap.className = 'vopth-music-title';
    cap.textContent = CONFIG.title;

    var tools = document.createElement('span');
    tools.className = 'vopth-music-tools';

    // ⚠️ 名字不能叫 close（会和 closePanel 冲突，见文件头注释）
    var shuffleBtn = document.createElement('button');
    shuffleBtn.type = 'button';
    shuffleBtn.className = 'vopth-music-iconbtn';
    shuffleBtn.setAttribute('aria-label', '换一首');
    shuffleBtn.title = '换一首';
    shuffleBtn.innerHTML = ICON_SHUFFLE;

    var closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'vopth-music-iconbtn vopth-music-close';
    closeBtn.setAttribute('aria-label', '收起播放器');
    closeBtn.title = '收起';
    closeBtn.innerHTML = ICON_CLOSE;

    tools.appendChild(shuffleBtn);
    tools.appendChild(closeBtn);
    head.appendChild(cap);
    head.appendChild(tools);

    var body = document.createElement('div');
    body.className = 'vopth-music-body';

    var tip = document.createElement('div');
    tip.className = 'vopth-music-tip';
    tip.textContent = '正在挑一首歌…';
    body.appendChild(tip);

    panel.appendChild(head);
    panel.appendChild(body);

    /* ---- 悬浮按钮 ---- */
    var toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = 'vopth-music-toggle';
    toggleBtn.setAttribute('aria-label', '打开音乐播放器');
    toggleBtn.title = '点我放音乐';
    toggleBtn.innerHTML = ICON_NOTE;

    /* ---- 首次提示气泡 ---- */
    var hintEl = document.createElement('div');
    hintEl.className = 'vopth-music-hint';
    hintEl.textContent = '点这里放音乐';
    if (!CONFIG.hint || read(CONFIG.hintKey) === '1') {
      hintEl.style.display = 'none';
    }

    root.appendChild(panel);
    root.appendChild(toggleBtn);
    root.appendChild(hintEl);

    /* ---------------------------------------------------------- 行为 ---- */

    var iframe = null;
    var opened = false;
    var loading = false;

    function setFrame(src, height) {
      if (!iframe) {
        iframe = document.createElement('iframe');
        iframe.className = 'vopth-music-frame';
        iframe.setAttribute('frameborder', 'no');
        iframe.setAttribute('border', '0');
        iframe.setAttribute('marginwidth', '0');
        iframe.setAttribute('marginheight', '0');
        iframe.setAttribute('scrolling', 'no');
        // allow="autoplay" 把自动播放权限委托给 iframe
        iframe.setAttribute('allow', 'autoplay; encrypted-media');
        iframe.setAttribute('title', '音乐播放器');
        iframe.width = String(CONFIG.frameWidth);
        body.appendChild(iframe);
      }
      iframe.height = String(height);
      iframe.src = src;                 // 换歌 = 换 src（会重载 iframe）
      tip.style.display = 'none';
    }

    function playRandom() {
      if (loading) return;
      loading = true;
      tip.textContent = '正在挑一首歌…';
      tip.style.display = '';

      loadPlaylist()
        .then(function (json) {
          var id = pickRandomId(json.trackIds);
          log('随机到:', id, '/', json.trackIds.length);
          setFrame(singleSongUrl(id), CONFIG.frameHeight);
        })
        .catch(function () {
          // 退路：退回歌单模式，至少还有音乐
          tip.textContent = '歌单数据加载失败，已退回歌单模式';
          setTimeout(function () {
            setFrame(playlistUrl(CONFIG.fallbackPlaylistId), 430);
          }, 1200);
        })
        .then(function () { loading = false; });
    }

    function dismissHint() {
      if (hintEl.style.display !== 'none') {
        hintEl.style.display = 'none';
        store(CONFIG.hintKey, '1');
      }
    }

    function openPanel(remember) {
      if (opened) return;
      opened = true;
      if (!iframe) playRandom();        // 在用户手势里创建，自动播放才有机会
      root.setAttribute('data-state', 'open');
      toggleBtn.classList.add('is-active');
      toggleBtn.setAttribute('aria-label', '收起音乐播放器');
      if (remember !== false) store(CONFIG.storageKey, '1');
      log('opened');
    }

    function closePanel(remember) {
      if (!opened) return;
      opened = false;
      root.setAttribute('data-state', 'closed');
      toggleBtn.classList.remove('is-active');
      toggleBtn.setAttribute('aria-label', '打开音乐播放器');
      if (remember !== false) store(CONFIG.storageKey, '0');
      log('closed');
    }

    toggleBtn.addEventListener('click', function () {
      dismissHint();
      if (opened) { closePanel(true); } else { openPanel(true); }
    }, false);

    closeBtn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      closePanel(true);
    }, false);

    // 换一首 —— 单曲模式下网易自己的上一首/下一首在单曲上下文里没用，
    // 所以换歌由我们自己来：重新随机一个 ID，换掉 iframe 的 src。
    shuffleBtn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (!opened) openPanel(true);
      else playRandom();
    }, false);

    hintEl.addEventListener('click', function () {
      dismissHint();
      openPanel(true);
    }, false);

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && opened) closePanel(true);
    }, false);

    /* 回访：上次开着就自动开。
       这一步不在用户手势里，所以首次访问会被浏览器拦下自动播放；
       但访客之前点过一次，浏览器认为这个域名"交互过"，这里就能真出声。 */
    if (read(CONFIG.storageKey) === '1') {
      dismissHint();
      openPanel(false);
    }

    return root;
  }

  /* ---------------------------------------------------------------- 挂载 */

  function mount() {
    if (isAdmin()) return;
    if (document.getElementById('vopth-music')) return;   // 防重复
    if (!shouldShow()) return;

    // ⚠️ 关键：挂在 <body> 直属下，不能放进 #body-wrap（那是 PJAX 的替换目标）
    document.body.appendChild(build());
    log('mounted');
  }

  if (document.body) {
    mount();
  } else {
    document.addEventListener('DOMContentLoaded', mount, false);
  }

  /* PJAX 不需要任何处理：
     播放器在 #body-wrap 之外，翻页时 PJAX 碰不到它，脚本也不会重跑。 */
})();
