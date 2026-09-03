export const SITE = {
  name: "lloyyd",
  url: "https://lloyyd.com",
  headline: "Lloyd is building his own app.",
  // TODO(lloyyd): 大标题下方的小字状态行
  tagline: "Designer & maker — building Panda Basket.",
  description: "Personal site of Lloyyd — design, apps, and notes.", // TODO(lloyyd): 站点描述
};

// 导航是一个数组:未来上线网页艺术时,加一行即可,比如
// { label: "lab", href: "/lab" }
export const NAV = [
  { label: "work", href: "/work" },
  { label: "blog", href: "/blog" },
  { label: "artifact", href: "/artifact" },
  { label: "slides", href: "/slides" },
] as const;

// Artifact —— 自成一页的交互式研究页面。每一篇是 src/pages/artifact/<slug>.astro,
// 自带 src/artifacts/<slug>/ 下的 body.html + css + js;加新的一篇只要建那两处再往
// 这个数组里补一行,列表页和导航自动跟上,不用改结构。
export interface Artifact {
  slug: string;
  title: string;
  blurb: string; // 列表页那句话
  description: string; // <meta name="description">
  meta: string; // 详情页标题下的那行小字
  pubDate: Date;
}

export const ARTIFACTS: Artifact[] = [
  {
    slug: "oklch",
    title: "OKLCH：让「调亮一点」真的只是调亮一点",
    blurb:
      "OKLCH 色彩模型的交互式学习手册。五个可以拖的演示:色相扫描对照、L/C/H 拆解器、色域天花板图、渐变插值对比、色阶生成器。",
    description:
      "OKLCH 色彩模型的交互式学习手册:从感知均匀性讲到 CSS 落地,含色相扫描对照、L/C/H 拆解器、色域天花板图与色阶生成器。",
    meta: "interactive · css color level 4 · 8 sections",
    pubDate: new Date("2026-08-21"),
  },
];

// Slides —— 演讲用的 deck。每份是 public/slides/<slug>/index.html 里一个自足的
// 单文件 HTML(1280×720 画布、键盘/点击翻页、@media print 出 PDF),不套站点布局、
// 不进 sitemap(public 目录本来就不被 @astrojs/sitemap 收录),可以直接把文件发给别人。
// 正本在本仓库;内容级改动(文案/知识点/页面增删)先回 ai/research 库定稿再同步过来。
export interface SlideDeck {
  slug: string;
  title: string;
  blurb: string; // 列表页那句话
  meta: string; // 列表页标题旁的小字
  pubDate: Date;
}

export const SLIDES: SlideDeck[] = [
  {
    slug: "oklch",
    title: "OKLCH — 最近気になってる色の話",
    blurb:
      "日语社内分享:HSL 的 L 为什么不可信、OKLCH 的三个旋钮、渐变泥区、from() 语法、主题换装。全程可以现场拖着讲。",
    meta: "ja · 24 slides · interactive",
    pubDate: new Date("2026-08-30"),
  },
];

export const LINKS = [
  { label: "x", href: "https://x.com/SSSLloyd3152" },
  { label: "instagram", href: "https://www.instagram.com/ssslloyd/" },
  // 客户确认页,仓库在 client-landings;根路径不列任何客户
  { label: "demo", href: "https://demo.lloyyd.com" },
] as const;

// 新文章在前;pubDate 只精确到天,同一天的用 Notion created_time(createdAt)区分
export function comparePosts(
  a: { data: { pubDate: Date; createdAt?: Date } },
  b: { data: { pubDate: Date; createdAt?: Date } },
): number {
  return (
    b.data.pubDate.valueOf() - a.data.pubDate.valueOf() ||
    (b.data.createdAt?.valueOf() ?? 0) - (a.data.createdAt?.valueOf() ?? 0)
  );
}

export function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
