import { basename, dirname, extname, join } from "node:path";
import { Project, ts } from "ts-morph";
import {
  NAV_FORMAT_VERSION,
  type Destination,
  type DestinationFlags,
  type Diagnostic,
  type NavEdge,
  type NavGraphIR,
  type NavigatorNode,
} from "@wirenav/core";
import { detectExpoRouter } from "./detect.js";
import { DIAG } from "./diagnostics.js";
import { extractEdges } from "./edges.js";
import { detectKind } from "./layout.js";
import { selectProfile } from "./profiles/index.js";
import { paramsFor, routePathFor } from "./route.js";
import { relPosix, walkSources } from "./walk.js";

/**
 * Strictly-higher directory keys of `dir`, from immediate parent up to root `''`.
 * `'a/b'` → `['a', '']`; `'(x)'` → `['']`; `''` → `[]`.
 */
function ancestorDirs(dir: string): string[] {
  const out: string[] = [];
  let d = dir;
  while (d !== "") {
    const idx = d.lastIndexOf("/");
    d = idx === -1 ? "" : d.slice(0, idx);
    out.push(d);
  }
  return out;
}

/**
 * Statically extract an Expo Router app's navigation graph into the IR. Works from
 * source + package.json alone — no install, no dependency resolution.
 */
export function extract(rootDir: string): NavGraphIR {
  const detection = detectExpoRouter(rootDir);
  const { profile, known } = selectProfile(detection.raw ? detection.major : null);
  const diagnostics: Diagnostic[] = [];
  if (!known) {
    diagnostics.push({
      code: DIAG.WN104,
      message: `unrecognized ${profile.router} version; using ${profile.id} profile`,
      file: "package.json",
      line: 0,
      detail: `declared: ${detection.raw ?? "(none)"}`,
    });
  }

  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    skipLoadingLibFiles: true,
    compilerOptions: { allowJs: true, jsx: ts.JsxEmit.Preserve, noLib: true },
  });

  const appDir = join(rootDir, "app");
  const sourceFiles = walkSources(rootDir);

  // --- Build navigator nodes from _layout files ---------------------------------
  const navByDir = new Map<string, NavigatorNode>();
  const screens: { relApp: string; id: string; noExt: string; dir: string }[] = [];

  for (const abs of sourceFiles) {
    if (!abs.startsWith(appDir)) continue; // only files under app/ define routes/navigators
    const relApp = relPosix(appDir, abs);
    const ext = extname(relApp);
    const base = basename(relApp, ext);
    const rawDir = dirname(relApp);
    const dir = rawDir === "." ? "" : rawDir;
    const id = `app/${relApp}`;

    if (base === profile.specialFiles.layout) {
      const sf = project.addSourceFileAtPath(abs);
      const kind = detectKind(sf, profile.navigatorComponents);
      if (kind === null) {
        diagnostics.push({
          code: DIAG.WN203,
          message: "unrecognized navigator layout; kind set to unknown",
          file: id,
          line: 0,
        });
      }
      const name = dir === "" ? "app" : (dir.split("/").pop() ?? dir);
      navByDir.set(dir, {
        kind: kind ?? "unknown",
        name,
        file: id,
        children: [],
        destinations: [],
      });
      continue;
    }
    if (profile.specialFiles.skip.includes(base)) continue;
    if (base.endsWith(profile.specialFiles.apiSuffix)) continue;

    screens.push({ relApp, id, noExt: relApp.slice(0, -ext.length), dir });
  }

  // --- Nest navigators ----------------------------------------------------------
  const navigators: NavigatorNode[] = [];
  for (const [dir, nav] of navByDir) {
    const parentDir = dir === "" ? undefined : ancestorDirs(dir).find((a) => navByDir.has(a));
    if (parentDir === undefined) navigators.push(nav);
    else navByDir.get(parentDir)!.children.push(nav);
  }

  // --- Build destinations and attach to nearest enclosing navigator -------------
  const attachDir = (fileDir: string): string | undefined => {
    if (navByDir.has(fileDir)) return fileDir;
    return ancestorDirs(fileDir).find((a) => navByDir.has(a));
  };

  const destinations: Destination[] = [];
  for (const s of screens) {
    const flags: DestinationFlags = {};
    if (basename(s.noExt) === profile.specialFiles.notFound) flags.special = "not-found";
    const dest: Destination = {
      id: s.id,
      routePath: routePathFor(s.noExt),
      params: paramsFor(s.noExt),
      deepLinks: [],
      flags,
    };
    destinations.push(dest);
    const navDir = attachDir(s.dir);
    if (navDir !== undefined) navByDir.get(navDir)!.destinations.push(dest);
  }

  // --- Duplicate-route collision (WN201) ----------------------------------------
  const byRoute = new Map<string, Destination[]>();
  for (const d of destinations) {
    const list = byRoute.get(d.routePath);
    if (list) list.push(d);
    else byRoute.set(d.routePath, [d]);
  }
  for (const [routePath, list] of byRoute) {
    if (list.length <= 1) continue;
    for (const d of list) {
      diagnostics.push({
        code: DIAG.WN201,
        message: `duplicate route ${routePath}`,
        file: d.id,
        line: 0,
      });
    }
  }

  // --- Edges --------------------------------------------------------------------
  const destMap = new Map(destinations.map((d) => [d.id, d.routePath]));
  const allRoutes = destinations.map((d) => d.routePath);
  const edges: NavEdge[] = [];
  for (const abs of sourceFiles) {
    const fileRel = relPosix(rootDir, abs);
    const sf = project.getSourceFile(abs) ?? project.addSourceFileAtPath(abs);
    const fromRoute = destMap.get(fileRel);
    const isShared = fromRoute === undefined;
    const fromId = fromRoute ?? `@shared/${fileRel}`;
    const result = extractEdges(sf, fileRel, fromId, isShared, allRoutes);
    edges.push(...result.edges);
    diagnostics.push(...result.diagnostics);
  }

  return {
    formatVersion: NAV_FORMAT_VERSION,
    router: { name: profile.router, major: detection.major },
    navigators,
    edges,
    diagnostics,
  };
}
