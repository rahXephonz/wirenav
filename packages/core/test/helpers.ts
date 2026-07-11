import type { Destination, NavEdge, NavGraphIR, NavigatorNode, Param } from "../src/ir.js";
import { NAV_FORMAT_VERSION } from "../src/ir.js";

export function dest(
  partial: Partial<Destination> & Pick<Destination, "id" | "routePath">,
): Destination {
  return {
    params: [],
    deepLinks: [],
    flags: {},
    ...partial,
  };
}

export function param(name: string, type: string, optional = false): Param {
  return { name, type, optional };
}

export function nav(
  partial: Partial<NavigatorNode> & Pick<NavigatorNode, "name" | "kind">,
): NavigatorNode {
  return { children: [], destinations: [], ...partial };
}

export function edge(
  from: string,
  to: string,
  kind: NavEdge["kind"],
  file: string,
  line: number,
): NavEdge {
  return { from, to, kind, source: { file, line } };
}

export function graph(partial: Partial<NavGraphIR> = {}): NavGraphIR {
  return {
    formatVersion: NAV_FORMAT_VERSION,
    router: { name: "expo-router", major: 5 },
    navigators: [],
    edges: [],
    diagnostics: [],
    ...partial,
  };
}
