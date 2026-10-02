# 这个目录是干什么的

放**文章封面图**。

> 本文件以 `_` 开头，Hexo 不会把它发布到网站上（Hexo 会忽略 `source/` 下所有
> `_` 开头的文件）—— 所以它只存在于仓库里，用来给人看。

## 用法：文件名和文章文件名一样就行

```
文章   source/_posts/my-first-post.md
封面   source/img/covers/my-first-post.jpg     ← 放这里，自动生效
```

**不需要改任何配置、不需要写 front-matter。** 构建时会自动挂到那篇文章上，
构建日志里会出现一行：

```
INFO  Post cover auto-assigned: my-first-post -> /img/covers/my-first-post.jpg
```

## 支持的扩展名（按优先级）

`.jpg` → `.jpeg` → `.png` → `.webp` → `.gif`

## 优先级（从高到低）

1. 文章 front-matter 写了 `cover: /img/xxx.jpg` → 用它（手动优先）
2. 本目录有同名图片 → 自动匹配
3. 都没有 → 主题的默认渐变图（`cover-1/2/3.svg` 随机）

实现见 `scripts/post-cover.js`。

## 尺寸建议

| | |
| --- | --- |
| 比例 | 首页卡片是横向长方形，建议 **16:10 或 3:2** |
| 尺寸 | 宽 **800～1200px** 足够（再大是浪费流量） |
| 大小 | 建议 **< 300 KB**，否则首页明显变慢 |
| 格式 | 照片用 jpg，需要透明背景用 png / webp |

> ⚠️ 手机拍的图动辄 4000px 宽、好几 MB，**直接放进来会明显拖慢首页**。
> 需要压缩可以找人帮忙，或自己用 Windows 自带「画图」缩放一下。
