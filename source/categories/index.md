---
title: 分类
date: 2026-10-03 00:00:00
type: categories
# 这里必须用 top_img 指定海报图，【不能只靠 _config.butterfly.yml 的 category_img】。
# 原因：主题 layout/includes/header/index.pug 里的分支是 when 'category'（单数），
# 而 page.js 返回的是 'categories'（复数），两者对不上 -> 掉进 default 分支
# -> 只会读 page.top_img || default_top_img，配置的 category_img 被整个绕过。
top_img: /videos/banner-1-poster.jpg
comments: false
---
