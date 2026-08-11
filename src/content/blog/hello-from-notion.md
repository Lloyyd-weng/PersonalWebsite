---
title: "Hello from Notion"
description: "第一篇从 Notion 自动同步到 lloyyd.com 的测试文章。"
pubDate: 2026-08-11
createdAt: 2026-08-11T09:24:56.000Z
notionId: 3b96eb17-14b7-81f5-ad64-d94e3d4091d7
---

这是一篇从 Notion 同步过来的测试文章。如果你在 [lloyyd.com/blog](http://lloyyd.com/blog) 上看到了它，说明整条自动发布链路已经跑通。


## 写作流程


以后发布文章只需要：

1. 在这个 Blog 数据库里新建一页，写内容
2. 把 **Status** 改成 `Published`
3. 等几秒（webhook）或最多一小时（定时同步），文章自动上线

## 格式支持


支持常见的 Markdown 元素，比如**加粗**、_斜体_、`行内代码`，还有：

> 引用块也没问题。

```javascript
// 代码块同样可以
console.log("hello from notion");
```


测试完可以把这篇文章的 Status 改回 Draft，它就会自动从网站下线。
