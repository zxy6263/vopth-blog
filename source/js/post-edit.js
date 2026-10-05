/* ===========================================================================
 *  文章底部「在 GitHub 上编辑此页」
 *
 *  为什么不是直接开主题的 post_edit？
 *      主题确实有 post_edit 开关，但它把这个链接渲染在【文章头部】的
 *      post-info 里（includes/header/post-info.pug），和「发表于 / 更新于」
 *      挤在一行。站主要的是文章【底部】。
 *      所以：配置里打开 post_edit 拿到那个带正确路径的 <a>（路径是构建时
 *      由 page.source 生成的，前端自己拼不出来），再由这个脚本把它挪到底部、
 *      换个更清楚的措辞。
 *
 *  为什么路径必须交给主题生成：
 *      GitHub 的编辑地址要精确到 source/_posts/xxx.md。前端拿不到这个路径，
 *      只能靠主题在构建时写进 href。
 *
 *  仓库是公开的：读者点进去只能「fork 后提 PR」，不能直接改你的仓库。
 * ========================================================================= */

(function () {
  'use strict';

  function relink() {
    // 主题渲染出来的那个链接，可能还不存在（非文章页就没有）
    var link = document.querySelector('#post-info .post-edit-link, .post-edit-link');
    if (!link) return;

    // 已经搬过了就别重复搬（PJAX 切回来会重新执行）
    if (link.classList.contains('post-edit-footer-link')) return;

    var article = document.getElementById('article-container');
    if (!article || !article.parentNode) return;

    var box = document.createElement('div');
    box.className = 'post-edit-footer';

    var href = link.getAttribute('href') || '';
    box.innerHTML =
      '<a class="post-edit-footer-link" href="' + href + '" target="_blank" rel="noopener">' +
        '<i class="fas fa-pen-to-square" aria-hidden="true"></i>' +
        '在 GitHub 上编辑此页' +
      '</a>' +
      '<span class="post-edit-footer-hint">发现错字或者有更好的写法？点左边直接改，改动会进这个仓库</span>';

    // 插到正文之后、版权/相关阅读之前 —— 也就是「文章读完了」的位置
    article.parentNode.insertBefore(box, article.nextSibling);

    // 把主题原来那个从头部移除，避免同一件事出现两次
    link.parentNode.removeChild(link);
  }

  relink();
  // PJAX 切换页面后 DOM 是新的，需要再跑一次
  if (window.btf && typeof window.btf.addEventListenerPjax === 'function') return;
  document.addEventListener('pjax:complete', relink, false);
  document.addEventListener('DOMContentLoaded', relink, false);
})();
