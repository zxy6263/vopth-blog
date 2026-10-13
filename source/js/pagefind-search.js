/**
 * 站内搜索 —— 用 Pagefind 接管主题的搜索弹层
 *
 * 为什么要换掉主题自带的搜索
 * --------------------------
 * Butterfly 用的是 hexo-generator-searchdb + 主题的 local-search.js，
 * 那个前端的分词方式是「按空格切词 + indexOf 完整子串匹配」：
 *
 *     const keywords = searchText.split(/[-\s]+/)      // 只按空格和连字符切
 *     while ((position = text.indexOf(searchWord, ...)) > -1)
 *
 * 中文没有空格，所以整句会变成一个超长字符串。2026-10-12 实测（11 篇文章）：
 *
 *     搜「服务器」         → 8 篇   ✅
 *     搜「Cloudflare 部署」 → 2 篇   ✅（空格分隔的两个词）
 *     搜「云服务器配置」    → 0 篇   ❌
 *     搜「静默失败的坑」    → 0 篇   ❌
 *     搜「封面 裁切」       → 0 篇   ❌（两个词在不同段落就搜不到）
 *
 * 还有一个副作用：索引里存的是 HTML 正文，主题把它当纯文本吃，
 * 于是搜「class」命中 11 篇、「strong」命中 10 篇 —— 全是标签名，纯噪音。
 *
 * 换成 Pagefind 之后（同样 11 篇文章，同一批查询）：
 *     「云服务器配置」→ 3 条　「静默失败的坑」→ 3 条　「封面 裁切」→ 1 条
 *     「class」→ 1 条（真实命中，那篇确实在讨论 CSS class）
 *
 * 本文件做的事
 * ------------
 * 主题的搜索弹层（外观、开关动画、遮罩、Ctrl+K 快捷键）全都保留，
 * 只把里面的输入框和结果区换成 Pagefind UI。
 * 这样视觉上和站点原本的搜索框是同一套东西，不用重做 UI。
 *
 * ⚠️ 主题自己的 local-search.js 仍然会被加载并运行 ——
 *    它往 #local-search-results 里写的东西我们已经隐藏了，所以看不见。
 *    代价是打开搜索时它会多下载一次 search.xml（约 139 KB）。
 *    后续优化方向：把 _config.butterfly.yml 的 local_search.preload 关掉，
 *    或者干脆去掉 hexo-generator-searchdb。
 *
 * 配套改动
 * --------
 *   tools/post-build.js      给文章页注入 data-pagefind-body（限定索引范围）
 *   package.json             build 里加一步 pagefind --site public
 *   _config.butterfly.yml    通过 inject 加载本文件 + Pagefind UI 的 css/js
 */

(function () {
  'use strict';

  var MOUNT_ID = 'pagefind-search';

  // 主题弹层里那几个元素要藏起来（它们属于主题的旧搜索）
  var HIDE = [
    '#loading-database',
    '.local-search-input',
    '#local-search-results',
    '#local-search-pagination',
    '#local-search-stats',
  ];

  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  /**
   * 等 window.PagefindUI 出现。
   * 它是 defer 加载的，和本文件的执行顺序不保证，
   * 所以不能假设此刻已经就绪。
   */
  function waitForUI(cb, tries) {
    tries = tries || 0;
    if (typeof window.PagefindUI === 'function') {
      cb();
      return;
    }
    if (tries > 120) {
      // 12 秒还没等到 —— 多半是 /pagefind/pagefind-ui.js 404 了
      // （本地 hexo server 不会跑 pagefind，只有 npm run build 之后才有）
      console.warn('[pagefind-search] PagefindUI 没加载出来，搜索不可用。' +
        '本地预览请用 npm run preview（它会先构建再起静态服务器）。');
      return;
    }
    setTimeout(function () { waitForUI(cb, tries + 1); }, 100);
  }

  /** 弹层打开后把光标放进 Pagefind 的输入框 */
  function focusInput() {
    var box = document.getElementById(MOUNT_ID);
    if (!box) return;
    var input = box.querySelector('input[type="text"], input[type="search"], input');
    if (input) {
      try { input.focus(); } catch (e) { /* 忽略 */ }
    }
  }

  function mount() {
    var dialog = document.querySelector('#local-search .search-dialog');
    if (!dialog) return;                              // 这个页面没有搜索弹层
    if (document.getElementById(MOUNT_ID)) return;    // 已经挂过，幂等

    HIDE.forEach(function (sel) {
      var el = dialog.querySelector(sel);
      if (el) el.style.display = 'none';
    });

    var box = document.createElement('div');
    box.id = MOUNT_ID;
    dialog.appendChild(box);

    waitForUI(function () {
      /* eslint-disable no-new */
      new window.PagefindUI({
        element: '#' + MOUNT_ID,
        showImages: false,        // 文章没有配图，省掉图片列
        showEmptyFilters: false,
        translations: {
          placeholder: '搜索文章…',
          clear_search: '清空',
          load_more: '加载更多',
          search_label: '站内搜索',
          filters_label: '筛选',
          zero_results: '没有找到「[SEARCH_TERM]」相关的内容',
          many_results: '找到 [COUNT] 条与「[SEARCH_TERM]」相关的内容',
          one_result: '找到 1 条与「[SEARCH_TERM]」相关的内容',
          alt_search: '没有「[SEARCH_TERM]」的结果，换成「[DIFFERENT_TERM]」试试',
          search_suggestion: '没有「[SEARCH_TERM]」的结果，试试下面这些',
          searching: '搜索「[SEARCH_TERM]」中…',
        },
      });
      /* eslint-enable no-new */

      // 弹层每次打开都聚焦输入框（主题的快捷键/按钮负责打开）
      document.addEventListener('click', function (e) {
        var t = e.target;
        if (!t || !t.closest) return;
        if (t.closest('#search-button') || t.closest('.search-close-button')) {
          setTimeout(focusInput, 350);   // 等弹层的动画结束
        }
      });

      // 直接按斜杠 / Ctrl+K 也聚焦
      document.addEventListener('keydown', function (e) {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
          setTimeout(focusInput, 350);
        }
      });
    });
  }

  ready(mount);

  // PJAX 翻页后如果弹层被重建，需要重新挂一次（幂等，重复调用无害）
  document.addEventListener('pjax:complete', mount);
})();
