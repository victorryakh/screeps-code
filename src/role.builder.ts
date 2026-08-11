import {
    harvestEnergy,
    findClosestSource,
    findConstructionSite,
    buildAt,
    upgradeRoomController
} from './utilities';

export function run(creep: Creep): void {
    if (typeof creep.memory.building !== 'boolean') {
        creep.memory.building = false;
    }

    const energy = creep.store[RESOURCE_ENERGY];
    const freeCapacity = creep.store.getFreeCapacity(RESOURCE_ENERGY);

    if (creep.memory.building && energy === 0) {
        creep.memory.building = false;
        creep.say('🔄 harvest');
    }

    if (!creep.memory.building && freeCapacity === 0) {
        creep.memory.building = true;
        creep.say('🚧 build');
    }

    if (creep.memory.building) {
        let site = findConstructionSite(creep, (s) =>
            s.structureType !== STRUCTURE_ROAD && s.progress < s.progressTotal
        );

        if (!site) {
            site = findConstructionSite(creep);
        }

        if (site) {
            buildAt(creep, site, {
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
