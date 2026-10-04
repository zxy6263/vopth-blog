---
title: 订阅本站
date: 2026-10-03 00:00:00
updated: 2026-10-05 07:10:00
comments: false
toc: false
keywords: RSS,订阅,Atom,Feedly
description: 用 RSS 订阅 vopth.xyz —— 没有算法推荐，没有广告，新文章自动送到你面前。
# banner 用视频，由 source/js/banner-video.js 注入，
# 并从视频池里随机挑一个（关于/归档/分类/标签/友链/订阅 共用同一个池）。
# 这里指向视频的一帧作为「海报图」：JS 没跑、加载失败、
# 或用户开了「减少动态效果」时，看到的是这张静态图而不是主题默认图。
#
# ⚠️ 这两处必须配套：top_img 指向海报图之外，还得把 '/subscribe/' 加进
#    banner-video.js 的 POOL_PAGES —— 只做一半的话，页面既不播视频、
#    又还是那张默认图。
top_img: /videos/banner-1-poster.jpg
---

<div class="subscribe-hero">
  <div class="subscribe-hero-icon"><i class="fas fa-rss"></i></div>
  <div class="subscribe-hero-title">订阅 vopth.xyz</div>
  <p class="subscribe-hero-desc">
    不想每次都主动来看有没有新文章？<br>
    用 RSS 订阅，有新内容会自动送到你面前。
  </p>
</div>

## 为什么用 RSS

一句话：**把很多个网站的新文章，汇集到一个地方看。**

你不用挨个打开网站检查有没有更新，阅读器会替你盯着。而且：

- **没有算法推荐** —— 你订阅什么，就看到什么，不会突然被塞一堆"猜你喜欢"
- **没有广告** —— 阅读器里就是你订阅的内容本身
- **不追踪你** —— 没有埋点、没有画像、没有"根据你的兴趣"
- **不绑定平台** —— 哪天这家阅读器倒闭了，订阅列表可以整个导出带走
- **一个入口看全部** —— 博客、新闻、论坛，全在一个列表里

作为写作者我也更喜欢它：**订阅数是真实的人，不是算法推出来的数字。**

## 三步订阅

### 第一步：选一个阅读器

| 阅读器 | 平台 | 说明 |
| --- | --- | --- |
| [Feedly](https://feedly.com) | 网页 / iOS / Android | 最流行，免费版对个人足够 |
| [Inoreader](https://www.inoreader.com) | 网页 / iOS / Android | 功能强大，免费版够用 |
| [NetNewsWire](https://netnewswire.com) | macOS / iOS | 开源免费，体验很干净 |
| [Fluent Reader](https://hyliu.me/fluent-reader/) | Windows / macOS / Linux | 桌面端，开源，中文友好 |
| [Follow](https://follow.is) | Windows / macOS / Linux | 新一代，支持 Web3 订阅 |

> 大多数邮箱也自带 RSS 功能，但体验一般，不太推荐。

### 第二步：复制订阅地址

<div class="subscribe-copy">
  <code id="feed-url">https://vopth.xyz/atom.xml</code>
  <button id="copy-feed-btn" type="button">复制地址</button>
</div>

<div class="subscribe-tip">
  <i class="fas fa-lightbulb"></i>
  <span>嫌麻烦？很多阅读器支持「粘贴网站首页自动发现订阅源」。
  直接输入 <code>vopth.xyz</code> 也行 —— 本站已经声明了 <code>link rel="alternate"</code>，阅读器能自己找到。</span>
</div>

### 第三步：在阅读器里粘贴

打开阅读器，找 **「添加订阅」/「Add feed」/「+」** 之类的按钮，把地址粘进去就行。

---

## 本站的订阅地址

```
https://vopth.xyz/atom.xml
```

> **如果你用浏览器点开这个地址，会看到一堆 XML 源码 —— 这是正常的。**
>
> RSS / Atom 是给**阅读器程序**读的数据格式，不是给人看的网页。
> Chrome、Edge 在很多年前就移除了原生渲染 RSS 的能力，所以只会把源码显示出来；
> 用 Firefox 打开则会看到一个排版好的订阅界面。**这个文件本身是完全正常的。**

---

## 不想用 RSS？

那就**偶尔回来逛逛**吧 —— [全部文章](/archives/) 和 [分类](/categories/) 都在，随时欢迎。

想找我聊天的话，[关于我](/about/) 页面有联系方式。

<script>
(function () {
  var btn = document.getElementById('copy-feed-btn');
  var el = document.getElementById('feed-url');
  if (!btn || !el) return;

  var reset;
  function done() {
    btn.textContent = '已复制 ✓';
    btn.classList.add('copied');
    clearTimeout(reset);
    reset = setTimeout(function () {
      btn.textContent = '复制地址';
      btn.classList.remove('copied');
    }, 2000);
  }

  // 老浏览器 / 非安全上下文没有 navigator.clipboard，退回 execCommand
  function fallback() {
    var ta = document.createElement('textarea');
    ta.value = el.textContent.trim();
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      done();
    } catch (e) {
      btn.textContent = '请手动复制';
    }
    document.body.removeChild(ta);
  }

  btn.addEventListener('click', function () {
    var url = el.textContent.trim();
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(url).then(done, fallback);
    } else {
      fallback();
    }
  });
})();
</script>
