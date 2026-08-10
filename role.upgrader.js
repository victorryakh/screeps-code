const { moveCached } = require('../utilities');

function run(creep) {
    if (typeof creep.memory.upgrading !== 'boolean') {
        creep.memory.upgrading = false;
    }

    const energy = creep.store[RESOURCE_ENERGY];
    const freeCapacity = creep.store.getFreeCapacity(RESOURCE_ENERGY);
    const controller = creep.room.controller;

    if (
        creep.memory.upgrading &&
        (energy === 0 || !controller || !controller.my)
    ) {
        creep.memory.upgrading = false;
    }

    if (
        !creep.memory.upgrading &&
        freeCapacity === 0 &&
        controller &&
        controller.my
    ) {
        creep.memory.upgrading = true;
    }

    if (creep.memory.upgrading) {
        if (creep.upgradeController(controller) === ERR_NOT_IN_RANGE) {
            moveCached(creep, controller, {
                visualizePathStyle: { stroke: '#00ff00' }
            });
        }

        return;
    }

    const source = creep.pos.findClosestByPath(FIND_SOURCES);

    if (!source) {
        return;
    }

    if (creep.harvest(source) === ERR_NOT_IN_RANGE) {
        moveCached(creep, source, {
            visualizePathStyle: { stroke: '#ffaa00' }
        });
    }
}

module.exports = { run };
