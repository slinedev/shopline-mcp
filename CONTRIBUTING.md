# Contributing

## Development Setup

```bash
npm install
npm run build
npm test
npm run test:smoke
```

Set `SHOPLINE_API_TOKEN` only for live API checks:

```bash
export SHOPLINE_API_TOKEN=your_token_here
```

## Adding or Updating Tools

- Register tools through `src/tools/register.ts`.
- Add custom business logic to `src/tools/custom.ts` when the tool reshapes data or combines multiple endpoints.
- Use `src/tools/generic.ts` only for simple endpoint wrappers.
- Keep tool descriptions in Traditional Chinese.
- Keep existing tool names stable unless a breaking change is intentional.

## Write Tools

Write tools must:

- Start their description with `[WRITE]`
- Include a `【副作用】` section
- Use the shared client in `src/client.ts`
- Return `success`, `resource_id`, and `message` where practical
- Never run live write tests unless `SHOPLINE_TEST_WRITES=1` is set

## Verification

Before publishing or opening a PR, run:

```bash
npm run build
npm test
npm run test:smoke
npm pack --dry-run
```

The local tests verify the 143-tool baseline, read/write split, endpoint coverage, client behavior, and stdio `tools/list`.
