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

/** Возвращает `RoomPosition`, разворачивая объекты с `.pos` (Source, Structure и т.п.). */
function unwrap(pos: PositionLike): RoomPosition {
    return 'pos' in pos ? pos.pos : pos;
}

/* ---------- Инициализация и тик-учёт ------------------------------------- */

/**
 * Инициализирует глобальную структуру `Memory.metrics` и слоты
 * `room.memory.metrics` для всех owned-комнат. Вызывается из {@link loop}
 * в начале каждого тика.
 *
 * @remarks
 * При `Memory.debug === true` дополнительно обновляет `lastRcl` в каждой
 * комнате (стоит считать дорогим — лишняя запись в память).
 * Также инициализирует `Memory._notified`, если оно не определено (для
 * дедупликации `Game.notify` в {@link log}).
 */
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

/**
 * Запоминает `Game.cpu.getUsed()` на старте тика. Парный вызов —
 * {@link tickEnd}, вычисляющий дельту. Значение хранится в `global`, а не в
 * `Memory`, чтобы не раздувать персистируемый JSON каждый тик.
 */
export function tickStart(): void {
    if (typeof Game.cpu !== 'undefined' && typeof Game.cpu.getUsed === 'function') {
        (global as { _tickStartCpu?: number })._tickStartCpu = Game.cpu.getUsed();
    }
}

/**
 * Завершает тик учёта: инкрементирует `Memory.metrics.ticks`, вычисляет
 * `lastTickCpu` (дельта от `tickStart` или абсолютное значение, если
 * `tickStart` не вызывался) и сохраняет `lastBucket`.
 */
export function tickEnd(): void {
    if (!Memory.metrics) {
        return;
    }

    Memory.metrics.ticks = (Memory.metrics.ticks || 0) + 1;

    if (typeof Game.cpu !== 'undefined') {
        const startCpu = (global as { _tickStartCpu?: number })._tickStartCpu;
        if (startCpu !== undefined) {
            Memory.metrics.lastTickCpu = Game.cpu.getUsed() - startCpu;
        } else {
            Memory.metrics.lastTickCpu = Game.cpu.getUsed();
        }

        if (typeof Game.cpu.bucket === 'number') {
            Memory.metrics.lastBucket = Game.cpu.bucket;
        }
    }
}

/* ---------- Счётчики событий --------------------------------------------- */

/**
 * Учитывает спавн крипа: инкрементирует `spawnsByRole[role]` и добавляет
 * `cost` в `totalSpawnEnergy`. Вызывается из `spawn.ts` (подключение —
 * следующий шаг, см. STRATEGY.md).
 *
 * @param role       Имя роли крипа.
 * @param cost       Полная стоимость тела в энергии.
 * @param _bodyParts Число частей тела (зарезервировано для будущих метрик,
 *                   сейчас игнорируется).
 */
export function recordSpawn(role: string, cost: number, _bodyParts: number): void {
    if (!Memory.metrics) {
        return;
    }

    const m = Memory.metrics;
    m.spawnsByRole[role] = (m.spawnsByRole[role] || 0) + 1;
    m.totalSpawnEnergy = (m.totalSpawnEnergy || 0) + cost;
}

/**
 * Учитывает смерть крипа: инкрементирует `deathsByRole[role]`.
 *
 * @param role     Имя роли умершего крипа.
 * @param ageTicks Возраст крипа в тиках. Зарезервировано для подробной
 *                 статистики при `Memory.debug === true`; в текущей
 *                 реализации явно игнорируется через `void` (подавление
 *                 предупреждения о неиспользуемом параметре).
 */
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

/**
 * Результат оценки экономики одного рейса крипа между двумя точками.
 * Используется для анализа эффективности маршрутов и подбора ролей.
 */
export interface TripEconomics {
    /** Длина пути в клетках (из кэша `moveCached` или `PathFinder.search`). */
    distance: number;
    /** Оценка длительности в один конец (в тиках), равна `distance`. */
    oneWayTicks: number;
    /** Оценка полного рейса туда-обратно: `oneWayTicks * 2 + 2`. */
    roundTripTicks: number;
    /** Грузоподъёмность крипа: `CARRY-частей * CARRY_CAPACITY`. */
    carryCapacity: number;
    /** Средняя эффективность: `carryCapacity / roundTripTicks`. */
    energyPerTick: number;
    /** TTL кэша пути для этого рейса (наследует `HOME_PATH_TTL`). */
    pathTtl?: number;
}

/**
 * Возвращает длину пути из `creep.memory._move`, если кэш валиден
 * (назначение и время совпадают). Возвращает `null`, если кэша нет
 * или он устарел.
 */
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

/** Считает количество живых `CARRY`-частей тела крипа. */
function carryParts(creep: Creep): number {
    let n = 0;

    for (const part of creep.body) {
        if (part.type === CARRY && part.hits > 0) {
            n++;
        }
    }

    return n;
}

/**
 * Оценивает экономику рейса крипа между `from` и `to`: считает длину пути
 * (из кэша `moveCached` или `PathFinder.search({plainCost:1, swampCost:5})`),
 * производную длительность и эффективность по грузоподъёмности.
 *
 * @param creep Крип, для которого оценивается рейс.
 * @param from  Стартовая позиция или объект с полем `pos`.
 * @param to    Конечная позиция или объект с полем `pos`.
 * @returns Объект {@link TripEconomics} с дистанцией, временем и эффективностью.
 *
 * @remarks
 * Побочный эффект: при `Memory.debug === true` пушит сэмпл в
 * `creep.room.memory.metrics.tripSamples` (кольцевой буфер на 20 записей).
 */
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

/**
 * Возвращает длину пути между двумя позициями через `PathFinder.search`
 * (без аллокации массива). Если поиск не завершён, возвращает чебышёва
 * расстояние как оценку.
 *
 * @param fromPos Начало маршрута.
 * @param toPos   Конец маршрута.
 * @param _opts   Зарезервировано для будущего кэширования (сейчас
 *                игнорируется).
 */
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

/**
 * Сохраняет снимок состава ролей комнаты в `room.memory.metrics.lastRoleCounts`.
 * Безопасно вызывать для комнат без инициализированных метрик (no-op).
 *
 * @param roomName Имя комнаты.
 * @param counts   Соответствие `роль → количество`.
 */
export function recordRoomCounts(roomName: string, counts: Record<string, number>): void {
    const r = Game.rooms[roomName];

    if (!r || !r.memory || !r.memory.metrics) {
        return;
    }

    r.memory.metrics.lastRoleCounts = counts;
}

/* ---------- Дамп для ручного вызова ------------------------------------- */

/**
 * Собирает плоский дамп глобальных и per-room метрик. Удобно вызывать
 * вручную через `console.log(JSON.stringify(metrics.summarize()))`.
 *
 * @returns Объект с `metrics` (глобальные счётчики) и `rooms` (RCL,
 *          `lastRoleCounts`, число сэмплов для каждой owned-комнаты).
 */
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
