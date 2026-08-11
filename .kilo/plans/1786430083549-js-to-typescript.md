# Convert Screeps bot from JS to TypeScript (with `@types/screeps`)

## Goal

Rewrite the existing `src/*.js` Screeps bot as TypeScript (`.ts`) using `@types/screeps`, with Bun bundling the TS to `dist/` for the existing grunt-screeps upload pipeline. End state: same runtime behavior on the Screeps server, plus strict local type checking.

## Locked decisions

- **Module style**: ESM (`import`/`export`).
- **Build/deploy**: `bun build src/main.ts --outdir dist --target=screeps` produces `dist/main.js`. `Gruntfile.js` uploads `dist/*.js` (unchanged grunt-screeps invocation, different src path).
- **Typed Memory**: Yes. Declare `CreepMemory`, `RoomMemory`, and augment `Memory` in `src/types.d.ts`.
- **Strictness**: Keep `strict: true`, `noUncheckedIndexedAccess: true`, `noImplicitOverride: true`. Add `noFallthroughCasesInSwitch` (already on).

## File-by-file actions

### 1. `tsconfig.json`
- Change `"types": ["bun"]` → `"types": ["bun", "screeps"]`.
- Change `"module": "Preserve"` → `"module": "ESNext"`.
- Keep `"noEmit": true` (Bun handles bundling, `tsc` is only used for type checking).
- Keep `allowJs: true` so any leftover `.js` (if rolled back partially) still type-checks.

### 2. `package.json`
- Add scripts:
  - `"typecheck": "tsc --noEmit"`
  - `"build": "bun build src/main.ts --outdir dist --target=screeps"`
  - `"push-main": "bun run build && grunt dist"`
- Move `typescript` from `peerDependencies` to `devDependencies` (it is required for `tsc`).
- Keep `@types/screeps` in `dependencies` (Bun bundles it away; runtime not needed, but it must resolve for type checking).
- Keep `grunt-screeps` for upload.

### 3. `Gruntfile.js`
- Change `src: ['src/*.js']` → `src: ['dist/*.js']`.
- No other changes; `.screeps.json` config block is unchanged.

### 4. New file: `src/types.d.ts`
Augment the global `Memory` and add the creep/room memory shapes used across the codebase:

```ts
declare global {
  interface CreepMemory {
    role: string;
    homeRoom: string;
    sourceId?: Id<Source>;
    targetRoom?: string;
    upgrading?: boolean;
    building?: boolean;
    repairing?: boolean;
    _move?: {
      path: RoomPosition[];
      dest: { x: number; y: number; roomName: string };
      time: number;
    };
  }
  interface RoomMemory {
    _extensionCheckTick?: number;
    _spawnCooldown?: number;
    _harvesterIndex?: number;
  }
}
export {};
```

(`Memory.creeps` is already keyed by name in `@types/screeps`.)

### 5. Convert each file from CJS `.js` to ESM `.ts`

For every `src/*.js` → `src/*.ts` rename, and every `const x = require('./y')` → `import x from './y'` / `import { a } from './y'`. Specific per-file notes:

- **`src/main.ts`** — `module.exports.loop = () => { ... }` → `export function loop(): void { ... }`. The Screeps entry point must be a top-level `export function loop()`. Bundled output keeps that name.
- **`src/constants.ts`** — Add `as const` to literal objects where helpful, e.g. `TARGETS` becomes `Record<number, ...>` or keep loose; `ROLE`/`EXPANSION` exports stay typed as object literals. The `CLAIM`, `WORK`, etc. tokens used in body arrays must be cast or annotated as `BodyPartConstant[]` because `@types/screeps` declares them as ambient constants of type `BodyPartConstant`.
- **`src/utilities.ts`** — Annotate `bodyFor(role: string): BodyPartConstant[]`, `moveCached(creep: Creep, dest: RoomPosition | { pos: RoomPosition }, opts?: MoveToOpts): ScreepsReturnCode`, etc. `opts.reusePath || HOME_PATH_TTL` becomes `opts.reusePath ?? HOME_PATH_TTL` to satisfy `noUncheckedIndexedAccess` on `opts`. `moveCached`'s cached dest comparison needs `pos.x !== undefined` guard or use `_.isEqual` pattern; simplest is to compare primitive fields.
- **`src/spawn.ts`** — `trySpawn(room: Room, role: string): boolean`. Cast the body returned by `bodyFor` to `BodyPartConstant[]`. `name` string templating is fine. `canAffordBody(room: Room, role: string): boolean`.
- **`src/room.ts`** — `run(room: Room): void`. `runCreep(creep: Creep): void`. `runTowers` / `ensureExtensions` stay internal. `Math.max(counts[ROLE.UPGRADER] || 0, 1)` — under `noUncheckedIndexedAccess`, `counts[key]` is `number | undefined`, so `|| 0` keeps it safe.
- **`src/expansion.ts`** — `run(): void`, `findHomeRoomName(): string | null`, `pickExpansionTarget(): string | null`. Cache typed via `Memory._exitsCache` augmentation (or cast as `any` with a comment). Use `Map`-like access patterns already present.
- **`src/role.harvester.ts` … `src/role.claimer.ts`** — Each exports `run(creep: Creep): void`. No logic changes; only signatures. `new RoomPosition(25, 25, name)` calls need no annotation; the constructor is typed.

### 6. `.gitignore`
- Add `dist/` (already there), `*.tsbuildinfo` (already there). Nothing else to change.

## Validation

1. `bun install` — confirms `@types/screeps`, `typescript`, `bun-types` resolve.
2. `bun run typecheck` — `tsc --noEmit` must exit 0 against the new `.ts` files.
3. `bun run build` — produces `dist/main.js` (single bundled file with no external runtime imports beyond what the Screeps VM provides).
4. Sanity-check the bundle: `head -1 dist/main.js` should show the loop export (Bun preserves ESM top-level exports when targeting Screeps; if the output is CJS, grunt-screeps still uploads it fine because `module.exports.loop = ...` style is also accepted by Screeps). If Bun emits CJS by default, confirm the loop is still reachable as `module.exports.loop` or that grunt-screeps is configured appropriately. (Bun defaults to CJS-compatible bundle output when targeting node/screeps; the loop function will be assigned accordingly.)
5. `bun run push-main` — bundles then uploads to the `default` branch via grunt-screeps using existing `.screeps.json`. (Skip if no live deploy access during review.)
6. Manual review: confirm no behavior change by reading diffs — only type annotations and module-syntax changes.

## Out of scope

- Switching off `grunt-screeps` (rollup plugin from the starter is not adopted).
- Adding ESLint / Prettier configs from the starter (kept simple to minimize blast radius).
- Adding the starter's `test/` directory or mocha/chai/sinon test stack.
- Touching `.screeps.json` (credentials stay in place).

## Risks

- **Bundle output format**: Bun's default bundle is CJS-friendly. Screeps accepts CJS `module.exports.loop`. If Bun emits ESM, grunt-screeps uploads the `.js` and Screeps' VM expects either a top-level `loop` function or `module.exports.loop`. Mitigation: verify `dist/main.js` exposes `loop` after build; if not, add `--format=cjs` or wrap in `module.exports.loop = loop`.
- **`@types/screeps` globals colliding with `bun-types`**: both declare some browser/Node globals. Mitigation: keep `"types": ["bun", "screeps"]` (no implicit `@types/...` from `node_modules/@types` autoload beyond these).
- **`noUncheckedIndexedAccess` noise**: dictionary-style accesses (`counts[role]`, `cached.exits[dir]`, `Game.rooms[name]`) become `T | undefined`. Code already uses `|| 0` / `if (!x)` patterns, but a few sites will need explicit guards or non-null assertions (`!`). Acceptable per the project's existing style.
- **Memory schema drift**: typed `CreepMemory` will flag any string-key access (none exist in the current code), but old serialized creeps from before deploy may have unexpected fields — `?` already covers this.
