# screeps

Screeps bot written in TypeScript. Bundled with Bun and uploaded via `grunt-screeps`.

## Install

```bash
bun install
```

## Configuration

Create `.screeps.json` (gitignored) in the project root:

```json
{
  "email": "you@example.com",
  "password": "your-password",
  "branch": "default",
  "ptr": false
}
```

## Commands

```bash
bun run typecheck    # tsc --noEmit
bun run lint         # eslint src
bun run build        # bun build src/main.ts --outdir dist --target=node --format=cjs
bun run push-main    # build + grunt dist (uploads to screeps.com)
```

## Entry point

`src/main.ts` exports the `loop()` function

## Strategy

The full strategy document lives at `./STRATEGY.md`
