# lloyyd.com

个人网站。Astro 5 + Tailwind CSS 4 + MDX,纯静态输出,Vercel 部署,push 到 `main` 自动上线。

## 构建的特殊之处

`npm run build` 不是单纯的 `astro build`,而是:

```
node scripts/sync-notion.mjs && astro build
```

**每次构建都会先打 Notion API 拉取博客内容。** 这意味着 Notion token 失效、限流或脚本报错都会导致整站构建失败。改动这个仓库里的任何东西,都要意识到它跟 Notion 的可用性绑在一起。

内容来源:Notion Blog 数据库里 Status=Published 的条目,同步进 `src/content/blog/`。
另有每小时一次的 GitHub Action 触发同步。

## 客户 landing 页不要放在这个仓库

给客户确认用的 landing 页有独立仓库和独立域名:

| | 仓库 | 域名 | 技术栈 |
|---|---|---|---|
| 个人站(本仓库) | `Lloyyd-weng/PersonalWebsite` | lloyyd.com | Astro 5 |
| 客户确认页 | `Lloyyd-weng/client-landings` | demo.lloyyd.com | Astro 7 |

本地路径:`~/Documents/Coding/client-landings`

**如果收到「加一个客户 landing 页 / 做个模板页给客户看」这类需求,去那个仓库做,不要在这里新建路径。** 四个理由:

1. **构建耦合** — 本仓库构建依赖 Notion API(见上)。客户页放这里,Notion 一挂就发不出去给客户看的链接;反过来客户页写错一行,博客也停止更新。
2. **交付剥离** — 客户确认后代码常要单独交付或转成正式项目,混在个人站的 git 历史里就剥不干净。
3. **样式冲突** — `src/styles/global.css` 的 `@theme` 是全局的(黑白灰 + 系统字体),客户各有品牌色和字体,会打架。
4. **SEO 污染** — 本仓库装了 `@astrojs/sitemap`,新路径会被自动收录进 `sitemap-index.xml`,客户未发布的产品页不该被搜到。

真要破例(比如做自己的作品集展示页而非客户确认页),必须同时处理:给 sitemap 加 `filter` 排除、页面加 `noindex` meta、用不引 `global.css` 的独立 layout。

## 结构备忘

- 导航在 `src/consts.ts` 的 `NAV` 数组
- 布局 `src/layouts/Base.astro`;首页不出页眉,子页面出一条最小返回导航
- 旧版站点(create-next-app + 登录页)归档在 git tag `v0-archive`

## 已知技术债

依赖里的 Astro 5 有一批已披露的 XSS 公告(`npm audit` 可见,最新版是 Astro 7)。本站纯静态、未使用 `define:vars`、spread props、server islands 等受影响特性,实际风险很低,但升级这件事一直挂着。升级时注意 Notion 同步脚本和 MDX/RSS/sitemap 集成的兼容性。
