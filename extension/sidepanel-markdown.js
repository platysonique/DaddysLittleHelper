export function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderMarkdown(text) {
  const src = String(text || "");
  const blocks = [];
  let blockIndex = 0;
  const placeholders = new Map();

  const fenced = src.replace(/```([\w-]*)\n([\s\S]*?)```/g, (_m, lang, code) => {
    const key = `@@BLOCK${blockIndex++}@@`;
    placeholders.set(
      key,
      `<pre><code class="language-${escapeHtml(lang || "text")}">${escapeHtml(code.trimEnd())}</code></pre>`
    );
    return key;
  });

  let html = escapeHtml(fenced);
  html = html.replace(/^### (.+)$/gm, "<h3>$1</h3>");
  html = html.replace(/^## (.+)$/gm, "<h2>$1</h2>");
  html = html.replace(/^# (.+)$/gm, "<h1>$1</h1>");
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  html = html.replace(/^(?:- .+\n?)+/gm, (block) => {
    const items = block
      .trim()
      .split("\n")
      .map((line) => `<li>${line.replace(/^- /, "")}</li>`)
      .join("");
    return `<ul>${items}</ul>`;
  });
  html = html.replace(/\n\n/g, "</p><p>");
  html = `<p>${html}</p>`;
  html = html.replace(/<p><\/p>/g, "");

  for (const [key, value] of placeholders) {
    html = html.replace(key, value);
  }
  return html;
}
