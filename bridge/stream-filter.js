/** Keep system prompts and CLI noise out of the side-panel chat stream. */

const LEAK_MARKERS = [
  /^You are DaddysLittleHelper,/im,
  /^Hard constraints:/im,
  /^Selected project:/im,
  /^Browser target:/im,
  /^Page context:/im,
  /^User request:/im,
  /AGENT_PROJECT_RESUME/
];

export function isLeakedPromptText(text) {
  if (!text || typeof text !== "string") return false;
  const trimmed = text.trim();
  if (trimmed.length < 60 && !/AGENT_PROJECT_RESUME/.test(trimmed)) return false;
  return LEAK_MARKERS.some((re) => re.test(trimmed));
}

/** Strip leaks for UI/history; keep only the user's words when possible. */
export function sanitizeChatDisplayText(text) {
  if (!text) return "";
  let trimmed = String(text).trim();
  if (!trimmed) return "";
  if (/^AGENT_PROJECT_RESUME\s*$/i.test(trimmed)) return "";

  if (isLeakedPromptText(trimmed)) {
    const match = trimmed.match(/User request:\s*([\s\S]+)$/i);
    return match ? match[1].trim() : "";
  }

  return trimmed
    .replace(/<\/?user_query>/gi, "")
    .replace(/<\/?assistant_query>/gi, "")
    .trim();
}

export function filterStreamEvent(event) {
  if (!event || typeof event !== "object") return event;

  if (event.type === "stdout" || event.type === "stderr") {
    return null;
  }

  if (event.type === "user" || event.role === "user") {
    return null;
  }

  const text = eventTextFromStreamEvent(event);
  if (text && isLeakedPromptText(text)) {
    return null;
  }

  return event;
}

export function eventTextFromStreamEvent(event) {
  const update = event?.params?.update;
  if (update?.sessionUpdate === "agent_message_chunk" && update.content?.text) {
    return update.content.text;
  }
  if (event?.type === "assistant") {
    return event.message?.content?.map((block) => block.text || "").join("") || "";
  }
  if (event?.type === "thinking" && typeof event.text === "string") {
    return event.text;
  }
  if (event?.type === "stdout" || event?.type === "stderr") {
    return event.text || "";
  }
  return "";
}

export function isFullAssistantSnapshot(event) {
  return Boolean(event?.type === "assistant" && event?.message?.content?.length);
}
