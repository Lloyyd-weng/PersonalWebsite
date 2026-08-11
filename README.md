# lloyyd.com

个人网站。Astro 5 + Tailwind CSS 4 + MDX,纯静态输出,部署在 Vercel。

## 常用命令

```bash
npm run dev       # 本地开发 http://localhost:4321
npm run build     # 构建到 dist/
npm run preview   # 预览构建产物
```

## 写博客

往 `src/content/blog/` 丢一个 `.md` 或 `.mdx` 文件即可:

```markdown
---
title: "文章标题"
description: "可选的摘要"
pubDate: 2026-08-11
draft: false # true 则不发布
---

正文,中英文都行。
```

## 待替换的占位内容

全局搜索 `TODO(lloyyd)`:

- `src/consts.ts` — 一句话身份介绍、站点描述、Dribbble / LinkedIn 链接
- `src/pages/index.astro` — 首页简介段落
- `src/pages/work/panda-basket.astro` — Panda Basket 介绍、截图、App Store 链接
- `src/content/blog/rebuilding-lloyyd-com.md` — 示例文章,改写或删除

## 结构备忘

- 导航在 `src/consts.ts` 的 `NAV` 数组;以后上线网页艺术页面,加一行 `{ label: "lab", href: "/lab" }` 即可
- 旧版站点(create-next-app + 登录页)归档在 git tag `v0-archive`
