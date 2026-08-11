import { ROLE, HOME_PATH_TTL, REPAIR_THRESHOLD } from './constants';
import { EXPANSION } from './strategy';

type MoveDest = RoomPosition | { pos: RoomPosition };

/**
 * Перемещает крипа к указанной точке, используя закэшированный в памяти крипа путь
 * для экономии CPU. При повторных вызовах с тем же назначением и в пределах TTL
 * применяется сохранённый маршрут через `Creep.moveByPath`; при его устаревании,
 * отсутствии или ошибке повторно выполняется полный поиск пути через `Creep.moveTo`.
 *
 * Путь хранится в `creep.memory._move` в формате `{ path, dest: { x, y, roomName }, time }`
 * и считается валидным, пока `Game.time - time < opts.reusePath ?? HOME_PATH_TTL`.
 *
 * @param creep  Крип, который должен переместиться.
 * @param dest   Цель перемещения: `RoomPosition` или любой объект с полем `pos`
 *               (например, `Source`, `Structure`, `Creep`, `ConstructionSite`).
 * @param opts   Дополнительные опции `MoveToOpts`. Поле `reusePath` ограничивает
 *               время жизни кэша; если не задано, используется `HOME_PATH_TTL`.
 * @returns Результат перемещения: `OK`, `ERR_TIRED`, `ERR_INVALID_ARGS`
 *          или код ошибки от `Creep.moveTo` / `Creep.moveByPath`.
 */
export function moveCached(
    creep: Creep,
    dest: MoveDest,
    opts?: MoveToOpts
): ScreepsReturnCode {
    opts = opts ?? {};

    const pos: RoomPosition | undefined = 'pos' in dest ? dest.pos : dest;

    if (!pos || pos.roomName === undefined) {
        return ERR_INVALID_ARGS;
    }

    if (creep.fatigue > 0) {
        return ERR_TIRED;
    }

    const moveMemory = creep.memory._move;

    if (
        moveMemory &&
        moveMemory.path &&
        moveMemory.dest &&
        moveMemory.dest.x === pos.x &&
        moveMemory.dest.y === pos.y &&
        moveMemory.dest.roomName === pos.roomName &&
        Game.time - (moveMemory.time || 0) < (opts.reusePath ?? HOME_PATH_TTL)
    ) {
        const result = creep.moveByPath(moveMemory.path);

        if (result === OK || result === ERR_TIRED) {
            return result;
        }
    }

    if (opts.reusePath === undefined) {
        opts.reusePath = HOME_PATH_TTL;
    }

    return creep.moveTo(dest, opts);
}

export function bodyCost(body: BodyPartConstant[]): number {
    let cost = 0;

    for (const part of body) {
        cost += BODYPART_COST[part];
    }

    return cost;
}

export function bodyFor(role: string): BodyPartConstant[] {
    switch (role) {
        case ROLE.HARVESTER:
            return [WORK, CARRY, MOVE];

        case ROLE.UPGRADER:
            return [WORK, WORK, CARRY, MOVE];

        case ROLE.BUILDER:
            return [WORK, CARRY, CARRY, MOVE, MOVE];

        case ROLE.REPAIRER:
            return [WORK, CARRY, MOVE, MOVE];

        case ROLE.RHARVESTER:
            return EXPANSION.rharvesterBody;

        case ROLE.RESERVER:
            return EXPANSION.reserverBody;

        case ROLE.CLAIMER:
            return EXPANSION.claimerBody;

        default:
            return [WORK, CARRY, MOVE];
    }
}

export function harvestEnergy(
    creep: Creep,
    source: Source | Mineral | Deposit | null | undefined,
    opts?: MoveToOpts
): ScreepsReturnCode {
    if (!source) {
        return ERR_INVALID_TARGET;
    }

    if (creep.harvest(source) === ERR_NOT_IN_RANGE) {
        return moveCached(creep, source, opts);
    }

    return OK;
}

export function findClosestSource(creep: Creep, activeOnly = false): Source | null {
    return creep.pos.findClosestByPath(activeOnly ? FIND_SOURCES_ACTIVE : FIND_SOURCES);
}

export function transferEnergy(
    creep: Creep,
    target: AnyCreep | Structure | null | undefined,
    opts?: MoveToOpts
): ScreepsReturnCode {
    if (!target) {
        return ERR_INVALID_TARGET;
    }

    if (creep.transfer(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
        return moveCached(creep, target, opts);
    }

    return OK;
}

export function findEnergyTransferTarget(
    creep: Creep,
    types: StructureConstant[] = [STRUCTURE_SPAWN, STRUCTURE_EXTENSION]
): Structure | null {
    return creep.pos.findClosestByPath(FIND_STRUCTURES, {
        filter: (s): s is AnyStoreStructure =>
            (types as StructureConstant[]).indexOf(s.structureType) !== -1 &&
            'store' in s &&
            (s as AnyStoreStructure).store.getFreeCapacity(RESOURCE_ENERGY) > 0
    });
}

export function upgradeRoomController(creep: Creep, opts?: MoveToOpts): ScreepsReturnCode {
    const controller = creep.room.controller;

    if (!controller || !controller.my) {
        return ERR_INVALID_TARGET;
    }

    if (creep.upgradeController(controller) === ERR_NOT_IN_RANGE) {
        return moveCached(creep, controller, opts);
    }

    return OK;
}

export function findConstructionSite(
    creep: Creep,
    filter: (s: ConstructionSite) => boolean = (s) => s.progress < s.progressTotal
): ConstructionSite | null {
    return creep.pos.findClosestByPath(FIND_MY_CONSTRUCTION_SITES, {
        filter: filter
    });
}

export function buildAt(
    creep: Creep,
    site: ConstructionSite | null | undefined,
    opts?: MoveToOpts
): ScreepsReturnCode {
    if (!site) {
        return ERR_INVALID_TARGET;
    }

    if (creep.build(site) === ERR_NOT_IN_RANGE) {
        return moveCached(creep, site, opts);
    }

    return OK;
}

export function findRepairTarget(creep: Creep, threshold: number = REPAIR_THRESHOLD): Structure | null {
    return creep.pos.findClosestByPath(FIND_STRUCTURES, {
        filter: (s) => {
            if (s.hitsMax <= 0) {
                return false;
            }

            if (
                s.structureType === STRUCTURE_WALL ||
                s.structureType === STRUCTURE_RAMPART
            ) {
                return false;
            }

            return s.hits < s.hitsMax * threshold;
        }
    });
}

export function repairAt(
    creep: Creep,
    target: Structure | null | undefined,
    opts?: MoveToOpts
): ScreepsReturnCode {
    if (!target) {
        return ERR_INVALID_TARGET;
    }

    if (creep.repair(target) === ERR_NOT_IN_RANGE) {
        return moveCached(creep, target, opts);
    }

    return OK;
}
