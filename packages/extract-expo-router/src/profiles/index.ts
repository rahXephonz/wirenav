import { latestProfile } from "./latest.js";
import type { VersionProfile } from "./types.js";

export type { VersionProfile } from "./types.js";
export { latestProfile } from "./latest.js";

/** All known profiles, newest first. */
export const profiles: readonly VersionProfile[] = [latestProfile];

/**
 * Select a profile for a detected major version. With only the latest profile today,
 * this always returns it; `known` reflects whether the major is in the profile's
 * `knownMajors` (a `false` result drives a WN104 diagnostic upstream).
 */
export function selectProfile(major: number | null): { profile: VersionProfile; known: boolean } {
  const profile = latestProfile;
  const known = major !== null && profile.knownMajors.includes(major);
  return { profile, known };
}
