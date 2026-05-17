/** DLH snapshot in a single frame. */
import { buildInteractiveTree, findInIndex, REF_ATTR, assertRefGeneration } from "../lib/dlh-tree.js";

export function buildSnapshot() {
  const tree = buildInteractiveTree(document, { doc: document, storage: sessionStorage });
  return {
    url: location.href,
    title: document.title,
    frameId: window === window.top ? 0 : null,
    ...tree
  };
}

export function findElements(query, limit = 12) {
  const tree = buildSnapshot();
  return {
    refGeneration: tree.refGeneration,
    matches: findInIndex(tree.index, query, { limit })
  };
}

export function elementForRef(ref, refGeneration) {
  assertRefGeneration(refGeneration, sessionStorage);
  if (!ref || !String(ref).startsWith("@")) {
    throw new Error(`Invalid DLH ref "${ref}". Use refs from dlh_browser_snapshot (e.g. @12).`);
  }
  const el = document.querySelector(`[${REF_ATTR}="${CSS.escape(ref)}"]`);
  if (!el) {
    throw new Error(`Ref ${ref} not found. Call dlh_browser_snapshot again after navigation or DOM changes.`);
  }
  return el;
}
