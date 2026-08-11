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

export type BaseStage =
    | 'bootstrap'
    | 'expansion-capable'
    | 'remote-harvest';

export function getBaseStage(room: Room, gclLevel: number | undefined): BaseStage {
    const rcl = room.controller?.level ?? 0;

    if (rcl < 3 || !gclLevel || gclLevel < 2) {
        return 'bootstrap';
    }

    return 'expansion-capable';
}

/* ---------- Целевой состав крипов по RCL --------------------------------- */

export interface RoomTargets {
    upgrader: number;
    harvester: number;
    builder: number;
    repairer: number;
}

export const TARGETS: Record<number, RoomTargets> = {
    1: { upgrader: 2, harvester: 2, builder: 1, repairer: 0 },
    2: { upgrader: 2, harvester: 2, builder: 2, repairer: 0 },
    3: { upgrader: 3, harvester: 3, builder: 2, repairer: 1 },
    4: { upgrader: 3, harvester: 3, builder: 2, repairer: 1 },
    5: { upgrader: 4, harvester: 3, builder: 2, repairer: 1 }
};

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

    return [
        [ROLE.UPGRADER, upgraderTarget],
        [ROLE.HARVESTER, targets.harvester],
        [ROLE.BUILDER, targets.builder],
        [ROLE.REPAIRER, targets.repairer]
    ];
}

/* ---------- Политика обороны -------------------------------------------- */

export interface DefenseDecision {
    enabled: boolean;
    attackHostiles: boolean;
    healInjured: boolean;
}

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

export interface BaseLayoutDecision {
    enabled: boolean;
    maxExtensions: number;
    planRadius: number;
    checkInterval: number;
    wallTerrain: TERRAIN_MASK_WALL;
}

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

export const EXPANSION = {
    reserverBody: [CLAIM, CLAIM, MOVE, MOVE] as BodyPartConstant[],
    claimerBody: [CLAIM, MOVE, MOVE, MOVE] as BodyPartConstant[],
    rharvesterBody: [WORK, WORK, CARRY, MOVE, MOVE] as BodyPartConstant[],
    reserverCount: 1,
    claimerCount: 1,
    rharvesterCount: 2,
    preferredTarget: 'E55N31',
    blacklist: ['E54N32', 'E54N30']
};

export const REMOTE_ROLES: RoleKey[] = [
    ROLE.RHARVESTER,
    ROLE.RESERVER,
    ROLE.CLAIMER
];

/* ---------- Фазы экспансии ---------------------------------------------- */

export type ExpansionPhase = 'idle' | 'reserve' | 'claim' | 'harvest';

export interface ExpansionDecision {
    enabled: boolean;
    phase: ExpansionPhase;
    homeRoom: string | null;
    targetRoom: string | null;
    desiredRole: RoleKey | null;
}

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

function isNormalRoomStatus(status: RoomStatus): boolean {
    return status.status === 'normal';
}

/* ---------- Подсчёт крипов по роли для экспансии ------------------------ */

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
