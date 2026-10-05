// 追加到导出后的后台页面里的自测脚本。
// 不走 iframe —— 直接在本页运行，避开 iframe load 时序那一堆坑。
// 结果写进 #rep（由 dump 脚本插到最前面）。
(function () {
  'use strict';
  var F = String.fromCharCode(96) + String.fromCharCode(96) + String.fromCharCode(96);
  var L = [];
  function J(s) { return JSON.stringify(s); }

  // 结果框：页面本身没有，自己造一个钉在左上角
  function rep() {
    var el = document.getElementById('rep');
    if (!el) {
      el = document.createElement('pre');
      el.id = 'rep';
      el.style.cssText = 'position:fixed;left:0;top:0;right:0;z-index:99999;background:#000;color:#0f0;'
        + 'margin:0;padding:10px;font:13px/1.7 monospace;white-space:pre;max-height:100vh;overflow:auto';
      document.body.insertBefore(el, document.body.firstChild);
    }
    return el;
  }

  function run() {
    var ta = document.getElementById('content');
    if (!ta) { rep().textContent = 'FAIL: 找不到 #content'; return; }
    function click(k) {
      var b = document.querySelector('[data-insert="' + k + '"]');
      if (b) b.click(); else L.push('  !!! 没找到按钮 ' + k);
    }
    function reset() { ta.value = ''; ta.setSelectionRange(0, 0); }
    function sel() { return ta.value.substring(ta.selectionStart, ta.selectionEnd); }

    L.push('工具条按钮数 = ' + document.querySelectorAll('#mdTools button[data-insert]').length);
    L.push('');

    reset(); click('note-info');
    L.push('[提示]    ' + J(ta.value));
    L.push('          选中=' + J(sel()) + '   ' + (ta.value.indexOf('{% note info flat %}') === 0 && sel().indexOf('这里写提示内容') >= 0 ? 'OK' : 'FAIL'));

    reset(); click('label');
    L.push('[标签]    ' + J(ta.value) + '   选中=' + J(sel()) + '   ' + (ta.value === '{% label 文字 primary %}' ? 'OK' : 'FAIL'));

    reset(); click('code');
    L.push('[代码块]  ' + J(ta.value));
    L.push('          反引号数=' + (ta.value.split(String.fromCharCode(96)).length - 1) + '   ' + (ta.value === F + '\n\n' + F ? 'OK' : 'FAIL'));

    reset(); click('btn');
    L.push('[按钮]    ' + J(ta.value));

    reset(); click('tabs');
    L.push('[分栏]    ' + J(ta.value.substring(0, 40)) + ' …   ' + (ta.value.indexOf('{% tabs') === 0 && ta.value.indexOf('{% endtabs %}') > 0 ? 'OK' : 'FAIL'));

    reset(); click('hide');
    L.push('[折叠]    ' + J(ta.value.substring(0, 40)) + ' …   ' + (ta.value.indexOf('{% hideToggle') === 0 ? 'OK' : 'FAIL'));

    reset(); click('img');
    L.push('[图片]    ' + J(ta.value));

    reset(); ta.value = '我的文字'; ta.setSelectionRange(0, 4); click('label');
    L.push('[选中后插] ' + J(ta.value) + '   ' + (ta.value.indexOf('{% label 我的文字 primary %}') >= 0 ? 'OK' : 'FAIL'));

    reset(); ta.value = 'AAABBB'; ta.setSelectionRange(3, 3); click('label');
    L.push('[光标处插] ' + J(ta.value) + '   ' + (ta.value.indexOf('AAA{% label') === 0 ? 'OK' : 'FAIL'));

    reset(); click('skeleton');
    L.push('[骨架]    长度=' + ta.value.length + '   开头=' + J(ta.value.substring(0, 18)));
    L.push('          草稿提示=' + J((document.getElementById('draftInfo') || {}).textContent));

    var bad = L.filter(function (x) { return x.indexOf('FAIL') >= 0 || x.indexOf('!!!') >= 0; }).length;
    L.push('');
    L.push(bad === 0 ? '===== 全部通过 =====' : '===== 有 ' + bad + ' 项没通过 =====');

    rep().textContent = L.join('\n');
    document.title = bad === 0 ? 'ALLPASS' : 'HASFAIL';
  }

  // 页面脚本是 defer 挂的，这个脚本在 body 末尾，DOM 已经就绪
  setTimeout(run, 300);
})();
