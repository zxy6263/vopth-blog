/**
 * 文章页的三个小增强。都只作用于 #article-container，不影响别的页面。
 *
 * ① 标题锚点复制
 *    主题给每个标题渲染了 <a class="headerlink" href="#xxx">，
 *    点了是跳转。但「分享某一小节」的场景里，用户其实要的是链接本身。
 *    改成：点击即复制完整绝对地址 + 右下角弹一句提示。
 *    仍然保留 URL hash 的更新（手动 pushState），所以浏览器地址栏照常变。
 *
 * ② 外链 ↗ 标记
 *    只给「真的会离开本站」的链接加，三个排除条件：
 *      · 同域（站内跳转不加）
 *      · 在 code / pre 里（代码里的 URL 不是链接）
 *      · 标题锚点（headerlink 是同页 hash，不算外链）
 *    用 CSS ::after 画箭头，不在 DOM 里塞字符 —— 复制链接时不会带上箭头。
 *
 * ③ 选中文字复制引用
 *    选中一段正文，旁边浮出「复制引用」，点了复制成：
 *        > 选中文本
 *        >
 *        > —— 摘自《标题》
 *        URL#小节
 *    只在有 hover 能力的设备上启用：触屏的长按选择菜单是系统级的，
 *    再叠一个气泡会打架。
 *
 * PJAX
 * ----
 * 换页后 #article-container 被替换，所以三个都要在 pjax:complete 重绑。
 * 用事件委托能省掉大部分，但「扫描加 class」这一步必须重跑。
 */
(function () {
  'use strict';

  if (window.__vopthPostEnhance) return;
  window.__vopthPostEnhance = true;

  var SELECTION_MIN = 4;
  var SELECTION_MAX = 500;

  // ======================================================================
  // 工具
  // ======================================================================
  function toast(msg) {
    var el = document.getElementById('vw-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'vw-toast';
      el.className = 'vw-toast';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add('vw-toast-show');
    clearTimeout(el._t);
    el._t = setTimeout(function () {
      el.classList.remove('vw-toast-show');
    }, 1800);
  }

  function copyText(text) {
    function legacyCopy() {
      // execCommand 路线：某些情况下 clipboard API 会被拒
      // （非安全上下文、没有用户激活、权限策略限制），这里兜底。
      return new Promise(function (resolve, reject) {
        var ta = document.createElement('textarea');
        ta.value = text;
        // 不能 display:none / visibility:hidden —— 那样 select() 拿不到内容
        ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        try {
          document.execCommand('copy') ? resolve() : reject(new Error('execCommand failed'));
        } catch (e) {
          reject(e);
        } finally {
          document.body.removeChild(ta);
        }
      });
    }

    if (navigator.clipboard && window.isSecureContext) {
      // 先试现代 API；失败（很可能是因为没有用户激活）再退回 execCommand
      return navigator.clipboard.writeText(text).catch(legacyCopy);
    }
    return legacyCopy();
  }

  function isExternal(a) {
    try {
      var u = new URL(a.href, location.href);
      return u.host !== location.host;
    } catch (e) {
      return false;
    }
  }

  // ======================================================================
  // ① 标题锚点复制
  // ======================================================================
  function onClickAnchor(e) {
    var a = e.target && e.target.closest ? e.target.closest('a.headerlink') : null;
    if (!a) return;

    var href = a.getAttribute('href') || '';
    if (!href) return;

    e.preventDefault();

    var url = location.origin + location.pathname + href;

    // 地址栏仍然跟着变（保留主题「滚动时地址栏跟随」的行为一致性）
    try { history.pushState(null, '', href); } catch (err) {}

    copyText(url).then(function () {
      toast('已复制本节链接');
    }).catch(function () {
      toast('复制失败，请手动复制地址栏');
    });
  }

  // ======================================================================
  // ② 外链 ↗ 标记
  // ======================================================================
  function markExternalLinks() {
    var root = document.getElementById('article-container');
    if (!root) return;

    var links = root.querySelectorAll('a[href^="http"]');
    for (var i = 0; i < links.length; i++) {
      var a = links[i];
      if (a.dataset.vwExt === '1') continue;            // 已处理
      if (a.classList.contains('headerlink')) continue;  // 标题锚点，不是外链
      if (a.closest('pre, code, .highlight')) continue; // 代码里的不算
      if (!isExternal(a)) continue;

      a.dataset.vwExt = '1';
      a.classList.add('vw-ext-link');
      // 无障碍：让读屏软件也知道会离开本站
      if (!a.getAttribute('title')) {
        a.setAttribute('title', (a.textContent || '').trim() + '（站外链接）');
      }
    }
  }

  // ======================================================================
  // ③ 选中文字复制引用
  // ======================================================================
  var bubble = null;
  var lastSelectionText = '';

  function ensureBubble() {
    if (bubble) return bubble;
    bubble = document.createElement('button');
    bubble.type = 'button';
    bubble.className = 'vw-quote-btn';
    bubble.textContent = '复制引用';
    bubble.hidden = true;
    document.body.appendChild(bubble);

    bubble.addEventListener('mousedown', function (e) {
      // 阻止默认，否则点击会让选区消失，拿不到 text
      e.preventDefault();
      e.stopPropagation();
    });

    bubble.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();

      var text = lastSelectionText;
      if (!text) return;

      var title = (document.querySelector('#article-container .post-title, .post-title') || {})
        .textContent || document.title;
      title = title.trim().replace(/\s+/g, ' ');

      // 引用块里的每一行前面都要有 "> "
      var quoted = text.split('\n').map(function (l) { return '> ' + l; }).join('\n');
      var url = location.origin + location.pathname + location.hash;

      var payload = quoted + '\n>\n> —— 摘自《' + title + '》\n' + url;

      copyText(payload).then(function () {
        toast('已复制引用');
      }).catch(function () {
        toast('复制失败');
      });

      hideBubble();
      try { window.getSelection().removeAllRanges(); } catch (err) {}
    });

    return bubble;
  }

  function hideBubble() {
    if (bubble) bubble.hidden = true;
    lastSelectionText = '';
  }

  function onSelectionEnd() {
    // 等一下，让 selection 稳定下来
    setTimeout(function () {
      var sel = window.getSelection();
      if (!sel || sel.isCollapsed) { hideBubble(); return; }

      var text = (sel.toString() || '').trim();
      if (text.length < SELECTION_MIN || text.length > SELECTION_MAX) { hideBubble(); return; }

      // 选区必须在正文里
      var root = document.getElementById('article-container');
      if (!root) { hideBubble(); return; }
      var anchorNode = sel.anchorNode;
      if (!anchorNode || !root.contains(anchorNode.nodeType === 3 ? anchorNode.parentNode : anchorNode)) {
        hideBubble();
        return;
      }

      var range = sel.getRangeAt(0);
      var rect = range.getBoundingClientRect();
      if (!rect || (rect.width === 0 && rect.height === 0)) { hideBubble(); return; }

      lastSelectionText = text;

      var btn = ensureBubble();
      btn.hidden = false;

      // 定位：选区上方居中，超出视口就翻到下方
      var bw = btn.offsetWidth || 92;
      var bh = btn.offsetHeight || 30;
      var left = rect.left + rect.width / 2 - bw / 2;
      var top = rect.top - bh - 8;

      left = Math.max(8, Math.min(left, window.innerWidth - bw - 8));
      if (top < 8) top = rect.bottom + 8;   // 上方放不下就放下面

      btn.style.left = left + 'px';
      btn.style.top = (top + window.scrollY) + 'px';
    }, 10);
  }

  // ======================================================================
  // 绑定
  // ======================================================================
  function boot() {
    markExternalLinks();

    // 触屏设备不启用「复制引用」——系统长按菜单已经够用，再叠气泡会打架
    var canHover = window.matchMedia && window.matchMedia('(hover: hover)').matches;
    if (!canHover) return;

    if (!window.__vopthQuoteBound) {
      window.__vopthQuoteBound = true;
      document.addEventListener('mouseup', function (e) {
        // 点在气泡自己身上时不重新计算
        if (bubble && bubble.contains(e.target)) return;
        onSelectionEnd();
      });
      // 滚动或点空白处收起来
      window.addEventListener('scroll', hideBubble, { passive: true });
      document.addEventListener('mousedown', function (e) {
        if (bubble && bubble.contains(e.target)) return;
        var sel = window.getSelection();
        if (!sel || sel.isCollapsed) hideBubble();
      });
    }
  }

  // 锚点点击用委托，PJAX 后不用重绑
  if (!window.__vopthAnchorBound) {
    window.__vopthAnchorBound = true;
    document.addEventListener('click', onClickAnchor, false);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') hideBubble();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }

  document.addEventListener('pjax:complete', function () {
    setTimeout(boot, 80);
  });
})();
