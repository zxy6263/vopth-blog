# vopth.xyz — 个人主页与博客

> **Hexo + Butterfly + Cloudflare。不需要买服务器，不需要备案。**

域名：`vopth.xyz`（阿里云注册） · 托管：Cloudflare Workers 静态资源（免费） · 生成器：Hexo 8 · 主题：Butterfly 5.7

---

## 目录

- [一、这套方案是什么](#一这套方案是什么)
- [二、目录结构](#二目录结构)
- [三、本地开发](#三本地开发)
- [四、部署到 Cloudflare](#四部署到-cloudflare)
  - [4.1 推送到 GitHub](#41-推送到-github)
  - [4.2 创建项目并连接仓库](#42-创建项目并连接仓库)
  - [4.3 把域名 DNS 接入 Cloudflare](#43-把域名-dns-接入-cloudflare)
  - [4.4 绑定自定义域名](#44-绑定自定义域名)
- [五、上线后请立刻改这几处](#五上线后请立刻改这几处)
- [六、日常写作流程](#六日常写作流程)
- [七、可选功能](#七可选功能)
  - [网页后台：在网站上直接发文章](#网页后台在网站上直接发文章)
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
- **免费且不限量**：静态资源请求不计费、不限量。站点上有一个 Worker 脚本（浏览量计数、发邮件通知、网页后台），但**只有落到 `/api/*` 和 `/admin/` 的请求才会跑它**，其余请求原样交给静态资源层，所以日常访问仍然是免费不限量的
- **不依赖国内被墙的 CDN**：字体图标、打字机、灯箱、分享按钮等全部打包在你自己站点里（`/pluginsSrc/`），不请求 jsDelivr / unpkg / Google Fonts

浏览器打开控制台 Network 面板看一下就知道：**没有任何第三方域名的请求**。

---

## 二、目录结构

```
vopth-blog/
├── _config.yml                 # 站点主配置（标题、域名、URL 结构、分页…）
├── _config.butterfly.yml       # 主题配置（外观、菜单、侧边栏、评论…）★改得最多
├── wrangler.jsonc              # Cloudflare 配置（★关键：声明构建产物目录）
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
│   │   ├── hello-vopth.md          # 开站第一篇（置顶）
│   │   ├── cloudflare-pages-deploy.md  # 部署全记录
│   │   ├── hexo-writing-guide.md   # 写作速查，忘了语法就翻它
│   │   ├── blog-build-notes.md     # 建站踩坑总结（28 个坑）
│   │   ├── blog-memory-setup.md    # 给博客配 AI 记忆的记录
│   │   └── ai-self-description.md  # 一个 AI 的自述（AI 视角写的一篇）
│   ├── _data/
│   │   └── link.yml            # ★友链数据
│   ├── about/index.md          # ★个人主页 / 关于我
│   ├── subscribe/index.md      # 订阅本站（RSS 说明页，不是 feed 本身）
│   ├── link/index.md           # 友链页
│   ├── categories/index.md     # 分类页
│   ├── tags/index.md           # 标签页
│   ├── css/custom.css          # ★自定义样式
│   ├── js/profile-hero.js      # 首页个人简介卡片
│   ├── js/banner-video.js      # 按页面注入视频 banner（Butterfly 不支持，需自己实现）
│   ├── robots.txt              # 爬虫规则 + 声明 sitemap 位置
│   ├── img/                    # 头像、logo、banner、封面（SVG + 照片）
│   └── videos/                 # 视频 banner 及其海报图
│
├── 发文章.cmd                  # ★双击它就能发文章（一键发帖入口）
├── 删文章.cmd                  # ★双击它就能删文章（含封面/资源文件夹清理 + 301 提醒）
│
├── tools/
│   ├── new-post.js             # 一键发文章脚本（发文章.cmd / npm run new-post 都调它）
│   ├── del-post.js             # 删除文章脚本（删文章.cmd / npm run del-post 都调它）
│   ├── post-build.js           # 构建收尾：把 _headers/_redirects 放进 public/
│   ├── check-site.ps1          # 部署后验收脚本（48 项检查）
│   └── compress-banner-video.ps1  # 把手机/壁纸站下的大视频压成适合做 banner 的 mp4
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

## 四、部署到 Cloudflare

整个流程大约 20 分钟，其中大部分时间在等 DNS 生效。

> **本文档描述的是 Cloudflare 现行的「Workers Builds / 导入仓库」流程。**
> Cloudflare 正在把旧的 Pages 产品并入 Workers，新账号点 **Create** 后进的就是
> Workers 流程。两者对本项目都可用，差异见 4.2 末尾。

### 4.1 推送到 GitHub

先在 GitHub 上建一个**空仓库**（不要勾选 README / .gitignore / license），名字 `vopth-blog`，然后：

```bash
cd vopth-blog

git init -b main
git add .
git commit -m "feat: 初始化 Hexo 博客"
git remote add origin git@github.com:zxy6263/vopth-blog.git
git push -u origin main
```

> **建议用 SSH 而不是 HTTPS**：GitHub 已经不允许用账号密码推送。如果
> `github.com:22` 端口被网络屏蔽（国内很常见），在 `~/.ssh/config` 里加一段即可走 443：
>
> ```
> Host github.com
>   HostName ssh.github.com
>   Port 443
>   User git
> ```
>
> ⚠️ 该文件必须是**无 BOM 的 UTF-8**。用 PowerShell 的 `Set-Content -Encoding UTF8`
> 会写入 BOM，导致 `Bad configuration option: \357\273\277#` 而失败。
> 验证方法：`git ls-remote git@github.com:用户名/仓库.git` 返回 0 即成功。

> 仓库设为 **Public 或 Private 都可以**，Cloudflare 两种都支持。
> 但如果你以后想用 giscus 评论，仓库必须是 Public。

### 4.2 创建项目并连接仓库

1. 打开 [Cloudflare Dashboard](https://dash.cloudflare.com/)（没有账号就注册一个，免费）
2. 左侧 **Workers & Pages** → **Create**（中文界面：「设置您的应用程序」）
3. 授权 GitHub，选中 `zxy6263/vopth-blog` 仓库
4. 按下表填写：

| 配置项 | 填什么 | 说明 |
| --- | --- | --- |
| Project name / 项目名称 | `vopth-blog` | 决定你的 `xxx.workers.dev` 临时地址 |
| Build command / 构建命令 | **`npm run build`** | ⚠️ 见下方警告 |
| Deploy command / 部署命令 | `npx wrangler deploy` | **保持默认，不用改** |

5. 展开 **高级设置 / Build variables**，加一条环境变量：

| 变量名 | 值 |
| --- | --- |
| `NODE_VERSION` | `22` |

6. 点 **部署 / Deploy**。首次构建约 **3～5 分钟**（要装 755 个依赖包）

> ⚠️ **Build command 一定要写 `npm run build`，不要写 `hexo generate`。**
> 因为真实的构建命令是 `hexo generate && node tools/post-build.js`，后半步负责把
> `_headers` 和 `_redirects` 放进产物目录。
> **判断方法**：构建日志里应出现 `[post-build] _headers -> public/_headers`。

> 📌 **这个流程没有「构建输出目录」这一栏。**
> 产物目录由仓库根目录的 `wrangler.jsonc` 里的 `assets.directory` 指定
> （本项目已配好为 `./public/`，并设置了 `not_found_handling: "404-page"`）。
> 如果没有这个文件，Cloudflare 会自动识别框架并**给你开一个 Pull Request**，
> 需要你合并后才会正常部署 —— 所以这个文件必须提交进仓库。

<details>
<summary><b>旧版 Pages 流程的差异（如果你在 Create 页面里能找到 Pages 标签）</b></summary>

| 配置项 | 填什么 |
| --- | --- |
| Production branch | `main` |
| Framework preset | `Hexo`（没有就选 `None`） |
| **Build command** | **`npm run build`** |
| Build output directory | `public` |

Pages 流程有独立的「构建输出目录」输入框，**不读 `wrangler.jsonc`**；
自定义域名在 **Custom domains** 标签下。功能上两者等价。

</details>

构建完成后会给你一个临时地址，形如 `https://vopth-blog.<你的子域>.workers.dev`。
**先打开它确认博客能正常显示**，再进行下一步绑域名。

### 4.3 把域名 DNS 接入 Cloudflare

这是最多人卡住的一步。**要绑定根域名 `vopth.xyz`，就必须让 Cloudflare 接管这个域名的 DNS。**

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
2. 进入 **Settings / 设置** → **Domains & Routes / 域和路由**
   （旧版 Pages 界面是顶部的 **Custom domains** 标签）
3. 点 **Add / 添加** → 选 **Custom domain / 自定义域**
4. 输入 `vopth.xyz` → **Add domain / 添加域**
5. 重复一次，把 `www.vopth.xyz` 也加上

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
- [ ] 打开 `https://vopth.xyz/feed` 会自动跳到 `/atom.xml`
- [ ] 按 F12 → Network，刷新首页，**确认没有第三方域名的请求**

---

## 五、上线后请立刻改这几处

站点已经按你给的信息填好了（昵称 `vopth`、GitHub `zxy6263`、简介「deepseek忠实合作伙伴」、邮箱 `3585648116@qq.com`）。

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

### 一键发文章（推荐）

```bash
npm run new-post
```

或者**双击仓库根目录的 `发文章.cmd`** —— 效果一样。

它会依次问几件事：

| 问题 | 说明 |
| --- | --- |
| 文章标题 | 必填 |
| 文件名 | 英文，同时是 URL 的一部分。**留空会自动用标题的拼音**（例：`这个博客是怎么搭的` 会变成 `zhe-ge-bo-ke-shi-zen-me-da-de`） |
| 分类 | 默认「随笔」 |
| 标签 | 逗号分隔，可留空 |
| 摘要 | 用于首页和搜索，可留空（留空则自动截取） |
| 封面图路径 | **可以把图片文件直接拖进命令行窗口**；留空则用默认封面 |

然后脚本自动完成：

1. 生成 `source/_posts/<文件名>.md`
2. **自动处理封面图** —— 复制到 `source/img/covers/<文件名>.<扩展名>`；
   如果图超过 1600px 宽或 400 KB，自动缩到 1280 宽
3. 用 VS Code 打开让你写正文（找不到 VS Code 就用记事本）
4. **写完保存并关闭编辑器**，脚本自动执行构建
5. **校验文章真的生成了**（查 sitemap，不只看退出码 —— 这个项目里"退出码 0 但没生效"的坑踩过太多次）
6. `git commit` + `git push` → Cloudflare 自动部署

> **发帖方式没有变** —— 依然是「Markdown 文件 → git push → Cloudflare 自动构建」。
> 这个脚本只是把手动步骤串起来，**没有引入任何新机制、新服务、新依赖到构建流程里**。

**几个安全设计：**

| 情况 | 脚本行为 |
| --- | --- |
| 工作区有未提交改动 | **先警告并列出，要求确认** —— 避免把不相关的改动一起提交 |
| 构建失败 | **中止，不提交不推送**，文章文件保留在本地 |
| 推送失败 | 明确告知「本地已提交，网络恢复后手动 `git push` 即可」 |
| 文件名已存在 | 提前拦住，不会覆盖旧文章 |

**非交互用法**（脚本化、或只想演练一次）：

```bash
node tools/new-post.js --title "标题" --slug my-post --no-edit --no-push
```

- `--no-edit` 不打开编辑器（先把文件建好，正文之后再写）
- `--no-push` 只生成并构建，**不提交不推送**
- 其余参数：`--category`、`--tags`、`--desc`、`--cover`

**想用别的编辑器**：设环境变量 `NEW_POST_EDITOR` 为编辑器的完整路径。

> 拼音文件名依赖 `pinyin-pro`（开发依赖，944 KB、零依赖）。
> 它**只被这个脚本用到**，不参与网站构建，也不会进构建产物。

### 手动方式（脚本出问题时的后备）

```bash
# 1. 新建文章（文件名用英文 slug，标题写中文）
npx hexo new "how-to-debug-node"

# 2. 编辑 source/_posts/how-to-debug-node.md
#    把 front-matter 里的 title 改成中文

# 3. 本地预览
npm run server

# 4. 发布
git add .
git commit -m "post: Node.js 调试踩坑记"
git push
```

推上去之后 Cloudflare 自动构建，**没有 FTP 上传，没有登录服务器，没有 `nginx -s reload`**。

**front-matter 和主题标签插件的完整写法**（提示框、选项卡、按钮、图片、mermaid 流程图…）都写在
[`source/_posts/hexo-writing-guide.md`](source/_posts/hexo-writing-guide.md) 里，忘了就翻这篇。

### 给文章配封面图

首页的文章卡片会显示封面图。来源有三种，优先级从高到低：

1. **文章 front-matter 里写 `cover: /img/xxx.jpg`** —— 手动指定，最优先
2. **`source/img/covers/<文章文件名>.jpg`** —— **约定式自动匹配，推荐**
3. 都没有 → 主题的默认渐变图（`cover-1/2/3.svg` 等三张随机）

**推荐第 2 种，因为完全不用改 front-matter：**

```
文章   source/_posts/my-first-post.md
封面   source/img/covers/my-first-post.jpg     ← 文件名一样就行
```

扩展名支持 `jpg` / `jpeg` / `png` / `webp` / `gif`（按此顺序匹配）。
构建时会自动挂上去，日志里能看到确认：

```
INFO  Post cover auto-assigned: my-first-post -> /img/covers/my-first-post.jpg
```

> ⚠️ **这一行日志很重要。** 如果文件名没对上，**不会有任何报错** ——
> 只是静默地用回默认渐变图。所以配完封面建议扫一眼构建日志，确认匹配成功。
> 这类"静默失效"是这个项目里踩过最多次的坑。

**尺寸建议**：

| | |
| --- | --- |
| 比例 | 首页卡片是横向长方形，建议 **16:10 或 3:2** |
| 尺寸 | 宽 **800～1200px** 足够 |
| 大小 | **小于 300 KB**，否则首页明显变慢 |
| 格式 | 照片用 jpg，需要透明背景用 png / webp |

> 手机原图动辄几 MB，直接放会让首页明显变慢。
>
> 实现见 `scripts/post-cover.js`；目录里还有一份说明
> `source/img/covers/_README.md`（以 `_` 开头，**不会被发布到网站上** ——
> 这利用了 Hexo 会忽略 `source/` 下所有 `_` 开头文件的特性）。

### 删除文章

```bash
npm run del-post
```

或者**双击仓库根目录的 `删文章.cmd`**。

它会：

1. **列出所有文章**（标题 + 文件名 + 日期），让你输入序号选
2. **显示将要删除的全部文件** —— 不只是文章本身，还有：
   - 它的专属封面 `source/img/covers/<文件名>.<扩展名>`
   - 它的资源文件夹 `source/_posts/<文件名>/`（用 `hexo new` 建的文章才有）
3. **要求确认**（删除不可逆）
4. 删除 → 构建 → **校验旧页面真的被清除了**
5. **主动问你要不要加 301 跳转**（见下）
6. `git commit` + `git push`

> **为什么需要这个脚本**：手动删很容易漏 ——
> 漏删封面会留一张没人用的孤儿图，漏删资源文件夹会留一整个空目录。
> 这两样都**不报错**，只是悄悄留在仓库里越积越多。

**只列出、不删除：**

```bash
npm run del-post -- --list
```

**非交互删除**（`--yes` 请慎用，删除不可逆）：

```bash
node tools/del-post.js --slug 文章文件名 --yes
node tools/del-post.js --slug 文章文件名 --yes --redirect /archives/
```

#### 关于 301 跳转

文章删掉后，**原来分享出去的链接会变成 404**。所以脚本会问你：
「这个链接分享出去过吗？」

| 情况 | 怎么做 |
| --- | --- |
| 分享过（发过微信、论坛，或被别人收藏） | 答 `y` —— 脚本在 `_redirects` 里加一条 301，旧链接跳到归档页，不变死链 |
| 没分享过（刚写完就删了） | 直接回车跳过 |

#### 三个要知道的点

| | |
| --- | --- |
| **旧页面会自动清除** | 已实测：构建日志里会出现 `INFO Deleted: 2026/10/03/xxx/index.html`，sitemap / 归档 / 标签 / 分类 / 搜索索引全部同步更新 |
| **git 历史里仍然留着** | 删文件 + commit 后，内容在 `git log` 里还查得到。删的如果是**涉及隐私**的内容（密码、住址），光删文件不够，必须改写 git 历史 —— 这种情况找人处理，别自己试 |
| **搜索引擎索引会残留** | 已收录的页面会逐渐消失，可能残留几天到几周。想加速可在 Search Console / 百度资源平台提交「移除请求」 |

### 置顶一篇文章

在文章 front-matter 里写：

```yaml
sticky: 100
```

数字越大越靠前。

> ⚠️ **置顶要用 `sticky`，不要用 `top`。**
>
> 置顶其实由**两个独立的机制**组成，它们读的字段不一样：
>
> | 机制 | 谁实现 | 读哪个字段 | 写 `top: true` | 写 `sticky: 100` |
> | --- | --- | --- | --- | --- |
> | **首页排序** | `hexo-generator-index` | **只读 `sticky`** | ❌ 不管用 | ✅ 排到最前 |
> | **标题前的图钉图标** | Butterfly 主题 | `article.top \|\| article.sticky > 0` | ✅ 会显示 | ✅ 会显示 |
>
> ```js
> // hexo-generator-index 的排序：只认 sticky
> posts.data.sort((a, b) => (b.sticky || 0) - (a.sticky || 0));
> ```
>
> **`top: true` 最阴险的地方**：它会让标题前出现一个橙红色图钉 ——
> 主题的 `indexPostUI.pug` 判断是 `article.top || article.sticky > 0` ——
> **看起来像置顶成功了，但列表顺序根本没变**，而且不报任何错。
> 这个坑我实地踩过一次：《你好，世界》一直排在列表最后。
>
> 图钉**只在首页显示**（条件里有 `globalPageType === 'home'`），归档页/标签页没有。
>
> 判断置顶是否真的生效：**看首页第一张卡片是不是它**。别只看有没有图钉。

> ⚠️ **另外，日期别写成未来时间。**
>
> 新文章的日期是「此刻」。如果仓库里已有文章的日期比此刻还晚，你的新文章就会
> 排到它们下面 —— 表现是「刚发的文章跑到列表中间/最后了」。
>
> `npm run new-post` 会**主动检查并警告**这种情况（会告诉你哪几篇、什么时间、怎么修）。
> 历史原因我踩过：早期手写日期时填了当天的晚上，而实际时间是凌晨，结果那几篇全成了"未来"。

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

**已经做好的部分**（本项目已内置，无需操作）：

| 项目 | 状态 | 说明 |
| --- | --- | --- |
| `sitemap.xml` | ✅ 已生成 | 8 条 URL，全部使用 `https://vopth.xyz` |
| `robots.txt` | ✅ 已生成 | 允许所有爬虫，并声明了 sitemap 位置 |
| `<link rel="sitemap">` | ✅ 已注入 | 通过 `_config.butterfly.yml` 的 `inject.head` 手动注入 |
| `canonical` / Open Graph / JSON-LD | ✅ 已注入 | 由 Butterfly 主题提供 |
| `atom.xml`（RSS / Atom） | ✅ 已生成 | `/feed`、`/rss` 也会 301 跳过来。首页 RSS 图标指向 `/subscribe/` 说明页，**feed 本身保持原始 XML 不动**（改它会废掉所有阅读器） |

> **关于 `<meta name="keywords">` 和 `<meta name="robots">`**：站点没有这两项，
> **这是刻意的，不是遗漏**。`keywords` 从 2009 年起就被 Google 完全忽略；
> `robots` 默认就是 `index,follow`，写上等于没写。不要被过时的 SEO 教程带偏。

**还需要你手动做的部分**（域名上线后）：

1. 到 [Google Search Console](https://search.google.com/search-console) 添加 `https://vopth.xyz`
2. 用「HTML 标记」方式验证，把拿到的 content 值填进 `_config.butterfly.yml`：

   ```yaml
   site_verification:
     - name: google-site-verification
       content: 你的验证码
   ```

3. 在 Search Console 的 **Sitemaps** 里提交：

   ```
   https://vopth.xyz/sitemap.xml
   ```

4. 国内的话，再到[百度搜索资源平台](https://ziyuan.baidu.com/)做同样的验证和提交

> 提交 sitemap 会让**新站被收录的速度快很多**。刚上线的站点，搜索引擎不主动抓取是常态，
> 主动提交是最有效的一步。

### 视频 banner（关于 / 归档 / 分类 / 标签 / 友链）

Butterfly **不支持**把视频作为 `top_img`，所以这部分是自己实现的（`source/js/banner-video.js`）。

**这五个页面共用一个「视频池」，每次打开页面随机挑一个播放** —— 所以每次刷新看到的可能不同。
首页用的是照片，文章页用的是渐变图（都不在池子里）。

**加一个新视频只要三步：**

**① 把视频压到可用体积**

手机 / 壁纸站下载的 4K 60fps 素材通常 **80～150 MB、码率 20+ Mbps** ——
**远超 Cloudflare 的单文件上限，原样部署会直接失败**。用仓库里的工具处理：

```powershell
# 先估算体积（只编码 5 秒再外推，几秒出结果）
powershell -File tools\compress-banner-video.ps1 -Source "D:\Downloads\xxx.mp4" -Name banner-3 -Estimate

# 满意就正式编码
powershell -File tools\compress-banner-video.ps1 -Source "D:\Downloads\xxx.mp4" -Name banner-3
```

输出两个文件：

- `source/videos/banner-3.mp4` —— 1920 宽、30fps、无音轨、已启用 faststart
- `source/videos/banner-3-poster.jpg` —— 海报图（视频的一帧）

> 工具已经处理了三个真实的坑：**中文路径**（老版 ffmpeg 支持差，会先复制到 ASCII 临时目录）、
> **奇数高度**（等比缩放可能得到 725 这种奇数，而 H.264 的 yuv420p 要求宽高都是偶数，
> 否则编码直接报错）、以及**老版本参数差异**（不用 `-hide_banner`、不用 `scale=W:-2`）。
>
> `-Estimate` 采样的是视频**中间**片段而不是开头 —— 开头往往最平缓，会明显低估
> （实测低估过 39%：预估 3.95 MB，实际 5.48 MB）。

**② 把新视频加进池子**

编辑 `source/js/banner-video.js` 的 `VIDEO_POOL` 数组：

```js
var VIDEO_POOL = [
  { src: '/videos/banner-1.mp4', poster: '/videos/banner-1-poster.jpg' },
  { src: '/videos/banner-2.mp4', poster: '/videos/banner-2-poster.jpg' },
  { src: '/videos/banner-3.mp4', poster: '/videos/banner-3-poster.jpg' }  // ← 加这一行
];
```

就完了。**不需要改任何页面配置** —— 池子里的视频会自动在所有池内页面随机出现。
想改池子覆盖哪些页面，编辑同一个文件里的 `POOL_PAGES` 数组。

**③（可选）换掉服务端渲染的静态海报图**

JS 关闭或加载失败时显示的那张静态图配在这几处：

| 页面 | 配在哪 |
| --- | --- |
| 关于页 | `source/about/index.md` 的 `top_img` |
| 友链页 | `source/link/index.md` 的 `top_img` |
| 分类页 | `source/categories/index.md` 的 `top_img` |
| 标签页 | `source/tags/index.md` 的 `top_img` |
| 归档页 | `_config.butterfly.yml` 的 `archive_img` |

> **为什么必须有海报图？** 它是**优雅降级**的最后一层，三层都不会出现黑块：
>
> 1. JS 正常执行 → 随机视频
> 2. 系统开了「减少动态效果」→ 随机海报图（`banner-video.js` 会连背景一起换掉）
> 3. JS 未执行 / 加载失败 → 上面配置的静态海报图

> ⚠️ **分类页 / 标签页的海报图必须配在页面 front-matter 的 `top_img` 里，
> 不能只靠 `_config.butterfly.yml` 的 `category_img` / `tag_img`。**
>
> 原因：主题 `layout/includes/header/index.pug` 的分支写的是 `when 'category'`（**单数**），
> 而 `scripts/helpers/page.js` 返回的是 `'categories'`（**复数**），两者对不上，
> 于是掉进 `default` 分支只读 `page.top_img || default_top_img` ——
> **配置项被整个绕过，而且不报任何错。**

> **体积参考**：本站两个视频分别是 30 秒 → 3.17 MB、93 秒 → 5.48 MB
> （原素材 83 MB / 90 MB，压到 3.8% / 6.1%）。因为启用了 faststart，
> 浏览器可以边下边播，不会等整个文件下载完。
> 池子变大后，访问几次浏览器就会把用到的视频缓存住，不会一直重复下载。

> ⚠️ **`tools/` 下的 `.ps1` 脚本必须保持纯 ASCII。**
> Windows PowerShell 5.1 会把无 BOM 的 UTF-8 文件按 GBK 解码，中文注释被解错后
> 可能产生假的引号或括号，直接导致脚本语法报错 —— 这个坑我实地踩过一次。

### 文章作者署名（头像 + 名字）

**每篇文章都会自动带上作者署名**，位置在文章标题正下方。由 `scripts/post-author.js`
通过 Hexo 的 `after_render:html` 过滤器在**服务端注入**，所以：

- **关掉 JS 也能看到**，对 SEO 也更友好
- **以后发新文章自动生效**，不用每篇手动加
- 首页、归档页、RSS feed **都不会**被影响 —— 它靠 `<h1 class="post-title">`
  这个只出现在文章页的标记来识别，不依赖 layout 判断

默认值来源：

| 项 | 取自 |
| --- | --- |
| 名字 | `_config.yml` 的 `author` |
| 头像 | `_config.butterfly.yml` 的 `avatar.img`（**和侧边栏头像自动保持一致**） |
| 链接 | `/about/` |

**单篇文章可以覆盖**（写在文章 front-matter 里）：

```yaml
author_name: 另一个名字
author_avatar: /img/other.jpg
author_link: https://example.com
```

**某篇文章不想要署名**：

```yaml
author_avatar: false
```

> 想改署名样式（圆角、间距、背景透明度等），改 `source/css/custom.css` 的第 9 节。

### 网页后台：在网站上直接发文章

打开 `https://vopth.xyz/admin/`，登录后填标题/正文，点发布 —— **不用开电脑、不用敲命令**，
手机上就能发。提交走 GitHub API 往 `source/_posts/` 写一个文件，之后 Cloudflare 自动构建上线
（和你在本地 `git push` 完全等价）。

**这个入口是锁着的**：`/admin/` 由 Cloudflare Access 拦一道（邮箱验证码 / Google 登录），
Worker 里再用 Access 的公钥做**真正的 JWT 签名校验**（`src/access.js`）。
不是「看某个请求头存不存在」——那种做法可以被伪造。

> ⚠️ 没配置好之前，`/admin/` 一律返回 **403**，这是**故意的**（fail closed）：
> 宁可后台不可用，也不能让没鉴权的请求有机会动仓库。

**页面为什么由 Worker 返回，而不是放进 `source/` 当静态页**

1. 放进 `source/` 就会出现在公开仓库和公开站点上 —— 后台入口暴露给所有人扫，只会招来无谓的尝试
2. 放在 Worker 里，就能在**返回 HTML 之前**先校验 Access：没通过鉴权的人连页面源码都拿不到，
   而不是「能打开但点了没用」
3. 代价：`/admin/` 的请求算 Worker 请求（会计费），但它一天也开不了几次

**三个文件的职责**

| 文件 | 做什么 |
|---|---|
| `src/index.js` | 路由：`/admin/` 返回页面；`/admin/api/post` 提交；`/admin/api/dry-run` 干跑（只回生成好的 Markdown 不提交） |
| `src/access.js` | Access 鉴权：RS256 真签名校验 + `iss` / `aud` / `exp` 检查，失败一律拒绝 |
| `src/admin.js` | 拼 front-matter（上海时间、真实秒数，纯函数可单测）+ 调 GitHub REST API |
| `src/admin-page.js` | 后台页面的 HTML：手机优先、自动存本地草稿、防重复提交 |

**配置（一次性，三步）**

1. **GitHub 细粒度 PAT**：Settings → Developer settings → Fine-grained tokens →
   只勾 `vopth-blog` 这一个仓库 → 权限 **Contents: Read and write**（别多给）→ 生成后
   `npx wrangler secret put GITHUB_TOKEN`
2. **Cloudflare Access**：Zero Trust → Access → Applications → Add → Self-hosted，
   ⚠️ **要建两条**：`vopth.xyz` + path `admin`，以及 `vopth.xyz` + path `admin`（一个应用就够，见下）。
   每条加一个 Allow 策略（Include = 你的邮箱）。
   > 为什么必须两条：Access 是**按路径**拦并注入 JWT 头的。只保护 `/admin` 的话，页面能打开，
   > 但它后面调 `/admin/api/post` 时拿不到那个头，Worker 会（正确地）拒绝 —— 表现就是「登录了却发不出去」。
3. 把应用详情页的 **AUD** 和团队域名填进 `wrangler.jsonc` 的 `vars`（模板里已经注释好了）：
   ```jsonc
   "ACCESS_TEAM_DOMAIN": "你的团队名.cloudflareaccess.com",
   "ACCESS_AUD": "从应用详情页复制的 AUD"
   ```
   ⚠️ 部署时配置文件的 `vars` 会覆盖控制台手填的同名变量，别一边填一半。

**几个已知边界**

- 后台只用来发**新**文章。仓库里已有同名文件时 GitHub 要求带原文件的 sha 才能更新，
  这里**故意不做** —— 免得静默覆盖你已发表的内容。改旧文章走本地那套工具
- 提交失败会明确告诉你是「文件已存在」还是别的原因，不会静默吞掉
- 页面里**没有任何密钥**，密钥只存在 Worker 的环境变量里
- ⚠️ 访问地址请用 **`https://vopth.xyz/admin/`**（带结尾斜杠，且不带 `www`）。
  `www` 没配 Access 规则，会被 Worker 自己的签名校验拒掉（403）—— 那是正确行为
- ⚠️ `wrangler.jsonc` 里用的是 **`run_worker_first` 的数组写法**
  （`["/admin", "/admin/*", "/api/*"]`），**不是布尔 `true`**。
  默认策略是「静态资源优先，没命中才落到 Worker」，而 `/admin` 这种没有对应文件的
  路径有可能被静态资源层当成目录直接返回 404，请求根本进不了 Worker。
  数组写法只影响这几个路径；布尔 `true` 会让全站每个请求都跑 Worker，
  免费额度烧光后 429，「静态资源免费不限量」就没了
- ⚠️ Cloudflare Access 里**每个应用有自己的 AUD**。这里保护两个路径，
  所以是两个应用两个 AUD，`ACCESS_AUD` 里要用逗号分隔写两个。只填一个的症状：
  页面能登录，但点发布一直失败

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

在项目的 **Settings → Build / 环境变量** 里加 `NODE_VERSION = 22`。

### 构建报找不到 configuration file / 部署失败

说明 `wrangler.jsonc` 没有被提交进仓库，或者 `assets.directory` 写错了。
确认仓库根目录有这个文件，且内容是：

```jsonc
{
  "name": "vopth-blog",
  "compatibility_date": "2026-10-02",
  "assets": { "directory": "./public/" }
}
```

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

### 本地访问 `/feed` 是 404，但线上是好的

正常现象。`_headers` 和 `_redirects` 是 **Cloudflare 的功能**，本地的 `npm run server`（Hexo 自带服务器）不认识这两个文件，所以 `/feed`、`/rss` 这类跳转规则只在线上生效。

想本地确认规则内容，直接看根目录的 `_redirects` 文件；想确认它有没有进构建产物：

```bash
npm run build
cat public/_redirects     # Windows 用 type public\_redirects
```

### 想回滚到上一个版本

Cloudflare → **Workers & Pages** → 你的项目 → **Deployments / 部署** 列表 → 找到历史版本 → 点 **Rollback / 回滚**。不用改代码。

### 更新了文章但线上还是旧的

- Cloudflare 有 CDN 缓存，HTML 我们设了 `must-revalidate`，正常刷新就应该是新的
- 强制刷新：`Ctrl + F5`（或 `Cmd + Shift + R`）
- 确认 push 的分支是生产分支（默认 `main`）

### 本地构建产物想清掉重来

```bash
npm run clean && npm run build
```

---

## 九、成本

| 项目 | 费用 |
| --- | --- |
| 域名 `vopth.xyz` | 约 ¥10～70/年（`.xyz` 首年常有优惠，续费价看注册商） |
| Cloudflare 静态资源托管 | **0** |
| HTTPS 证书 | **0** |
| 带宽流量 | **0**（静态请求不计费、不限量） |
| 服务器 | 不存在 |
| 评论系统（giscus） | **0** |
| 访问统计 | **0** |

**一年下来就是域名钱。**

> **为什么静态请求不计费？** 我们的 Worker 没有 `main` 脚本，是纯静态资源。
> Cloudflare 只有在「Worker 脚本被调用」时才计费，而纯静态资源不经过脚本。

### 一个需要知道的坑：`.xyz` 后缀

`.xyz` 因为历史上被垃圾站滥用得多，**在国内部分网络环境下会被拦截**，最典型的是**微信内置浏览器**打开会提示"已停止访问该网页"。这是 TLD 层面的问题，换任何托管平台都一样，换 DNS 也没用。

如果你主要读者都在国内，以后可以考虑换 `.com` 或 `.cn`（`.cn` 需要备案，但用 Cloudflare 托管的话不需要）。

不过话说回来：**这个站首先是写给自己的。** 能让你在零心理负担的情况下持续写下去，比什么都重要。

---

## 十、参考

- [Hexo 官方文档](https://hexo.io/zh-cn/docs/)
- [Butterfly 主题文档](https://butterfly.js.org/)（配置项查询第一去处）
- [Cloudflare Workers 静态资源](https://developers.cloudflare.com/workers/static-assets/)
- [Workers 静态资源 `_headers`](https://developers.cloudflare.com/workers/static-assets/headers/)
- [Workers 静态资源 `_redirects`](https://developers.cloudflare.com/workers/static-assets/redirects/)
- [Workers 自定义 404 页面](https://developers.cloudflare.com/workers/static-assets/routing/static-site-generation/)
- [Workers Builds 构建配置](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)
- [giscus](https://giscus.app/zh-CN)
- 主题完整默认配置：`node_modules/hexo-theme-butterfly/_config.yml`
  （`_config.butterfly.yml` 是**覆盖式**的，只写了要改的项，其余自动沿用默认值）
