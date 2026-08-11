import * as room from './room';
import * as expansion from './expansion';
import * as metrics from './metrics';

export function loop(): void {
    metrics.tickStart();
    metrics.init();

    for (const name in Memory.creeps) {
        if (!Game.creeps[name]) {
            delete Memory.creeps[name];
        }
    }

    for (const name in Game.creeps) {
        const creep = Game.creeps[name];

        if (!creep) {
            continue;
        }

        if (!creep.memory.homeRoom) {
            creep.memory.homeRoom = creep.room.name;
        }
    }

    const ownedRoomNames: string[] = [];

    for (const roomName in Game.rooms) {
        const r = Game.rooms[roomName];

        if (!r) {
            continue;
        }

        if (r.controller && r.controller.my) {
            ownedRoomNames.push(roomName);
        }
    }

    if (ownedRoomNames.length === 0) {
        metrics.tickEnd();
        return;
    }

    for (const roomName of ownedRoomNames) {
        const r = Game.rooms[roomName];
        if (r) {
            room.run(r);
        }
    }

    expansion.run();

    if (
        Game.cpu &&
        Game.cpu.bucket >= 10000 &&
        typeof Game.cpu.generatePixel === 'function'
    ) {
        Game.cpu.generatePixel();
    }

    metrics.tickEnd();
}
