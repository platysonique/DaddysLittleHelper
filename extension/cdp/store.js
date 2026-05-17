const MAP_PREFIX = "dlhCdpRefMap:";
const GEN_PREFIX = "dlhCdpGen:";
const MODE_PREFIX = "dlhSnapMode:";

const MIN_FAST_REFS = 4;

export async function saveRefState(tabId, refGeneration, refMap) {
  await chrome.storage.session.set({
    [`${MAP_PREFIX}${tabId}`]: refMap,
    [`${GEN_PREFIX}${tabId}`]: refGeneration
  });
}

export async function loadRefState(tabId) {
  const data = await chrome.storage.session.get([`${MAP_PREFIX}${tabId}`, `${GEN_PREFIX}${tabId}`]);
  return {
    refMap: data[`${MAP_PREFIX}${tabId}`] || {},
    refGeneration: data[`${GEN_PREFIX}${tabId}`] ?? null
  };
}

export async function clearRefState(tabId) {
  await chrome.storage.session.remove([`${MAP_PREFIX}${tabId}`, `${GEN_PREFIX}${tabId}`]);
}

export async function setSnapshotMode(tabId, mode) {
  await chrome.storage.session.set({ [`${MODE_PREFIX}${tabId}`]: mode });
}

export async function getSnapshotMode(tabId) {
  const data = await chrome.storage.session.get(`${MODE_PREFIX}${tabId}`);
  return data[`${MODE_PREFIX}${tabId}`] || "fast";
}

export function shouldEscalateSnapshot(fastResult, { totalFrames, allFrames }) {
  const refCount = fastResult?.refCount ?? 0;
  if (refCount < MIN_FAST_REFS) return "thin_tree";
  if (allFrames && (fastResult?.frameCount ?? 1) < totalFrames) return "inaccessible_frames";
  return null;
}

export async function assertDeepRefGeneration(tabId, expected) {
  if (expected === undefined || expected === null) return;
  const { refGeneration } = await loadRefState(tabId);
  if (Number(expected) !== Number(refGeneration)) {
    throw new Error(
      `Stale snapshot (expected refGeneration ${expected}, current ${refGeneration}). Call dlh_browser_snapshot again.`
    );
  }
}
