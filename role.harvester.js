const { moveCached } = require('../utilities');

function run(creep) {
    if (creep.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
        let source = Game.getObjectById(creep.memory.sourceId);

        if (!source) {
            source = creep.pos.findClosestByPath(FIND_SOURCES);
        }

        if (!source) {
            return;
        }

        if (creep.harvest(source) === ERR_NOT_IN_RANGE) {
            moveCached(creep, source, {
                visualizePathStyle: { stroke: '#ffaa00' }
            });
        }

        return;
    }

    const transferTarget = creep.pos.findClosestByPath(FIND_STRUCTURES, {
        filter: (s) => (
            s.structureType === STRUCTURE_SPAWN ||
            s.structureType === STRUCTURE_EXTENSION ||
            s.structureType === STRUCTURE_TOWER
        ) && s.store.getFreeCapacity(RESOURCE_ENERGY) > 0
    });

    if (transferTarget) {
        if (creep.transfer(transferTarget, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
            moveCached(creep, transferTarget, {
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
}

module.exports = { run };
