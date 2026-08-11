const {
    moveCached,
    harvestEnergy,
    findClosestSource,
    transferEnergy,
    findEnergyTransferTarget,
    upgradeRoomController
} = require('./utilities');

function run(creep) {
    if (creep.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
        let source = Game.getObjectById(creep.memory.sourceId);

        if (!source) {
            source = findClosestSource(creep);
        }

        if (!source) {
            return;
        }

        harvestEnergy(creep, source, {
            visualizePathStyle: { stroke: '#ffaa00' }
        });

        return;
    }

    const transferTarget = findEnergyTransferTarget(creep, [
        STRUCTURE_SPAWN,
        STRUCTURE_EXTENSION,
        STRUCTURE_TOWER
    ]);

    if (transferTarget) {
        transferEnergy(creep, transferTarget, {
            visualizePathStyle: { stroke: '#ffffff' }
        });

        return;
    }

    upgradeRoomController(creep, {
        visualizePathStyle: { stroke: '#ffffff' }
    });
}

module.exports = { run };
