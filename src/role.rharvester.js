const {
    moveCached,
    harvestEnergy,
    findClosestSource,
    transferEnergy,
    findEnergyTransferTarget
} = require('./utilities');
const { HOME_PATH_TTL, REMOTE_PATH_TTL } = require('./constants');

function run(creep) {
    if (!creep.memory.targetRoom) {
        return;
    }

    const home = Game.rooms[creep.memory.homeRoom];

    if (!home) {
        return;
    }

    if (creep.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
        if (creep.room.name !== creep.memory.targetRoom) {
            moveCached(
                creep,
                new RoomPosition(25, 25, creep.memory.targetRoom),
                { reusePath: REMOTE_PATH_TTL }
            );
            return;
        }

        const source = findClosestSource(creep, true);

        if (source) {
            harvestEnergy(creep, source, { reusePath: REMOTE_PATH_TTL });
        }

        return;
    }

    if (creep.room.name !== home.name) {
        moveCached(
            creep,
            home.controller || new RoomPosition(25, 25, home.name),
            { reusePath: REMOTE_PATH_TTL }
        );
        return;
    }

    const transferTarget = findEnergyTransferTarget(creep, [
        STRUCTURE_SPAWN,
        STRUCTURE_EXTENSION
    ]);

    if (transferTarget) {
        transferEnergy(creep, transferTarget, { reusePath: HOME_PATH_TTL });

        return;
    }

    if (home.storage && home.storage.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
        transferEnergy(creep, home.storage, { reusePath: HOME_PATH_TTL });

        return;
    }

    creep.drop(RESOURCE_ENERGY);
}

module.exports = { run };
