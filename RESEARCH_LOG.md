### Cursor Thread Names And Rename Storage
**Date**: 2026-05-20 04:35
**Trigger**: DLH side panel showed only one renamed Cursor thread name for DaddysLittleHelper, while several Cursor threads existed and needed rename support from DLH.
**Source**: Perplexity `perplexity_search` query: `Cursor IDE agent chat thread rename local storage glass.localAgentProjects.v1 state.vscdb`
**Findings**:
- Cursor conversation history and project/thread indexes are stored in local SQLite databases, especially global `state.vscdb`.
- Public Cursor forum reports mention `glass.localAgentProjects.v1` as a workspace/thread association index that may need patching when paths move.
- Other reports note agent transcripts under `.cursor/projects/.../agent-transcripts`, while visible thread names can come from Cursor's local database index rather than the transcript file itself.
**Relevance**: DLH must merge Cursor's global project index, chat-store metadata, and agent transcript directories instead of relying on only one source.
**Status**: ACTIVE

**Codebase Findings** (2026-05-20 04:35):
- `bridge/cursor-threads.js` previously read `glass.localAgentProjects.v1`, current workspace chat stores, and current project transcript IDs only.
- The current DLH path is `/home/papaya/Projects/DaddysLittleHelper`, but older Cursor history also exists under `/home/papaya/.cursor/projects/home-papaya-Documents-DaddysLittleHelper/agent-transcripts`.
- Cursor workspaceStorage state DBs for both Documents and Projects DLH folders did not contain usable thread titles in this environment.
- `glass.localAgentProjects.v1` had one current renamed DLH entry (`DLH Worker`), while transcript-only IDs had no durable title source.
- Resolution approach: merge same-basename Cursor project transcript buckets, derive fallback titles from first meaningful user request, and write DLH renames back to `glass.localAgentProjects.v1` with a backup.

**Resolution** (2026-05-20 04:40):
- `bridge/cursor-threads.js` now merges current and same-basename Cursor transcript buckets, reads Cursor's global project index, derives fallback names from transcript user requests, and exposes `renameCursorThread()`.
- `bridge/server.js` now has `POST /cursor-threads/:id/rename`.
- `extension/sidepanel.html` and `extension/sidepanel.js` now expose a selected-thread rename field/button.
- Status: RESOLVED
