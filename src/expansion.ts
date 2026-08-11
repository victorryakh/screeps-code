import { ROLE, EXPANSION, EXITS_CACHE_TTL } from './constants';
import { trySpawn, canAffordBody } from './spawn';

export function run(): void {
    const blacklist = Memory.expansionBlacklist || EXPANSION.blacklist || [];

    if (Memory.targetRoom && blacklist.indexOf(Memory.targetRoom) !== -1) {
        delete Memory.targetRoom;
    }

    if (!Memory.targetRoom) {
        const picked = pickExpansionTarget();
        if (picked) {
            Memory.targetRoom = picked;
        }

        if (!Memory.targetRoom) {
            return;
        }
    }

    const homeName = findHomeRoomName();

    if (!homeName) {
        return;
    }

    const home = Game.rooms[homeName];

    if (!home || !home.controller || !home.controller.my) {
        return;
    }

    if (home.controller.level < 3 || !Game.gcl || Game.gcl.level < 2) {
        return;
    }

    const targetRoomObject = Game.rooms[Memory.targetRoom];

    if (
        targetRoomObject &&
        targetRoomObject.controller &&
        targetRoomObject.controller.my
    ) {
        let rharvesterCount = 0;

        for (const name in Game.creeps) {
            const creep = Game.creeps[name];

            if (!creep) {
                continue;
            }

            if (
                creep.memory.role === ROLE.RHARVESTER &&
                creep.memory.targetRoom === Memory.targetRoom
            ) {
                rharvesterCount++;
            }
        }

        if (rharvesterCount < EXPANSION.rharvesterCount) {
            trySpawn(home, ROLE.RHARVESTER);
        }

        return;
    }

    let reserverCount = 0;
    let claimerCount = 0;

    for (const name in Game.creeps) {
        const creep = Game.creeps[name];

        if (!creep) {
            continue;
        }

        if (creep.memory.targetRoom !== Memory.targetRoom) {
            continue;
        }

        if (creep.memory.role === ROLE.RESERVER) {
            reserverCount++;
        }

        if (creep.memory.role === ROLE.CLAIMER) {
            claimerCount++;
        }
    }

    if (
        reserverCount < EXPANSION.reserverCount &&
        canAffordBody(home, ROLE.RESERVER)
    ) {
        trySpawn(home, ROLE.RESERVER);
        return;
    }

    if (
        claimerCount < EXPANSION.claimerCount &&
        canAffordBody(home, ROLE.CLAIMER)
    ) {
        trySpawn(home, ROLE.CLAIMER);
    }
}

export function findHomeRoomName(): string | null {
    let bestRoom: Room | null = null;

    for (const roomName in Game.rooms) {
        const room = Game.rooms[roomName];
        if (!room || !room.controller || !room.controller.my) {
            continue;
        }

        if (!bestRoom || !bestRoom.controller) {
            bestRoom = room;
            continue;
        }

        if (room.controller.level > bestRoom.controller.level) {
            bestRoom = room;
            continue;
        }

        if (
            room.controller.level === bestRoom.controller.level &&
            room.energyCapacityAvailable > bestRoom.energyCapacityAvailable
        ) {
            bestRoom = room;
        }
    }

    return bestRoom ? bestRoom.name : null;
}

function pickExpansionTarget(): string | null {
    const homeName = findHomeRoomName();

    if (!homeName) {
        return null;
    }

    if (!Memory._exitsCache) {
        Memory._exitsCache = {};
    }

    let cached = Memory._exitsCache[homeName];

    if (!cached || Game.time - cached.tick > EXITS_CACHE_TTL) {
        const exits = Game.map.describeExits(homeName) || {};

        cached = {
            tick: Game.time,
            exits: exits
        };

        Memory._exitsCache[homeName] = cached;
    }

    const exits = cached.exits;
    const neighbourRooms: string[] = [];

    for (const dir in exits) {
        const neighbour = exits[dir as ExitKey];
        if (neighbour) {
            neighbourRooms.push(neighbour);
        }
    }

    const blacklist = Memory.expansionBlacklist || EXPANSION.blacklist || [];
    const preferred = Memory.expansionPreferredTarget || EXPANSION.preferredTarget;

    if (
        preferred &&
        neighbourRooms.indexOf(preferred) !== -1 &&
        blacklist.indexOf(preferred) === -1
    ) {
        const status = Game.map.getRoomStatus(preferred);

        if (isNormalRoomStatus(status)) {
            if (Memory.debug) {
                console.log(`[expansion] preferred target selected: ${preferred}`);
            }

            return preferred;
        }
    }

    const directions = Object.keys(exits).sort() as ExitKey[];

    for (const dir of directions) {
        const neighbourName = exits[dir];

        if (!neighbourName) {
            continue;
        }

        if (blacklist.indexOf(neighbourName) !== -1) {
            continue;
        }

        if (Memory.targetRoom && neighbourName === Memory.targetRoom) {
            continue;
        }

        const homeShardPrefix = homeName.indexOf('-') !== -1
            ? homeName.split('-')[0]
            : '';

        const neighbourShardPrefix = neighbourName.indexOf('-') !== -1
            ? neighbourName.split('-')[0]
            : '';

        if (homeShardPrefix !== neighbourShardPrefix) {
            continue;
        }

        const status = Game.map.getRoomStatus(neighbourName);

        if (isNormalRoomStatus(status)) {
            if (Memory.debug) {
                console.log(`[expansion] picked target ${neighbourName} from ${homeName}`);
            }

            return neighbourName;
        }
    }

    return null;
}

function isNormalRoomStatus(status: RoomStatus): boolean {
    return status.status === 'normal';
}
