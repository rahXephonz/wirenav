/**
 * `.nav` text → IR. Inverse of {@link serialize} for any file `serialize` produced:
 * `serialize(parse(serialize(ir))) === serialize(ir)` (round-trip invariant, tested).
 *
 * The parser is line-oriented and tolerant of the single-space grammar the serializer
 * emits. It assumes route paths and file paths contain no spaces (true for
 * repo-relative POSIX paths and URL-shaped routes); param/diagnostic messages may
 * contain spaces and are handled specifically.
 */
import {
  NAV_FORMAT_VERSION,
  SUPPORTED_FORMAT_VERSIONS,
  type Destination,
  type Diagnostic,
  type NavEdge,
  type NavGraphIR,
  type NavigatorKind,
  type NavigatorNode,
  type Param,
  type RouterInfo,
} from "./ir.js";

/** Thrown when the input is not parseable `.nav` text (or an unsupported version). */
export class NavParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NavParseError";
  }
}

const NAVIGATOR_KINDS: readonly NavigatorKind[] = ["stack", "tabs", "drawer", "slot", "unknown"];

type Section = "tree" | "declared" | "inferred" | "diagnostics";

function parseRouter(value: string): RouterInfo {
  const at = value.lastIndexOf("@");
  if (at <= 0) throw new NavParseError(`malformed router header: ${JSON.stringify(value)}`);
  const name = value.slice(0, at);
  const major = Number(value.slice(at + 1));
  if (!Number.isInteger(major)) {
    throw new NavParseError(`router major is not an integer: ${JSON.stringify(value)}`);
  }
  return { name, major };
}

function parseNavigatorLine(content: string): NavigatorNode {
  const m = /^navigator (.+?) \[([a-z]+)\](?: file=(\S+))?$/.exec(content);
  if (!m) throw new NavParseError(`malformed navigator line: ${JSON.stringify(content)}`);
  const [, name, kindRaw, file] = m;
  const kind = (NAVIGATOR_KINDS as readonly string[]).includes(kindRaw!)
    ? (kindRaw as NavigatorKind)
    : "unknown";
  return { kind, name: name!, file, children: [], destinations: [] };
}

function parseDestinationLine(content: string): Destination {
  const m = /^destination (\S+) file=(\S+)(.*)$/.exec(content);
  if (!m) throw new NavParseError(`malformed destination line: ${JSON.stringify(content)}`);
  const [, routePath, id, rest] = m;
  const flags: Destination["flags"] = {};
  if (/(?:^|\s)\[conditional\](?:\s|$)/.test(rest!)) flags.conditional = true;
  const special = /(?:^|\s)\[special:([a-z-]+)\](?:\s|$)/.exec(rest!);
  if (special) flags.special = special[1] as Destination["flags"]["special"];
  return { id: id!, routePath: routePath!, params: [], deepLinks: [], flags };
}

function parseParamLine(content: string): Param {
  const m = /^param (\w+)(\?)?: (.+)$/.exec(content);
  if (!m) throw new NavParseError(`malformed param line: ${JSON.stringify(content)}`);
  const [, name, optional, type] = m;
  return { name: name!, optional: optional === "?", type: type! };
}

function parseEdgeLine(content: string, kind: NavEdge["kind"]): NavEdge {
  // The text format carries no line number; `line` is 0 on a parsed baseline. Fresh
  // extraction supplies real lines, but the differ keys on (from, to, file) so the
  // absent baseline line never affects drift.
  const m = /^(\S+) -> (\S+) (\S+)$/.exec(content);
  if (!m) throw new NavParseError(`malformed edge line: ${JSON.stringify(content)}`);
  const [, from, to, file] = m;
  return { from: from!, to: to!, kind, source: { file: file!, line: 0 } };
}

function parseDiagnosticLine(content: string): Diagnostic {
  // code = first token; file = trailing token; message = everything between. No line
  // in the text format, so `line` is 0 on a parsed baseline (see parseEdgeLine).
  const m = /^(\S+) (.+) (\S+)$/.exec(content);
  if (!m) throw new NavParseError(`malformed diagnostic line: ${JSON.stringify(content)}`);
  const [, code, message, file] = m;
  return { code: code!, message: message!, file: file!, line: 0 };
}

function indentDepth(line: string): number {
  const m = /^( *)/.exec(line);
  return (m ? m[1]!.length : 0) >> 1;
}

/** Parse `.nav` text into an IR. Throws {@link NavParseError} on malformed input. */
export function parse(text: string): NavGraphIR {
  let formatVersion = NAV_FORMAT_VERSION;
  let router: RouterInfo = { name: "unknown", major: 0 };
  const navigators: NavigatorNode[] = [];
  const edges: NavEdge[] = [];
  const diagnostics: Diagnostic[] = [];

  // Stack of open navigators keyed by their indent depth, for reconstructing nesting.
  const navStack: { depth: number; node: NavigatorNode }[] = [];
  let currentDest: Destination | null = null;
  let section: Section = "tree";

  for (const rawLine of text.split("\n")) {
    if (rawLine.trim() === "") continue;
    const depth = indentDepth(rawLine);
    const content = rawLine.trim();

    if (content.startsWith("wirenav-format:")) {
      const v = Number(content.slice("wirenav-format:".length).trim());
      if (!SUPPORTED_FORMAT_VERSIONS.includes(v)) {
        throw new NavParseError(
          `unsupported wirenav-format ${v}; run \`wirenav dump\` to migrate your baseline`,
        );
      }
      formatVersion = v;
      continue;
    }
    if (content.startsWith("router:")) {
      router = parseRouter(content.slice("router:".length).trim());
      continue;
    }
    if (content === "edges declared") {
      section = "declared";
      continue;
    }
    if (content === "edges inferred") {
      section = "inferred";
      continue;
    }
    if (content === "diagnostics") {
      section = "diagnostics";
      continue;
    }

    if (section === "declared" || section === "inferred") {
      edges.push(parseEdgeLine(content, section));
      continue;
    }
    if (section === "diagnostics") {
      diagnostics.push(parseDiagnosticLine(content));
      continue;
    }

    // section === 'tree'
    if (content.startsWith("navigator ")) {
      const node = parseNavigatorLine(content);
      while (navStack.length > 0 && navStack[navStack.length - 1]!.depth >= depth) navStack.pop();
      const parent = navStack[navStack.length - 1];
      if (parent) parent.node.children.push(node);
      else navigators.push(node);
      navStack.push({ depth, node });
      currentDest = null;
      continue;
    }
    if (content.startsWith("destination ")) {
      const dest = parseDestinationLine(content);
      while (navStack.length > 0 && navStack[navStack.length - 1]!.depth >= depth) navStack.pop();
      const parent = navStack[navStack.length - 1];
      if (!parent) throw new NavParseError(`destination outside any navigator: ${content}`);
      parent.node.destinations.push(dest);
      currentDest = dest;
      continue;
    }
    if (content.startsWith("param ")) {
      if (!currentDest) throw new NavParseError(`param outside any destination: ${content}`);
      currentDest.params.push(parseParamLine(content));
      continue;
    }
    if (content.startsWith("deeplink ")) {
      if (!currentDest) throw new NavParseError(`deeplink outside any destination: ${content}`);
      currentDest.deepLinks.push(content.slice("deeplink ".length));
      continue;
    }
    throw new NavParseError(`unrecognized line: ${JSON.stringify(content)}`);
  }

  return { formatVersion, router, navigators, edges, diagnostics };
}
