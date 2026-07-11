import { Node, SyntaxKind } from "ts-morph";
import type { SourceFile, TemplateExpression } from "ts-morph";
import type { Diagnostic, NavEdge } from "@wirenav/core";
import { DIAG } from "./diagnostics.js";
import { stripGroups } from "./route.js";

const ROUTER_METHODS = new Set(["push", "replace", "navigate", "dismissTo"]);
const EXPO_ROUTER = "expo-router";

export interface EdgeResult {
  edges: NavEdge[];
  diagnostics: Diagnostic[];
}

/** Local binding names imported from `expo-router` that identify the navigation API. */
interface ExpoBindings {
  /** Local names bound to the `Link` component. */
  link: Set<string>;
  /** Local names bound to a `router`-like object (direct import + `useRouter()` vars). */
  router: Set<string>;
}

/**
 * Resolve which local identifiers actually come from `expo-router`. Import verification
 * is mandatory: a locally-defined `Link` component or a `router` variable from another
 * module must NOT produce edges (a wrong edge is worse than a missing one).
 */
function collectExpoBindings(sf: SourceFile): ExpoBindings {
  const link = new Set<string>();
  const router = new Set<string>();
  const useRouter = new Set<string>();

  for (const imp of sf.getImportDeclarations()) {
    if (imp.getModuleSpecifierValue() !== EXPO_ROUTER) continue;
    for (const named of imp.getNamedImports()) {
      const imported = named.getName();
      const local = named.getAliasNode()?.getText() ?? imported;
      if (imported === "Link") link.add(local);
      else if (imported === "router") router.add(local);
      else if (imported === "useRouter") useRouter.add(local);
    }
  }

  // `const nav = useRouter()` → `nav` is a router object. Destructured/renamed forms
  // (`const { push } = useRouter()`) are not handled (documented limitation).
  if (useRouter.size > 0) {
    for (const decl of sf.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
      const init = decl.getInitializer();
      if (!init || !Node.isCallExpression(init)) continue;
      const callee = init.getExpression();
      if (!Node.isIdentifier(callee) || !useRouter.has(callee.getText())) continue;
      const nameNode = decl.getNameNode();
      if (Node.isIdentifier(nameNode)) router.add(nameNode.getText());
    }
  }

  return { link, router };
}

/**
 * Extract navigation edges from one source file.
 *
 * @param fromId   The `from` node: a route `routePath` for files under `app/`, or a
 *                 synthetic `@shared/<file>` node for call sites in shared components.
 * @param isShared When true, every edge is `inferred` — the origin is not a real screen.
 * @param allRoutes All known destination routePaths, for template-literal resolution.
 */
export function extractEdges(
  sf: SourceFile,
  fileRel: string,
  fromId: string,
  isShared: boolean,
  allRoutes: readonly string[],
): EdgeResult {
  const edges: NavEdge[] = [];
  const diagnostics: Diagnostic[] = [];
  const bindings = collectExpoBindings(sf);

  // No expo-router navigation API imported ⇒ nothing here is an edge.
  if (bindings.link.size === 0 && bindings.router.size === 0) {
    return { edges, diagnostics };
  }

  const emit = (to: string, confidence: "literal" | "template", line: number): void => {
    const kind: NavEdge["kind"] = isShared || confidence === "template" ? "inferred" : "declared";
    edges.push({ from: fromId, to, kind, source: { file: fileRel, line } });
  };
  const unresolved = (node: Node, line: number): void => {
    // Message is STABLE (generic); the offending source text goes in `detail` only.
    diagnostics.push({
      code: DIAG.WN202,
      message: "unresolvable navigation target",
      file: fileRel,
      line,
      detail: node.getText(),
    });
  };

  const handleTarget = (node: Node | undefined, line: number): void => {
    if (!node) return;
    if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) {
      emit(stripGroups(node.getLiteralText()), "literal", line);
      return;
    }
    if (Node.isObjectLiteralExpression(node)) {
      const pathname = node.getProperty("pathname");
      if (pathname && Node.isPropertyAssignment(pathname)) {
        const init = pathname.getInitializer();
        if (init && (Node.isStringLiteral(init) || Node.isNoSubstitutionTemplateLiteral(init))) {
          emit(stripGroups(init.getLiteralText()), "literal", line);
          return;
        }
      }
      unresolved(node, line);
      return;
    }
    if (Node.isTemplateExpression(node)) {
      const to = resolveTemplate(node, allRoutes);
      if (to) emit(to, "template", line);
      else unresolved(node, line);
      return;
    }
    unresolved(node, line);
  };

  // 1) <Link href=...> — only for a Link imported from expo-router.
  if (bindings.link.size > 0) {
    const linkEls = [
      ...sf.getDescendantsOfKind(SyntaxKind.JsxOpeningElement),
      ...sf.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement),
    ].filter((n) => bindings.link.has(n.getTagNameNode().getText()));
    for (const el of linkEls) {
      const attr = el.getAttribute("href");
      if (!attr || !Node.isJsxAttribute(attr)) continue;
      handleTarget(unwrapInitializer(attr.getInitializer()), el.getStartLineNumber());
    }
  }

  // 2) router.push/replace/navigate/dismissTo(arg) — only for a verified router object.
  if (bindings.router.size > 0) {
    for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const callee = call.getExpression();
      if (!Node.isPropertyAccessExpression(callee)) continue;
      if (!ROUTER_METHODS.has(callee.getName())) continue;
      if (!bindings.router.has(callee.getExpression().getText())) continue;
      handleTarget(call.getArguments()[0], call.getStartLineNumber());
    }
  }

  return { edges, diagnostics };
}

function unwrapInitializer(init: Node | undefined): Node | undefined {
  if (!init) return undefined;
  if (Node.isJsxExpression(init)) return init.getExpression();
  return init;
}

/**
 * Resolve a template-literal target of the shape `` `/static/prefix/${expr}` `` to a
 * single dynamic route. Returns the routePath when the static prefix (ending in `/`)
 * plus exactly one trailing dynamic segment matches exactly one known route; otherwise
 * null (⇒ WN202). Anything more complex than one trailing interpolation is unresolvable.
 */
function resolveTemplate(te: TemplateExpression, allRoutes: readonly string[]): string | null {
  const spans = te.getTemplateSpans();
  if (spans.length !== 1) return null;
  const tail = spans[0]!.getLiteral().getLiteralText();
  if (tail !== "") return null;
  const head = te.getHead().getLiteralText();
  if (!head.endsWith("/")) return null;
  const re = new RegExp("^" + escapeRegExp(head) + "\\[[^/]+\\]$");
  const matches = allRoutes.filter((r) => re.test(r));
  return matches.length === 1 ? matches[0]! : null;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
