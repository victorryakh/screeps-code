const { moveCached } = require('./utilities');
const { REMOTE_PATH_TTL } = require('./constants');

function run(creep) {
    if (!creep.memory.targetRoom) {
        return;
    }

    if (creep.room.name !== creep.memory.targetRoom) {
        moveCached(
            creep,
            new RoomPosition(25, 25, creep.memory.targetRoom),
            { reusePath: REMOTE_PATH_TTL }
        );
        return;
    }

    const controller = creep.room.controller;

    if (!controller) {
        return;
    }

    const result = creep.claimController(controller);

    if (result === ERR_NOT_IN_RANGE) {
        moveCached(creep, controller, { reusePath: REMOTE_PATH_TTL });
        return;
    }

    if (result === OK && controller.my) {
        if (Memory.debug) {
            console.log(`[claim] claimed ${controller.room.name}, suiciding claimer`);
        }

        creep.suicide();
    }
}

module.exports = { run };
