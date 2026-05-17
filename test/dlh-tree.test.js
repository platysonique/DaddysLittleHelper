import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
  buildInteractiveTree,
  findInIndex,
  labelOfElement,
  scoreElement,
  assertRefGeneration,
  implicitRole,
  GEN_KEY
} from "../extension/lib/dlh-tree.js";
import { memoryStorage, setupDom } from "./helpers.js";

const visibleStyle = () => ({ display: "block", visibility: "visible", opacity: "1", pointerEvents: "auto" });

test("scoreElement prefers buttons and ARIA roles", () => {
  const dom = new JSDOM(`<button>Go</button><div role="button">Save</div>`);
  const btn = dom.window.document.querySelector("button");
  const roleBtn = dom.window.document.querySelector("[role=button]");
  assert.ok(scoreElement(btn, "Go") > scoreElement(roleBtn, "Save"));
  assert.equal(implicitRole(roleBtn), "button");
});

test("buildInteractiveTree v2 assigns refs and index", () => {
  const dom = setupDom(`
    <main>
      <h1>Title</h1>
      <button id="go">Go</button>
      <a href="/x">Checkout</a>
      <label for="email">Email</label>
      <input id="email" type="email" placeholder="you@example.com" />
    </main>
  `);
  const doc = dom.window.document;
  const storage = memoryStorage();
  const tree = buildInteractiveTree(doc, { doc, storage, getComputedStyleFn: visibleStyle });
  assert.equal(tree.format, "dlh-tree-v2");
  assert.ok(tree.refGeneration >= 1);
  assert.ok(tree.index.length >= 3);
  assert.match(tree.snapshot, /@1/);
  assert.match(tree.snapshot, /\[button\]/);
  assertRefGeneration(tree.refGeneration, storage);
});

test("findInIndex returns label matches", () => {
  const dom = setupDom(`<button>Checkout</button><button>Cancel</button>`);
  const doc = dom.window.document;
  const tree = buildInteractiveTree(doc, { doc, storage: memoryStorage(), getComputedStyleFn: visibleStyle });
  const matches = findInIndex(tree.index, "checkout");
  assert.ok(matches.length >= 1, `expected matches, index=${JSON.stringify(tree.index)}`);
  assert.match(matches[0].name, /checkout/i);
});

test("labelOfElement uses aria-label", () => {
  const dom = new JSDOM(`<input aria-label="Email" />`);
  const input = dom.window.document.querySelector("input");
  assert.equal(labelOfElement(input, dom.window.document), "Email");
});

test("assertRefGeneration rejects stale generation", () => {
  const storage = memoryStorage();
  storage.setItem(GEN_KEY, "3");
  assert.throws(() => assertRefGeneration(1, storage), /Stale snapshot/);
});
