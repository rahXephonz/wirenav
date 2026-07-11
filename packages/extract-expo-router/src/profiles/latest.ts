import type { VersionProfile } from "./types.js";

/**
 * The latest Expo Router profile. Covers the current filesystem conventions (SDK 50+,
 * expo-router v3+). Until a dedicated legacy profile lands (a later milestone), this is
 * the only profile and `knownMajors` spans the currently supported range; anything
 * outside it is handled best-effort with WN104.
 */
export const latestProfile: VersionProfile = {
  router: "expo-router",
  id: "latest",
  knownMajors: [3, 4, 5],
  specialFiles: {
    layout: "_layout",
    notFound: "+not-found",
    skip: ["+html", "+native-intent"],
    apiSuffix: "+api",
  },
  navigatorComponents: {
    Stack: "stack",
    Tabs: "tabs",
    Drawer: "drawer",
    Slot: "slot",
  },
};
