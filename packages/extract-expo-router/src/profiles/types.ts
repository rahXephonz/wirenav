import type { NavigatorKind } from "@wirenav/core";

/**
 * A version profile encodes convention differences between Expo Router versions as
 * DATA, not as `if (version)` branches scattered through extraction logic (CLAUDE.md
 * version policy). Detection reads the target's package.json and selects a profile;
 * unknown/newer versions fall back to the latest profile + WN104.
 */
export interface VersionProfile {
  /** Router identifier for the `.nav` header, e.g. `expo-router`. */
  readonly router: string;
  /** Profile id, e.g. `latest`. */
  readonly id: string;
  /** Major versions this profile claims to understand. Others ⇒ WN104. */
  readonly knownMajors: readonly number[];
  readonly specialFiles: {
    /** Basename (no ext) of a navigator layout file. */
    readonly layout: string;
    /** Basename (no ext) of the not-found route (flagged special). */
    readonly notFound: string;
    /** Basenames (no ext) that are infra files and are skipped entirely. */
    readonly skip: readonly string[];
    /** Basename suffix marking an API route (skipped as a screen). */
    readonly apiSuffix: string;
  };
  /** JSX component tag name → navigator kind, read from `_layout` default exports. */
  readonly navigatorComponents: Readonly<Record<string, NavigatorKind>>;
}
