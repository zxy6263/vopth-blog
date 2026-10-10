/**
 * 页面浏览量显示
 * ===========================================================================
 *
 * 配合 src/index.js 那个 Worker 用（接口在 /api/views，同域，不需要跨域配置）
 *
 * 它做两件事
 *   1. 文章页：在本会话第一次打开时上报一次，然后把「阅读 N」显示在文章
 *      元信息那一行
 *   2. 所有页面：把「总访问量」插进侧边栏的「网站信息」卡片
 *
 * 计数口径（别误解）
 *   记的是 PV（浏览次数）。同一个浏览器会话里，同一篇文章只上报一次 ——
 *   所以自己反复刷新不会把数字刷上去。
 *   真正的独立访客数看 Cloudflare 仪表盘（那边按 IP 去重）。
 *
 * 为什么不用 busuanzi
 *   busuanzi 是第三方服务、近年不稳定，而且会引入一次站外请求。
 *   这个站一直坚持零第三方依赖（评论也选了数据存在自己仓库的 giscus），
 *   所以浏览量也自己数：走自己的域名、国内可访问、数据在自己账号里。
 *
 * 失败时怎么办
 *   接口挂了就【什么都不显示】—— 宁可不显示，也不要显示一个假的 0。
 *   所以下面每个 fetch 都 .catch 掉，出错就直接返回。
 */

(function () {
  'use strict';

  var API = '/api/views';

  // ---------------------------------------------------------------- 工具

  // 必须和后端 normalizePath 保持一致，否则 /about 和 /about/ 会被算成两篇
  function normalizePath(p) {
    p = String(p || '/').split('?')[0].split('#')[0];
    if (p.charAt(0) !== '/') p = '/' + p;
    p = p.replace(/\/index\.html$/, '/');
    if (p !== '/' && p.slice(-1) !== '/') p = p + '/';
    return p;
  }

  // 1000 -> 1,000   12345 -> 1.2 万
  function fmt(n) {
    n = Number(n) || 0;
    if (n >= 10000) {
      return (n / 10000).toFixed(1).replace(/\.0$/, '') + ' 万';
    }
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function api(method, path) {
    return fetch(API + '?path=' + encodeURIComponent(path), {
      method: method,
      headers: { accept: 'application/json' },
      cache: 'no-store',
      credentials: 'omit'
    }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    });
  }

  // 同一个会话、同一个页面只上报一次
  function firstVisitThisSession(path) {
    var key = 'pv-counted:' + path;
    try {
      if (sessionStorage.getItem(key)) return false;
      sessionStorage.setItem(key, '1');
      return true;
    } catch (e) {
      // 隐私模式下 sessionStorage 可能不可用 —— 那就每次都算，
      // 总比完全不计数好
      return true;
    }
  }

  // ---------------------------------------------------------------- 渲染

  // 文章页元信息在哪 —— Butterfly 5.7 的真实结构（实测线上 HTML）是：
  //   <div id="post-meta">
  //     <div class="meta-firstline">  发表于 | 更新于 | 分类 </div>
  //     <div class="meta-secondline"> | 总字数 | 阅读时长 </div>
  //   </div>
  // 插到 meta-secondline 里，和「总字数」「阅读时长」排在同一行。
  // 其余选择器是保险：万一哪天主题改了结构，还能退到别的落点。
  function findPostMeta() {
    var sels = [
      '#post-meta .meta-secondline',
      '#post-meta',
      '#post-info .post-meta-container',
      '.post-meta-container'
    ];
    for (var i = 0; i < sels.length; i++) {
      var el = document.querySelector(sels[i]);
      if (el) return el;
    }
    return null;
  }

  function renderPostViews(views) {
    var target = findPostMeta();
    if (!target) return;

    var wrap = document.createElement('span');
    wrap.className = 'post-meta-pageviews';
    wrap.title = '本站自己统计的浏览次数（每个会话只计一次）';

    if (target.classList.contains('meta-secondline')) {
      // 和主题里「总字数」「阅读时长」一样的画法：分隔符 + 图标 + 标签
      wrap.innerHTML =
        '<span class="post-meta-separator">|</span>' +
        '<i class="fas fa-eye fa-fw post-meta-icon"></i>' +
        '<span class="post-meta-label">阅读:</span>' +
        '<span>' + fmt(views) + '</span>';
    } else {
      // 退路：结构不认识时，用最朴素的一小段
      wrap.innerHTML =
        '<i class="fas fa-eye fa-fw"></i><span>阅读 ' + fmt(views) + '</span>';
    }

    target.appendChild(wrap);
  }

  // 侧边栏「网站信息」卡片 —— 用主题自己的 webinfo-item 结构，样式自动一致
  function renderSiteTotal(total) {
    var box = document.querySelector('.card-webinfo .webinfo');
    if (!box) return;
    if (box.querySelector('.webinfo-item--pageviews')) return; // 防重复

    var item = document.createElement('div');
    item.className = 'webinfo-item webinfo-item--pageviews';
    item.innerHTML =
      '<div class="item-name">总访问量 :</div>' +
      '<div class="item-count">' + fmt(total) + '</div>';
    box.appendChild(item);
  }

  // ---------------------------------------------------------------- 主流程

  function run() {
    if (!window.fetch) return; // 老浏览器直接跳过

    var path = normalizePath(location.pathname);
    var isPost = /\/\d{4}\/\d{2}\/\d{2}\//.test(path) || document.querySelector('#post-info');

    // 文章页：先决定「上报」还是「只读」，两种都会拿到这篇文章的阅读量和站点总数
    var p = isPost
      ? (firstVisitThisSession(path) ? api('POST', path) : api('GET', path))
      : api('GET', path);

    p.then(function (data) {
      if (isPost && typeof data.views === 'number') renderPostViews(data.views);
      if (typeof data.total === 'number') renderSiteTotal(data.total);
    }).catch(function () {
      // 接口不可用 —— 静默放弃，不显示任何数字
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }

  // PJAX 换页后 #body-wrap 被整个替换、DOM 是新的，必须重跑一次。
  // 没有这一行的话：从首页 PJAX 进文章页时，「阅读 N」和侧边栏「总访问量」
  // 都不会出现（接口其实返回了，只是没人去渲染）。
  //
  // 重复上报的风险：run() 里的 firstVisitThisSession() 用 sessionStorage 去重，
  // 所以重跑只会走 GET，不会把 PV 重复计上去。
  document.addEventListener('pjax:complete', run, false);
})();
