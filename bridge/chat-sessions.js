import { randomUUID } from "node:crypto";

/** @type {Map<string, { cancel: () => void }>} */
const sessions = new Map();

export function createChatSession(cancelFn) {
  const id = randomUUID();
  sessions.set(id, { cancel: cancelFn });
  return id;
}

export function cancelChatSession(id) {
  const session = sessions.get(id);
  if (!session) return false;
  try {
    session.cancel();
  } finally {
    sessions.delete(id);
  }
  return true;
}

export function endChatSession(id) {
  sessions.delete(id);
}

export function activeChatCount() {
  return sessions.size;
}
