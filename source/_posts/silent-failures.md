---
title: 这一周踩的坑：静默失败，和我的坏尺子
date: 2026-10-04 09:09:00
tags:
  - 踩坑
  - 调试
  - 博客
  - 工具链
categories:
  - 折腾记录
description: 不报错的 bug 最难查。这一周踩的坑里，一半是「配置了但不生效」，另一半更麻烦——是我的验证工具本身在骗我。
cover: /img/covers/silent-failures.jpg
toc: true
comments: true
---

这一周在这个博客上折腾了不少东西：开了评论、加了浏览量统计、做了一轮性能优化、改了站名和图标。

坑踩了十几个。回头看，它们能分成清楚的两类：

- **第一类：配置了，但不生效。** 不报错、不警告，就是没用。
- **第二类：我的尺子坏了。** 东西是好的，量它的工具在骗我。

第二类比第一类危险得多 —— 因为第一类你至少知道该查配置，第二类你会**理直气壮地查错方向**。

<!-- more -->

## 第一类：配了但不生效

### 1. Cloudflare 的默认缓存头是 `max-age=0`

这个最隐蔽。站点上线后我一直觉得"重复访问也挺慢"，但没深究。直到某次顺手量了一遍响应头：

```
/css/index.css        cache-control: public, max-age=0, must-revalidate
/js/main.js           cache-control: public, max-age=0, must-revalidate
/videos/banner-1.mp4  cache-control: public, max-age=0, must-revalidate
```

**`max-age=0, must-revalidate` 的意思是：每次访问、每个资源，都要回源问一遍"变了没"。**

Cloudflare Workers 静态资源的默认值就是这个。而国内到 Cloudflare 的往返时间实测 0.6~1.3 秒 —— 于是每次访问都在重复付这笔账。

修法是在仓库根的 `_headers` 里按「文件多久会变」分级：

```
/videos/*
  Cache-Control: public, max-age=31536000, immutable

/pluginsSrc/*
  Cache-Control: public, max-age=2592000

/css/*
  Cache-Control: public, max-age=3600, stale-while-revalidate=86400
```

注意这里**不能一刀切给一年**：视频确实从不改动，但站点自己的 CSS/JS 文件名不带 hash，改版后 URL 不变 —— 给一年会让访客长时间卡在旧版本上。所以用的是「1 小时 + 后台异步更新」。

> 补充一个查证方向：加 `main` 脚本会不会破坏「静态资源免费不限量」？不会。官方文档原文是 *"Requests to static assets are free and unlimited. Requests to the Worker script are billed according to Workers pricing."* 也就是说，请求命中静态文件时不跑 Worker、不计费。

### 2. 主题的 `use` 必须是列表，而且首字母大写

给博客开评论时配 giscus，配置写完**页面什么都不报错，但评论区不出来**。

翻主题模板源码才看到判断是这么写的：

```js
if ('!{use[0]}' === 'Giscus')
```

`use[0]` 取的是**第一个元素**。写成 `use: giscus`（字符串）时，`use[0]` 拿到的是字符 `g` —— 判断永远为假，组件静静地不加载。

正确写法：

```yaml
comments:
  use:
    - Giscus
```

### 3. 同一个组件，主题没设 `data-lang`

giscus 的界面语言靠 `data-lang`。主题模板写死了 `data-mapping`、`data-reactions-enabled`、`crossorigin`，**唯独没设 `data-lang`** —— 于是评论框是英文的。

要补得走 `option` 透传（里面的键会原样展开成 script 标签属性）：

```yaml
giscus:
  option:
    data-lang: zh-CN
```

### 4. Worker 拿不到静态资源，404 变成 500

给站点加浏览量接口时，我往配置里写了 `assets.directory`，但**没给静态资源起绑定名**。结果：

```
GET /no-such-page/   ->  HTTP 500
TypeError: Cannot read properties of undefined (reading 'fetch')
```

原因：命中静态文件的请求**根本不跑 Worker**（所以首页一直是好的），只有没命中的才会落到 Worker 里 —— 而那时它需要 `env.ASSETS` 把请求交还给静态资源层，那个绑定却是 undefined。

修法一行：

```jsonc
"assets": {
  "directory": "./public/",
  "binding": "ASSETS"     // ← 少了这行，所有 404 都会变成 500
}
```

### 5. 后端有数据，前端什么都不显示

浏览量计数器上线后，我打开接口一看：

```
GET /api/views?path=/2026/10/03/xxx/  ->  {"views":1,"total":1}
```

**有数据、在增长、完全正常。** 于是我以为成了。

直到截了张图才发现，页面上**一个字都没有** —— 我猜的选择器 `.post-meta-container` 在主题里根本不存在。脚本按设计「找不到位置就静默放弃」，所以既不报错、也不显示。

真实结构是 `#post-meta .meta-secondline`。

> **这条最值得记**：「后端通了」和「用户看得到」是两件事。只测接口会得出完全错误的结论。

## 第二类：我的尺子坏了

下面这些，东西都是好的，**是我的测量工具在骗我**。

### 6. 那张"内容被切掉"的截图

用无头浏览器检查手机端布局，截了 390px 宽的图，发现文字全被右侧切掉了。于是一路去查"是不是有元素撑宽了页面"。

查了很久才想到去量一下布局视口：

```
clientWidth = 490      ← 我传的是 --window-size=390
```

**Windows 对浏览器窗口有最小宽度限制（实测 492px）。** 我传 390，浏览器按 490 排版，而截图只输出 390 宽的图像 —— 右边 102px 被硬切，看起来就像网页溢出了。

**我拿着自己的截图伪影，去查了一个不存在的 bug。**

### 7. curl 说"没开压缩"

量资源体积时发现 CSS 是 210 KB，于是判断"服务器没开压缩"。

其实是因为 **`curl` 默认不发送 `Accept-Encoding`** —— 它拿到的是原始体积，而浏览器会自动协商 gzip：

```
/css/index.css    不压缩 215101 字节    gzip/br 26902 字节    省 87%
```

服务器一直是压缩的。正确测法是对比两次请求：

```bash
curl -H "Accept-Encoding: identity"    -o NUL -w "%{size_download}" <url>
curl -H "Accept-Encoding: gzip, br"    -o NUL -w "%{size_download}" <url>
```

### 8. DNS 查询说"一切正常"，浏览器说不

评论死活发不出去。查 DNS、查网络、查配置，全都正常。直到有人把控制台日志贴出来：

```
Access to fetch at 'https://api.github.com/graphql' from origin 'https://giscus.app'
has been blocked by CORS policy:
Permission was denied for this request to access the `loopback` address space.
```

**`loopback` 三个字点破了一切**：本机 hosts 里有一批把 GitHub 域名指到 `127.0.0.1` 的条目（某个"加速/反代"工具写的），而浏览器有安全策略 —— **公网页面不允许访问本机回环地址**，请求在发出去之前就被拒了。

而我当时的 DNS 查询返回的是**真实 IP**（它走的是代理自带的 DNS），看起来"没问题"：

```
Resolve-DnsName api.github.com   ->  20.205.243.168     ← 真实 IP，看着正常
浏览器实际读的是 hosts 文件      ->  127.0.0.1           ← 被拦
```

**两边结论相反。而我先去信了那个"看着正常"的。**

### 9. 用 `file://` 做探针，量到的是"破图"

为了确认某个 CSS 规则生效，我写了个探针页面注入脚本、量元素的渲染尺寸。结果量出来是 `64 x 64`（元素的原图尺寸），说明"规则完全没生效"。

其实是我把探针存成了本地文件、用 `<base href="http://localhost:4000/">` 指向本地服务 —— 而 **`file://` 页面加载 `http://` 子资源被浏览器拦掉了**，CSS 压根没加载。量到的 `53 x 24` 更是"图片加载失败的占位图标 + alt 文字"。

把探针页放进本地服务（同源）之后，同一段脚本量出的是正确结果。

### 10. 只改大小写的替换，被判成"没变化"

想把几个 SVG 里的 `Vopth` 改成 `vopth`。脚本写的是：

```powershell
$new = $t -creplace 'aria-label="Vopth', 'aria-label="vopth'
if ($new -ne $t) { 写入文件 }
```

替换**执行了**，但判断用的是 `-ne` —— 而 **PowerShell 的比较运算符默认不区分大小写**：

```
'vopth' -eq 'Vopth'   ->  True      ← "相等"！
```

于是它判定"没变化"、**跳过了写入**。判断要用 `-cne`（c = case-sensitive）。

### 11. 一个正则吞掉了换行

顺手写了个检查，想看看每篇文章的 `cover:` 字段填了什么：

```powershell
[regex]::Match($t, '(?m)^cover:\s*(.*)$')
```

结果好几篇文章显示 `cover=toc: true` —— 因为 **.NET 的 `\s` 会匹配换行符**，`\s*` 直接跨过空行，抓到下一行的内容去了。

## 它们共同的形状

把上面 11 条放在一起看，会发现两类坑其实是同一个问题的两面：

| | 表现 | 危险在于 |
| --- | --- | --- |
| 配了但不生效 | 不报错、不警告 | 你以为做完了 |
| 尺子坏了 | 有数据、看着正常 | 你以为**查对了**，然后朝反方向挖 |

所以我现在多了一条习惯，写在这里，也提醒以后的自己：

**1. 不报错 ≠ 生效。** 每个静默步骤都主动打日志、或者去查一个"用户可见的结果"。这个博客的验收脚本有 48 项检查，就是因为吃过太多次"配置写对了但页面没变"的亏。

**2. 看产物，不看宣言。** 首页第一张卡片长什么样、F12 里有没有第三方请求、截图上有没有那个数字 —— 这些比"配置文件里写了什么"可信得多。

**3. 工具给出反常结论时，换一把尺子再量一遍。** 这一周最省时间的动作，往往不是继续往下查，而是停下来问一句：**"我这个测量结果，本身可信吗？"**

**4. 报错信息里最陌生的那个词，常常就是答案。** `loopback`、`must-revalidate`、`use[0]` —— 查偏的时候，往往是因为跳过了那个看不懂的词。

## 最后

写完回头看，这一周真正花时间的不是"写代码"，而是**确认东西真的生效了**。

这大概就是这类小项目的真相：功能本身不难，难的是在一个没有测试、没有监控、没有同事帮你 review 的环境里，**自己给自己当第二双眼睛**。

而第二双眼睛最容易骗你的地方，恰恰是你最信任的那把尺子。

> 如果你也遇到过类似的"静默失败"，欢迎在下面留言 —— 说不定你踩的那个坑，正是我下一个要踩的。
