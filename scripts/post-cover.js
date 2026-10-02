/**
 * 文章封面图：约定式自动匹配
 *
 * 解决的问题：
 *   每篇文章都手动写 `cover:` 很麻烦，而且很容易忘。
 *   这里做一层约定 —— 只要把图片按【文章文件名】命名放进 source/img/covers/，
 *   构建时会自动挂到那篇文章上，front-matter 一个字都不用改。
 *
 * 优先级（从高到低）：
 *   1. 文章 front-matter 里写了 cover: /img/xxx.jpg   -> 用它，本脚本不插手
 *   2. source/img/covers/<文章文件名>.jpg|jpeg|png|webp|gif  -> 自动匹配
 *   3. _config.butterfly.yml 的 cover.default_cover   -> 主题随机渐变图
 *
 * 例子：
 *   文章  source/_posts/my-first-post.md
 *   封面  source/img/covers/my-first-post.jpg
 *   -> 自动生效，无需任何配置
 *
 * 为什么文件名要用英文 slug？
 *   因为匹配靠的就是文件名。中文文件名虽然技术上也能匹配，
 *   但 URL 会变成一长串百分号编码，很难维护。
 *
 * 自动匹配时会往构建日志打一行 `Post cover auto-assigned: ...`，
 * 方便确认到底有没有匹配上（避免"静默不生效"这种最难查的问题）。
 */

'use strict';

const fs = require('fs');
const path = require('path');

// 封面图存放目录（相对 source/）
const COVER_DIR = 'img/covers';

// 支持的扩展名，按优先级从上到下
const EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];

hexo.extend.filter.register('before_post_render', function (data) {
  // 手动指定过封面就不插手
  if (data.cover) return data;

  // 用 slug 匹配；没有 slug 时从 source 路径推（例如 _posts/my-post.md）
  let slug = data.slug;
  if (!slug && data.source) {
    slug = path.basename(data.source, path.extname(data.source));
  }
  if (!slug) return data;

  const dir = path.join(hexo.source_dir, COVER_DIR);

  for (const ext of EXTS) {
    const fileName = slug + ext;
    if (fs.existsSync(path.join(dir, fileName))) {
      data.cover = `/${COVER_DIR}/${fileName}`;
      hexo.log.info('Post cover auto-assigned: %s -> %s', slug, data.cover);
      return data;
    }
  }

  // 没匹配到就交给主题的 default_cover
  return data;
});
