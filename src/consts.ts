export const SITE = {
  name: "lloyyd",
  url: "https://lloyyd.com",
  // TODO(lloyyd): 首页大标题,一句话,替换成你想说的
  headline: "I'm Lloyyd. Nice to meet you.",
  // TODO(lloyyd): 大标题下方的小字状态行
  tagline: "Designer & maker — building Panda Basket.",
  description: "Personal site of Lloyyd — design, apps, and notes.", // TODO(lloyyd): 站点描述
};

// 导航是一个数组:未来上线网页艺术时,加一行即可,比如
// { label: "lab", href: "/lab" }
export const NAV = [
  { label: "work", href: "/work" },
  { label: "blog", href: "/blog" },
] as const;

export const LINKS = [
  { label: "github", href: "https://github.com/Lloyyd-weng" },
  { label: "dribbble", href: "#" }, // TODO(lloyyd): 填 Dribbble 主页链接
  { label: "linkedin", href: "#" }, // TODO(lloyyd): 填 LinkedIn 主页链接
  { label: "email", href: "mailto:lloyyd.weng@gmail.com" }, // 沿用旧站公开邮箱,可改
] as const;

export function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
