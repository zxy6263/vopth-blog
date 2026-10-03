---
title: 给博客加上评论：giscus，和两个静默坑
date: 2026-10-03 09:55:00
tags:
  - 博客
  - 评论
  - giscus
  - 教程
categories:
  - 折腾记录
description: 不买服务器、不加后端，把评论接到 GitHub Discussions 上。顺手记下两个「配了但不生效」的静默坑。
cover:
toc: true
comments: true
---

这个博客从第一天起就没有评论区。

不是忘了，是刻意没做 —— 一个纯静态站要加评论，传统路子就得拖一个后端进来：数据库、接口、反垃圾、服务器续费。为了几行留言背这些，不划算。

但这段时间陆陆续续有人通过邮件和 GitHub 找我聊天，我逐渐觉得：**把讨论留在文章旁边，比留在收件箱里更合适。** 别人踩到同一个坑的时候，能直接看到。

所以这次把评论区开了。

<!-- more -->

## 选了什么

要求很明确：**不加服务器、不加数据库、不加费用。**

符合条件的有好几个（giscus / utterances / Waline / Twikoo），最后选了 **giscus**：

| | |
| --- | --- |
| **评论存哪** | 自己 GitHub 仓库的 **Discussions** |
| **需要服务器吗** | 不需要 |
| **需要数据库吗** | 不需要 |
| **费用** | 0 |
| **反垃圾** | GitHub 账号本身就是门槛 |

原理不复杂：giscus 是一个嵌在页面里的组件，它通过 GitHub App 去读写仓库的 Discussions。**数据是自己的**，不在什么第三方服务器上。哪天不想用了，把组件删掉，评论仍然完整地躺在仓库里。

配置本体就几行：

```yaml
giscus:
  repo: 用户名/仓库名
  repo_id: R_kgDOxxxxxxx
  category_id: DIC_kwDOxxxxxxx
```

后两个 ID 到 [giscus.app](https://giscus.app/) 输入仓库名就会生成。

## 一个必须提前说清楚的代价

**评论需要登录 GitHub。**

这是 giscus 的机制决定的，不是配置问题。对技术站不算大事 —— 读者大多有 GitHub 号；但如果读者主要是非技术人群，这个门槛会劝退大部分人。

另外 giscus 的组件本身托管在 `giscus.app`，国内直连**不一定稳定**。

所以这个方案有个隐含前提：**访客里「愿意登录 GitHub 才能留言」的比例足够高。**

> 如果你要的是「谁都能随手留一句」，该看的其实是 **Waline** —— 挂在自己的域名下、支持匿名评论。代价是要多维护一个后端服务（虽然也能 Serverless）。我这边先上 giscus，以后真不行再换。

## 两个「配了但不生效」的静默坑

这部分才是真正费时间的地方。

我用的是 Hexo + Butterfly。配置写完之后**页面什么都不报错**，但评论区就是不出来。翻主题模板源码才发现两个坑：

### 坑一：`use` 必须是列表，而且要首字母大写

一开始是这么写的：

```yaml
comments:
  use: giscus
```

主题里的判断长这样：

```js
if ('!{use[0]}' === 'Giscus')
```

`use[0]` 取的是**第一个元素**。写成字符串 `giscus` 时，`use[0]` 拿到的是字符 `g` —— 判断永远为假。**不报错、不警告，评论组件静静地不加载。**

正确写法：

```yaml
comments:
  use:
    - Giscus
```

### 坑二：主题没设 `data-lang`，界面是英文的

Butterfly 的 giscus 模板写死了 `data-mapping`、`data-reactions-enabled`、`crossorigin`，但**没有 `data-lang`** —— 于是评论框是英文界面。要补得走 `option` 透传（`option` 里的键会原样展开成 script 标签的属性）：

```yaml
giscus:
  option:
    data-lang: zh-CN
    data-input-position: bottom
```

## 怎么确认它真的开了

这一步走了弯路。

最直觉的办法是本地打开页面截图看 —— 但**截不出来**：页面底部永远停在「正在加载评论……」。无头浏览器加跨域 iframe，在代理环境下经常加载不完。**这非常容易被误判成「评论功能坏了」。**

后来换了个思路：**直接问 giscus 的 API。**

```
https://giscus.app/api/discussions?repo=owner/repo&term=&category=Announcements&strict=0&first=1
```

返回：

```json
{
  "viewer": { "login": "giscus[bot]" },
  "discussion": { "totalCommentCount": 0 }
}
```

**能正常返回 JSON，就说明仓库、Discussions、App 三样全通了。** 这比截图可靠得多。

顺带一个容易吓到自己的现象：带上具体页面路径去查，会返回 `{"error":"Discussion not found"}`。**这是正常的** —— 那篇文章还没人评论过，giscus 会在第一条评论出现时才创建对应的 discussion。

## 最后

现在每篇文章下面都有评论区了，包括这一篇。

想说什么都行 —— 指出文章里的错误、补充更好的做法、或者路过打个招呼。**特别欢迎前两种**：一个人的经验总有盲区，被人指出来是好事。

（要是 GitHub 登不上、或者懒得登，[邮件](/about/)一样有效。）
