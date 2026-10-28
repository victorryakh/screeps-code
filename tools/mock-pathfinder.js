/* Minimal `PathFinder` for the offline smoke tests.
 *
 * The bot measures the delivery distance of a room with
 * `PathFinder.search(slot, goals)` (see `measureDeliveryDistance` in
 * `src/utilities.ts`): how many tiles of path a harvester has to walk from a
 * harvest tile to the closest storage. The mock has to answer that question
 * honestly, otherwise the test would pass for the wrong reason.
 *
 * The search is a breadth-first walk over the room's walkable tiles:
 *   - natural walls block movement;
 *   - structures and construction sites block movement as well, but the goal
 *     tile itself is always walkable (the engine does the same: it forces the
 *     goal tile walkable so that a creep can path *onto* it);
 *   - movement is eight-directional, like the engine's.
 *
 * Usage:
 *   const { installPathFinder } = require('./mock-pathfinder');
 *   installPathFinder(() => currentRoom);
 */

/** Eight-directional neighbours, in the engine's order. */
const STEPS = [
    [0, 1], [0, -1], [1, 0], [-1, 0],
    [1, 1], [1, -1], [-1, 1], [-1, -1]
];

/**
 * Installs a `PathFinder` global that searches the room returned by
 * `getRoom`.
 *
 * @param {() => any} getRoom Функция, возвращающая текущую комнату.
 */
function installPathFinder(getRoom) {
    global.PathFinder = {
        search(origin, goal) {
            const room = getRoom();

            if (!room) {
                return undefined;
            }

            const goals = Array.isArray(goal) ? goal : [goal];
            const normalised = goals.map((g) => {
                const pos = g.pos || g;
                return { x: pos.x, y: pos.y, range: g.range === undefined ? 0 : g.range };
            });

            const blocked = new Set();

            for (const s of room.find(107 /* FIND_STRUCTURES */)) {
                blocked.add(`${s.pos.x},${s.pos.y}`);
            }

            for (const s of room.find(111 /* FIND_CONSTRUCTION_SITES */)) {
                blocked.add(`${s.pos.x},${s.pos.y}`);
            }

            const walls = new Set();

            for (let x = 1; x <= 48; x++) {
                for (let y = 1; y <= 48; y++) {
                    if (room.getTerrain().get(x, y) === 1) {
                        walls.add(`${x},${y}`);
                    }
                }
            }

            const isGoal = (x, y) =>
                normalised.some(
                    (g) => Math.max(Math.abs(x - g.x), Math.abs(y - g.y)) <= g.range
                );

            // A tile the search may end on: not a wall. The exact goal tile is
            // the only exception - the engine forces it walkable so that a
            // creep can path *onto* the object it walks to.
            const mayEnd = (x, y) => {
                const key = `${x},${y}`;

                if (walls.has(key)) {
                    return normalised.some(
                        (g) => g.x === x && g.y === y && g.range === 0
                    );
                }

                return true;
            };

            const start = { x: origin.x, y: origin.y };
            const seen = new Set([`${start.x},${start.y}`]);
            const parent = new Map();
            let frontier = [start];

            if (isGoal(start.x, start.y)) {
                return { path: [], cost: 0, ops: 1 };
            }

            for (let depth = 0; depth < 50 && frontier.length > 0; depth++) {
                const next = [];

                for (const cur of frontier) {
                    for (const [dx, dy] of STEPS) {
                        const nx = cur.x + dx;
                        const ny = cur.y + dy;

                        if (nx < 1 || nx > 48 || ny < 1 || ny > 48) {
                            continue;
                        }

                        const key = `${nx},${ny}`;

                        if (seen.has(key)) {
                            continue;
                        }

                        const goal = isGoal(nx, ny);

                        if (!goal) {
                            if (walls.has(key) || blocked.has(key)) {
                                continue;
                            }
                        } else if (!mayEnd(nx, ny)) {
                            continue;
                        }

                        seen.add(key);
                        parent.set(key, cur);
                        next.push({ x: nx, y: ny });

                        if (goal) {
                            const path = [{ x: nx, y: ny }];
                            let node = cur;

                            while (node) {
                                path.unshift(node);
                                node = parent.get(`${node.x},${node.y}`);
                            }

                            return { path, cost: path.length, ops: seen.size };
                        }
                    }
                }

                frontier = next;
            }

            return undefined;
        }
    };
}

module.exports = { installPathFinder };
