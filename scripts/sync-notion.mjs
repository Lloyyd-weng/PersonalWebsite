#!/usr/bin/env node
// Sync published posts from the Notion "Blog" database into src/content/blog.
// Runs in three places:
//   - GitHub Action (hourly cron, SYNC_STRICT=1: failures fail the job)
//   - Vercel build (best-effort: on failure the build keeps committed content)
//   - locally via `npm run sync`
// Notion image URLs are signed and expire within ~1 hour, so every image is
// downloaded into public/notion/<pageId>/ and referenced by local path.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@notionhq/client";
import { NotionToMarkdown } from "notion-to-md";

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const DATABASE_ID = process.env.NOTION_DATABASE_ID || "aca877e056fb4571b39551015589adcc";
const STRICT = process.env.SYNC_STRICT === "1";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONTENT_DIR = path.join(ROOT, "src", "content", "blog");
const IMAGE_ROOT = path.join(ROOT, "public", "notion");

if (!NOTION_TOKEN) {
  console.warn("[sync-notion] NOTION_TOKEN not set, skipping sync.");
  process.exit(0);
}

const notion = new Client({ auth: NOTION_TOKEN });
const n2m = new NotionToMarkdown({ notionClient: notion });

// Mutated per page so the image transformer knows where to save files.
const current = { pageId: "" };

n2m.setCustomTransformer("image", async (block) => {
  const image = block.image;
  const url = image?.type === "external" ? image.external?.url : image?.file?.url;
  if (!url) return "";
  const caption = (image.caption ?? []).map((r) => r.plain_text).join("");
  try {
    const localPath = await downloadImage(url, current.pageId, block.id);
    return `![${caption}](${localPath})`;
  } catch (err) {
    console.warn(`[sync-notion] image download failed (${url}): ${err.message}`);
    return `![${caption}](${url})`;
  }
});

async function downloadImage(url, pageId, blockId) {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const ext = extFor(res.headers.get("content-type"), url);
  const dir = path.join(IMAGE_ROOT, pageId);
  await fs.mkdir(dir, { recursive: true });
  const file = `${blockId}${ext}`;
  await fs.writeFile(path.join(dir, file), buf);
  return `/notion/${pageId}/${file}`;
}

function extFor(contentType, url) {
  const byType = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "image/svg+xml": ".svg",
    "image/avif": ".avif",
  }[contentType?.split(";")[0].trim()];
  if (byType) return byType;
  const fromUrl = path.extname(new URL(url).pathname);
  return fromUrl || ".png";
}

const plain = (richText) => (richText ?? []).map((r) => r.plain_text).join("").trim();

function slugify(title, pageId) {
  const slug = title
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return slug || pageId.replaceAll("-", "").slice(0, 8);
}

async function fetchPublishedPages() {
  const pages = [];
  let cursor;
  do {
    const res = await notion.databases.query({
      database_id: DATABASE_ID,
      filter: { property: "Status", select: { equals: "Published" } },
      start_cursor: cursor,
    });
    pages.push(...res.results);
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  return pages;
}

async function pageToFile(page, usedSlugs) {
  const props = page.properties;
  const title = plain(props.Title?.title) || "Untitled";
  let slug = plain(props.Slug?.rich_text) || slugify(title, page.id);
  if (usedSlugs.has(slug)) slug = `${slug}-${page.id.replaceAll("-", "").slice(0, 8)}`;
  usedSlugs.add(slug);

  const description = plain(props.Description?.rich_text);
  const pubDate = props.PubDate?.date?.start || page.created_time.slice(0, 10);

  current.pageId = page.id;
  const blocks = await n2m.pageToMarkdown(page.id);
  const md = n2m.toMarkdownString(blocks);
  const body = (typeof md === "string" ? md : md.parent ?? "").trim();

  const frontmatter = [
    "---",
    `title: ${JSON.stringify(title)}`,
    ...(description ? [`description: ${JSON.stringify(description)}`] : []),
    `pubDate: ${pubDate}`,
    `notionId: ${page.id}`,
    "---",
  ].join("\n");

  return { fileName: `${slug}.md`, content: `${frontmatter}\n\n${body}\n`, pageId: page.id };
}

async function main() {
  const pages = await fetchPublishedPages();
  console.log(`[sync-notion] ${pages.length} published page(s) in Notion.`);

  const usedSlugs = new Set();
  const files = [];
  for (const page of pages) files.push(await pageToFile(page, usedSlugs));

  await fs.mkdir(CONTENT_DIR, { recursive: true });
  const keepFiles = new Set();
  for (const f of files) {
    const target = path.join(CONTENT_DIR, f.fileName);
    const existing = await fs.readFile(target, "utf8").catch(() => null);
    if (existing !== null && !existing.includes("notionId:")) {
      console.warn(`[sync-notion] skip ${f.fileName}: a hand-written post already uses this slug.`);
      continue;
    }
    keepFiles.add(f.fileName);
    if (existing !== f.content) {
      await fs.writeFile(target, f.content);
      console.log(`[sync-notion] wrote ${f.fileName}`);
    }
  }

  // Remove posts that came from Notion but are no longer published.
  for (const entry of await fs.readdir(CONTENT_DIR)) {
    if (!/\.mdx?$/.test(entry) || keepFiles.has(entry)) continue;
    const content = await fs.readFile(path.join(CONTENT_DIR, entry), "utf8");
    if (content.includes("notionId:")) {
      await fs.rm(path.join(CONTENT_DIR, entry));
      console.log(`[sync-notion] removed ${entry} (unpublished in Notion)`);
    }
  }

  // Remove image folders of pages that are gone.
  const keepPageIds = new Set(files.map((f) => f.pageId));
  const imageDirs = await fs.readdir(IMAGE_ROOT).catch(() => []);
  for (const dir of imageDirs) {
    if (!keepPageIds.has(dir)) await fs.rm(path.join(IMAGE_ROOT, dir), { recursive: true });
  }

  console.log("[sync-notion] done.");
}

main().catch((err) => {
  console.error(`[sync-notion] sync failed: ${err.message}`);
  process.exit(STRICT ? 1 : 0);
});
