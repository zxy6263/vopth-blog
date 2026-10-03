/* ===========================================================================
 *  首页个人简介卡片
 *  只在站点首页（/）插入，其他页面不受影响。
 *  插入位置：#recent-posts 的第一个子元素，也就是出现在文章列表上方。
 *
 *  不想用这个卡片：删掉 _config.butterfly.yml 里 inject.bottom 的那一行即可，
 *  不会影响主题本身的任何功能。
 * ========================================================================= */
(function () {
  'use strict';

  // 只在首页插入（/page/2/ 这类分页不插入，避免重复占位）
  var path = window.location.pathname.replace(/index\.html$/, '');
  if (path !== '/' && path !== '') return;

  var posts = document.getElementById('recent-posts');
  if (!posts) return;                                 // 归档 / 标签 / 分类页没有这个容器
  if (document.querySelector('.ph-card')) return;      // 防重复插入

  var html = [
    '<div class="ph-card">',
    '  <div class="ph-avatar">',
    '    <img src="/img/avatar.jpg" alt="vopth" width="88" height="88">',
    '  </div>',
    '  <div class="ph-body">',
    '    <div class="ph-name">vopth<span class="ph-badge">deepseek忠实合作伙伴</span></div>',
    '    <p class="ph-bio">deepseek忠实合作伙伴。这里记录我的技术笔记、踩坑记录和一些日常。</p>',
    '    <div class="ph-links">',
    '      <a href="https://github.com/zxy6263" target="_blank" rel="noopener"><i class="fab fa-github"></i>GitHub</a>',
    '      <a href="mailto:3585648116@qq.com"><i class="fas fa-envelope"></i>邮箱</a>',
    '      <a href="/about/"><i class="fas fa-user"></i>关于我</a>',
    '      <a href="/subscribe/"><i class="fas fa-rss"></i>RSS 订阅</a>',
    '    </div>',
    '  </div>',
    '</div>'
  ].join('\n');

  var holder = document.createElement('div');
  holder.innerHTML = html;
  posts.insertBefore(holder.firstChild, posts.firstChild);
})();
