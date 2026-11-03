/**
 * 深色模式切换的「圆形扩散」过渡动画。
 *
 * 来源
 * ----
 * 参考 https://www.tangyuxian.com/.../mei-hua-wang-ye-zhu-ti-qie-huan-de-jian-bian-dong-hua/
 * 它那套是：View Transitions API + 一张会动的 GIF 当 mask，
 * 新主题从 GIF 的形状里「长」出来（mask-size 0 -> 2000vmax）。
 *
 * 这里改成「从点击位置扩散的圆」，原因：
 *   · 不用额外托管一张 GIF（那位的 GIF 来自 tenor，国内直连不稳）
 *   · 圆形扩散在任何主题配色下都不会显得突兀
 *   · 想换成图片遮罩也简单，见下面 MASK_MODE 常量
 *
 * 为什么用「捕获阶段拦截 + 重放点击」而不是自己调主题函数
 * ------------------------------------------------------
 * 主题的切换在 rightSideFn.darkmode 里，那个对象没有暴露到 window
 * （window.btf 上只有 saveToLocal / activateDarkMode / activateLightMode）。
 * 自己重写一遍就得复制 snackbar、saveToLocal、handleThemeChange 三处逻辑，
 * 以后主题升级就跟不上了。
 * 所以：document 上 capture 拦点击 -> stopImmediatePropagation 掐断主题的处理
 *      -> startViewTransition 回调里重新点一次按钮，让主题走它自己的完整流程。
 *      用 bypass 标志防止自己的拦截器再次拦截这次重放。
 *
 * 降级
 * ----
 * · 浏览器不支持 startViewTransition -> 直接放行，主题照常瞬间切换
 * · 系统开了「减少动态效果」      -> 同上
 */
(function () {
  'use strict';

  if (window.__vopthThemeTransition) return;
  window.__vopthThemeTransition = true;

  var CONFIG = {
    // 'circle'  = 从点击位置扩散的圆（默认，无需素材）
    // 'mask'    = 用一张图片/动图当遮罩，把 MASK_URL 换成你自己的
    mode: 'circle',
    maskUrl: '',
    duration: 620,          // ms
  };

  if (typeof document.startViewTransition !== 'function') return;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  var bypass = false;

  // ---- 计算扩散半径：从点击点算到最远的那个角 --------------------------
  function revealRadius(x, y) {
    var w = window.innerWidth;
    var h = window.innerHeight;
    var dx = Math.max(x, w - x);
    var dy = Math.max(y, h - y);
    return Math.hypot(dx, dy);
  }

  // 每次切换前把圆心和半径写进 CSS 变量，供 keyframes 使用
  function setOrigin(x, y) {
    var r = revealRadius(x, y);
    document.documentElement.style.setProperty('--vw-tt-x', x + 'px');
    document.documentElement.style.setProperty('--vw-tt-y', y + 'px');
    document.documentElement.style.setProperty('--vw-tt-r', r + 'px');
    document.documentElement.style.setProperty('--vw-tt-dur', CONFIG.duration + 'ms');
  }

  // ---- 捕获阶段拦截 ----------------------------------------------------
  document.addEventListener('click', function (e) {
    if (bypass) return;                                  // 这是我们自己重放的，放行

    var btn = e.target && e.target.closest && e.target.closest('#darkmode');
    if (!btn) return;

    // 把主题自己的 click 处理掐断
    e.preventDefault();
    e.stopImmediatePropagation();

    var rect = btn.getBoundingClientRect();
    setOrigin(rect.left + rect.width / 2, rect.top + rect.height / 2);

    var root = document.documentElement;
    root.classList.add('vw-tt-active');
    root.classList.add(CONFIG.mode === 'mask' && CONFIG.maskUrl ? 'vw-tt-mask' : 'vw-tt-circle');
    if (CONFIG.mode === 'mask' && CONFIG.maskUrl) {
      root.style.setProperty('--vw-tt-mask-url', 'url("' + CONFIG.maskUrl + '")');
    }

    document.startViewTransition(function () {
      // 重放点击：bypass 期间不拦截，让主题走完整流程
      bypass = true;
      btn.click();
      bypass = false;
    }).finished.finally(function () {
      root.classList.remove('vw-tt-active');
      root.classList.remove('vw-tt-circle');
      root.classList.remove('vw-tt-mask');
    });
  }, true);
})();
