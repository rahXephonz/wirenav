# Changesets

This directory holds [changesets](https://github.com/changesets/changesets). Each
changeset is a small Markdown file describing an intended package version bump and
the human-readable summary of the change. Run `pnpm changeset` to add one.

Any change that alters `.nav` output must also note the drift in the relevant
package `CHANGELOG` — see `CLAUDE.md`.
