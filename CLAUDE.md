# lloyyd.com

个人网站。Astro 5 + Tailwind CSS 4 + MDX,纯静态输出,Vercel 部署,push 到 `main` 自动上线。

## 构建的特殊之处

`npm run build` 不是单纯的 `astro build`,而是:

```
node scripts/sync-notion.mjs && astro build
```

**每次构建都会先打 Notion API 拉取博客内容,但同步是 best-effort 的,挂了不会拖垮构建。**
`scripts/sync-notion.mjs` 里 `main().catch()` 只在 `SYNC_STRICT=1` 时 `exit 1`,其余情况打一条
错误就 `exit 0`,`astro build` 照常跑;`NOTION_TOKEN` 没设置时更是直接跳过同步。所以 token 失效、
限流、Notion 宕机的后果是**博客内容停在上一次成功同步的状态**(仓库里已提交的 `src/content/blog/`
照常发布),不是整站发不出去。

`SYNC_STRICT=1` 只在每小时那个 GitHub Action 里设(`.github/workflows/sync-notion.yml`),
目的是让同步失败在 Action 里显式变红,而不是悄悄地什么都不更新 —— 但那个 job 失败同样不影响线上站点。
Vercel 构建不设这个变量。

内容来源:Notion Blog 数据库里 Status=Published 的条目,同步进 `src/content/blog/` 并由 Action
提交进仓库 —— 仓库里那份 markdown 才是构建真正读的东西,Notion 只是上游。

## 客户 landing 页不要放在这个仓库

给客户确认用的 landing 页有独立仓库和独立域名:

| | 仓库 | 域名 | 技术栈 |
|---|---|---|---|
| 个人站(本仓库) | `Lloyyd-weng/PersonalWebsite` | lloyyd.com | Astro 5 |
| 客户确认页 | `Lloyyd-weng/client-landings` | demo.lloyyd.com | Astro 7 |

本地路径:`~/Documents/Coding/client-landings`

**如果收到「加一个客户 landing 页 / 做个模板页给客户看」这类需求,去那个仓库做,不要在这里新建路径。** 四个理由:

1. **构建耦合** — 同一条流水线:客户页写错一行,整站构建失败,博客也停止更新;反过来客户页的每次部署都要陪着跑一遍 Notion 同步。
2. **交付剥离** — 客户确认后代码常要单独交付或转成正式项目,混在个人站的 git 历史里就剥不干净。
3. **样式冲突** — `src/styles/global.css` 的 `@theme` 是全局的(黑白灰 + 系统字体),客户各有品牌色和字体,会打架。
4. **SEO 污染** — 本仓库装了 `@astrojs/sitemap`,新路径会被自动收录进 `sitemap-index.xml`,客户未发布的产品页不该被搜到。

真要破例(比如做自己的作品集展示页而非客户确认页),必须同时处理:给 sitemap 加 `filter` 排除、页面加 `noindex` meta、用不引 `global.css` 的独立 layout。

## 结构备忘

- 导航在 `src/consts.ts` 的 `NAV` 数组
- 布局 `src/layouts/Base.astro`;首页不出页眉,子页面出一条最小返回导航
- 旧版站点(create-next-app + 登录页)归档在 git tag `v0-archive`

## artifact 栏目

`/artifact` 放交互式研究页面 —— 自带 JS 演示、一页讲一件事的那种。跟 blog 平行,但不走
Notion:内容是手写/生成的 HTML,直接进仓库,**不受 Notion 可用性影响**。

加第二篇不用改结构,三步:

1. `src/artifacts/<slug>/` 放 `body.html` + 样式 + 脚本
2. `src/pages/artifact/<slug>.astro` 套 `src/layouts/Artifact.astro`,正文用 `?raw` 导入后
   `set:html` 注入 —— 生成的 HTML 里常有 `{}`,走 Astro 模板会被当表达式吃掉
3. `src/consts.ts` 的 `ARTIFACTS` 数组补一条,列表页和排序自动跟上

每篇的样式表自带 token、选择器收在自己的作用域类里(见 `oklch.css` 的 `.oklch-doc`),
彼此不串味。**注意这跟「客户 landing 页」是两回事** —— 客户确认页仍然去 client-landings
仓库,理由见上一节;artifact 是自己的东西,放这里没问题。

## slides 栏目

`/slides` 放演讲用的 deck,与 artifact 平行但存放方式不同:**deck 是自足的单文件 HTML,
放 `public/slides/<slug>/index.html`,完全不走 Astro 管线**。这么做是为了保住 deck 的
三个关键属性:可以离线打开演讲、可以把单个文件直接发给别人、`@media print` 一键出 PDF。
副作用正好也是想要的 —— public 目录天然不被 `@astrojs/sitemap` 收录,deck 本体不进
sitemap(只有 `/slides/` 索引页进)。

加新 deck 两步:`public/slides/<slug>/index.html` 放文件,`src/consts.ts` 的 `SLIDES`
数组补一条,索引页和导航自动跟上。

**正本与回传规则**(与 `~/Documents/ai/research` 库的分工):deck 的正本在本仓库,
演讲、分发、修改都以这里为准;但**内容级改动(文案、知识点、页面增删)要先回
ai/research 库定稿再同步过来**,展示级强化(渲染、交互、构图)直接在这里做。
research 库的 `presentations/` 下有各 deck 的 v1 快照、交接注记和演讲台本。

改 deck 本体时注意:design system(tokens、标题三级、24px 间距、组件层)写在
deck 文件头部注释里,新增页面必须遵循;互动区要包 `.no-nav` 类,否则点击会触发翻页。

## 已知技术债

依赖里的 Astro 5 有一批已披露的 XSS 公告(`npm audit` 可见,最新版是 Astro 7)。本站纯静态、未使用 `define:vars`、spread props、server islands 等受影响特性,实际风险很低,但升级这件事一直挂着。升级时注意 Notion 同步脚本和 MDX/RSS/sitemap 集成的兼容性。

### 全站颜色改用 OKLCH —— 条件性待办,别无条件动手

2026-08-21 评估过一次,结论是**当时不做**,但条件一到就该做。挂在这里免得忘。

现状:全站颜色字面量只有 10 处 —— `src/styles/global.css` 里 8 个 token,
`src/layouts/Base.astro` 里 2 个 `theme-color` meta。那 8 个 token **R=G=B 全部成立,
chroma 恰好为 0**。所以现在换只是记法替换:`oklch(0.191 0 0)` 和 `#141414` 是同一个像素,
OKLCH 的三个卖点(跨色相等亮度、C/H 正交、色阶可公式生成)在纯中性灰上全部失效。

工具链没有障碍(Tailwind v4 自带调色板本身就是 oklch 写的),唯一实打实的代价是:
**全站没有 `@supports` 兜底的话,不支持 oklch 的浏览器拿到的是整站无样式**,
而不是像 `/artifact/oklch` 那样只退化一个页面。所以迁移必须连兜底一起做,
8 行变 22 行,换来零视觉收益 —— 这就是当时判断不划算的原因。

**触发条件**(任意一条成立就值得做):

1. 站点第一次要加彩色(链接强调色、品牌色之类)
2. 需要一套灰阶梯,而不是现在这 4 个手挑的灰
3. 想把深浅色映射写成「L 沿 0.5 翻转」一条规则,而不是维护两张手写表

**工作量**:只改 `global.css` 一个文件,8 个值加一段 `@supports not (color: oklch(0 0 0))`
兜底,约 25 行;`theme-color` meta 留 hex(那里没有兜底机制);跑一次 build 目视核对。
20–30 分钟。`src/artifacts/oklch/oklch.css` 里已经有一份写好的 `@supports` 兜底块可以照抄。
