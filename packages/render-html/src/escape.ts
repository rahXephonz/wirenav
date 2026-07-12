/** HTML/JSON escaping helpers. Kept tiny and dependency-free (core stays lean downstream). */

/** Escape text/attribute content for HTML. Covers the five significant characters. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// U+2028/U+2029 are valid in JSON strings but are line terminators in ECMAScript, so a
// raw one in an inline <script> is a syntax error. Built via char code to keep this
// source pure-ASCII (no invisible bytes in the repo).
const LINE_SEP = new RegExp(String.fromCharCode(0x2028), "g");
const PARA_SEP = new RegExp(String.fromCharCode(0x2029), "g");

/**
 * Serialize a value for embedding inside an inline `<script>`. Beyond JSON.stringify we
 * neutralize `<` (so `</script>` and `<!--` can never break out of the script element)
 * and U+2028/U+2029 (see above).
 */
export function escapeJsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(LINE_SEP, "\\u2028")
    .replace(PARA_SEP, "\\u2029");
}
