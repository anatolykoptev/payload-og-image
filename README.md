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

## Licence

Apache-2.0. See `LICENSE` and `NOTICE`.
