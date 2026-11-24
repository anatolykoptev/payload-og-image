# Contributing

Thanks for helping. Bug reports, fixes and documentation are welcome; for a larger feature, open an issue first so the
shape can be agreed before you write it.

## Set up

Node `^22.23.5 || ^24.22.3 || >=26.13.1` and pnpm (the version is pinned in `package.json` as `packageManager`).

```sh
pnpm install
pnpm dev          # the dev app in dev/ (Payload + Next on SQLite)
```

## Before you open a pull request

```sh
pnpm test -- test/<file>   # the tests for the code you touched
make preflight             # lint, typecheck, test, build, api-extractor: the same gate CI runs
```

- **Public API.** `etc/*.api.md` are api-extractor reports of the three entry points (`payload-og-image`,
  `/next`, `/testing`). A change to an exported name, signature or type fails `make preflight` until you accept it with
  `pnpm api:update` and commit the updated report, so the change shows up in review.
- **Tests.** Behaviour that would break silently (a cache header, a version derived from the wrong input, an access
  check) needs a test that fails when the code is reverted. Docs and mechanical changes need none.
- **Style.** Biome formats and lints (`pnpm lint:fix`). Edit files in their existing style.
- **Commits.** [Conventional Commits](https://www.conventionalcommits.org) (`feat:`, `fix:`, `docs:`, `chore:`).
  release-please builds the changelog and the version from them.
- **Docs.** Keep [docs/INDEX.md](docs/INDEX.md) listing every document.

## Reporting problems

Bugs and feature requests go to GitHub issues. A security problem does not: follow [SECURITY.md](SECURITY.md).

By contributing you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md), and that your contribution is licensed
under [Apache-2.0](LICENSE).
