const { ROLE, EXPANSION, HOME_PATH_TTL } = require('./constants');

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

module.exports = {
    moveCached,
    bodyCost,
    bodyFor
};
