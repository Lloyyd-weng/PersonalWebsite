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
] as const;

export const LINKS = [
  { label: "x", href: "https://x.com/SSSLloyd3152" },
  { label: "instagram", href: "https://www.instagram.com/ssslloyd/" },
] as const;

export function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
