import { elementForRef } from "./snapshot.js";

function centerOf(el) {
  const rect = el.getBoundingClientRect();
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2
  };
}

function dispatchPointer(el, type, init) {
  el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, composed: true, ...init }));
}

/** Prefer real control for labels; climb to nearest explicit interactive ancestor. */
export function resolveActionTarget(el) {
  const tag = el.tagName?.toLowerCase();
  if (tag === "label") {
    const id = el.getAttribute("for");
    if (id) {
      const control = document.getElementById(id);
      if (control) return control;
    }
  }

  return (
    el.closest(
      "button, a[href], input, select, textarea, summary, [role='button'], [role='link'], [role='menuitem'], [contenteditable='true']"
    ) || el
  );
}

export function measureRef(ref, refGeneration) {
  let el = elementForRef(ref, refGeneration);
  el = resolveActionTarget(el);
  el.scrollIntoView({ block: "center", inline: "nearest" });
  const rect = el.getBoundingClientRect();
  return {
    x: Math.round(rect.left + rect.width / 2),
    y: Math.round(rect.top + rect.height / 2)
  };
}

export function clickRef(ref, refGeneration, button = "left", clickCount = 1) {
  let el = elementForRef(ref, refGeneration);
  el = resolveActionTarget(el);

  if (el.disabled || el.getAttribute("aria-disabled") === "true") {
    throw new Error(`Ref ${ref} is disabled.`);
  }

  el.scrollIntoView({ block: "center", inline: "nearest" });
  const { x, y } = centerOf(el);
  const pointerInit = {
    pointerId: 1,
    pointerType: "mouse",
    isPrimary: true,
    clientX: x,
    clientY: y,
    button: button === "right" ? 2 : 0,
    buttons: button === "right" ? 2 : 1
  };

  for (let i = 0; i < clickCount; i += 1) {
    dispatchPointer(el, "pointerover", pointerInit);
    dispatchPointer(el, "pointerenter", pointerInit);
    dispatchPointer(el, "pointerdown", pointerInit);
    dispatchPointer(el, "pointerup", pointerInit);
    el.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        composed: true,
        clientX: x,
        clientY: y,
        button: pointerInit.button,
        detail: i + 1
      })
    );
    if (typeof el.click === "function") el.click();
  }

  const hit = document.elementFromPoint(x, y);
  const hitRef = hit?.closest?.(`[data-dlh-ref]`)?.getAttribute("data-dlh-ref") || null;

  return {
    ok: true,
    ref,
    tag: el.tagName,
    actionTarget: el.tagName,
    hitRef: hitRef !== ref ? hitRef : null
  };
}

export function typeRef(ref, refGeneration, text, submit = false) {
  const el = resolveActionTarget(elementForRef(ref, refGeneration));
  el.focus({ preventScroll: false });

  if ("value" in el) {
    el.value = text;
    el.dispatchEvent(new InputEvent("input", { bubbles: true, data: text, inputType: "insertText" }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  } else if (el.isContentEditable) {
    el.textContent = text;
    el.dispatchEvent(new InputEvent("input", { bubbles: true, data: text, inputType: "insertText" }));
  } else {
    throw new Error(`Ref ${ref} is not a text input.`);
  }

  if (submit) {
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
    el.form?.requestSubmit?.();
  }

  return { ok: true, ref, length: text.length };
}

export function fillRef(ref, refGeneration, text) {
  return typeRef(ref, refGeneration, text, false);
}

export function selectRef(ref, refGeneration, value) {
  const el = elementForRef(ref, refGeneration);
  if (el.tagName?.toLowerCase() !== "select") {
    throw new Error(`Ref ${ref} is not a <select> element.`);
  }
  const options = Array.from(el.options || []);
  const match =
    options.find((o) => o.value === value) ||
    options.find((o) => (o.label || o.text).trim() === value) ||
    options.find((o) => (o.label || o.text).toLowerCase().includes(String(value).toLowerCase()));
  if (!match) throw new Error(`Option "${value}" not found on select ${ref}.`);
  el.value = match.value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return { ok: true, ref, value: match.value, label: match.label || match.text };
}

export function scrollPage(direction = "down", amount = 900) {
  const target = document.scrollingElement || document.documentElement;
  const delta = direction === "up" ? -Math.abs(amount) : Math.abs(amount);
  target.scrollBy({ top: delta, behavior: "smooth" });
  return {
    ok: true,
    direction,
    scrollTop: target.scrollTop,
    scrollHeight: target.scrollHeight
  };
}

export function waitMs(ms) {
  return new Promise((resolve) => {
    setTimeout(() => resolve({ ok: true, waitedMs: ms }), ms);
  });
}
