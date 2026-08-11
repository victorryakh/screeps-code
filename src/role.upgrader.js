const {
    moveCached,
    harvestEnergy,
    findClosestSource,
    upgradeRoomController
} = require('./utilities');

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
        upgradeRoomController(creep, {
            visualizePathStyle: { stroke: '#00ff00' }
        });

        return;
    }

    const source = findClosestSource(creep);

    if (!source) {
        return;
    }

    harvestEnergy(creep, source, {
        visualizePathStyle: { stroke: '#ffaa00' }
    });
}

module.exports = { run };
