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

`git commit` automatically runs `bun run lint` and `bun run typecheck` via Husky. Bypass with `git commit --no-verify` when needed.

## Entry point

`src/main.ts` exports the `loop()` function

## Strategy

The full strategy document lives at `./STRATEGY.md`

## Watchdog

Игровой скрипт в Screeps не запускается, если у аккаунта нет ни комнаты, ни
крипа. Если аккаунт остался без спавна (`world-status` = `empty`), его может
вернуть в игру только внешний процесс — `tools/screeps-watchdog.mjs`:

```bash
SCREEPS_TOKEN=<токен> node tools/screeps-watchdog.mjs
```

Скрипт без зависимостей, работает и по cron, и в GitHub Actions
(`.github/workflows/screeps-watchdog.yml`, токен берётся из секрета
`SCREEPS_TOKEN`). Подробности — в [`tools/README.md`](./tools/README.md).
