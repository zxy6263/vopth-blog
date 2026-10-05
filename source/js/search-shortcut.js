/* ===========================================================================
 *  搜索快捷键
 *
 *  Ctrl+K（Mac 上是 Cmd+K）或直接按 / 打开站内搜索。
 *
 *  主题的搜索是用这个方式打开的：
 *      btf.addEventListenerPjax(document.querySelector('#search-button > .search'), 'click', ...)
 *  所以我不用去碰它的内部逻辑，模拟一次 click 就行 —— 主题改版也不会失效。
 *
 *  两个细节：
 *    · 只在「没在输入框里打字」时响应 /，否则你在评论区打斜杠会被抢走
 *    · Ctrl+K 不受输入框限制（浏览器/编辑器里这也是通用快捷键，用户是有意按的），
 *      但要 preventDefault，否则 Chrome 会打开地址栏搜索
 * ========================================================================= */

(function () {
  'use strict';

  function isTyping(el) {
    if (!el) return false;
    var tag = (el.tagName || '').toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable === true;
  }

  function openSearch() {
    var btn = document.querySelector('#search-button > .search') ||
              document.querySelector('#search-button');
    if (!btn) return false;
    btn.click();
    return true;
  }

  document.addEventListener('keydown', function (e) {
    var key = (e.key || '').toLowerCase();

    // Ctrl+K / Cmd+K —— 不管焦点在哪都响应
    if ((e.ctrlKey || e.metaKey) && key === 'k') {
      e.preventDefault();
      openSearch();
      return;
    }

    // / —— 只有在没打字、也没按修饰键时才响应
    if (key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !isTyping(e.target)) {
      e.preventDefault();
      openSearch();
    }
  }, false);
})();
