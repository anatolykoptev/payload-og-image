# payload-og-image: notes for agents

A Payload CMS 3 plugin that draws content-versioned Open Graph cards. TypeScript, ESM, pnpm, vitest, biome,
api-extractor, release-please. Every document is indexed in [docs/INDEX.md](docs/INDEX.md).

## Layout

- `src/exports/`: the three public entry points (`index`, `next`, `testing`). Nothing else is public.
- `src/plugin/`: `ogImagePlugin`, option validation, the Payload document source. `src/template.ts`: `defineTemplate`, `defineTarget`.
- `src/next/`: `createOgRoute`, `ogMetadata`, `withHead`. `src/internal/`: version, handler, memo, gate, store, resolve.
- `src/render/`: the next/og renderer, hero loading and the guarded fetch. `src/testing/`: the test kit and the `og-parity` bin.
- `test/`: vitest specs mirroring `src/`. `dev/`: a Payload + Next app used by `pnpm dev` and the kit's own spec.
- `etc/*.api.md`: committed api-extractor reports. `scripts/verify-pack.mjs`: the pre-publish tarball check.

## Commands

```sh
pnpm test -- test/<file>   # scoped tests while you work
make preflight             # the full gate: lint, typecheck, test, build, api-check. CI runs it once
pnpm lint:fix              # biome, which also formats the markdown
pnpm api:update            # accept an intended public-surface change into etc/*.api.md
```

## Rules that are easy to break

- A card URL's version is derived from the props the template draws, the template `id` and `revision`, the font
  bytes and the hero. Anything a template draws that is not in its props changes a card without changing its URL. Do not
  give `ctx` site data.
- Draft text goes only to editors, is never cached and never stored. Reads use `overrideAccess: false`.
- The `?v=` on a request only picks the `Cache-Control` header. It is never a key and never stored.
- Public surface changes go through `pnpm api:update` and show in the diff of `etc/*.api.md`.
- A test earns its place when its failure would be silent in production; such a change ships with a test that goes red
  when the production call site is reverted.
- This repository is public: no hostnames, operator paths, account names, tokens or client names in any tracked
  file, test fixtures included. Use invented values (`example.com`, `x.test`).
- Commits are Conventional Commits; release-please reads them. Docs-only changes need no new test.

## Release flow

1. Merge to `main`. `release.yml` runs release-please, which opens or updates a release PR (version and
   `CHANGELOG.md`). It only runs in a public repository.
2. Merging the release PR tags `vX.Y.Z`. The `publish` job checks the tag against `package.json`, runs
   `make preflight` and `scripts/verify-pack.mjs`, then `npm publish --provenance --access public --tag next`
   through npm trusted publishing (OIDC): npm trusts `release.yml` of this repository, set on the package's
   npm access page. No token or secret is involved.
3. Promotion is manual: `npm dist-tag add payload-og-image@<version> latest`.
4. A failed publish is retried with the `release` workflow's `tag` input (`workflow_dispatch`).
