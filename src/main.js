const room = require('./room');
const expansion = require('./expansion');

module.exports.loop = function () {
    for (const name in Memory.creeps) {
        if (!Game.creeps[name]) {
            delete Memory.creeps[name];
        }
    }

    for (const name in Game.creeps) {
        const creep = Game.creeps[name];

        if (!creep.memory.homeRoom) {
            creep.memory.homeRoom = creep.room.name;
        }
    }

    const ownedRoomNames = [];

    for (const roomName in Game.rooms) {
        const r = Game.rooms[roomName];

        if (r.controller && r.controller.my) {
            ownedRoomNames.push(roomName);
        }
    }

    if (ownedRoomNames.length === 0) {
        return;
    }

    for (const roomName of ownedRoomNames) {
        room.run(Game.rooms[roomName]);
    }

    expansion.run();

    if (
        Game.cpu &&
        Game.cpu.bucket >= 10000 &&
        typeof Game.cpu.generatePixel === 'function'
    ) {
        Game.cpu.generatePixel();
    }
};
