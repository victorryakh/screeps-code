import {
    ROLE,
    DOWNGRADE_BUFFER_TICKS,
    EXITS_CACHE_TTL,
    EXTENSION_PLAN_RADIUS,
    EXTENSION_CHECK_INTERVAL,
    WALL_TERRAIN
} from './constants';
import type { RoleKey } from './constants';

/* ============================================================================
 * Стратегическое управление.
 *
 * Этот модуль содержит все стратегические решения бота:
 *   1) целевой состав крипов в зависимости от RCL;
 *   2) порядок спавна и приоритеты ролей;
 *   3) политика обороны башнями;
 *   4) политика планирования базы (extensions, future: roads/ramparts);
 *   5) фазы экспансии и условия их перехода;
 *   6) выбор «домашней» комнаты и соседней целевой.
 *
 * Модуль намеренно чист от деталей исполнения (spawning, pathing, towers
 * напрямую не вызываются) — он только возвращает решения, которые
 * исполняются в room.ts и expansion.ts.
 * ==========================================================================*/

/* ---------- Стадии развития базы ---------------------------------------- */

/** Высокоуровневая стадия развития базы (используется стратегическим слоем). */
export type BaseStage =
    | 'bootstrap'
    | 'expansion-capable'
    | 'remote-harvest';

/**
 * Возвращает стадию развития базы по RCL комнаты и GCL аккаунта.
 * `bootstrap` — до RCL 3 или GCL 2; `expansion-capable` — начиная с RCL 3
 * и GCL 2. Стадия `remote-harvest` зарезервирована для будущего использования.
 */
export function getBaseStage(room: Room, gclLevel: number | undefined): BaseStage {
    const rcl = room.controller?.level ?? 0;

    if (rcl < 3 || !gclLevel || gclLevel < 2) {
        return 'bootstrap';
    }

    return 'expansion-capable';
}

/* ---------- Целевой состав крипов по RCL --------------------------------- */

/** Целевое количество каждой «домашней» роли крипов в зависимости от RCL. */
export interface RoomTargets {
    upgrader: number;
    harvester: number;
    builder: number;
    repairer: number;
}

/**
 * Таблица целевого состава крипов для RCL 1–5. Ключ — RCL, значение —
 * {@link RoomTargets}. Используется {@link getRoomTargets}.
 */
export const TARGETS: Record<number, RoomTargets> = {
    1: { upgrader: 2, harvester: 2, builder: 1, repairer: 0 },
    2: { upgrader: 2, harvester: 2, builder: 2, repairer: 0 },
    3: { upgrader: 3, harvester: 3, builder: 2, repairer: 1 },
    4: { upgrader: 3, harvester: 3, builder: 2, repairer: 1 },
    5: { upgrader: 4, harvester: 3, builder: 2, repairer: 1 }
};

/**
 * Возвращает целевой состав крипов для указанного RCL. Для RCL > 5
 * возвращается запись для RCL 5; для невалидного RCL — безопасный нулевой
 * объект.
 */
export function getRoomTargets(rcl: number): RoomTargets {
    return TARGETS[rcl] || TARGETS[5] || { upgrader: 0, harvester: 0, builder: 0, repairer: 0 };
}

/* ---------- Порядок спавна ----------------------------------------------- */

/**
 * Возвращает упорядоченный список решений «какую роль дозаказать».
 * Первый элемент списка — самый приоритетный.
 * Список обрезается так, чтобы в одном тике был заказан максимум один крип.
 */
export function planSpawnOrder(
    room: Room,
    counts: Record<string, number>
): [RoleKey, number][] {
    const rcl = room.controller?.level ?? 0;
    const targets = getRoomTargets(rcl);

    const canUpgrade = room.controller
        ? room.controller.ticksToDowngrade > DOWNGRADE_BUFFER_TICKS
        : true;

    const upgraderTarget = canUpgrade
        ? targets.upgrader
        : Math.min(counts[ROLE.UPGRADER] || 0, 1);

    // Когда downgrade-буфер исчерпан, приоритет «сначала upgrader»
    // контр-продуктивен: без harvesters энергии в spawn/extensions нет,
    // upgrader простаивает, контроллер продолжает голодать. В этом
    // состоянии временно поднимаем harvester на первое место — пока не
    // появится хотя бы один. Как только harvester >= 1, возвращаемся
    // к обычному порядку (upgrader → harvester → ...).
    const harvesterCount = counts[ROLE.HARVESTER] || 0;
    const needsHarvesterFirst = !canUpgrade && harvesterCount < 1;

    if (needsHarvesterFirst) {
        return [
            [ROLE.HARVESTER, targets.harvester],
            [ROLE.UPGRADER, upgraderTarget],
            [ROLE.BUILDER, targets.builder],
            [ROLE.REPAIRER, targets.repairer]
        ];
    }

    return [
        [ROLE.UPGRADER, upgraderTarget],
        [ROLE.HARVESTER, targets.harvester],
        [ROLE.BUILDER, targets.builder],
        [ROLE.REPAIRER, targets.repairer]
    ];
}

/* ---------- Политика обороны -------------------------------------------- */

/** Решение по включению оборонительной логики для комнаты. */
export interface DefenseDecision {
    /** Включать ли оборонительный проход (башни). */
    enabled: boolean;
    /** Атаковать ли враждебных крипов. */
    attackHostiles: boolean;
    /** Лечить ли раненых своих крипов. */
    healInjured: boolean;
}

/**
 * Чистая функция: возвращает политику обороны для комнаты. Активна с RCL 3
 * (башни появляются с RCL 3). Не имеет побочных эффектов.
 */
export function planDefense(room: Room): DefenseDecision {
    const rcl = room.controller?.level ?? 0;

    if (rcl < 3) {
        return { enabled: false, attackHostiles: false, healInjured: false };
    }

    return {
        enabled: true,
        attackHostiles: true,
        healInjured: true
    };
}

/* ---------- Планировка базы --------------------------------------------- */

/** Решение по автоматической планировке базы (на данный момент — extensions). */
export interface BaseLayoutDecision {
    /** Включён ли планировщик (активно с RCL 2). */
    enabled: boolean;
    /** Максимальное число extensions, доступное при текущем RCL. */
    maxExtensions: number;
    /** Радиус поиска места под extension (от центра спавна). */
    planRadius: number;
    /** Интервал между полными проходами планировщика (в тиках). */
    checkInterval: number;
    /** Битовая маска «непроходимой» клетки для фильтрации мест. */
    wallTerrain: TERRAIN_MASK_WALL;
}

/**
 * Чистая функция: возвращает параметры планировки базы. Включается с RCL 2;
 * максимальное количество extensions берётся из `CONTROLLER_STRUCTURES`.
 * Не имеет побочных эффектов.
 */
export function planBaseLayout(room: Room): BaseLayoutDecision {
    const rcl = room.controller?.level ?? 0;

    if (rcl < 2 || !room.controller) {
        return {
            enabled: false,
            maxExtensions: 0,
            planRadius: EXTENSION_PLAN_RADIUS,
            checkInterval: EXTENSION_CHECK_INTERVAL,
            wallTerrain: WALL_TERRAIN
        };
    }

    const maxExtensions = CONTROLLER_STRUCTURES[STRUCTURE_EXTENSION][rcl] ?? 0;

    return {
        enabled: true,
        maxExtensions,
        planRadius: EXTENSION_PLAN_RADIUS,
        checkInterval: EXTENSION_CHECK_INTERVAL,
        wallTerrain: WALL_TERRAIN
    };
}

/* ---------- Конфигурация экспансии -------------------------------------- */

/**
 * Конфигурация экспансии: тела крипов трёх удалённых ролей, целевое
 * количество, предпочтительная целевая комната и блеклист.
 *
 * @remarks
 * Хранится как литерал `as-`-типизированный объект (без `as const`), чтобы
 * поля-массивы остались совместимы с `BodyPartConstant[]` без сужения.
 * `preferredTarget` и `blacklist` хардкоднуты под конкретный шард
 * (`E54`/`E55`) — при переносе их нужно обновить.
 */
export const EXPANSION = {
    reserverBody: [CLAIM, CLAIM, MOVE, MOVE] as BodyPartConstant[],
    claimerBody: [CLAIM, MOVE, MOVE, MOVE] as BodyPartConstant[],
    rharvesterBody: [WORK, WORK, CARRY, MOVE, MOVE] as BodyPartConstant[],
    reserverCount: 1,
    claimerCount: 1,
    rharvesterCount: 2,
    // Поля `preferredTarget` и `blacklist` перенесены в `Memory.expansionPreferredTarget` /
    // `Memory.expansionBlacklist`, чтобы не хардкодить сектор. Пример для текущей
    // home (E53N34) — нейтральные комнаты `E53N33` (не в чёрном списке) и
    // `E54N33` (тоже не в чёрном списке) подходят как цели экспансии.
    preferredTarget: undefined as string | undefined,
    blacklist: [] as string[]
};

/**
 * Список ролей, для которых при спавне требуется `Memory.targetRoom`.
 * Используется в `spawn.trySpawn` для автоподстановки `targetRoom` в память.
 */
export const REMOTE_ROLES: RoleKey[] = [
    ROLE.RHARVESTER,
    ROLE.RESERVER,
    ROLE.CLAIMER
];

/* ---------- Фазы экспансии ---------------------------------------------- */

/** Текущая фаза экспансии. */
export type ExpansionPhase = 'idle' | 'reserve' | 'claim' | 'harvest';

/** Решение по следующему шагу экспансии для исполнительного слоя. */
export interface ExpansionDecision {
    /** Выполнять ли действие в текущем тике. */
    enabled: boolean;
    /** Фаза экспансии (`idle`/`reserve`/`claim`/`harvest`). */
    phase: ExpansionPhase;
    /** Имя «домашней» комнаты, из которой спавним крип. */
    homeRoom: string | null;
    /** Имя выбранной целевой комнаты. */
    targetRoom: string | null;
    /** Роль, которую нужно доспавнить (или `null`, если пока не нужно). */
    desiredRole: RoleKey | null;
}

/**
 * Возвращает `true`, если выполнены все «гейты» для экспансии: есть owned
 * домашняя комната, RCL ≥ 3 и GCL ≥ 2.
 */
export function getExpansionGates(home: Room, gclLevel: number | undefined): boolean {
    if (!home.controller || !home.controller.my) {
        return false;
    }

    if (home.controller.level < 3) {
        return false;
    }

    if (!gclLevel || gclLevel < 2) {
        return false;
    }

    return true;
}

/**
 * Чистая функция: выбирает фазу и желаемую роль для экспансии на основе
 * текущего состояния комнаты-цели и количества уже занятых на ней крипов.
 *
 * Ход решения:
 * 1. Если целевая комната уже принадлежит нам — фаза `harvest`, дозаказываем
 *    `rharvester` до `EXPANSION.rharvesterCount`.
 * 2. Иначе сначала `reserver` до `EXPANSION.reserverCount`.
 * 3. Затем `claimer` до `EXPANSION.claimerCount`.
 * 4. Когда запасы удовлетворены — `enabled: false`.
 */
export function planExpansion(
    home: Room | null,
    targetRoom: string | null,
    targetRoomObject: Room | undefined,
    rharvesterCount: number,
    reserverCount: number,
    claimerCount: number
): ExpansionDecision {
    const base: ExpansionDecision = {
        enabled: false,
        phase: 'idle',
        homeRoom: home ? home.name : null,
        targetRoom,
        desiredRole: null
    };

    if (!home || !targetRoom) {
        return base;
    }

    if (
        targetRoomObject &&
        targetRoomObject.controller &&
        targetRoomObject.controller.my
    ) {
        if (rharvesterCount < EXPANSION.rharvesterCount) {
            return {
                enabled: true,
                phase: 'harvest',
                homeRoom: home.name,
                targetRoom,
                desiredRole: ROLE.RHARVESTER
            };
        }

        return {
            enabled: false,
            phase: 'harvest',
            homeRoom: home.name,
            targetRoom,
            desiredRole: null
        };
    }

    if (reserverCount < EXPANSION.reserverCount) {
        return {
            enabled: true,
            phase: 'reserve',
            homeRoom: home.name,
            targetRoom,
            desiredRole: ROLE.RESERVER
        };
    }

    if (claimerCount < EXPANSION.claimerCount) {
        return {
            enabled: true,
            phase: 'claim',
            homeRoom: home.name,
            targetRoom,
            desiredRole: ROLE.CLAIMER
        };
    }

    return base;
}

/* ---------- Выбор «домашней» комнаты ----------------------------------- */

/**
 * Выбирает «домашнюю» комнату для экспансии: owned-комнату с наибольшим RCL,
 * при равенстве — с максимальным `energyCapacityAvailable`.
 *
 * @param rooms Словарь `имя → Room` (обычно `Game.rooms`).
 * @returns Лучшую owned-комнату или `null`, если owned-комнат нет.
 */
export function findHomeRoom(rooms: Record<string, Room>): Room | null {
    let bestRoom: Room | null = null;

    for (const roomName in rooms) {
        const room = rooms[roomName];
        if (!room || !room.controller || !room.controller.my) {
            continue;
        }

        if (!bestRoom || !bestRoom.controller) {
            bestRoom = room;
            continue;
        }

        if (room.controller.level > bestRoom.controller.level) {
            bestRoom = room;
            continue;
        }

        if (
            room.controller.level === bestRoom.controller.level &&
            room.energyCapacityAvailable > bestRoom.energyCapacityAvailable
        ) {
            bestRoom = room;
        }
    }

    return bestRoom;
}

/* ---------- Выбор целевой соседней комнаты ------------------------------ */

/**
 * Выбирает соседнюю комнату для экспансии. Приоритеты:
 * 1. `preferred`, если он есть среди соседей, не в блеклисте и имеет
 *    нормальный статус.
 * 2. Иначе первый сосед (в алфавитном порядке направлений выходов),
 *    не в бтеклисте, отличающийся от `previousTarget` и находящийся
 *    в том же shard-е, что и `homeName`, со статусом `'normal'`.
 *
 * @param homeName       Имя домашней комнаты.
 * @param exitsCache     Кэш `Game.map.describeExits` (TTL — `EXITS_CACHE_TTL`).
 *                       Функция обновляет кэш по необходимости.
 * @param blacklist      Список комнат, которые нельзя выбирать.
 * @param preferred      Предпочтительная цель (или `undefined`).
 * @param previousTarget Прошлая цель (исключается из перебора, чтобы не
 *                       зацикливаться).
 * @returns Имя выбранной комнаты или `null`, если подходящей нет.
 */
export function pickExpansionTarget(
    homeName: string,
    exitsCache: NonNullable<Memory['_exitsCache']>,
    blacklist: string[],
    preferred: string | undefined,
    previousTarget: string | undefined
): string | null {
    let cached = exitsCache[homeName];

    if (!cached || Game.time - cached.tick > EXITS_CACHE_TTL) {
        const exits = Game.map.describeExits(homeName) || {};

        cached = {
            tick: Game.time,
            exits: exits
        };

        exitsCache[homeName] = cached;
    }

    const exits = cached.exits;
    const neighbourRooms: string[] = [];

    for (const dir in exits) {
        const neighbour = exits[dir as ExitKey];
        if (neighbour) {
            neighbourRooms.push(neighbour);
        }
    }

    if (
        preferred &&
        neighbourRooms.indexOf(preferred) !== -1 &&
        blacklist.indexOf(preferred) === -1
    ) {
        const status = Game.map.getRoomStatus(preferred);

        if (isNormalRoomStatus(status)) {
            if (Memory.debug) {
                console.log(`[strategy] preferred target selected: ${preferred}`);
            }

            return preferred;
        }
    }

    const directions = Object.keys(exits).sort() as ExitKey[];

    for (const dir of directions) {
        const neighbourName = exits[dir];

        if (!neighbourName) {
            continue;
        }

        if (blacklist.indexOf(neighbourName) !== -1) {
            continue;
        }

        if (previousTarget && neighbourName === previousTarget) {
            continue;
        }

        const homeShardPrefix = homeName.indexOf('-') !== -1
            ? homeName.split('-')[0]
            : '';

        const neighbourShardPrefix = neighbourName.indexOf('-') !== -1
            ? neighbourName.split('-')[0]
            : '';

        if (homeShardPrefix !== neighbourShardPrefix) {
            continue;
        }

        const status = Game.map.getRoomStatus(neighbourName);

        if (isNormalRoomStatus(status)) {
            if (Memory.debug) {
                console.log(`[strategy] picked target ${neighbourName} from ${homeName}`);
            }

            return neighbourName;
        }
    }

    return null;
}

/** Проверяет, что статус комнаты — `'normal'` (не SK и не unavailable). */
function isNormalRoomStatus(status: RoomStatus): boolean {
    return status.status === 'normal';
}

/* ---------- Подсчёт крипов по роли для экспансии ------------------------ */

/**
 * Считает количество крипов каждой удалённой роли, привязанных к
 * `targetRoom` (по `creep.memory.targetRoom`).
 *
 * @param targetRoom Имя целевой комнаты экспансии.
 * @returns Объект с числом `rharvester`/`reserver`/`claimer`.
 */
export function countExpansionCreeps(targetRoom: string): {
    rharvester: number;
    reserver: number;
    claimer: number;
} {
    let rharvester = 0;
    let reserver = 0;
    let claimer = 0;

    for (const name in Game.creeps) {
        const creep = Game.creeps[name];

        if (!creep) {
            continue;
        }

        if (
            creep.memory.role === ROLE.RHARVESTER &&
            creep.memory.targetRoom === targetRoom
        ) {
            rharvester++;
            continue;
        }

        if (creep.memory.targetRoom !== targetRoom) {
            continue;
        }

        if (creep.memory.role === ROLE.RESERVER) {
            reserver++;
        }

        if (creep.memory.role === ROLE.CLAIMER) {
            claimer++;
        }
    }

    return { rharvester, reserver, claimer };
}
