/**
 * The snapshot layer contract render-html consumes. render-html DEFINES this interface
 * (it is the consumer) and accepts an OPTIONAL, possibly-empty map — a missing map or a
 * missing entry falls back to a param card. render-html must be release-quality with zero
 * snapshots (the cards-only shippable tier in CLAUDE.md).
 *
 * Providers (snap-web, snap-device, `--images <dir>`) produce a SnapshotMap and hand it in.
 * They import this type; render-html never imports a provider (swappable behind one type).
 */

/** Why a destination has (or lacks) a usable snapshot. Mirrors the provider contract. */
export type SnapshotStatus = "ok" | "crashed" | "skipped";

/**
 * One screen's snapshot, keyed in {@link SnapshotMap} by destination `id` (the file path,
 * the IR's stable identity — NOT routePath, which can collide).
 *
 * `dataUri` is deliberately an inlined `data:` URI rather than a filesystem path: the HTML
 * is standalone and makes zero network/filesystem requests, so the image bytes must live
 * in the document. Providers (or the CLI) inline the PNG before handing the map to
 * render-html. `path` is retained for diagnostics/tooling only and is never fetched.
 */
export interface SnapshotEntry {
  status: SnapshotStatus;
  /** Inlined image as a `data:image/...;base64,...` URI. Required when `status === 'ok'`. */
  dataUri?: string;
  /** Intrinsic pixel dimensions, used to size the card without layout shift. */
  width?: number;
  height?: number;
  /** Original on-disk path — informational only; render-html never reads it. */
  path?: string;
  /** For non-ok statuses: the WN401/WN402 explanation, shown on the fallback card. */
  diagnostic?: string;
}

/** destination id → snapshot. Absent/empty ⇒ every destination renders as a param card. */
export type SnapshotMap = Record<string, SnapshotEntry>;

/** Options for {@link renderHtml}. All optional; defaults keep output deterministic. */
export interface RenderOptions {
  /** Document `<title>` and header label. Defaults to a generic wirenav title. */
  title?: string;
}
