/** DLH page context — structured extraction for Cursor prompts (DLH-native, not markdown-clone). */

const EXCERPT_LIMIT = 24_000;
const SELECTION_LIMIT = 12_000;

function cleanText(value, limit) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

function articleRoot() {
  return (
    document.querySelector("article") ||
    document.querySelector("[role='main']") ||
    document.querySelector("main") ||
    document.body
  );
}

function headingOutline(root) {
  const headings = root.querySelectorAll("h1, h2, h3, h4, h5, h6");
  const outline = [];
  for (const el of headings) {
    if (outline.length >= 12) break;
    const text = cleanText(el.innerText, 160);
    if (!text) continue;
    outline.push({ level: el.tagName.toLowerCase(), text });
  }
  return outline;
}

function paragraphSample(root) {
  const blocks = [];
  for (const el of root.querySelectorAll("p, li, pre, blockquote")) {
    if (blocks.length >= 8) break;
    const text = cleanText(el.innerText, 320);
    if (text.length < 40) continue;
    blocks.push(text);
  }
  return blocks;
}

export function getPageContext(workspaceId = null) {
  const root = articleRoot();
  const excerptSource = cleanText(root?.innerText || "", EXCERPT_LIMIT);
  return {
    url: location.href,
    title: document.title,
    selection: cleanText(getSelection?.() || "", SELECTION_LIMIT),
    excerpt: excerptSource,
    outline: headingOutline(root),
    blocks: paragraphSample(root),
    workspaceId: workspaceId ?? null,
    capturedAt: new Date().toISOString()
  };
}
