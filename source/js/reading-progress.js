/* ===========================================================================
 *  阅读进度条
 *
 *  顶部一条细线，随滚动填充，告诉读者「这篇读到哪儿了」。
 *  长文（比如那篇 4.7k 字的踩坑合集）用得上。
 *
 *  只在有正文容器（#article-container）的页面出现 —— 首页列表、归档这些
 *  没有正文的页面不显示，否则一条永远填不满的线会很奇怪。
 *
 *  实现要点：
 *    · 用 transform: scaleX() 而不是改 width —— transform 不触发布局重排，
 *      滚动时不会卡（改 width 会让浏览器每帧重新计算布局）
 *    · 滚动监听加 passive: true，告诉浏览器「我不会 preventDefault」，
 *      它就能放心地异步滚动
 *    · 节流用【时间戳】而不是 requestAnimationFrame —— 见下面 onScroll
 *      里的注释，rAF 在后台标签页和被节流的 iframe 里可能不触发
 *    · 高度按「可滚动距离」算，不是按文档总高 —— 否则滚到底也到不了 100%
 * ========================================================================= */

(function () {
  'use strict';

  var article = document.getElementById('article-container');
  if (!article) return;                       // 不是文章页，不显示

  var bar = document.createElement('div');
  bar.className = 'reading-progress';
  bar.setAttribute('aria-hidden', 'true');    // 纯装饰，读屏软件跳过
  bar.innerHTML = '<i></i>';
  var fill = bar.firstChild;

  // 插到 body 最前面，避免被其他容器的 overflow/transform 影响定位
  document.body.insertBefore(bar, document.body.firstChild);

  function update() {
    var doc = document.documentElement;
    var scrollTop = window.pageYOffset || doc.scrollTop || 0;
    var scrollable = (doc.scrollHeight || document.body.scrollHeight) - window.innerHeight;
    var ratio = scrollable > 0 ? scrollTop / scrollable : 0;
    if (ratio < 0) ratio = 0;
    if (ratio > 1) ratio = 1;
    fill.style.transform = 'scaleX(' + ratio + ')';
  }

  /* 节流：同一帧内最多算一次。
   *
   * 为什么用时间戳而不是 requestAnimationFrame：
   *   rAF 在后台标签页里会被浏览器节流、甚至暂停。那种情况下用户切回来滚动，
   *   进度条可能停在旧值上。时间戳节流没有这个依赖，代价只是可能比 rAF 多算
   *   几次（上限 60 次/秒）。update() 本身很轻：读两个属性、写一个 transform。
   *
   * ⚠️ 排查过程记一笔（避免以后误判）：
   *   第一版写的就是 rAF 版本，验证时进度条纹丝不动，我一度认定是 rAF 被节流。
   *   后来发现真正的原因在【测试脚本】，不在页面代码：
   *     ① 我把 scroll 事件 dispatch 在 document 上 —— 而 scroll 事件
   *        【不冒泡】，挂在 window 上的监听器根本收不到；
   *     ② scrollTo() 触发的真实 scroll 事件是【异步】派发的，
   *        我却同步立刻去读 transform，读到的是上一帧的值。
   *   改成在 window 上派发 + 等 450ms 再读，数值就精确对上了
   *   （25%→0.250、50%→0.500、到底→1.000、回顶→0.000）。
   *   所以：换节流方式是稳妥改进，但不要把它当成"已证实的 bug 修复"。
   */
  var lastRun = 0;
  function onScroll() {
    var now = Date.now();
    if (now - lastRun < 16) return;           // 约 60fps 上限
    lastRun = now;
    update();
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  update();
})();
