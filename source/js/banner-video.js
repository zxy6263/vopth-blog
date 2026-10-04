/* ===========================================================================
 *  banner 视频池
 *
 *  作用：关于 / 归档 / 分类 / 标签 / 友链 这几个页面**共用一个视频池**，
 *  每次打开页面随机挑一个播放。以后加视频，只需要往 VIDEO_POOL 里加一条。
 *
 *  为什么需要这个脚本？
 *  Butterfly 不支持把视频作为 top_img（主题里没有任何 video 处理逻辑），
 *  所以这里自己把 <video> 插进 banner。
 *
 *  优雅降级（三层）：
 *    1. JS 正常执行         -> 随机视频
 *    2. 系统开了「减少动态效果」-> 随机海报图（不播视频）
 *    3. JS 未执行 / 加载失败 -> 服务端渲染的静态海报图（见各处 top_img 配置）
 *  所以任何一层都不会出现黑块。
 * ========================================================================= */
(function () {
  'use strict';

  /* -------------------------------------------------------------------------
   *  视频池 —— 想加视频就在这里加一条
   *
   *  先用 tools/compress-banner-video.ps1 把原始素材压好：
   *    powershell -File tools\compress-banner-video.ps1 -Source "D:\path\v.mp4" -Name banner-3
   *  它会在 source/videos/ 下产出 banner-3.mp4 和 banner-3-poster.jpg
   * ---------------------------------------------------------------------- */
  var VIDEO_POOL = [
    {
      src: '/videos/banner-1.mp4',
      poster: '/videos/banner-1-poster.jpg'
    },
    {
      src: '/videos/banner-2.mp4',
      poster: '/videos/banner-2-poster.jpg'
    }
    // 继续往下加，例如：
    // ,{
    //   src: '/videos/banner-3.mp4',
    //   poster: '/videos/banner-3-poster.jpg'
    // }
  ];

  // 使用这个池子的页面
  //
  // ⚠️ 漏页面是很容易犯的错，而且不报错、只是"少了个效果"，肉眼不对比看不出来：
  //    订阅页原来就没列在这里，结果它一直显示主题默认图（/img/banner-page.svg），
  //    而隔壁每个栏目页都在放视频。加新栏目页时记得回来补这一行。
  var POOL_PAGES = ['/about/', '/archives/', '/categories/', '/tags/', '/link/', '/subscribe/'];

  /* ---------------------------------------------------------------------- */

  var path = window.location.pathname.replace(/index\.html$/, '');

  function usesPool(p) {
    if (POOL_PAGES.indexOf(p) !== -1) return true;
    // 标签 / 分类的子页面（如 /tags/Hexo/）也用池子，否则同一栏目下
    // 一会儿有视频一会儿没有，看起来像 bug
    return p.indexOf('/tags/') === 0 || p.indexOf('/categories/') === 0;
  }

  if (!VIDEO_POOL.length) return;
  if (!usesPool(path)) return;

  var header = document.getElementById('page-header');
  if (!header) return;
  if (header.querySelector('.banner-video')) return; // 防重复插入

  // 随机挑一个
  var pick = VIDEO_POOL[Math.floor(Math.random() * VIDEO_POOL.length)];

  // 先把背景换成本次挑中的海报图。
  // JS 设置的行内样式会覆盖服务端渲染的那一张 —— 这样「减少动态效果」的
  // 用户看到的也是随机的那张，而不是固定的一张。
  header.style.backgroundImage = 'url("' + pick.poster + '")';

  // 尊重系统的「减少动态效果」：到这里为止，只显示静态海报图
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    return;
  }

  var v = document.createElement('video');
  v.className = 'banner-video';
  v.src = pick.src;
  v.poster = pick.poster;
  v.autoplay = true;
  v.muted = true;        // 必须静音，否则浏览器一律拒绝自动播放
  v.loop = true;
  v.playsInline = true;  // iOS 上允许内联播放（不强制全屏）
  v.preload = 'auto';
  v.setAttribute('muted', '');
  v.setAttribute('playsinline', '');
  v.setAttribute('webkit-playsinline', '');
  v.setAttribute('aria-hidden', 'true'); // 纯装饰，屏幕阅读器跳过

  header.insertBefore(v, header.firstChild);
  header.classList.add('has-video-banner');

  // 少数情况（省电模式、后台标签页）浏览器会拒绝自动播放。
  // 播放失败不影响使用 —— 海报图还在，文章照样能读。
  var playing = v.play();
  if (playing && typeof playing.catch === 'function') {
    playing.catch(function () { /* 静默忽略：保留静态海报即可 */ });
  }
})();
