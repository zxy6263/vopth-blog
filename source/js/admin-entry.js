/* ===========================================================================
 *  右下角「设置」里加一个进后台的入口
 *
 *  加在哪
 *    主题的右下角是一组按钮，结构是：
 *      #rightside
 *        #rightside-config-hide      <- 点齿轮后滑出来的那一组
 *          #darkmode                 夜间模式
 *          #hide-aside-btn           单栏/双栏
 *        #rightside-config-show
 *          #rightside-config         齿轮（点它展开上面那组）
 *          #go-up                    回到顶部
 *
 *    所以「设置里面」= #rightside-config-hide，插进去的按钮会跟着齿轮一起滑出来。
 *
 *  为什么用 <a> 而不是 <button>
 *    主题的样式选择器是 `#rightside > div > a`（和 button 并列），所以 <a> 自动
 *    就有完全一样的 35x35 圆角方块外观、hover 阴影和图标弹跳动画 —— 一行 CSS 都不用写。
 *    而且 <a> 支持中键新标签页打开，对一个「进后台」的链接来说更合适。
 *
 *  PJAX
 *    2026-10-10 起 _config.butterfly.yml 的 pjax.enable 改成了 true（为了音乐
 *    播放器能跨页不断）。主题的 PJAX 会替换 #rightside-config-hide，右下角这组
 *    按钮是【重建】的 —— 所以必须靠下面的 pjax:complete 把入口重新插回去。
 *    当初写这个钩子时 pjax 还是关的（注释写的是"留着无害"），现在它真正在干活。
 *    删掉那一行的话：PJAX 翻页之后，右下角设置里就找不到进后台的入口了。
 *
 *  不想用这个入口：删掉 _config.butterfly.yml 里 inject.bottom 的那一行即可，
 *  不影响主题和后台的任何功能。
 * ========================================================================= */

(function () {
  'use strict';

  function inject() {
    var box = document.getElementById('rightside-config-hide');
    if (!box) return;                                  // 非文章页/极端窄屏可能没有
    if (document.getElementById('admin-entry')) return; // 已经插过了

    var a = document.createElement('a');
    a.id = 'admin-entry';
    a.href = '/admin/';
    a.title = '后台（写文章）';
    a.setAttribute('aria-label', '后台（写文章）');
    a.innerHTML = '<i class="fas fa-pen-to-square"></i>';

    box.appendChild(a);
  }

  inject();

  // PJAX 会重建 #rightside-config-hide，所以每次换页都要重新插一次
  document.addEventListener('pjax:complete', inject, false);
})();
