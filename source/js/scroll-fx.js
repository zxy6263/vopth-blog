/**
 * 滚动入场 + 卡片跟随光斑。
 *
 * 为什么做这两个
 * --------------
 * 它们都是「不改变信息结构、只改变观感」的增强：
 *   · 滚动入场：内容进入视口时淡入上浮，让长列表不再是一次性糊上来
 *   · 跟随光斑：鼠标在卡片上移动时，有一团柔光跟着走，卡片才有「材质感」
 * 两者都不动 DOM 结构、不依赖主题模板，换主题也能带走。
 *
 * 滚动入场
 * --------
 * 用 IntersectionObserver 而不是监听 scroll：
 *   · 不占主线程，滚动时零计算
 *   · 元素只触发一次（unobserve），不会来回闪
 * 错峰（stagger）按「同一批被观察到的元素」的下标算延迟，
 * 不是全局下标 —— 否则往下翻到第 30 篇时延迟会累加到 1 秒以上。
 *
 * 鼠标光斑
 * --------
 * 用 CSS 变量把鼠标位置写给卡片（--mx / --my），光斑在 CSS 里画。
 * 这样 JS 只负责「写两个数字」，绘制交给合成层，不会触发 layout。
 * 用 rAF 节流：mousemove 触发频率远高于一帧一次，直接写变量会让样式重算排队。
 *
 * PJAX
 * ----
 * 换页后 #body-wrap 整个被替换，所以要在 pjax:complete 后重新扫描。
 * 已入场的元素带 data-vw-revealed，重复扫描会跳过。
 */
(function () {
  'use strict';

  if (window.__vopthScrollFx) return;
  window.__vopthScrollFx = true;

  var reduceMotion = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---- 滚动入场的目标选择器 --------------------------------------------
  // 只挑「列表里的条目」和「正文里的块级元素」，不碰 banner / 侧边栏
  var REVEAL_SELECTORS = [
    '#recent-posts .recent-post-item',
    '#article-container > *',
    '.flink-list-item',
    '.card-widget',
    '#pagination .page-number',
  ];

  var STAGGER = 45;        // 每个元素额外延迟 ms
  var MAX_STAGGER = 260;   // 延迟封顶，避免长列表越翻越慢

  var observer = null;

  function collectTargets() {
    var out = [];
    for (var i = 0; i < REVEAL_SELECTORS.length; i++) {
      var nodes = document.querySelectorAll(REVEAL_SELECTORS[i]);
      for (var j = 0; j < nodes.length; j++) {
        var el = nodes[j];
        if (el.dataset.vwRevealed === '1') continue;   // 已经处理过
        if (el.dataset.vwReveal === '1') continue;     // 已在观察队列里
        // 太矮的元素（分隔线、空行）不做动画，否则看着像闪烁
        var r = el.getBoundingClientRect();
        if (r.height < 24) continue;
        el.dataset.vwReveal = '1';
        out.push(el);
      }
    }
    return out;
  }

  function reveal(el, delay) {
    el.style.transitionDelay = delay + 'ms';
    el.classList.add('vw-reveal-in');
    el.dataset.vwRevealed = '1';
    // 动画结束后清掉 transition-delay，避免影响后续的 hover 过渡
    setTimeout(function () {
      el.style.transitionDelay = '';
      el.classList.remove('vw-reveal-wait');
    }, delay + 700);
  }

  function initObserver() {
    if (!('IntersectionObserver' in window)) {
      // 老浏览器：不做动画，直接显示
      var all = collectTargets();
      for (var i = 0; i < all.length; i++) { all[i].dataset.vwRevealed = '1'; }
      return;
    }

    if (!observer) {
      observer = new IntersectionObserver(function (entries) {
        // 同一批进入视口的元素按顺序错峰
        var batch = [];
        for (var i = 0; i < entries.length; i++) {
          if (entries[i].isIntersecting) batch.push(entries[i].target);
        }
        batch.sort(function (a, b) {
          return a.getBoundingClientRect().top - b.getBoundingClientRect().top;
        });
        for (var k = 0; k < batch.length; k++) {
          var el = batch[k];
          observer.unobserve(el);
          reveal(el, Math.min(k * STAGGER, MAX_STAGGER));
        }
      }, {
        rootMargin: '0px 0px -8% 0px',   // 元素露出 8% 再触发，避免贴边就闪
        threshold: 0.01,
      });
    }

    var targets = collectTargets();
    for (var t = 0; t < targets.length; t++) {
      targets[t].classList.add('vw-reveal-wait');
      observer.observe(targets[t]);
    }
  }

  // ---- 卡片跟随光斑 ----------------------------------------------------
  var SPOTLIGHT_SELECTOR = [
    '.recent-post-item',
    '.card-widget',
    '.flink-list-item',
  ].join(',');

  var rafPending = false;
  var lastEvent = null;

  function applySpotlight() {
    rafPending = false;
    if (!lastEvent) return;
    var el = lastEvent.el;
    var r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
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
    // 只绑一次到 document，用委托 —— 不用管 PJAX 换掉了哪些卡片
    if (window.__vopthSpotlightBound) return;
    window.__vopthSpotlightBound = true;
    document.addEventListener('pointermove', onPointerMove, { passive: true });
  }

  // ---- 启动 ------------------------------------------------------------
  function boot() {
    if (!reduceMotion) {
      initObserver();
    }
    bindSpotlight();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }

  // PJAX 换页后重新扫描
  document.addEventListener('pjax:complete', function () {
    setTimeout(boot, 60);
  });
})();
