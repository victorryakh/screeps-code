const { moveCached } = require('../utilities');

function run(creep) {
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
        let site = creep.pos.findClosestByPath(FIND_MY_CONSTRUCTION_SITES, {
            filter: (s) => s.structureType !== STRUCTURE_ROAD && s.progress < s.progressTotal
        });

        if (!site) {
            site = creep.pos.findClosestByPath(FIND_MY_CONSTRUCTION_SITES, {
                filter: (s) => s.progress < s.progressTotal
            });
        }

        if (site) {
            if (creep.build(site) === ERR_NOT_IN_RANGE) {
                moveCached(creep, site, {
                    visualizePathStyle: { stroke: '#ffffff' }
                });
            }

            return;
        }

        if (creep.room.controller && creep.room.controller.my) {
            if (creep.upgradeController(creep.room.controller) === ERR_NOT_IN_RANGE) {
                moveCached(creep, creep.room.controller, {
                    visualizePathStyle: { stroke: '#ffffff' }
                });
            }
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
