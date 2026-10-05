---
title: 不买服务器也能有博客：Cloudflare Pages 部署全记录
date: 2026-10-03 02:49:00
tags:
  - 建站
  - Cloudflare
  - 教程
categories:
  - 折腾记录
keywords: Cloudflare Pages,Hexo部署,免费博客,自定义域名
description: 从阿里云域名到 Cloudflare Pages 自动构建，一份能照着抄的部署流程。
cover:
comments: true
toc: true
---

这篇是操作记录。如果你也买了域名但不想买服务器，照着走一遍，半小时能有一个跑在你自己域名上的博客。

<!-- more -->

## 前置条件

- 一个域名（我用的是阿里云注册的 `vopth.xyz`）
- 一个 GitHub 账号
- 一个 Cloudflare 账号（免费注册）
- 本机装了 Node.js 20 或更高版本

## 第一步：本地把站点跑起来

```bash
# 克隆你自己的仓库（或者从零初始化）
git clone https://github.com/<你的用户名>/vopth-blog.git
cd vopth-blog

# 安装依赖
npm install

# 本地预览，默认 http://localhost:4000
npm run server
```

改完文章后：

```bash
# 生成静态文件到 public/
npm run build
```

`public/` 目录里的东西就是最终网站的全部内容 —— 一堆 HTML、CSS、JS 和图片。**它不需要任何后端。**

## 第二步：把代码推到 GitHub

```bash
git add .
git commit -m "feat: init blog"
git branch -M main
git remote add origin https://github.com/<你的用户名>/vopth-blog.git
git push -u origin main
```

> 仓库可以是 Public 也可以是 Private，Cloudflare Pages 两种都支持。

## 第三步：在 Cloudflare Pages 上建项目

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. 左侧选 **Workers & Pages** → **Create** → **Pages** → **Connect to Git**
3. 授权 GitHub，选中刚才那个仓库
4. 构建配置填：

| 配置项 | 值 |
| --- | --- |
| Production branch | `main` |
| Framework preset | `Hexo`（没有就选 `None`） |
| Build command | `npm run build` |
| Build output directory | `public` |
| 环境变量 `NODE_VERSION` | `22` |

5. 点 **Save and Deploy**

等一两分钟，你会拿到一个 `xxx.pages.dev` 的临时地址。打开它，如果能看到你的博客，构建就成功了。

## 第四步：绑定你的域名

这是最关键的一步，也是最多人卡住的地方。

### 情况 A：域名在阿里云，DNS 也托管在阿里云

Cloudflare Pages 要求域名在 Cloudflare 上管理才能一键绑定自定义域。所以你需要把 **DNS 服务器**从阿里云改成 Cloudflare：

1. 回到 Cloudflare Dashboard → **Add a site** → 输入 `vopth.xyz` → 选 **Free 套餐**
2. Cloudflare 会给你两个 nameserver，形如：

   ```
   arya.ns.cloudflare.com
   rob.ns.cloudflare.com
   ```

3. 打开 [阿里云域名控制台](https://dc.console.aliyun.com/) → 找到 `vopth.xyz` → **DNS 修改** / **修改 DNS 服务器**
4. 把原来的阿里云 DNS 换成 Cloudflare 给的那两个
5. 等生效（通常几分钟到 24 小时，我这次大概 10 分钟）

生效后 Cloudflare 会给你发邮件。然后在 Pages 项目里：

**Custom domains** → **Set up a custom domain** → 输入 `vopth.xyz` → 保存。

Cloudflare 会自动帮你加好 DNS 记录，并且**自动签发 HTTPS 证书**。你不需要自己申请证书，也不需要配 Nginx。

### 情况 B：不想动 DNS，想继续用阿里云解析

不推荐，但可以：在阿里云云解析里加一条 CNAME 记录。

- 主机记录：`www`（子域名可以）
- 记录类型：`CNAME`
- 记录值：`你的项目名.pages.dev`

**根域名（`vopth.xyz`，不带 www）用不了 CNAME** —— 这是 DNS 协议的限制，标准 CNAME 不能出现在根域名上。阿里云也没有 CNAME 拉平功能。所以根域名想直连，还是得走情况 A。

另外这种情况 Cloudflare 那边的自定义域验证也可能失败。**结论：老老实实把 DNS 交给 Cloudflare，别折腾。**

## 第五步：以后怎么发文章

```bash
npx hexo new "文章标题"      # 生成 source/_posts/文章标题.md
# 写内容
git add . && git commit -m "post: 文章标题" && git push
```

推上去之后 Cloudflare 检测到 main 分支更新，自动重新构建，一两分钟后线上就是最新的。

**这就是全部流程。** 没有上传 FTP，没有登录服务器，没有 `nginx -s reload`。

## 几个容易踩的坑

### 1. 构建报错 `Node version not supported`

在 Pages 项目的 **Settings → Environment variables** 里加：

```
NODE_VERSION = 22
```

### 2. 页面能打开但样式全丢

九成是 `_config.yml` 里的 `url` 和 `root` 配错了。`url` 必须是完整域名且**不带结尾斜杠**：

```yaml
url: https://vopth.xyz
root: /
```

### 3. 中文文章标题导致 URL 很丑

文章文件名用英文 slug，`title` 再用中文：

```bash
npx hexo new "hello-world"    # 文件名
# 然后编辑 front-matter 里的 title: 你好，世界
```

### 4. 换了域名之后旧链接全 404

在 Pages 项目根目录放一个 `public/_redirects` 文件（或者在 Hexo 的 `source/` 里放 `_redirects`，构建时会带过去）：

```
/old-path/  /new-path/  301
```

### 5. 想回滚到上一个版本

Cloudflare Pages 的 **Deployments** 列表里，每个历史版本都有 **Rollback** 按钮。点一下就行，不用改代码。

## 关于成本

| 项目 | 费用 |
| --- | --- |
| 域名 `vopth.xyz` | 约 ¥10/年（`.xyz` 首年经常几块钱） |
| Cloudflare Pages | **0** |
| HTTPS 证书 | **0** |
| 流量带宽 | **0**（免费套餐不限量） |
| 服务器 | 不存在 |

一年十块钱出头，这就是全部开销。

---

有人会问：`.xyz` 在国内有些网络环境（比如微信内置浏览器）会被拦。这是 TLD 层面的问题，换任何托管平台都一样。如果主要读者都在国内，考虑 `.com` / `.cn` 更稳一些。

但对我自己来说，这个站首先是写给自己的。**能让我在没有任何心理负担的情况下持续写下去，比什么都重要。**
