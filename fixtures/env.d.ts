// Ambient module + JSX stubs so editors / TS servers don't flag the source-only fixtures.
//
// Fixtures are NEVER installed (no node_modules) — the extractor reads them statically
// from source + package.json — so real type packages (react, react-native, expo-router)
// are intentionally absent. These declarations exist ONLY to keep IDE diagnostics quiet.
// They live at the fixtures root, outside every individual fixture's own directory, so the
// extractor's per-fixture filesystem walk never sees this file.
declare module "react";
declare module "react-native";
declare module "expo-router";

declare namespace JSX {
  interface IntrinsicElements {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [elemName: string]: any;
  }
}
