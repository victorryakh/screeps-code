const { moveCached } = require('../utilities');
const { REPAIR_THRESHOLD } = require('../constants');

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
        const repairTarget = creep.pos.findClosestByPath(FIND_STRUCTURES, {
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

                return s.hits < s.hitsMax * REPAIR_THRESHOLD;
            }
        });

        if (repairTarget) {
            if (creep.repair(repairTarget) === ERR_NOT_IN_RANGE) {
                moveCached(creep, repairTarget, {
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
