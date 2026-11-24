# payload-og-image

Payload CMS plugin that generates Open Graph share cards from your content, versions every card URL by
what it draws, and serves it through a bounded render gate with a crash-safe on-disk store.

Status: pre-0.1, under construction. The public surface is fixed in advance:

- `payload-og-image`: `ogImagePlugin`, `defineTemplate`, `defineTarget`
- `payload-og-image/next`: `createOgRoute`, `ogMetadata`, `withHead`
- `payload-og-image/testing`: `installTestRuntime`, `ogKit`

Requires Payload `^3.93.0`, Next `^16.4.5`, React `^19.3.1`, sharp `^0.35.4`, Node `^22.23.5 || ^24.22.3 || >=26.13.1`.

## Development

```sh
pnpm install
pnpm test -- test/<file>   # scoped tests
make preflight             # lint, typecheck, test, build, api-extractor (CI runs this)
pnpm api:update            # accept an intended public-surface change into etc/*.api.md
pnpm dev                   # dev app (sqlite) in dev/
```

## Setup notes (verified in the dev app, Next 16.4.6, Turbopack and webpack)

- Add `serverExternalPackages: ['fontkit']` to `next.config`. fontkit reads data files relative to its own location, and a page that imports your Payload config fails with `ERR_INVALID_ARG_TYPE` when fontkit is bundled.
- Param encoding differs by caller: a page component's `params` arrive percent-encoded (`a%25b`), while `generateMetadata` params and a route handler's `params` arrive already decoded (`a%b`). Decode in the page component only; decoding the others again throws on a literal `%`. The card route never decodes.
- The card route exports `GET` and `HEAD = GET`. `withHead` is only for Payload's own REST route, which answers HEAD with a 404.
- A drafts-enabled collection must allow public read of published documents (`read: ({ req: { user } }) => user ? true : { _status: { equals: 'published' } }`): the plugin reads with `overrideAccess: false`.

## Threat model

The card store directory (`store: { dir }`) must be private to the application user and live on a volume only
the application writes. Anyone who can write that directory can already change the application, so the store
defends against corrupt or foreign files appearing in it (torn writes, symlinks, odd file types), not against a
local attacker racing it with directory swaps after boot.

## Release checklist

- Before the repository goes public, deregister the self-hosted runner from it. Otherwise a fork could target
  that runner by editing the workflow. Switch nothing else by hand: `preflight.yml` already picks a hosted runner
  once the repository is public.
- Keep "Require approval for all outside collaborators" (fork pull request workflows) turned on.
- Set the `NPM_TOKEN` secret, and expect `scripts/verify-pack.mjs` to fail until every entry point exports its
  agreed names.

## Licence

Apache-2.0. See `LICENSE` and `NOTICE`.
