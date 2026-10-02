/**
 * 给每篇文章自动加上作者署名（头像 + 名字）
 *
 * 为什么用 Hexo 过滤器而不是 JS？
 *   1. 服务端渲染 —— 关掉 JS 也能看到，对 SEO 也更友好；
 *   2. 一次写好，以后【所有新文章自动生效】，不用每篇手动加；
 *   3. 主题的 post-info.pug 里完全没有 author 相关代码，没有配置项可用。
 *
 * 插入位置：文章标题 </h1> 之后、文章元信息 #post-meta 之前。
 * 识别方式：`<h1 class="post-title"` 只出现在文章页，首页/归档页都没有，
 *          所以不需要依赖 layout 判断，也不会误伤其他页面。
 *
 * 默认值取自站点配置：
 *   名字   <- _config.yml 的 author
 *   头像   <- _config.butterfly.yml 的 avatar.img（和侧边栏头像保持一致）
 *   链接   -> /about/
 *
 * 单篇文章可以用 front-matter 覆盖：
 *   author_name: 另一个名字
 *   author_avatar: /img/other.jpg
 *   author_link: https://example.com
 *   author_avatar: false          # 这篇不要署名
 */

'use strict';

const { escapeHTML } = require('hexo-util');

const TITLE_MARKER = '<h1 class="post-title"';
const TITLE_CLOSE = '</h1>';

/**
 * 属性值转义。
 * 不用 hexo-util 的 escapeHTML：它会把 / 也转成 &#x2F;，
 * 对 URL 完全没必要，而且让生成的 HTML 很难读。
 * 属性值只需要防住 & " < > 这四个字符。
 */
function escapeAttr(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

hexo.extend.filter.register('after_render:html', function (html, data) {
  if (typeof html !== 'string') return html;

  const start = html.indexOf(TITLE_MARKER);
  if (start === -1) return html; // 不是文章页，直接放行

  const h1End = html.indexOf(TITLE_CLOSE, start);
  if (h1End === -1) return html;
  const insertAt = h1End + TITLE_CLOSE.length;

  const page = (data && data.page) || {};

  // 允许单篇文章关掉署名
  if (page.author_avatar === false) return html;

  const siteConfig = hexo.config || {};
  const themeConfig = hexo.theme.config || {};

  const name = page.author_name || siteConfig.author || '';
  const avatar = page.author_avatar
    || (themeConfig.avatar && themeConfig.avatar.img)
    || '';
  const link = page.author_link || '/about/';

  if (!name && !avatar) return html;

  const safeName = escapeHTML(String(name));
  const safeAvatar = escapeAttr(avatar);
  const isExternal = /^https?:\/\//i.test(String(link));
  const safeLink = escapeAttr(link);
  const linkAttrs = isExternal ? ' target="_blank" rel="noopener"' : ' rel="author"';

  const img = avatar
    ? `<img src="${safeAvatar}" alt="${safeName}" width="40" height="40" loading="lazy">`
    : '';
  const label = name ? `<span class="post-author-name">${safeName}</span>` : '';

  const block = `<div class="post-author"><a href="${safeLink}"${linkAttrs}>${img}${label}</a></div>`;

  return html.slice(0, insertAt) + block + html.slice(insertAt);
});
