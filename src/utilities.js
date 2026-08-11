const { ROLE, EXPANSION, HOME_PATH_TTL, REPAIR_THRESHOLD } = require('./constants');

function moveCached(creep, dest, opts) {
    opts = opts || {};

    const pos = dest.pos || dest;

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
        Game.time - (moveMemory.time || 0) < (opts.reusePath || HOME_PATH_TTL)
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

function bodyCost(body) {
    let cost = 0;

    for (const part of body) {
        cost += BODYPART_COST[part];
    }

    return cost;
}

function bodyFor(role) {
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

function harvestEnergy(creep, source, opts) {
    if (!source) {
        return ERR_INVALID_TARGET;
    }

    if (creep.harvest(source) === ERR_NOT_IN_RANGE) {
        return moveCached(creep, source, opts);
    }

    return OK;
}

function findClosestSource(creep, activeOnly) {
    return creep.pos.findClosestByPath(activeOnly ? FIND_SOURCES_ACTIVE : FIND_SOURCES);
}

function transferEnergy(creep, target, opts) {
    if (!target) {
        return ERR_INVALID_TARGET;
    }

    if (creep.transfer(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
        return moveCached(creep, target, opts);
    }

    return OK;
}

function findEnergyTransferTarget(creep, types) {
    types = types || [STRUCTURE_SPAWN, STRUCTURE_EXTENSION];

    return creep.pos.findClosestByPath(FIND_STRUCTURES, {
        filter: (s) =>
            types.indexOf(s.structureType) !== -1 &&
            s.store.getFreeCapacity(RESOURCE_ENERGY) > 0
    });
}

function upgradeRoomController(creep, opts) {
    const controller = creep.room.controller;

    if (!controller || !controller.my) {
        return ERR_INVALID_TARGET;
    }

    if (creep.upgradeController(controller) === ERR_NOT_IN_RANGE) {
        return moveCached(creep, controller, opts);
    }

    return OK;
}

function findConstructionSite(creep, filter) {
    filter = filter || ((s) => s.progress < s.progressTotal);

    return creep.pos.findClosestByPath(FIND_MY_CONSTRUCTION_SITES, {
        filter: filter
    });
}

function buildAt(creep, site, opts) {
    if (!site) {
        return ERR_INVALID_TARGET;
    }

    if (creep.build(site) === ERR_NOT_IN_RANGE) {
        return moveCached(creep, site, opts);
    }

    return OK;
}

function findRepairTarget(creep, threshold) {
    threshold = (threshold === undefined) ? REPAIR_THRESHOLD : threshold;

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

function repairAt(creep, target, opts) {
    if (!target) {
        return ERR_INVALID_TARGET;
    }

    if (creep.repair(target) === ERR_NOT_IN_RANGE) {
        return moveCached(creep, target, opts);
    }

    return OK;
}

module.exports = {
    moveCached,
    bodyCost,
    bodyFor,
    harvestEnergy,
    findClosestSource,
    transferEnergy,
    findEnergyTransferTarget,
    upgradeRoomController,
    findConstructionSite,
    buildAt,
    findRepairTarget,
    repairAt
};
