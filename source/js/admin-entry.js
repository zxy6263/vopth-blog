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
 *  要不要管 PJAX
 *    不用。站点的 _config.butterfly.yml 里 pjax.enable 是 false（当初因为「PJAX 与
 *    第三方脚本容易冲突」主动关掉的），所以链接就是普通的整页跳转。
 *    下面那个 pjax:complete 监听是保险：万一以后开了 PJAX，右下的 DOM 会重建，
 *    这行能让入口重新插回去。现在它不会触发，留着无害。
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

  // PJAX 开着的话右下角会随页面重建；现在 pjax 是关的，这行不触发
  document.addEventListener('pjax:complete', inject, false);
})();
