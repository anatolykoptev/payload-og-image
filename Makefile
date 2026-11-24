.PHONY: preflight lint typecheck test build api-check
PNPM ?= pnpm

# The full gate. CI runs this; locally run only the scoped tests (`pnpm test -- <file>`).
preflight: lint typecheck test build api-check

lint:
	$(PNPM) lint

typecheck:
	$(PNPM) typecheck

test:
	$(PNPM) test

build:
	$(PNPM) build

# Fails on any drift between the built public surface and the committed etc/*.api.md reports.
api-check: build
	$(PNPM) api:check
