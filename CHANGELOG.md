# Changelog

## [0.10.0](https://github.com/anatolykoptev/payload-og-image/compare/v0.9.0...v0.10.0) (2026-11-26)


### ⚠ BREAKING CHANGES

* a hero object that has no readable upload record in the site's upload collections (for example a remote URL handed in directly) is no longer drawn; give it a backing upload record.
* drawing under a jsdom test environment is no longer supported; templates and the test kit's templatesRender/sizeBudget need a Node test environment (// @vitest-environment node). The start-up check no longer draws a card: a broken renderer is reported by the first render as render_error plus the degraded fallback.

### Features

* read SVG logos safely ([#89](https://github.com/anatolykoptev/payload-og-image/issues/89)) ([#100](https://github.com/anatolykoptev/payload-og-image/issues/100)) ([141822a](https://github.com/anatolykoptev/payload-og-image/commit/141822a082b66ad7d96bc7490135b5c903d42ec8))


### Bug Fixes

* close the exposure tech debt ([#86](https://github.com/anatolykoptev/payload-og-image/issues/86) [#91](https://github.com/anatolykoptev/payload-og-image/issues/91) [#85](https://github.com/anatolykoptev/payload-og-image/issues/85) [#73](https://github.com/anatolykoptev/payload-og-image/issues/73) [#77](https://github.com/anatolykoptev/payload-og-image/issues/77)) ([#95](https://github.com/anatolykoptev/payload-og-image/issues/95)) ([d1e1db9](https://github.com/anatolykoptev/payload-og-image/commit/d1e1db96a2b71cab39993f7264663cdd2e1b18d8))
* jsdom self-test, store short read, missing tests, MCP followups ([#93](https://github.com/anatolykoptev/payload-og-image/issues/93)) ([70d4f2b](https://github.com/anatolykoptev/payload-og-image/commit/70d4f2bbb1adfeddec99ec8982c851ae7a092901))
* weight-aware fonts ([#90](https://github.com/anatolykoptev/payload-og-image/issues/90)), truecolour hero for lossy cards ([#71](https://github.com/anatolykoptev/payload-og-image/issues/71)) ([#98](https://github.com/anatolykoptev/payload-og-image/issues/98)) ([0112c7c](https://github.com/anatolykoptev/payload-og-image/commit/0112c7c06b87830c1adea66329b5d300fe83c9d1))


### Performance Improvements

* free boot (no draw in onInit, lazy sharp and fontkit, realm.ts removed) ([#99](https://github.com/anatolykoptev/payload-og-image/issues/99)) ([7885550](https://github.com/anatolykoptev/payload-og-image/commit/788555054e29ad6f852b7d91f5b678cbe0535bee))

## [0.9.0](https://github.com/anatolykoptev/payload-og-image/compare/v0.8.0...v0.9.0) (2026-11-26)


### Features

* zero-config presets (photo and text) behind collections ([#88](https://github.com/anatolykoptev/payload-og-image/issues/88)) ([12094f3](https://github.com/anatolykoptev/payload-og-image/commit/12094f301c5754d958c99056e877bc5cfd283a8a))

## [0.8.0](https://github.com/anatolykoptev/payload-og-image/compare/v0.7.2...v0.8.0) (2026-11-26)


### Features

* several named images per card, and a hero from a hasMany upload field ([#83](https://github.com/anatolykoptev/payload-og-image/issues/83)) ([c2ae3cd](https://github.com/anatolykoptev/payload-og-image/commit/c2ae3cdfb1472009777977364e84b5380d91d243))

## [0.7.2](https://github.com/anatolykoptev/payload-og-image/compare/v0.7.1...v0.7.2) (2026-11-26)


### Bug Fixes

* **ci:** run the pack gate on every pull request; install optional peers per entry ([#80](https://github.com/anatolykoptev/payload-og-image/issues/80)) ([91d2e62](https://github.com/anatolykoptev/payload-og-image/commit/91d2e629270c8e8bd68f0c52be5b90777fb85ba7))

## [0.7.1](https://github.com/anatolykoptev/payload-og-image/compare/v0.7.0...v0.7.1) (2026-11-26)


### Bug Fixes

* **release:** one public-surface list for the spec and the pack gate ([#76](https://github.com/anatolykoptev/payload-og-image/issues/76)) ([e4a5892](https://github.com/anatolykoptev/payload-og-image/commit/e4a5892278ca75680de428343db0e9b6c7536131))

## [0.7.0](https://github.com/anatolykoptev/payload-og-image/compare/v0.6.0...v0.7.0) (2026-11-25)


### Features

* size variants for schema.org images ([#72](https://github.com/anatolykoptev/payload-og-image/issues/72)) ([74e2d18](https://github.com/anatolykoptev/payload-og-image/commit/74e2d1857c6f263ad03c237e508f49f8dc32333a))

## [0.6.0](https://github.com/anatolykoptev/payload-og-image/compare/v0.5.0...v0.6.0) (2026-11-25)


### Features

* **render:** JPEG and WebP card output ([#67](https://github.com/anatolykoptev/payload-og-image/issues/67)) ([1e699d6](https://github.com/anatolykoptev/payload-og-image/commit/1e699d6cb8201e2ed9e073444e8eb0be922aa86d))

## [0.5.0](https://github.com/anatolykoptev/payload-og-image/compare/v0.4.0...v0.5.0) (2026-11-25)


### Features

* **mcp:** read-only og_card, og_audit, og_preview tools for @payloadcms/plugin-mcp; stacked on [#61](https://github.com/anatolykoptev/payload-og-image/issues/61) ([#63](https://github.com/anatolykoptev/payload-og-image/issues/63)) ([68fdb26](https://github.com/anatolykoptev/payload-og-image/commit/68fdb26e739bfb7165d0b019108004929cabe2fd))
* site gaps from [#54](https://github.com/anatolykoptev/payload-og-image/issues/54) (alt, per-target heroBackground, ctx.fit ladder, kit options); stacked on [#59](https://github.com/anatolykoptev/payload-og-image/issues/59) ([#61](https://github.com/anatolykoptev/payload-og-image/issues/61)) ([cb914d3](https://github.com/anatolykoptev/payload-og-image/commit/cb914d36a6268e7d9abcd5de4c9d2e0eb5ddf7b3))


### Bug Fixes

* transparent hero keeps its alpha (0.4.1); kit spec timeout docs ([#59](https://github.com/anatolykoptev/payload-og-image/issues/59)) ([97ce4d5](https://github.com/anatolykoptev/payload-og-image/commit/97ce4d5225355596144c237d80f89834906ad99d))

## [0.4.0](https://github.com/anatolykoptev/payload-og-image/compare/v0.3.0...v0.4.0) (2026-11-25)


### Features

* **render:** palette option for the card and the hero ([#55](https://github.com/anatolykoptev/payload-og-image/issues/55)) ([4aa6800](https://github.com/anatolykoptev/payload-og-image/commit/4aa68001cb50accacbf76c14078ccfa1452d2e1a))

## [0.3.0](https://github.com/anatolykoptev/payload-og-image/compare/v0.2.0...v0.3.0) (2026-11-25)


### Features

* Payload 4 support alongside 3.x ([#51](https://github.com/anatolykoptev/payload-og-image/issues/51)) ([fc45cac](https://github.com/anatolykoptev/payload-og-image/commit/fc45cac94888e313550c06b58f82bfce004ac719))
* revalidation recipe, dev-server probe in CI, restHeadParity, docs and analyzer leftovers ([#47](https://github.com/anatolykoptev/payload-og-image/issues/47)) ([ed97a9e](https://github.com/anatolykoptev/payload-og-image/commit/ed97a9e7a8cf0119cdaa88513cc81714c9738818))


### Bug Fixes

* offline renderer, per-glyph stacks, start-up draw, preview and secureUrl tests ([#48](https://github.com/anatolykoptev/payload-og-image/issues/48)) ([669b697](https://github.com/anatolykoptev/payload-og-image/commit/669b69763c5a7b595a6bb6c2f2173760d198422f))
* parse route files with the TypeScript compiler API; Force new image guard, round trip and crawler hint ([#34](https://github.com/anatolykoptev/payload-og-image/issues/34)) ([bbdc2f5](https://github.com/anatolykoptev/payload-og-image/commit/bbdc2f56bf66944a06959232276a679969f8fe11))
* review leftovers of [#47](https://github.com/anatolykoptev/payload-og-image/issues/47) (long cache tags, probe cleanup, loader errors, beta pick) ([#49](https://github.com/anatolykoptev/payload-og-image/issues/49)) ([6d879ee](https://github.com/anatolykoptev/payload-og-image/commit/6d879eecf0ccbcb71ee3fb144add3955848d0b59))

## [0.2.0](https://github.com/anatolykoptev/payload-og-image/compare/v0.1.4...v0.2.0) (2026-11-24)


### Features

* admin-only /stats ([#32](https://github.com/anatolykoptev/payload-og-image/issues/32)) ([043d91d](https://github.com/anatolykoptev/payload-og-image/commit/043d91d5e29f390e1f4daac940006cdd89f1c6c8))
* **admin:** live card preview with warnings ([#29](https://github.com/anatolykoptev/payload-og-image/issues/29)) ([f40834d](https://github.com/anatolykoptev/payload-og-image/commit/f40834d9a0c5a2dfdc1bab3e000da6f2e890571e))
* force-new-image nonce ([#31](https://github.com/anatolykoptev/payload-og-image/issues/31)) ([c4db7e5](https://github.com/anatolykoptev/payload-og-image/commit/c4db7e5d65bb9626a9d9943b3fb29fefd257ce04))
* per-document og field group (mode, headline, subtitle) ([#26](https://github.com/anatolykoptev/payload-og-image/issues/26)) ([4c584c5](https://github.com/anatolykoptev/payload-og-image/commit/4c584c5851616bbbc5a78ba9d5e179cb77b90124))

## [0.1.4](https://github.com/anatolykoptev/payload-og-image/compare/v0.1.3...v0.1.4) (2026-11-24)


### Bug Fixes

* close the 0.1 review leftovers ([#11](https://github.com/anatolykoptev/payload-og-image/issues/11)) ([#23](https://github.com/anatolykoptev/payload-og-image/issues/23)) ([b4d1da9](https://github.com/anatolykoptev/payload-og-image/commit/b4d1da97dcf7426366ed9c1a2337f3233f971eb8))

## [0.1.3](https://github.com/anatolykoptev/payload-og-image/compare/v0.1.2...v0.1.3) (2026-11-24)


### Bug Fixes

* **release:** every release is published as latest ([#21](https://github.com/anatolykoptev/payload-og-image/issues/21)) ([9a90c3f](https://github.com/anatolykoptev/payload-og-image/commit/9a90c3fe05c5c3e38be5bb742f44ae2b39c8eca2))

## [0.1.2](https://github.com/anatolykoptev/payload-og-image/compare/v0.1.1...v0.1.2) (2026-11-24)


### Bug Fixes

* **release:** publish through npm trusted publishing; og-parity bin path npm keeps ([#19](https://github.com/anatolykoptev/payload-og-image/issues/19)) ([ae3a762](https://github.com/anatolykoptev/payload-og-image/commit/ae3a76289e96733b2eda521b719035f4f72ae801))

## [0.1.1](https://github.com/anatolykoptev/payload-og-image/compare/v0.1.0...v0.1.1) (2026-11-24)


### Bug Fixes

* **ci:** lint skips the generated CHANGELOG ([#17](https://github.com/anatolykoptev/payload-og-image/issues/17)) ([a196824](https://github.com/anatolykoptev/payload-og-image/commit/a19682478e19f714fdf94b9e0c6faa08a3b3cf61))

## 0.1.0 (2026-11-24)


### Features

* card handler: HEAD-safe headers, draft-mode bypass, shedding, per-request downgrade, gated fallback ([a286a93](https://github.com/anatolykoptev/payload-og-image/commit/a286a93f274bb14c0a636fdd2050ee26d9cd3316))
* card handler: HEAD-safe headers, draft-mode bypass, shedding, per-request downgrade, gated fallback ([5db887d](https://github.com/anatolykoptev/payload-og-image/commit/5db887d5446f6ec86066b9c924306f328ad55e48))
* content version over props, heroes, fonts and host ([acc6b43](https://github.com/anatolykoptev/payload-og-image/commit/acc6b435010daae3bc21a82a76f894314e705d3b))
* content version over props, heroes, fonts and host, with constant slots for 0.2 ([b706fa5](https://github.com/anatolykoptev/payload-og-image/commit/b706fa5a9ab111bb66d17b2faa6558f646614a4c))
* **dev:** wire the plugin into the dev app; record what Next 16.4.6 actually does ([febcb65](https://github.com/anatolykoptev/payload-og-image/commit/febcb6534afccc3a993411fc36aff5fe723fbb4a))
* font registry with digest, coverage, missing-glyph strip and fit ([100e71a](https://github.com/anatolykoptev/payload-og-image/commit/100e71a74913d0269d9090808a525e95b6c41eb7))
* font registry with digest, coverage, missing-glyph strip and fit from fontkit metrics ([32c51d9](https://github.com/anatolykoptev/payload-og-image/commit/32c51d9579a418aa7e22cc6745a690493b25dcfc))
* next/og renderer with palette encode, no-fetch-by-default hero loader, fallback card ([9ea3103](https://github.com/anatolykoptev/payload-og-image/commit/9ea310388ff26aa0aa95958084707cfc14dd16dd))
* next/og renderer with palette encode, no-fetch-by-default hero loader, fallback card ([61f7476](https://github.com/anatolykoptev/payload-og-image/commit/61f74761cc82fd40e836f1a2c408716e6ff9131a))
* Payload plugin (schema-neutral), published/draft doc source, route factory, re-reading metadata helper ([d539be3](https://github.com/anatolykoptev/payload-og-image/commit/d539be38f4182731d265fa0d247c127a8fbd99f5))
* Payload plugin (schema-neutral), published/draft doc source, route factory, re-reading metadata helper ([59d961b](https://github.com/anatolykoptev/payload-og-image/commit/59d961b56a4cc7701aa98fce7ed8fe6e3a5b88cd))
* **plugin:** heroBackground option ([6d7d83a](https://github.com/anatolykoptev/payload-og-image/commit/6d7d83a5c8b4255fa40a07904e287175e7d685ff))
* **plugin:** serverURL option, so the host config need not set its own ([9eadf5b](https://github.com/anatolykoptev/payload-og-image/commit/9eadf5badbe5d23735039b627016dd094766515f))
* render gate, bounded memo, crash-safe CRC-validated disk store ([686cf85](https://github.com/anatolykoptev/payload-og-image/commit/686cf855d16c7ea0fcc370aa6410b95eca5e1096))
* render gate, bytes-bounded single-flight memo, crash-safe CRC-validated disk store ([118387b](https://github.com/anatolykoptev/payload-og-image/commit/118387bb188721326991d39102c93f0f68ba6a39))
* **template:** the props contract is the normalized shape ([b90bd82](https://github.com/anatolykoptev/payload-og-image/commit/b90bd82cb5d2b21a851fc0ad3cd0d37832dbaf0d))
* **testing:** kit over the site's real metadata and route modules, path/route matcher, parity tool ([326eb6d](https://github.com/anatolykoptev/payload-og-image/commit/326eb6dd62978c645ea1bf448c83357ca8c8d34d))
* **testing:** kit over the site's real metadata and route modules, path/route matcher, parity tool ([9ddb16c](https://github.com/anatolykoptev/payload-og-image/commit/9ddb16ca985bd98292220a02af0d8d9c4303cdfe))
* typed templates and targets, share-image eligibility, one precedence resolver ([25832b4](https://github.com/anatolykoptev/payload-og-image/commit/25832b4fe5d3ae854f3528777acd2002b3ef5a37))
* typed templates and targets, share-image eligibility, one precedence resolver ([4f0a4bd](https://github.com/anatolykoptev/payload-og-image/commit/4f0a4bd21c5b9448698ee0e4971fa7f554499d82))
* **version:** normalizeProps defines the props model ([c8f2b0c](https://github.com/anatolykoptev/payload-og-image/commit/c8f2b0c457fc12e340c3891ddd737d913829923e))


### Bug Fixes

* **ci:** no untrusted code on the self-hosted runner; release gated on the packed tarball ([4c0af7f](https://github.com/anatolykoptev/payload-og-image/commit/4c0af7f87dd614ac1d3dedef695a4b56e49b9716))
* **fonts:** cap fitText's maxSize at 2048 and require the size step to change the size ([c4827fb](https://github.com/anatolykoptev/payload-og-image/commit/c4827fbc92fba4c61e93a3724d1b10aa8bc58b1f))
* **fonts:** fitText rejects a box that would loop forever ([6750a80](https://github.com/anatolykoptev/payload-og-image/commit/6750a80f86616b3738a8605722edf5afbb72d10a))
* **fonts:** review findings on font views, per-face coverage and measuring face ([0300df6](https://github.com/anatolykoptev/payload-og-image/commit/0300df6473277e611034ee55a926159a282014e9))
* gaps found migrating the reference site (heroBackground, serverURL, kit fake globals) ([1cf7348](https://github.com/anatolykoptev/payload-og-image/commit/1cf7348e2b5bda442b25a0f79f50b9dac0199e07))
* **handler,resolve:** review findings on revalidation, :id routes, event counts, pinned routes and unservable keys ([1229067](https://github.com/anatolykoptev/payload-og-image/commit/122906720cf6cfa9003d63903f17256ce8837182))
* **handler:** 304 only with the current bytes in hand; bounded pre-admission work; hero collection ([6b06db1](https://github.com/anatolykoptev/payload-og-image/commit/6b06db14a2dbcc9d252ed4f8d7653b70c66fef1f))
* **handler:** settle the fonts and site reads before releasing the admission slot ([f449163](https://github.com/anatolykoptev/payload-og-image/commit/f4491635c0a1489e1a5db93de7ecc81e9b71b900))
* **handler:** the fallback card drops site-name glyphs no font draws ([03e2552](https://github.com/anatolykoptev/payload-og-image/commit/03e2552b9b18a93f4726f40caf274e1b798b01ff))
* **hero:** cancel an error response's body instead of leaving it open ([d7addd3](https://github.com/anatolykoptev/payload-og-image/commit/d7addd37f73bf99a8ced130bb42ab9a768ec6e1e))
* **hero:** guarded fetch on its own agent, complete special-purpose ranges, failed responses reject ([6540d33](https://github.com/anatolykoptev/payload-og-image/commit/6540d33cd58a1562b4b2ea1ccb968247189dd3c6))
* **hero:** SSRF guard for remote heroes; read a hero only inside its own upload collection ([868f818](https://github.com/anatolykoptev/payload-og-image/commit/868f818d99cb6606f540f7dcd11bba87cdf91eab))
* **plugin:** depth 0 everywhere; uploads read by id, related() for the rest; safe route error text ([62798ff](https://github.com/anatolykoptev/payload-og-image/commit/62798fff4fd4f72818bd1ef17ba17f7f30fdc39b))
* **plugin:** export RelatedFn, drop an unused import and a comma operator ([3763077](https://github.com/anatolykoptev/payload-og-image/commit/376307741477dc80970b3466022dd3e2ebfbbf47))
* **plugin:** heroBackground in the version, strict serverURL origin and hero colour ([2dd8f93](https://github.com/anatolykoptev/payload-og-image/commit/2dd8f93b10edbbb3713799d4ad31e115c887b8a2))
* **plugin:** no draft relations in published reads; editors are admin-collection users; hero collection; route never throws ([eecadde](https://github.com/anatolykoptev/payload-og-image/commit/eecaddeb33ab776bebe343575965ee69e9a806c8))
* **plugin:** select keeps the root of the editor's share-image field ([14eb4d9](https://github.com/anatolykoptev/payload-og-image/commit/14eb4d9a68eedfffa6c0429cfc7e8e8e181abb49))
* **release:** check out refs/tags/&lt;tag&gt;; document the threat model and a release checklist ([d2e2662](https://github.com/anatolykoptev/payload-og-image/commit/d2e2662a9a9c2984672f66c959109eada5c6888a))
* **release:** publish the tagged revision, and ship NOTICE in the tarball ([674b9ff](https://github.com/anatolykoptev/payload-og-image/commit/674b9ff9d0df835dc96b5297fa6095b471a55e78))
* **resolve:** hash and render one normalized props model; explicit default font stack; pathname-only target paths ([643cf49](https://github.com/anatolykoptev/payload-og-image/commit/643cf497018aad64913881383c94fdfd5e578031))
* **resolve:** review findings on props shape, stack order, lazy share, kind index and dot slugs ([49c4694](https://github.com/anatolykoptev/payload-og-image/commit/49c4694e733dc02567ae2776f58476ed9d457e0c))
* **runtime:** crawlerEvents.sample is a fraction, and the event carries ua_family and cache ([1a5e8fd](https://github.com/anatolykoptev/payload-og-image/commit/1a5e8fd4195f67d8651eba33755f205b39417ba7))
* **store:** prune honours usable(); FIFO-safe open; own only the temp names it created; reject Adam7 and bad filter bytes ([ca423f6](https://github.com/anatolykoptev/payload-og-image/commit/ca423f6d891e55c4a322b955fbb96f1024d1fcce))
* **store:** review findings on pruning, sinks, PNG validation and the memory bound ([4122145](https://github.com/anatolykoptev/payload-og-image/commit/4122145cadadc6eab0e62225bdda5a7fd299592a))
* **store:** symlink-safe, bounded, decode-checked disk store; stricter gate/memo/memory ([53d7824](https://github.com/anatolykoptev/payload-og-image/commit/53d7824bb7220213ea143d1089fd0b6f725ab7c2))
* **testing:** fake find honours _status; editor credential per editor collection; AST route check ([127e9e2](https://github.com/anatolykoptev/payload-og-image/commit/127e9e2ebb5f985ee953bb3a54de8392185c50ca))
* **testing:** kit review findings; dev example draws its hero ([1b416bf](https://github.com/anatolykoptev/payload-og-image/commit/1b416bf413bb9bcb14be8305262bb65865f6a72e))
* **testing:** the fake Payload lists the site's globals in its config ([7b0f23c](https://github.com/anatolykoptev/payload-og-image/commit/7b0f23cc2d7b25e248c947dc8600ba4d1efe1ac6))
* **testing:** the kit drives the site's route and the production auth path ([74e35d7](https://github.com/anatolykoptev/payload-og-image/commit/74e35d7f37c9f9d42f1eb20adf6135a8e0f12387))
* validate every numeric option (memo, stores) instead of trusting it ([265f3af](https://github.com/anatolykoptev/payload-og-image/commit/265f3af8f760bf44bb2ae8bd02f05b6bf2b48a5e))
* **version:** canonicalJson follows JSON.stringify on holes, toJSON keys and function members ([90ab836](https://github.com/anatolykoptev/payload-og-image/commit/90ab8365379dbced205e7639a507c537cb7d8382))
* **version:** normalizeProps keeps an own __proto__ key as data ([922a2e6](https://github.com/anatolykoptev/payload-og-image/commit/922a2e696239853a45e0d004e80a372061998f5c))


### Miscellaneous Chores

* **release:** the first release is 0.1.0 ([#15](https://github.com/anatolykoptev/payload-og-image/issues/15)) ([1cea855](https://github.com/anatolykoptev/payload-og-image/commit/1cea8553959927dad639e112bf84e68ddf53fd8b))

## Changelog

All notable changes to this project are recorded here. The file is generated by release-please from
[Conventional Commits](https://www.conventionalcommits.org) when a release PR is merged; do not edit it by hand.
