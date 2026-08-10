const { ROLE, REMOTE_ROLES } = require('./constants');
const { bodyFor, bodyCost } = require('./utilities');

function trySpawn(room, role) {
    if (room.memory._spawnCooldown === Game.time) {
        return false;
    }

    const spawn = room.find(FIND_MY_SPAWNS, {
        filter: (s) => !s.spawning
    })[0];

    if (!spawn) {
        return false;
    }

    const body = bodyFor(role);

    if (!body) {
        return false;
    }

    if (spawn.room.energyAvailable < bodyCost(body)) {
        return false;
    }

    const name = `${role}_${Game.time}_${Math.floor(Math.random() * 1000)}`;

    const memory = {
        role: role,
        homeRoom: room.name
    };

    if (REMOTE_ROLES.indexOf(role) !== -1) {
        if (!Memory.targetRoom) {
            return false;
        }

        memory.targetRoom = Memory.targetRoom;
    }

    if (role === ROLE.HARVESTER) {
        const sources = room.find(FIND_SOURCES);

        if (sources.length > 0) {
            room.memory._harvesterIndex = (room.memory._harvesterIndex || 0) + 1;
            const source = sources[room.memory._harvesterIndex % sources.length];
            memory.sourceId = source.id;
        }
    }

    const result = spawn.spawnCreep(body, name, { memory: memory });

    if (result === OK) {
        room.memory._spawnCooldown = Game.time;
        return true;
    }

    return false;
}

function canAffordBody(room, role) {
    const body = bodyFor(role);

    if (!body) {
        return false;
    }

    return room.energyCapacityAvailable >= bodyCost(body);
}

module.exports = {
    trySpawn,
    canAffordBody
};
