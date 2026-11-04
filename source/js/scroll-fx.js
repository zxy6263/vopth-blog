/**
 * 滚动入场 + 卡片跟随光斑。
 *
 * ⚠️ 设计前提：这个脚本绝不能让页面内容不可见。
 *   第一版只靠 IntersectionObserver，结果关于页整页空白 ——
 *   25 个元素全部卡在 vw-reveal-wait（opacity 0），observer 没触发，
 *   而元素自己不知道「我该显示了」。任何观察类动画都有这个风险
 *   （observer 被 GC、元素在 observe 后被替换、浏览器标签页冻结……
 *   具体原因可以慢慢查，但「白屏」这个后果一次都不能有）。
 *
 *   所以现在分三层：
 *     1. 观察时已经在视口里（或已在视口上方）的 -> 立刻展开，不进等待态
 *     2. 只有视口下方的才加 vw-reveal-wait 并交给 observer
 *     3. 两道兜底：定时检查 + 滚动时检查，凡在视口内还没展开的一律强制展开
 *
 * 滚动入场
 * --------
 * 用 IntersectionObserver 而不是监听 scroll：不占主线程、一次性、不会来回闪。
 * 错峰按「同一批进入视口的元素」按下标算延迟，不是全局下标 ——
 * 否则翻到第 30 篇时延迟会累加到 1 秒以上；这里封顶 260ms。
 *
 * 鼠标光斑
 * --------
 * 用 CSS 变量把鼠标位置写给卡片（--mx / --my），光斑在 CSS 里画。
 * JS 只负责「写两个数字」，绘制交给合成层，不会触发 layout。
 * 用 rAF 节流：pointermove 触发频率远高于一帧一次，直接写变量会让样式重算排队。
 */
(function () {
  'use strict';

  if (window.__vopthScrollFx) return;
  window.__vopthScrollFx = true;

  var reduceMotion = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var REVEAL_SELECTORS = [
    '#recent-posts .recent-post-item',
    '#article-container > *',
    '.flink-list-item',
    '.card-widget',
    '#pagination .page-number',
  ];

  var STAGGER = 45;
  var MAX_STAGGER = 260;
  var FAILSAFE_DELAY = 1200;

  var observer = null;

  // ======================================================================
  // 展开
  // ======================================================================
  function reveal(el, delay) {
    // 关键：把 wait 态摘掉，不要指望 CSS 里两个类的顺序决定谁赢
    el.classList.remove('vw-reveal-wait');
    el.style.transitionDelay = (delay || 0) + 'ms';
    el.classList.add('vw-reveal-in');
    el.dataset.vwRevealed = '1';

    setTimeout(function () {
      el.style.transitionDelay = '';
      el.classList.remove('vw-reveal-in');
      // 展开后回到「不该被 will-change 占着」的状态
      el.style.willChange = '';
    }, (delay || 0) + 700);
  }

  function revealAll() {
    var all = document.querySelectorAll('[data-vw-reveal="1"]');
    for (var i = 0; i < all.length; i++) reveal(all[i], 0);
  }

  // ======================================================================
  // 收集
  // ======================================================================
  function collectTargets() {
    var out = [];
    for (var i = 0; i < REVEAL_SELECTORS.length; i++) {
      var nodes = document.querySelectorAll(REVEAL_SELECTORS[i]);
      for (var j = 0; j < nodes.length; j++) {
        var el = nodes[j];
        if (el.dataset.vwReveal === '1') continue;
        var r = el.getBoundingClientRect();
        if (r.height < 24) continue;      // 分隔线、空行不做动画
        el.dataset.vwReveal = '1';
        out.push(el);
      }
    }
    return out;
  }

  // ======================================================================
  // 初始化
  // ======================================================================
  function initObserver() {
    if (!('IntersectionObserver' in window)) {
      revealAll();
      return;
    }

    var targets = collectTargets();
    if (!targets.length) return;

    var vh = window.innerHeight || document.documentElement.clientHeight;
    // 视口底部留 8% 余量：元素露出 8% 以上才算「进入」
    var line = vh * 0.92;

    var instant = [];
    var deferred = [];

    for (var i = 0; i < targets.length; i++) {
      var r = targets[i].getBoundingClientRect();
      // r.top < line 包含「在视口内」和「已经在视口上方」（负值）
      if (r.top < line) instant.push(targets[i]);
      else deferred.push(targets[i]);
    }

    // ① 视口内的直接展开，连等待态都不加 —— 这是防白屏的第一道保险
    for (var a = 0; a < instant.length; a++) {
      reveal(instant[a], Math.min(a * STAGGER, MAX_STAGGER));
    }

    // ② 视口下方的才进入等待 + 观察
    if (deferred.length) {
      if (!observer) {
        observer = new IntersectionObserver(function (entries) {
          var batch = [];
          for (var k = 0; k < entries.length; k++) {
            if (entries[k].isIntersecting) batch.push(entries[k].target);
          }
          batch.sort(function (x, y) {
            return x.getBoundingClientRect().top - y.getBoundingClientRect().top;
          });
          for (var m = 0; m < batch.length; m++) {
            observer.unobserve(batch[m]);
            reveal(batch[m], Math.min(m * STAGGER, MAX_STAGGER));
          }
        }, {
          rootMargin: '0px 0px -8% 0px',
          threshold: 0.01,
        });
      }
      for (var b = 0; b < deferred.length; b++) {
        deferred[b].classList.add('vw-reveal-wait');
        observer.observe(deferred[b]);
      }
    }

    // ③ 第二道保险：定时把「还在视口内但没展开」的强制展开
    setTimeout(failsafe, FAILSAFE_DELAY);
  }

  // ======================================================================
  // 兜底：凡在视口内还挂着 wait 的，一律展开
  // ======================================================================
  function failsafe() {
    if (!document.querySelector('.vw-reveal-wait')) return;
    var vh = window.innerHeight || document.documentElement.clientHeight;
    var stuck = document.querySelectorAll('.vw-reveal-wait');
    for (var i = 0; i < stuck.length; i++) {
      var r = stuck[i].getBoundingClientRect();
      if (r.top < vh) reveal(stuck[i], 0);   // 包括在视口上方的（负 top）
    }
  }

  var scrollPending = false;
  function onScroll() {
    if (scrollPending) return;
    scrollPending = true;
    requestAnimationFrame(function () {
      scrollPending = false;
      failsafe();
    });
  }

  // ======================================================================
  // 光斑
  // ======================================================================
  var SPOTLIGHT_SELECTOR = ['.recent-post-item', '.card-widget', '.flink-list-item'].join(',');
  var rafPending = false;
  var lastEvent = null;

  function applySpotlight() {
    rafPending = false;
    if (!lastEvent) return;
    var el = lastEvent.el;
    var r = el.getBoundingClientRect();
    if (!r.width || !r.height) return;
    el.style.setProperty('--mx', (lastEvent.x - r.left) + 'px');
    el.style.setProperty('--my', (lastEvent.y - r.top) + 'px');
    lastEvent = null;
  }

  function onPointerMove(e) {
    var el = e.target && e.target.closest ? e.target.closest(SPOTLIGHT_SELECTOR) : null;
    if (!el) return;
    lastEvent = { el: el, x: e.clientX, y: e.clientY };
    if (!rafPending) {
      rafPending = true;
      requestAnimationFrame(applySpotlight);
    }
  }

  function bindSpotlight() {
    if (window.__vopthSpotlightBound) return;
    window.__vopthSpotlightBound = true;
    document.addEventListener('pointermove', onPointerMove, { passive: true });
  }

  // ======================================================================
  // 启动
  // ======================================================================
  function boot() {
    if (reduceMotion) {
      // 用户要求减少动态效果：不加任何等待态，更不需要观察
      var all = collectTargets();
      for (var i = 0; i < all.length; i++) all[i].dataset.vwRevealed = '1';
    } else {
      initObserver();
    }
    bindSpotlight();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }

  // 图片/字体加载完，布局会变，重新兜一次底
  window.addEventListener('load', function () {
    setTimeout(failsafe, 100);
  });

  // 滚动时兜底
  window.addEventListener('scroll', onScroll, { passive: true });

  // PJAX 换页后重新扫描
  document.addEventListener('pjax:complete', function () {
    setTimeout(boot, 60);
  });
})();
