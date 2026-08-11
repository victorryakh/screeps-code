import {
    moveCached,
    harvestEnergy,
    findClosestSource,
    transferEnergy,
    findEnergyTransferTarget,
    upgradeRoomController
} from './utilities';

export function run(creep: Creep): void {
    if (creep.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
        let source = Game.getObjectById(creep.memory.sourceId ?? ('' as Id<Source>));

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
