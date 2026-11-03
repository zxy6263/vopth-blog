/**
 * 点击绽开的小粒子特效。
 *
 * 为什么不用 mouse-firework 之类的 npm 包
 * -----------------------------------------
 * 那些包要额外引一个 CDN 脚本（本站 CDN 全部走 local，见 _config.butterfly.yml），
 * 而这个效果本身只有几十行 —— 自己写能：
 *   · 配色跟站点主色走（#4a6cf7 / #00c4b6），不引入不搭调的色板
 *   · 零外部请求，不受 CDN 波动影响
 *   · 只在真有指针设备的场合启用
 *
 * 与 PJAX 的兼容
 * --------------
 * 监听器挂在 document 上，不绑定具体元素 —— PJAX 换页时 DOM 被替换，
 * 但 document 不换，所以不需要在 pjax:complete 里重新初始化。
 * canvas 也只创建一次，挂在 <body> 直属下。
 *
 * 降级
 * ----
 * · 系统开了「减少动态效果」→ 完全不开
 * · 纯触屏设备（没有 hover 能力）→ 不开，点一下就冒粒子在手机上很吵
 */
(function () {
  'use strict';

  // ---- 开关 ----------------------------------------------------------------
  var CONFIG = {
    colors: ['#4a6cf7', '#00c4b6', '#7b5cf7', '#ffd166'],  // 站点主色 + 两个点缀
    count: 16,          // 每次点击的粒子数
    speed: 2.6,         // 初速度（px/帧）
    gravity: 0.12,      // 重力
    friction: 0.965,    // 阻尼
    life: 620,          // 存活时长（ms）
    size: 2.6,          // 粒子半径
  };

  // ---- 环境判断 ------------------------------------------------------------
  if (window.__vopthClickFirework) return;   // 避免重复初始化
  window.__vopthClickFirework = true;

  var reduceMotion = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduceMotion) return;

  // 纯触屏设备（没有精细指针）不启用
  var finePointer = window.matchMedia &&
    window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  if (!finePointer) return;

  // ---- canvas --------------------------------------------------------------
  var canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText =
    'position:fixed;top:0;left:0;width:100%;height:100%;' +
    'pointer-events:none;z-index:9999999;';
  var ctx = canvas.getContext('2d');
  var dpr = 1;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  var particles = [];
  var rafId = null;
  var lastTs = 0;

  function loop(ts) {
    var dt = lastTs ? Math.min(ts - lastTs, 48) : 16;
    lastTs = ts;

    var step = dt / 16.67;   // 以 60fps 为基准归一化，帧率不同速度一致

    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

    for (var i = particles.length - 1; i >= 0; i--) {
      var p = particles[i];
      p.age += dt;
      if (p.age >= p.life) {
        particles.splice(i, 1);
        continue;
      }

      p.vx *= Math.pow(CONFIG.friction, step);
      p.vy = p.vy * Math.pow(CONFIG.friction, step) + CONFIG.gravity * step;
      p.x += p.vx * step;
      p.y += p.vy * step;

      var t = p.age / p.life;          // 0 -> 1
      var alpha = 1 - t * t;           // 先慢后快淡出
      var r = p.size * (1 - 0.55 * t); // 逐渐缩小

      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalAlpha = 1;

    if (particles.length > 0) {
      rafId = requestAnimationFrame(loop);
    } else {
      rafId = null;
      lastTs = 0;
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    }
  }

  function burst(x, y) {
    for (var i = 0; i < CONFIG.count; i++) {
      var angle = (Math.PI * 2 * i) / CONFIG.count + Math.random() * 0.6;
      var speed = CONFIG.speed * (0.55 + Math.random() * 0.9);
      particles.push({
        x: x,
        y: y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 0.6,
        color: CONFIG.colors[(Math.random() * CONFIG.colors.length) | 0],
        size: CONFIG.size * (0.7 + Math.random() * 0.7),
        age: 0,
        life: CONFIG.life * (0.75 + Math.random() * 0.5),
      });
    }
    if (rafId === null) {
      lastTs = 0;
      rafId = requestAnimationFrame(loop);
    }
  }

  // ---- 事件 ----------------------------------------------------------------
  function onPointerDown(e) {
    // 只响应鼠标左键；触屏的 pointerdown 在 finePointer 判断里已经挡掉了
    if (e.button !== undefined && e.button !== 0) return;
    burst(e.clientX, e.clientY);
  }

  function boot() {
    resize();
    document.body.appendChild(canvas);
    window.addEventListener('resize', resize, { passive: true });
    // 用 pointerdown 而不是 click：按下的瞬间就有反馈，比等 mouseup 更快
    document.addEventListener('pointerdown', onPointerDown, { passive: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
