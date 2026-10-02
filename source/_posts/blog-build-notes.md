---
title: 这个博客是怎么搭的：架构、日常流程，和我踩过的 21 个坑
date: 2026-10-03 23:30:00
updated: 2026-10-03 23:30:00
tags:
  - 建站
  - Hexo
  - Cloudflare
  - 避坑
categories:
  - 折腾记录
keywords: Hexo, Cloudflare Workers, 博客搭建, 避坑, 静态博客
description: 不买服务器搭一个博客，从域名到上线的完整记录 —— 重点是我踩过的 21 个坑，尤其是那些「不报错、但静默失效」的类型。
toc: true
comments: true
---

这篇是写给**未来的自己**的。

搭这个博客的过程中，我遇到了一堆「文档里没写、搜索引擎上也搜不到」的坑。更麻烦的是其中一大半属于**不报错、但功能静默失效**的类型 —— 你不主动去验证，根本发现不了。

所以趁还记得，全部记下来。

<!-- more -->

## 这套站是怎么跑起来的

```
我写 Markdown
     ↓
git push
     ↓
Cloudflare 自动构建（npm run build）
     ↓
生成纯静态文件 public/
     ↓
Cloudflare 全球 CDN
     ↓
读者
```

**核心：没有服务器，没有后端，没有数据库。**

| 部分 | 用什么 | 费用 |
| --- | --- | --- |
| 域名 | `vopth.xyz`（阿里云注册） | 约 ¥10～70/年 |
| DNS | Cloudflare | 0 |
| 托管 | Cloudflare Workers 静态资源 | 0 |
| HTTPS 证书 | Cloudflare 自动签发续期 | 0 |
| 生成器 | Hexo 8 | 0 |
| 主题 | Butterfly 5.7 | 0 |
| 评论（未启用） | giscus（基于 GitHub Discussions） | 0 |

**为什么不用服务器**：博客的流量模型是「读多写极少」，内容还几乎永久不变。用动态服务器扛这种场景是巨大的浪费。静态文件 + CDN 才是正解。

**顺带的好处**：托管在境外，**不需要 ICP 备案**。

### 一个刻意的设计：不依赖外部 CDN

主题默认会从 jsDelivr 加载字体图标、打字机等资源，但 **jsDelivr 在国内经常被墙或抽风**，一旦挂了整站图标全丢。

所以我把第三方 JS **全部本地化**到 `/pluginsSrc/`：

```yaml
# _config.butterfly.yml
CDN:
  internal_provider: local
  third_party_provider: local
```

**验证方法**：打开网页 → F12 → Network → 刷新 → 看看有没有第三方域名的请求。**一个都不该有。**

---

## 日常只做三件事

```bash
# 1. 新建文章（文件名用英文 slug）
npx hexo new "my-post-title"

# 2. 本地预览，改完自动刷新
npm run server          # http://localhost:4000

# 3. 发布
git add . && git commit -m "post: 文章标题" && git push
```

推上去 1～2 分钟，线上自动更新。**没有 FTP，没有登录服务器，没有 `nginx -s reload`。**

### front-matter 速查

| 字段 | 作用 |
| --- | --- |
| `title` | 标题（写中文） |
| `date` | 发布日期，决定排序 |
| `tags` | 标签，可以多个 |
| `categories` | 分类，**建议只写一个** |
| `description` | 摘要，用于首页和 SEO |
| `cover` | 封面图，留空会自动匹配（见下） |
| `top` | 是否置顶 |
| `toc` | 是否显示目录 |
| `comments` | 是否开启评论 |
| `author_avatar` | 设为 `false` 可关闭本文的作者署名 |

写正文时，`<!-- more -->` 之前的内容会作为首页摘要。

更多标签插件（提示框、选项卡、按钮、mermaid 流程图…）的写法见 [Hexo 写作速查](/2026/10/03/hexo-writing-guide/)。

---

## 想改东西时，改哪里

### 内容类

| 想改 | 改哪 |
| --- | --- |
| 头像 | 换 `source/img/avatar.jpg`（署名头像会自动跟着变） |
| 首页大图 | `_config.butterfly.yml` 的 `index_img` |
| 首页打字机文案 | `_config.butterfly.yml` 的 `subtitle.sub` |
| 首页个人卡片 | `source/js/profile-hero.js` |
| 「关于我」页面 | `source/about/index.md` |
| 站名 / 描述 / 关键词 | `_config.yml` 最上面 |
| 友链 | `source/_data/link.yml` |

### 外观类

| 想改 | 改哪 |
| --- | --- |
| 主题色 | `_config.butterfly.yml` 的 `theme_color.main` |
| 首页文章卡片样式 | `index_layout: 1~7`（7 种现成布局） |
| 导航菜单 | `menu:` |
| 侧边栏显示哪些卡片 | `aside.card_*` 开关 |
| 微调间距 / 圆角 / 阴影 | `source/css/custom.css`（分 9 节，都有注释） |

### 封面图：文件名对上就自动生效

```
文章   source/_posts/my-first-post.md
封面   source/img/covers/my-first-post.jpg     ← 文件名一样，自动挂上
```

**不用改任何配置。** 构建日志里会出现确认：

```
INFO  Post cover auto-assigned: my-first-post -> /img/covers/my-first-post.jpg
```

想手动指定就写 `cover: /img/xxx.jpg`（优先级更高）。

**尺寸建议**：16:10 或 3:2，宽 800～1200px，**小于 300 KB**。手机原图动辄几 MB，直接放会明显拖慢首页。

### 视频 banner

关于 / 归档 / 分类 / 标签 / 友链这五个页面**共用一个视频池，每次打开随机挑一个**。

加新视频：

```powershell
# 第一步：压缩（原始素材 80~150MB 远超 Cloudflare 单文件上限，必须压）
powershell -File tools\compress-banner-video.ps1 -Source "D:\path\v.mp4" -Name banner-3 -Estimate
powershell -File tools\compress-banner-video.ps1 -Source "D:\path\v.mp4" -Name banner-3

# 第二步：把新视频加进 source/js/banner-video.js 的 VIDEO_POOL 数组
```

**不需要改页面配置** —— 加进池子就自动在所有池内页面随机出现。

---

## ⚠️ 21 个坑

这是本文的重点。**按类型分组，越靠前越容易踩。**

### A. 「静默失效」类 —— 最危险，因为不报错

**1. 文件名没对上，封面图静默不生效**

`source/img/covers/` 里的文件名和文章文件名不一致时，**不会有任何报错**，只是悄悄用回默认渐变图。

👉 **配完封面必须扫一眼构建日志**，找 `auto-assigned` 那一行。

**2. Hexo 会吞掉渲染错误，退出码仍然是 0**

友链数据的 `link_list` 只写了注释 → YAML 解析成 `null` → 主题模板遍历 `null` 抛异常。Hexo 打印了错误，**但退出码依然是 0**，构建「成功」了，页面却没渲染出来。

👉 **不能只看退出码，要读 stderr。**

**3. `hexo-generator-sitemap` 的 `rel: true` 完全无效**

它的注入正则是：

```js
/<head>(?!<\/head>).+?<\/head>/
```

**没有 `s` 标志，`.` 匹配不了换行** —— 而生成出来的 HTML 是带换行的，所以永远匹配不上，也不报错。

👉 改为在 `inject.head` 里手动注入 `<link rel="sitemap">`。

**4. 主题里 `'category'`（单数）对不上 `'categories'`（复数）**

Butterfly 的 `header/index.pug` 分支：

```pug
when 'tag'       → 读 theme.tag_img
when 'category'  → 读 theme.category_img
```

而 `page.js` 返回的是：

```js
if (type === 'tags' || type === 'categories') return type   // 复数！
```

**匹配不上 → 掉进 `default` 分支 → 我配的 `category_img` / `tag_img` 被整个绕过，不报错。**

最阴的是：**单独一个标签页（`/tags/Hexo/`）是正常的**（它没有显式 `type`，走 `is_tag()` 判定 → `'tag'` → 能匹配），**只有列表页坏**。所以表现是"点进子页面有图、回列表页没图"，极容易误判成缓存问题。

👉 改用页面 front-matter 的 `top_img`，绕开这个 bug。

**5. `escapeHTML` 会把 URL 里的斜杠也转义**

`hexo-util` 的 `escapeHTML('/about/')` → `&#x2F;about&#x2F;`。浏览器能解码、功能正常，但生成的 HTML 很难读。

👉 属性值只用自定义的 `escapeAttr`，只转义 `& " < >`。

**6. Cloudflare 的 DNS 解析器会用「自己托管的 zone 数据」自答**

我查 `vopth.xyz` 的 NS，Cloudflare 的 DoH（1.1.1.1）返回了 `gabriel.ns.cloudflare.com` —— 看起来已经切换成功。**但 `.xyz` 注册局的权威服务器仍然显示 `hichina`。**

**用一个服务商去查它自己托管的配置，等于自己证明自己。**

👉 **判断域名委派是否真的生效，必须查 TLD 注册局的权威服务器**（对 `.xyz` 就是 `a/b/c.nic.xyz`）。

### B. 环境 / 工具链

**7. `package.json` 必须有 `"hexo"` 字段**

缺了它，`hexo-cli` 就无法识别项目根目录，会退化成只有 `init` / `help` / `version` 三个命令。

👉 表现是：`hexo generate` **只打印一堆帮助信息，什么都不生成，退出码还是 0**。

**8. Hexo 会忽略 `source/` 下所有 `_` 开头的文件**

这导致 `_headers` / `_redirects`（Cloudflare 要求文件名就是这个）**不能放在 `source/` 里**。

👉 反过来也可以利用它：把不想被发布到网站的说明文件命名为 `_README.md` 就行。

**9. Hexo 8 的 `after_generate` 早于写 `public/`**

我原本用它来复制 `_headers`，结果复制时目标目录还不存在，直接 `ENOENT` **让整个构建 FATAL**。

👉 改用显式的后置步骤：`"build": "hexo generate && node tools/post-build.js"`。

**10. PowerShell 5.1 会把无 BOM 的 UTF-8 文件按 GBK 解码**

在 `.ps1` 脚本里写中文注释 → 被误解码 → 产生**假的引号或括号** → 脚本语法直接报错。

👉 **`tools/` 下所有 `.ps1` 必须保持纯 ASCII。** 我在这个坑上摔了两次。

**11. PowerShell 的 `Set-Content -Encoding UTF8` 会写入 BOM**

我用它写 `~/.ssh/config`，结果 OpenSSH 报：

```
Bad configuration option: \357\273\277#
```

`\357\273\277` 就是 UTF-8 BOM。**Git 自带的 ssh 不容忍它**（Windows 自带的 ssh 反而容忍，所以第一次测试是"成功"的假象）。

👉 用 `[System.IO.File]::WriteAllText()` 配 `UTF8Encoding($false)` 写无 BOM 文件；验证要用 `git ls-remote`，而不是 `ssh -T`。

**12. `github.com:22` 被运营商屏蔽**

国内很常见。GitHub 提供了备用入口 `ssh.github.com:443`：

```
# ~/.ssh/config
Host github.com
  HostName ssh.github.com
  Port 443
  User git
```

**13. 本机 DNS 结果可能被代理软件的 fake-ip 污染**

如果开着 Clash 之类的 TUN 模式，`A` 记录查询可能返回 `198.18.0.x` —— 那是 RFC 保留的基准测试网段，**不是真实 IP**（NS 查询通常不受影响）。

👉 判断真实解析结果用 **DoH（DNS over HTTPS）**，走 HTTPS 绕过 fake-ip。

**14. ffmpeg 是 2013 年的老构建，三个坑**

| 坑 | 现象 |
| --- | --- |
| 中文路径支持差 | 源文件路径含中文会失败 → 先复制到纯 ASCII 路径 |
| 没有 `-hide_banner` | 报 `Unrecognized option` |
| 不支持 `scale=1920:-2` | 报 `Size values less than -1 are not acceptable` |

**15. H.264 的 `yuv420p` 要求宽高都是偶数**

`3840×1450` 等比缩到 1920 宽正好是 **725（奇数）** → **编码直接失败**。

👉 向下取偶成 724（差 1 像素，肉眼不可见）。

**16. YAML 同名键，后面的覆盖前面的**

我测 `author_avatar: false` 时改错了行，front-matter 里还留着一行 `author_avatar: /img/logo.svg`，于是 `false` 被静默顶掉。**我一开始误判成代码有 bug。**

**17. 构建时如果 `hexo server` 在跑，编辑 `source/` 下的文件会失败**

报 `ReplaceFileW EIO (Win32 32)`（文件被占用）—— 因为文件监视器正持有它。

👉 **改文件前先停掉 dev server。**

**18. 单文件体积上限**

Cloudflare 静态资源有单文件大小限制。**83 MB 的视频原样部署会直接失败** —— 必须压缩（我压到了 3.17 MB，原体积的 3.8%）。

**19. `hexo-server` 不支持 HTTP Range 请求**

视频拖动进度条依赖 `206 Partial Content`。**本地测出来是 200，会误判成"视频流式播放没配好"** —— 实际是本地开发服务器的限制，线上是正常的。

### C. CSS

**20. `em` 是相对父元素计算的，嵌套会复合**

我给 `#site-subtitle` 和它的子元素 `#subtitle` 都写了 `font-size: 2.3em` → 实际效果是 **2.3 × 2.3 ≈ 5.29em**，副标题直接爆掉。

👉 **只给最外层容器设字号**，子元素继承。

**21. 两处「看着应该生效、实际被绕过」的 CSS/结构问题**

| 问题 | 原因 |
| --- | --- |
| `#site-title` 的字号规则同时作用到内页 | 首页和内页**都用 `#site-title`**，必须按 header 的 class（`.full_page` / `.not-home-page` / `.post-bg`）区分 |
| 头像描边加在 `<img>` 上没反应 | 主题的 `.avatar-img` 容器有 `overflow: hidden`，而 `<img>` 是 `100%×100%` —— **描边必须加在容器上**，否则被裁掉 |

---

## 一条通用教训：警惕「静默失效」

回头看，**上面 21 个坑里超过一半属于同一类**：

> **不报错、退出码正常、但功能没生效。**

这类问题的可怕之处在于：

- 你不知道它坏了
- 它不会自己冒出来
- 唯一发现方式是**主动去验证**

### 我的三条对策

**① 让关键步骤「留痕」**

比如封面自动匹配，脚本会打日志：

```
INFO  Post cover auto-assigned: my-first-post -> /img/covers/my-first-post.jpg
```

没有这一行，就说明没匹配上 —— **把不可见的行为变成可见的输出**。

**② 不只信退出码，要看真实产物**

构建「成功」不等于页面正确。我会检查：

- 生成的文件数
- 关键页面是否真的存在
- HTML 里是否真的出现了预期的标记

**③ 用脚本固化验收**

我写了 `tools/check-site.ps1`，一次性检查 **47 项**：

```powershell
# 检查本地预览
powershell -File tools\check-site.ps1 -BaseUrl http://localhost:4000
# 检查线上（部署后）
powershell -File tools\check-site.ps1
```

它检查：所有页面/资源的状态码、第三方 JS 是否真的本地化、自定义 404、
首页关键标记、**是否残留外部 CDN 引用**、文章作者署名是否注入、
以及**署名有没有误伤首页**。

**每次发完文章跑一遍，比人眼盯着可靠得多。**

---

## 还没做完的事

- **域名还没挂上**：DNS 已经改成 Cloudflare 的 nameserver，但注册局层面的委派还没更新（阿里云提示 24～48 小时）。现在站点跑在 `workers.dev` 的临时地址上。
- **评论没开**：打算用 giscus（基于 GitHub Discussions，不需要服务器）。等域名稳定后再开。
- **封面图还没配**：功能已经做好，但暂时没有合适的图。
- **访问统计没开**：打算用 Cloudflare Web Analytics。

---

## 最后

搭这个站最大的收获不是「学会用 Hexo」，而是**重新确认了一件事**：

> **凡是「看起来应该生效」的地方，都要动手验证。**

上面这些坑，没有一个是通过读文档发现的 —— 全是构建时报错、或者我主动去核对产物才暴露出来的。而最危险的那几个，连报错都没有。

如果你也在搭静态博客，希望这篇能帮你少摔几跤。

……不过说实话，**摔跤本身可能就是这件事最有意思的部分**。
