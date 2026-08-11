/* ============================================================================
 * Метрики: расстояния, длительности, экономика крипов.
 *
 * Хранение:
 *   - Memory.metrics              — глобальные счётчики (тики, CPU, спавны,
 *                                  смерти, общий расход энергии на спавн).
 *   - Memory.rooms[name].metrics  — per-room метрики (сэмплы tripEconomics,
 *                                  последние roleCounts и RCL).
 *
 * Активность:
 *   - init()                       — вызывается из main.ts в начале каждого тика.
 *   - tickStart() / tickEnd()      — считают длительность тика и bucket.
 *   - recordSpawn() / recordCreepDeath() — обновляют глобальные счётчики.
 *   - tripEconomics() / pathLengthCached() — расчётные помощники. Запись
 *     trip-сэмплов в room.memory.metrics — только при Memory.debug === true.
 *
 * Цена CPU в дефолте (Memory.debug === false):
 *   - init() и tickStart/tickEnd пишут по 3-5 полей в Memory, O(rooms).
 *   - tripEconomics() считает в чистой памяти (без PathFinder.search, если
 *     есть кэшированный путь в creep.memory._move).
 * ==========================================================================*/

import { HOME_PATH_TTL } from './constants';

const TRIP_SAMPLES_LIMIT = 20;

type PositionLike = RoomPosition | { pos: RoomPosition };

function unwrap(pos: PositionLike): RoomPosition {
    return 'pos' in pos ? pos.pos : pos;
}

/* ---------- Инициализация и тик-учёт ------------------------------------- */

export function init(): void {
    if (!Memory.metrics) {
        Memory.metrics = {
            ticks: 0,
            lastTickCpu: 0,
            lastBucket: 0,
            spawnsByRole: {},
            deathsByRole: {},
            totalSpawnEnergy: 0
        };
    }

    if (Memory._notified === undefined) {
        Memory._notified = {};
    }

    for (const roomName in Game.rooms) {
        const r = Game.rooms[roomName];

        if (!r || !r.controller || !r.controller.my) {
            continue;
        }

        if (!r.memory.metrics) {
            r.memory.metrics = {
                tripSamples: [],
                lastRoleCounts: {},
                lastRcl: 0
            };
        }

        if (Memory.debug) {
            r.memory.metrics.lastRcl = r.controller.level;
        }
    }
}

export function tickStart(): void {
    if (typeof Game.cpu !== 'undefined' && typeof Game.cpu.getUsed === 'function') {
        Memory._tickStartCpu = Game.cpu.getUsed();
    }
}

export function tickEnd(): void {
    if (!Memory.metrics) {
        return;
    }

    Memory.metrics.ticks = (Memory.metrics.ticks || 0) + 1;

    if (typeof Game.cpu !== 'undefined') {
        if (Memory._tickStartCpu !== undefined) {
            Memory.metrics.lastTickCpu = Game.cpu.getUsed() - Memory._tickStartCpu;
        } else {
            Memory.metrics.lastTickCpu = Game.cpu.getUsed();
        }

        if (typeof Game.cpu.bucket === 'number') {
            Memory.metrics.lastBucket = Game.cpu.bucket;
        }
    }
}

/* ---------- Счётчики событий --------------------------------------------- */

export function recordSpawn(role: string, cost: number, _bodyParts: number): void {
    if (!Memory.metrics) {
        return;
    }

    const m = Memory.metrics;
    m.spawnsByRole[role] = (m.spawnsByRole[role] || 0) + 1;
    m.totalSpawnEnergy = (m.totalSpawnEnergy || 0) + cost;
}

export function recordCreepDeath(role: string, ageTicks: number): void {
    if (!Memory.metrics) {
        return;
    }

    const m = Memory.metrics;

    if (!m.deathsByRole[role]) {
        m.deathsByRole[role] = 0;
    }

    m.deathsByRole[role]++;

    if (Memory.debug && role) {
        void ageTicks;
    }
}

/* ---------- Экономика пути и рейсов ------------------------------------- */

export interface TripEconomics {
    distance: number;
    oneWayTicks: number;
    roundTripTicks: number;
    carryCapacity: number;
    energyPerTick: number;
    pathTtl?: number;
}

function cachedPathDistance(
    creep: Creep,
    dest: RoomPosition
): number | null {
    const move = creep.memory._move;

    if (!move || !move.path || !move.dest) {
        return null;
    }

    if (
        move.dest.x !== dest.x ||
        move.dest.y !== dest.y ||
        move.dest.roomName !== dest.roomName
    ) {
        return null;
    }

    if (Game.time - (move.time || 0) >= HOME_PATH_TTL) {
        return null;
    }

    return move.path.length;
}

function carryParts(creep: Creep): number {
    let n = 0;

    for (const part of creep.body) {
        if (part.type === CARRY && part.hits > 0) {
            n++;
        }
    }

    return n;
}

export function tripEconomics(
    creep: Creep,
    from: PositionLike,
    to: PositionLike
): TripEconomics {
    const fromPos = unwrap(from);
    const toPos = unwrap(to);

    let distance: number;

    const cached = cachedPathDistance(creep, toPos);

    if (cached !== null) {
        distance = cached;
    } else {
        const search = PathFinder.search(
            fromPos,
            { pos: toPos, range: 1 },
            { plainCost: 1, swampCost: 5, maxOps: 2000 }
        );

        if (search.incomplete || !search.path) {
            const dx = Math.abs(fromPos.x - toPos.x);
            const dy = Math.abs(fromPos.y - toPos.y);

            distance = Math.max(dx, dy);
        } else {
            distance = search.path.length;
        }
    }

    const oneWayTicks = distance;
    const roundTripTicks = oneWayTicks * 2 + 2;

    const carryPartsCount = carryParts(creep);
    const carryCapacity = carryPartsCount * (CARRY_CAPACITY || 50);

    const energyPerTick = roundTripTicks > 0 ? carryCapacity / roundTripTicks : 0;

    if (Memory.debug && creep.room && creep.room.memory && creep.room.memory.metrics) {
        const samples = creep.room.memory.metrics.tripSamples;

        samples.push({
            ts: Game.time,
            role: creep.memory.role || 'unknown',
            distance: distance,
            roundTripTicks: roundTripTicks,
            energyPerTick: energyPerTick
        });

        while (samples.length > TRIP_SAMPLES_LIMIT) {
            samples.shift();
        }
    }

    return {
        distance: distance,
        oneWayTicks: oneWayTicks,
        roundTripTicks: roundTripTicks,
        carryCapacity: carryCapacity,
        energyPerTick: energyPerTick,
        pathTtl: HOME_PATH_TTL
    };
}

export function pathLengthCached(
    fromPos: RoomPosition,
    toPos: RoomPosition,
    _opts?: { reusePath?: number }
): number {
    const search = PathFinder.search(
        fromPos,
        { pos: toPos, range: 1 },
        { plainCost: 1, swampCost: 5, maxOps: 2000 }
    );

    if (search.incomplete || !search.path) {
        return Math.max(
            Math.abs(fromPos.x - toPos.x),
            Math.abs(fromPos.y - toPos.y)
        );
    }

    return search.path.length;
}

/* ---------- Подсчёт состава ролей в комнате ----------------------------- */

export function recordRoomCounts(roomName: string, counts: Record<string, number>): void {
    const r = Game.rooms[roomName];

    if (!r || !r.memory || !r.memory.metrics) {
        return;
    }

    r.memory.metrics.lastRoleCounts = counts;
}

/* ---------- Дамп для ручного вызова ------------------------------------- */

export function summarize(): Record<string, unknown> {
    const rooms: Record<string, unknown> = {};

    for (const roomName in Game.rooms) {
        const r = Game.rooms[roomName];

        if (!r || !r.memory || !r.memory.metrics) {
            continue;
        }

        rooms[roomName] = {
            rcl: r.controller?.level ?? 0,
            lastRoleCounts: r.memory.metrics.lastRoleCounts,
            tripSamples: r.memory.metrics.tripSamples.length
        };
    }

    return {
        metrics: Memory.metrics,
        rooms: rooms
    };
}
