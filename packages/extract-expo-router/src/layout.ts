import { SyntaxKind } from "ts-morph";
import type { SourceFile } from "ts-morph";
import type { NavigatorKind } from "@wirenav/core";

/**
 * Determine a navigator's kind from its `_layout` file by finding the first (outermost,
 * by source position) JSX element whose tag name is exactly a known navigator component
 * (`Stack`, `Tabs`, `Drawer`, `Slot`). Matching the exact tag name — not a property
 * access like `Stack.Screen` — ensures we pick the container, not a child config.
 *
 * Returns `null` when no known component is found, so the caller can record WN203 and
 * fall back to kind `unknown` rather than guessing.
 */
export function detectKind(
  sf: SourceFile,
  components: Readonly<Record<string, NavigatorKind>>,
): NavigatorKind | null {
  const els = [
    ...sf.getDescendantsOfKind(SyntaxKind.JsxOpeningElement),
    ...sf.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement),
  ].map((n) => ({ name: n.getTagNameNode().getText(), pos: n.getStart() }));
  els.sort((a, b) => a.pos - b.pos);
  for (const el of els) {
    const kind = components[el.name];
    if (kind) return kind;
  }
  return null;
}
