/** DLH interactive tree — enhanced element detection (v2). */

export const REF_ATTR = "data-dlh-ref";
export const GEN_KEY = "dlh-ref-generation";

const MAX_NODES = 500;
const MAX_DEPTH = 18;

const TAG_SCORE = {
  button: 90,
  a: 75,
  input: 85,
  textarea: 85,
  select: 80,
  summary: 70,
  label: 55
};

const INTERACTIVE_ROLES = new Set([
  "button",
  "link",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "tab",
  "checkbox",
  "radio",
  "switch",
  "combobox",
  "textbox",
  "searchbox",
  "slider",
  "spinbutton",
  "option",
  "treeitem",
  "gridcell"
]);

export function implicitRole(el) {
  const explicit = el.getAttribute?.("role");
  if (explicit) return explicit.toLowerCase();
  const tag = el.tagName?.toLowerCase();
  if (tag === "button") return "button";
  if (tag === "a" && el.getAttribute("href")) return "link";
  if (tag === "input") return el.type || "textbox";
  if (tag === "textarea") return "textbox";
  if (tag === "select") return "combobox";
  if (tag === "summary") return "button";
  if (el.isContentEditable) return "textbox";
  return tag || "generic";
}

export function labelOfElement(el, doc = document) {
  const pieces = [
    el.getAttribute("aria-label"),
    labelFromAriaLabelledBy(el, doc),
    el.getAttribute("title"),
    el.getAttribute("placeholder"),
    el.getAttribute("alt"),
    el.getAttribute("name"),
    el.getAttribute("value") && el.tagName === "INPUT" ? el.getAttribute("value") : null,
    labelFromForAttribute(el, doc),
    el.labels?.[0]?.innerText || el.labels?.[0]?.textContent,
    el.innerText || el.textContent
  ];
  for (const piece of pieces) {
    const text = String(piece || "").replace(/\s+/g, " ").trim();
    if (text) return text.slice(0, 140);
  }
  return "";
}

function labelFromAriaLabelledBy(el, doc) {
  const ids = (el.getAttribute("aria-labelledby") || "").split(/\s+/).filter(Boolean);
  if (!ids.length) return "";
  return ids
    .map((id) => {
      const node = doc.getElementById(id);
      return node?.innerText || node?.textContent || "";
    })
    .join(" ")
    .trim();
}

function labelFromForAttribute(el, doc) {
  if (el.tagName?.toLowerCase() !== "label") return "";
  const id = el.getAttribute("for");
  if (!id) return "";
  const control = doc.getElementById(id);
  if (!control) return "";
  return control.getAttribute("aria-label") || control.getAttribute("placeholder") || control.getAttribute("name") || "";
}

export function scoreElement(el, labelText = "") {
  const tag = el.tagName?.toLowerCase();
  const role = implicitRole(el);
  let score = TAG_SCORE[tag] || 0;

  if (INTERACTIVE_ROLES.has(role)) score += 55;
  if (el.getAttribute("role")) score += 25;
  if (el.tabIndex >= 0) score += 25;
  if (el.disabled || el.getAttribute("aria-disabled") === "true") score -= 40;
  if (el.getAttribute("href")) score += 15;
  if (labelText) score += 20;
  if (/^h[1-6]$/i.test(tag) && labelText) score += 35;
  if (el.isContentEditable) score += 70;
  if (el.getAttribute("onclick") || el.onclick) score += 35;
  try {
    if (el.style?.cursor === "pointer") score += 20;
  } catch {
    // ignore
  }
  if (tag === "input" && ["button", "submit", "reset", "checkbox", "radio"].includes(el.type)) score += 30;
  if (tag === "label" && el.getAttribute("for")) score += 25;

  return score;
}

export function isVisible(el, getComputedStyleFn = getComputedStyle) {
  if (!el?.getBoundingClientRect) return false;
  const style = getComputedStyleFn(el);
  if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) {
    return false;
  }
  if (style.pointerEvents === "none") return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 1 && rect.height > 1;
}

export function isAriaHidden(el) {
  if (el.getAttribute("aria-hidden") === "true") return true;
  let parent = el.parentElement;
  let depth = 0;
  while (parent && depth < 6) {
    if (parent.getAttribute("aria-hidden") === "true") return true;
    parent = parent.parentElement;
    depth += 1;
  }
  return false;
}

export function isInert(el) {
  if (el.inert || el.getAttribute("inert") !== null) return true;
  let parent = el.parentElement;
  let depth = 0;
  while (parent && depth < 8) {
    if (parent.inert || parent.getAttribute("inert") !== null) return true;
    parent = parent.parentElement;
    depth += 1;
  }
  return false;
}

/** Element center is not fully covered by an unrelated ancestor. */
export function isReachableAtCenter(el, doc = document) {
  const rect = el.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return false;
  const x = clamp(rect.left + rect.width / 2, rect.left + 1, rect.right - 1);
  const y = clamp(rect.top + rect.height / 2, rect.top + 1, rect.bottom - 1);
  const hit = doc.elementFromPoint(x, y);
  if (!hit) return false;
  return hit === el || el.contains(hit) || hit.contains(el);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function openShadowRoot(el) {
  if (el.shadowRoot) return el.shadowRoot;
  try {
    return chrome?.dom?.openOrClosedShadowRoot?.(el) || null;
  } catch {
    return null;
  }
}

export function nextRefGeneration(storage) {
  const current = Number(storage.getItem(GEN_KEY) || 0);
  const next = current + 1;
  storage.setItem(GEN_KEY, String(next));
  return next;
}

export function assertRefGeneration(expected, storage) {
  if (expected === undefined || expected === null) return;
  const live = Number(storage.getItem(GEN_KEY) || 0);
  if (Number(expected) !== live) {
    throw new Error(
      `Stale snapshot (expected refGeneration ${expected}, current ${live}). Call dlh_browser_snapshot again.`
    );
  }
}

function inputMeta(el) {
  const tag = el.tagName?.toLowerCase();
  if (tag !== "input") return "";
  const parts = [el.type || "text"];
  if (el.required) parts.push("required");
  if (el.readOnly) parts.push("readonly");
  return ` <input ${parts.join(" ")}>`;
}

function stateOf(el, doc) {
  const parts = [];
  if (el.disabled || el.getAttribute("aria-disabled") === "true") parts.push("disabled");
  if (el.checked) parts.push("checked");
  if (el === doc.activeElement) parts.push("focused");
  const expanded = el.getAttribute("aria-expanded");
  if (expanded === "true") parts.push("expanded");
  if (expanded === "false") parts.push("collapsed");
  if (el.getAttribute("aria-pressed") === "true") parts.push("pressed");
  if (!isReachableAtCenter(el, doc)) parts.push("obscured");
  return parts.length ? ` {${parts.join(", ")}}` : "";
}

function shortPath(el) {
  const bits = [];
  let node = el;
  while (node && node.nodeType === 1 && bits.length < 5) {
    const tag = node.tagName?.toLowerCase() || "node";
    const id = node.id ? `#${node.id}` : "";
    const testId = node.getAttribute?.("data-testid");
    const testBit = testId ? `[data-testid=${testId}]` : "";
    bits.unshift(`${tag}${id}${testBit}`);
    node = node.parentElement || node.getRootNode()?.host || null;
  }
  return bits.join(" > ");
}

export function buildInteractiveTree(root, { doc = document, getComputedStyleFn = getComputedStyle, storage = sessionStorage } = {}) {
  root.querySelectorAll(`[${REF_ATTR}]`).forEach((el) => el.removeAttribute(REF_ATTR));

  const refGeneration = nextRefGeneration(storage);
  const ELEMENT_NODE = doc.defaultView?.Node?.ELEMENT_NODE ?? 1;
  const lines = [];
  const index = [];
  let assigned = 0;
  const stack = [{ el: root.documentElement || root, depth: 0 }];

  function pushChildren(el, depth) {
    const kids = el.children ? Array.from(el.children) : [];
    for (let i = kids.length - 1; i >= 0; i -= 1) stack.push({ el: kids[i], depth: depth + 1 });
    const shadow = openShadowRoot(el);
    if (shadow) {
      const shadowKids = Array.from(shadow.children);
      for (let i = shadowKids.length - 1; i >= 0; i -= 1) stack.push({ el: shadowKids[i], depth: depth + 1 });
    }
  }

  while (stack.length && assigned < MAX_NODES) {
    const { el, depth } = stack.pop();
    if (!el || depth > MAX_DEPTH) continue;

    if (el.nodeType !== ELEMENT_NODE || isAriaHidden(el) || isInert(el)) {
      pushChildren(el, depth);
      continue;
    }

    if (!isVisible(el, getComputedStyleFn)) {
      pushChildren(el, depth);
      continue;
    }

    const name = labelOfElement(el, doc);
    const score = scoreElement(el, name);
    const tag = el.tagName?.toLowerCase();
    const role = implicitRole(el);
    const interesting = score >= 48 || (name && /^h[1-6]$/i.test(tag));

    if (interesting) {
      assigned += 1;
      const ref = `@${assigned}`;
      el.setAttribute(REF_ATTR, ref);
      const indent = "  ".repeat(Math.min(depth, 8));
      const meta = inputMeta(el);
      lines.push(`${indent}${ref} [${role}] ${name || "(no label)"}${stateOf(el, doc)}${meta}  <${shortPath(el)}>`);
      index.push({ ref, role, name: name || "", score, obscured: !isReachableAtCenter(el, doc) });

      if (tag === "select") {
        const opts = Array.from(el.options || [])
          .slice(0, 16)
          .map((o) => `${o.value}=${o.label || o.text}`)
          .join(", ");
        if (opts) lines.push(`${indent}  options: ${opts}`);
      }
    }

    pushChildren(el, depth);
  }

  return {
    format: "dlh-tree-v2",
    refPrefix: "@",
    refGeneration,
    refCount: assigned,
    snapshot: lines.join("\n"),
    index
  };
}

/** Search the indexed snapshot entries (case-insensitive substring). */
export function findInIndex(index, query, { limit = 12 } = {}) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return [];
  return index
    .filter((entry) => entry.name.toLowerCase().includes(q) || entry.role.includes(q) || entry.ref.includes(q))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
