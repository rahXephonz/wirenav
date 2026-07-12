/**
 * @wirenav/render-html — IR (+ optional SnapshotMap) → standalone interactive HTML.
 *
 * Consumes `@wirenav/core` ONLY. Never imports an extractor or a snapshot provider
 * (the N + M architecture rule in CLAUDE.md — providers depend on this package's
 * SnapshotMap type, not the other way around). Release-quality with an empty map.
 */
export { renderHtml } from "./render.js";
export type { SnapshotMap, SnapshotEntry, SnapshotStatus, RenderOptions } from "./types.js";
