/* ===========================================================================
 *  视频 banner
 *
 *  为什么需要这个脚本？
 *  Butterfly 不支持把视频作为 top_img（主题里没有任何 video 处理逻辑），
 *  所以这里自己把 <video> 插进 banner。
 *
 *  优雅降级设计：
 *    - 页面 front-matter 里的 top_img 指向【海报图】（视频的一帧），
 *      所以 JS 没跑、或视频加载失败时，看到的是静态图，而不是黑块；
 *    - 系统关闭了动画效果（prefers-reduced-motion）时直接不插入视频，
 *      只保留静态海报图 —— 这类用户明确表示不想看到动的东西。
 *
 *  想给别的页面也加视频：往 VIDEO_PAGES 里加一条即可（键是页面路径）。
 * ========================================================================= */
(function () {
  'use strict';

  var VIDEO_PAGES = {
    '/about/': {
      src: '/videos/about-banner.mp4',
      poster: '/videos/about-banner-poster.jpg'
    }
  };

  // 尊重系统的「减少动态效果」设置
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    return;
  }

  // 兼容带 index.html 的路径写法
  var path = window.location.pathname.replace(/index\.html$/, '');
  var cfg = VIDEO_PAGES[path];
  if (!cfg) return;

  var header = document.getElementById('page-header');
  if (!header) return;
  if (header.querySelector('.banner-video')) return; // 防重复插入

  var v = document.createElement('video');
  v.className = 'banner-video';
  v.src = cfg.src;
  v.poster = cfg.poster;
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
