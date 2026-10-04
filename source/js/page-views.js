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

  // 文章页的元信息那一行在哪，随主题版本可能不同，所以多试几个选择器
  function findPostMeta() {
    var sels = [
      '#post-info .post-meta-container',
      '.post-meta-container',
      '#post-info .post-meta',
      '.post-meta'
    ];
    for (var i = 0; i < sels.length; i++) {
      var el = document.querySelector(sels[i]);
      if (el) return el;
    }
    return null;
  }

  function renderPostViews(views) {
    var meta = findPostMeta();
    if (!meta) return;

    var span = document.createElement('span');
    span.className = 'post-meta-pageviews';
    span.title = '本站自己统计的浏览次数（每个会话只计一次）';
    span.innerHTML = '<i class="fas fa-eye fa-fw" aria-hidden="true"></i>阅读 ' + fmt(views);
    meta.appendChild(span);
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
})();
