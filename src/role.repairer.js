const {
    harvestEnergy,
    findClosestSource,
    findRepairTarget,
    repairAt,
    upgradeRoomController
} = require('./utilities');

function run(creep) {
    if (typeof creep.memory.repairing !== 'boolean') {
        creep.memory.repairing = false;
    }

    const energy = creep.store[RESOURCE_ENERGY];
    const freeCapacity = creep.store.getFreeCapacity(RESOURCE_ENERGY);

    if (creep.memory.repairing && energy === 0) {
        creep.memory.repairing = false;
    }

    if (!creep.memory.repairing && freeCapacity === 0) {
        creep.memory.repairing = true;
    }

    if (creep.memory.repairing) {
        const repairTarget = findRepairTarget(creep);

        if (repairTarget) {
            repairAt(creep, repairTarget, {
                visualizePathStyle: { stroke: '#ffffff' }
            });

            return;
        }

        upgradeRoomController(creep, {
            visualizePathStyle: { stroke: '#ffffff' }
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
