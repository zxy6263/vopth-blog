# vopth.xyz — 个人主页与博客

> **Hexo + Butterfly + Cloudflare Pages。不需要买服务器，不需要备案。**

域名：`vopth.xyz`（阿里云注册） · 托管：Cloudflare Pages（免费） · 生成器：Hexo 8 · 主题：Butterfly 5.7

---

## 目录

- [一、这套方案是什么](#一这套方案是什么)
- [二、目录结构](#二目录结构)
- [三、本地开发](#三本地开发)
- [四、部署到 Cloudflare Pages](#四部署到-cloudflare-pages)
  - [4.1 推送到 GitHub](#41-推送到-github)
  - [4.2 创建 Pages 项目](#42-创建-pages-项目)
  - [4.3 把域名 DNS 接入 Cloudflare](#43-把域名-dns-接入-cloudflare)
  - [4.4 绑定自定义域名](#44-绑定自定义域名)
- [五、上线后请立刻改这几处](#五上线后请立刻改这几处)
- [六、日常写作流程](#六日常写作流程)
- [七、可选功能](#七可选功能)
- [八、常见问题排错](#八常见问题排错)
- [九、成本](#九成本)

---

## 一、这套方案是什么

```
你写 Markdown  →  git push  →  Cloudflare 自动构建  →  全球 CDN  →  读者
```

- **没有服务器**：构建出来的 `public/` 是纯静态文件（HTML/CSS/JS/图片），不需要任何后端
- **不需要备案**：托管在 Cloudflare 的海外节点，不涉及国内服务器
- **自带 HTTPS**：证书由 Cloudflare 自动签发和续期，不用管
- **免费**：Cloudflare Pages 免费套餐**不限流量**
- **不依赖国内被墙的 CDN**：字体图标、打字机、灯箱、分享按钮等全部打包在你自己站点里（`/pluginsSrc/`），不请求 jsDelivr / unpkg / Google Fonts

浏览器打开控制台 Network 面板看一下就知道：**没有任何第三方域名的请求**。

---

## 二、目录结构

```
vopth-blog/
├── _config.yml                 # 站点主配置（标题、域名、URL 结构、分页…）
├── _config.butterfly.yml       # 主题配置（外观、菜单、侧边栏、评论…）★改得最多
├── _headers                    # Cloudflare 响应头（缓存、安全头）
├── _redirects                  # Cloudflare 跳转规则（换域名/短链）
├── package.json                # 依赖与命令
├── .nvmrc                      # 指定 Node 版本（Cloudflare 构建时读取）
│
├── scaffolds/                  # 新建文章/页面的模板
│   ├── post.md
│   ├── page.md
│   └── draft.md
│
├── source/                     # 你写的东西都在这里
│   ├── _posts/                 # ★文章放这里
│   │   ├── hello-vopth.md
│   │   ├── cloudflare-pages-deploy.md
│   │   └── hexo-writing-guide.md   # 写作速查，忘了语法就翻它
│   ├── _data/
│   │   └── link.yml            # ★友链数据
│   ├── about/index.md          # ★个人主页 / 关于我
│   ├── link/index.md           # 友链页
│   ├── categories/index.md     # 分类页
│   ├── tags/index.md           # 标签页
│   ├── css/custom.css          # ★自定义样式
│   ├── js/profile-hero.js      # 首页个人简介卡片
│   └── img/                    # 头像、logo、banner、封面（全是本地 SVG）
│
├── tools/post-build.js         # 构建收尾：把 _headers/_redirects 放进 public/
└── public/                     # 构建产物（已 gitignore，不用管）
```

---

## 三、本地开发

```bash
# 安装依赖（第一次，或换了电脑）
npm install

# 本地预览：http://localhost:4000
npm run server

# 只构建，不启服务
npm run build

# 新建一篇文章 / 一个页面
npx hexo new "my-post-title"
npx hexo new page "about"
```

> **小提示**：`npm run server` 启动后改文章会自动刷新，`Ctrl+C` 退出。

### 为什么不用 `npx hexo ...` 而用 `npm run ...`

两者都行，但 `npm run` 用的是项目里安装的 Hexo，版本一定对得上。如果 `npx hexo generate` 只打印一堆帮助信息，说明它找到了别的全局 Hexo —— 用 `npm run build` 就没这个问题。

---

## 四、部署到 Cloudflare Pages

整个流程大约 20 分钟，其中大部分时间在等 DNS 生效。

### 4.1 推送到 GitHub

先在 GitHub 上建一个**空仓库**（不要勾选 README / .gitignore），名字建议 `vopth-blog`，然后：

```bash
cd vopth-blog

git init
git add .
git commit -m "feat: 初始化 Hexo 博客"
git branch -M main
git remote add origin https://github.com/zxy6263/vopth-blog.git
git push -u origin main
```

> 仓库设为 **Public 或 Private 都可以**，Cloudflare Pages 两种都支持。
> 但如果你以后想用 giscus 评论，仓库必须是 Public。

### 4.2 创建 Pages 项目

1. 打开 [Cloudflare Dashboard](https://dash.cloudflare.com/)（没有账号就注册一个，免费）
2. 左侧 **Workers & Pages** → **Create** → 切到 **Pages** 标签 → **Connect to Git**
3. 授权 GitHub，选中 `vopth-blog` 仓库
4. 构建配置按下表填：

| 配置项 | 填什么 |
| --- | --- |
| Project name | `vopth-blog`（决定你的 `xxx.pages.dev` 地址） |
| Production branch | `main` |
| Framework preset | `Hexo`（如果列表里没有就选 `None`） |
| **Build command** | **`npm run build`** |
| Build output directory | `public` |

5. 展开 **Environment variables (advanced)**，加一条：

| 变量名 | 值 |
| --- | --- |
| `NODE_VERSION` | `22` |

6. 点 **Save and Deploy**，等 1～3 分钟

构建完成后会给你一个临时地址，类似 `https://vopth-blog.pages.dev`。**先打开它确认博客能正常显示**，再进行下一步绑域名。

> ⚠️ **Build command 一定要写 `npm run build`，不要写 `hexo generate`。**
> 因为我们的构建命令是 `hexo generate && node tools/post-build.js`，后半步负责把
> `_headers` 和 `_redirects` 放进产物目录。少了它，缓存策略和跳转规则就不会生效。

### 4.3 把域名 DNS 接入 Cloudflare

这是最多人卡住的一步。**Cloudflare Pages 要绑定根域名 `vopth.xyz`，就必须让 Cloudflare 接管这个域名的 DNS。**

为什么？因为根域名（不带 `www`）在 DNS 协议上**不能用 CNAME 记录**，而阿里云云解析没有 CNAME 拉平（flattening）功能。所以只能把整域 DNS 交给 Cloudflare。

**操作步骤：**

1. 在 Cloudflare Dashboard 点 **+ Add a site**
2. 输入 `vopth.xyz` → 选择 **Free** 套餐 → Continue
3. Cloudflare 会自动扫一遍你现有的 DNS 记录，直接 Continue
4. 记下它给你的**两个 nameserver**，形如：

   ```
   arya.ns.cloudflare.com
   rob.ns.cloudflare.com
   ```

5. 打开 [阿里云域名控制台](https://dc.console.aliyun.com/) → **域名列表** → 找到 `vopth.xyz` → 点 **管理**
6. 左侧 **DNS 修改**（有的界面叫「修改 DNS 服务器」）
7. 把原来的阿里云 DNS（`ns1.alidns.com` / `ns2.alidns.com` 之类）**替换成 Cloudflare 给的那两个**
8. 保存。生效时间通常 10 分钟到 24 小时（我这边大约 10 分钟）

Cloudflare 检测到 NS 生效后会发邮件通知你。

> **注意**：改成 Cloudflare NS 之后，你在**阿里云云解析里加的记录就不再起作用了**。
> 以后所有 DNS 记录（包括邮箱的 MX 记录）都要在 Cloudflare 后台加。
> 如果你之前用阿里云邮箱或其他服务，改之前先把记录抄下来。

> **需要备案吗？** 不需要。域名用境外 DNS + 境外托管，不涉及国内服务器，无需 ICP 备案。

### 4.4 绑定自定义域名

NS 生效后：

1. 回到 Cloudflare → **Workers & Pages** → 你的 `vopth-blog` 项目
2. **Custom domains** 标签 → **Set up a custom domain**
3. 输入 `vopth.xyz` → Continue → **Activate domain**
4. 重复一次，把 `www.vopth.xyz` 也加上（Cloudflare 会自动配好跳转）

Cloudflare 会自动创建 DNS 记录并签发 HTTPS 证书（一般 1～5 分钟）。**你不需要自己申请证书，也不需要配任何服务器。**

### 4.5 验证上线成功

浏览器打开 `https://vopth.xyz`，确认：

- [ ] 地址栏有小锁（HTTPS 生效）
- [ ] 首页 banner 和「个人简介卡片」正常显示
- [ ] 导航栏「关于 / 归档 / 分类 / 标签 / 友链」都能点开
- [ ] 随便进一篇文章，右侧目录、代码高亮、分享按钮正常
- [ ] 右上角切换到暗色模式，样式没崩
- [ ] 搜索框能搜到文章
- [ ] 打开 `https://vopth.xyz/不存在的页面`，能看到自定义 404
- [ ] 按 F12 → Network，刷新首页，**确认没有第三方域名的请求**

---

## 五、上线后请立刻改这几处

站点已经按你给的信息填好了（昵称 `vopth`、GitHub `zxy6263`、简介「一个爱瞎折腾IT的爱好者」、邮箱 `3585648116@qq.com`）。**其中邮箱我是按 QQ 号补全的，如果不对请改。**

下面这些是**建议你替换成自己内容**的地方：

| 要改什么 | 文件 | 找什么 |
| --- | --- | --- |
| 邮箱地址 | `_config.butterfly.yml` | `3585648116@qq.com`（出现在 social 和公告卡两处） |
| 邮箱地址 | `source/js/profile-hero.js` | `mailto:3585648116@qq.com` |
| 邮箱地址 | `source/about/index.md` | 两处邮箱链接 |
| 换成真人头像 | `source/img/avatar.*` | 放一张正方形照片，然后改 `_config.butterfly.yml` 里 `avatar.img` |
| 站点简介 / SEO 描述 | `_config.yml` | `subtitle` / `description` / `keywords` |
| 首页打字机文案 | `_config.butterfly.yml` | `subtitle.sub` 那三行 |
| 首页简介卡片文字 | `source/js/profile-hero.js` | `ph-name` / `ph-bio` 两处 |
| 个人主页内容 | `source/about/index.md` | 整篇按自己情况重写 |
| 「技能点」进度条 | `source/about/index.md` | `about-skill` 里的 `--w:88%` |
| 友链 | `source/_data/link.yml` | 把 `link_list: []` 换成真实好友 |
| 主题色 | `_config.butterfly.yml` | `theme_color.main`（现在是 `#4A6CF7` 靛蓝） |

改完执行：

```bash
git add .
git commit -m "chore: 替换个人信息"
git push
```

Cloudflare 会自动重新构建，1～2 分钟后线上生效。

---

## 六、日常写作流程

```bash
# 1. 新建文章（文件名用英文 slug，标题写中文）
npx hexo new "how-to-debug-node"

# 2. 编辑 source/_posts/how-to-debug-node.md
#    把 front-matter 里的 title 改成中文，例如：title: Node.js 调试踩坑记

# 3. 本地预览
npm run server

# 4. 发布
git add .
git commit -m "post: Node.js 调试踩坑记"
git push
```

就这样。推上去之后 Cloudflare 自动构建，**没有 FTP 上传，没有登录服务器，没有 `nginx -s reload`**。

**front-matter 和主题标签插件的完整写法**（提示框、选项卡、按钮、图片、mermaid 流程图…）都写在
[`source/_posts/hexo-writing-guide.md`](source/_posts/hexo-writing-guide.md) 里，忘了就翻这篇。

---

## 七、可选功能

### 开启评论（giscus，基于 GitHub Discussions）

不需要任何服务器，评论直接存在你仓库的 Discussions 里。

1. 把 GitHub 仓库设为 **Public**
2. 仓库 **Settings → General → Features** → 勾选 **Discussions**
3. 到 [giscus.app](https://giscus.app/)：
   - Repository 填 `zxy6263/vopth-blog`
   - 页面 ↔ Discussion 映射选 `pathname`
   - Discussion 分类建议新建一个 `Comments`（Announcements 类型）
4. 页面往下拉，复制生成的 **`data-repo-id`** 和 **`data-category-id`** 两个值
5. 填进 `_config.butterfly.yml`：

```yaml
comments:
  use: giscus          # 原来是空的，改成 giscus

giscus:
  repo: zxy6263/vopth-blog
  repo_id: 你的repo_id        # ← 填这里
  category_id: 你的category_id # ← 和这里
```

6. 装一下 giscus 的 GitHub App（giscus.app 页面会有链接和授权按钮）
7. `git push` 后评论就出现了

### 访问统计

推荐 **Cloudflare Web Analytics**：免费、无 Cookie、不拖慢页面，而且你已经在用 Cloudflare 了。

1. Cloudflare Dashboard → **Analytics & Logs → Web Analytics** → Add a site
2. 填 `vopth.xyz`，拿到一段 token
3. 填进 `_config.butterfly.yml`：

```yaml
cloudflare_analytics: 你的token
```

数据在 Cloudflare 后台看，不会在页面上显示计数器。

> 想显示 PV/UV 数字的话，可以把 `busuanzi` 那三个开关改成 `true`，
> 但不蒜子官方服务近年不太稳定，我没默认开启。

### 让搜索引擎收录

**Google**：到 [Google Search Console](https://search.google.com/search-console) 添加 `https://vopth.xyz`，用「HTML 标记」方式验证，把 content 值填到：

```yaml
site_verification:
  - name: google-site-verification
    content: 你的验证码
```

本站目前**没有**生成 sitemap。需要的话装一个：

```bash
npm install hexo-generator-sitemap
```

然后在 `_config.yml` 加：

```yaml
sitemap:
  path: sitemap.xml
```

**提交站点地图**：在 Search Console 或[百度搜索资源平台](https://ziyuan.baidu.com/)提交 `https://vopth.xyz/sitemap.xml`。

**RSS**：已自动生成，地址是 `https://vopth.xyz/atom.xml`（`/feed`、`/rss` 也会 301 跳转过来）。

---

## 八、常见问题排错

### `npx hexo generate` 只打印一堆帮助信息，什么都不生成

`hexo-cli` 靠 `package.json` 里的 `"hexo"` 字段来识别项目根目录。这个字段一旦丢了，它就会退化成只有 `init/help/version` 三个命令。

**解决**：确认 `package.json` 里有这个（本项目已经有了）：

```json
"hexo": {
  "version": "8.1.2"
}
```

### 构建报 `Node version not supported`

在 Pages 项目的 **Settings → Environment variables** 里加 `NODE_VERSION = 22`。

### 页面能打开，但样式全丢 / 图片 404

九成是 `_config.yml` 里 `url` 配错了。必须是**完整域名且结尾没有斜杠**：

```yaml
url: https://vopth.xyz
root: /
```

### 构建成功，但 `_headers` 没生效

确认 Build command 是 `npm run build` 而不是 `hexo generate`。看构建日志里有没有：

```
[post-build] _headers -> public/_headers
```

### DNS 改了但 Cloudflare 一直显示 Pending

- `.xyz` 域名在阿里云需要已完成**实名认证**，否则域名本身会被暂停解析
- 用 `nslookup -type=ns vopth.xyz 8.8.8.8` 确认 NS 是否已经变成 Cloudflare 的
- 有些域名有 **clientHold** 状态（比如刚注册未实名），在阿里云控制台能看到

### 文章里写 `{% note %}` 之类的标签，结果被当成普通文本显示了

说明它被转义了。检查是不是误加了反斜杠或 `{% raw %}`。

### 中文文章 URL 变成一长串 `%E4%BD%A0...`

文章**文件名**要用英文 slug，中文写在 front-matter 的 `title` 里：

```bash
npx hexo new "my-post"    # 文件名英文
# 然后改 title: 我的文章
```

### 想回滚到上一个版本

Cloudflare → 你的 Pages 项目 → **Deployments** 列表 → 找到历史版本 → 点 **Rollback**。不用改代码。

### 更新了文章但线上还是旧的

- Cloudflare 有 CDN 缓存，HTML 我们设了 `must-revalidate`，正常刷新就应该是新的
- 强制刷新：`Ctrl + F5`（或 `Cmd + Shift + R`）
- 确认 push 的分支是 `main`（Pages 只监听 Production branch）

### 本地构建产物想清掉重来

```bash
npm run clean && npm run build
```

---

## 九、成本

| 项目 | 费用 |
| --- | --- |
| 域名 `vopth.xyz` | 约 ¥10～70/年（`.xyz` 首年常有优惠，续费价看注册商） |
| Cloudflare Pages | **0** |
| HTTPS 证书 | **0** |
| 带宽流量 | **0**（免费套餐不限量） |
| 服务器 | 不存在 |
| 评论系统（giscus） | **0** |
| 访问统计 | **0** |

**一年下来就是域名钱。**

### 一个需要知道的坑：`.xyz` 后缀

`.xyz` 因为历史上被垃圾站滥用得多，**在国内部分网络环境下会被拦截**，最典型的是**微信内置浏览器**打开会提示"已停止访问该网页"。这是 TLD 层面的问题，换任何托管平台都一样，换 DNS 也没用。

如果你主要读者都在国内，以后可以考虑换 `.com` 或 `.cn`（`.cn` 需要备案，但用 Cloudflare 托管的话不需要）。

不过话说回来：**这个站首先是写给自己的。** 能让你在零心理负担的情况下持续写下去，比什么都重要。

---

## 十、参考

- [Hexo 官方文档](https://hexo.io/zh-cn/docs/)
- [Butterfly 主题文档](https://butterfly.js.org/)（配置项查询第一去处）
- [Cloudflare Pages 文档](https://developers.cloudflare.com/pages/)
- [giscus](https://giscus.app/zh-CN)
- 主题完整默认配置：`node_modules/hexo-theme-butterfly/_config.yml`
  （`_config.butterfly.yml` 是**覆盖式**的，只写了要改的项，其余自动沿用默认值）
