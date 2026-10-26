/* Offline smoke test for the source-slot logic of the bot bundle.
 *
 * Reproduces the failure that starved the colony in E34S53 on 2026-10-26:
 * the source lies on a wall tile, so only three tiles around it can be used
 * for harvesting. Three upgraders occupied all three, the harvesters had no
 * target at all and carried 0 energy for days — the colony produced nothing.
 *
 * Usage:
 *   bun run build && node tools/smoke-source-slots.js
 *
 * Exit code 0 - all checks passed; 1 - at least one check failed.
 */
const C = {
    FIND_CONSTRUCTION_SITES: 111,
    FIND_CREEPS: 101,
    FIND_DEPOSITS: 122,
    FIND_DROPPED_RESOURCES: 106,
    FIND_EXIT: 10,
    FIND_EXIT_BOTTOM: 5,
    FIND_EXIT_LEFT: 7,
    FIND_EXIT_RIGHT: 3,
    FIND_EXIT_TOP: 1,
    FIND_FLAGS: 110,
    FIND_HOSTILE_CONSTRUCTION_SITES: 115,
    FIND_HOSTILE_CREEPS: 103,
    FIND_HOSTILE_POWER_CREEPS: 121,
    FIND_HOSTILE_SPAWNS: 113,
    FIND_HOSTILE_STRUCTURES: 109,
    FIND_MINERALS: 116,
    FIND_MY_CONSTRUCTION_SITES: 114,
    FIND_MY_CREEPS: 102,
    FIND_MY_POWER_CREEPS: 120,
    FIND_MY_SPAWNS: 112,
    FIND_MY_STRUCTURES: 108,
    FIND_NUKES: 117,
    FIND_POWER_CREEPS: 119,
    FIND_RUINS: 123,
    FIND_SOURCES: 105,
    FIND_SOURCES_ACTIVE: 104,
    FIND_STRUCTURES: 107,
    FIND_TOMBSTONES: 118,
    STRUCTURE_CONTAINER: 'container',
    STRUCTURE_CONTROLLER: 'controller',
    STRUCTURE_EXTENSION: 'extension',
    STRUCTURE_EXTRACTOR: 'extractor',
    STRUCTURE_FACTORY: 'factory',
    STRUCTURE_INVADER_CORE: 'invaderCore',
    STRUCTURE_KEEPER_LAIR: 'keeperLair',
    STRUCTURE_LAB: 'lab',
    STRUCTURE_LINK: 'link',
    STRUCTURE_NUKER: 'nuker',
    STRUCTURE_OBSERVER: 'observer',
    STRUCTURE_PORTAL: 'portal',
    STRUCTURE_POWER_BANK: 'powerBank',
    STRUCTURE_POWER_SPAWN: 'powerSpawn',
    STRUCTURE_RAMPART: 'rampart',
    STRUCTURE_ROAD: 'road',
    STRUCTURE_SPAWN: 'spawn',
    STRUCTURE_STORAGE: 'storage',
    STRUCTURE_TERMINAL: 'terminal',
    STRUCTURE_TOWER: 'tower',
    STRUCTURE_WALL: 'constructedWall'
};
const OK = 0;
const ERR_NOT_IN_RANGE = -9;

// ---- globals -------------------------------------------------------------
Object.assign(global, C, {
    TERRAIN_MASK_WALL: 1,
    TERRAIN_MASK_SWAMP: 2,
    RESOURCE_ENERGY: 'energy',
    BODYPART_COST: { move: 50, work: 100, carry: 50, attack: 80, ranged_attack: 150, tough: 10, heal: 250, claim: 600 },
    FIND_EXIT_TOP: 1, FIND_EXIT_RIGHT: 2, FIND_EXIT_BOTTOM: 3, FIND_EXIT_LEFT: 4, FIND_EXIT: 5,
    CREEP_LIFE_TIME: 1500,
    MAX_CREEP_SIZE: 50,
    OK: 0, ERR_BUSY: -4, ERR_NOT_ENOUGH_ENERGY: -6, ERR_INVALID_ARGS: -10,
    ERR_NAME_EXISTS: -3, ERR_RCL_NOT_ENOUGH: -14, ERR_NOT_OWNER: -13,
    ERR_INVALID_TARGET: -9, ERR_FULL: -5, ERR_TIRED: -6, ERR_NO_PATH: -4, ERR_NOT_IN_RANGE: -9,
    MOVE: 'move', WORK: 'work', CARRY: 'carry', ATTACK: 'attack',
    RANGED_ATTACK: 'ranged_attack', TOUGH: 'tough', HEAL: 'heal', CLAIM: 'claim',
    CONTROLLER_STRUCTURES: {
        [C.STRUCTURE_EXTENSION]: { 0: 0, 1: 0, 2: 3, 3: 5, 4: 10, 5: 20, 6: 30, 7: 40, 8: 60 },
        [C.STRUCTURE_TOWER]: { 0: 0, 1: 0, 2: 0, 3: 1, 4: 2, 5: 3, 6: 4, 7: 5, 8: 6 },
        [C.STRUCTURE_STORAGE]: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 1, 5: 1, 6: 1, 7: 1, 8: 1 },
        [C.STRUCTURE_LINK]: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 1, 6: 1, 7: 1, 8: 1 },
        [C.STRUCTURE_LAB]: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 1, 7: 1, 8: 1 }
    },
    SOURCE_ENERGY_CAPACITY: 3000,
    SPAWN_ENERGY_CAPACITY: 300,
    EXTENSION_ENERGY_CAPACITY: 50,
    BUILT_EXTENSIONS: { 0: 0, 1: 0, 2: 3, 3: 5, 4: 10, 5: 20, 6: 30, 7: 40, 8: 60 }
});
global.global = global;
global.console = console;
global.RoomPosition = class RoomPosition {
    constructor(x, y, roomName) {
        this.x = x;
        this.y = y;
        this.roomName = roomName;
    }
    isEqualTo(other) {
        return this.x === other.x && this.y === other.y && this.roomName === other.roomName;
    }
};

// Terrain of E34S53 around the source and the controller: both lie on a wall
// tile, which is exactly what makes the source so scarce there.
const WALLS = new Set([
    '13,19', '13,20',
    '16,22', '16,23', '16,24',
    '17,21', '17,22', '17,23', '17,24', '17,25',
    '18,21', '18,22', '18,23', '18,24', '18,25',
    '19,22', '19,23', '19,24'
]);

const notifications = [];
const createdSites = [];
let tick = 1000;

let currentRoom = null;

function pos(x, y) {
    return {
        x,
        y,
        roomName: 'E34S53',
        isEqualTo(other) {
            return this.x === other.x && this.y === other.y && this.roomName === other.roomName;
        },
        findClosestByPath(type, opts) {
            if (!currentRoom) {
                return null;
            }
            const list = currentRoom.find(type, opts);
            return list.length > 0 ? list[0] : null;
        },
        findClosestByRange(list) {
            return list.length > 0 ? list[0] : null;
        }
    };
}

function near(a, b) {
    return Math.abs(a.x - b.x) <= 1 && Math.abs(a.y - b.y) <= 1;
}

function makeCreep(x, y, role, energy) {
    const store = {
        energy: energy || 0,
        getCapacity() { return 50; },
        getFreeCapacity() { return 50 - this.energy; }
    };

    return {
        name: `${role}_${x}_${y}`,
        pos: pos(x, y),
        my: true,
        hits: 300,
        hitsMax: 300,
        fatigue: 0,
        store,
        memory: { role, homeRoom: 'E34S53' },
        room: null,
        actions: [],
        harvest(source) {
            if (!near(this.pos, source.pos)) {
                this.actions.push(['harvest-fail', source.pos.x, source.pos.y]);
                return ERR_NOT_IN_RANGE;
            }
            this.actions.push(['harvest', source.pos.x, source.pos.y]);
            const got = Math.min(2, store.getFreeCapacity(), source.energy);
            store.energy += got;
            source.energy -= got;
            return OK;
        },
        withdraw(target, resource, amount) {
            if (!near(this.pos, target.pos)) {
                this.actions.push(['withdraw-fail', target.pos.x, target.pos.y]);
                return ERR_NOT_IN_RANGE;
            }
            this.actions.push(['withdraw', target.pos.x, target.pos.y, amount]);
            const got = amount === undefined
                ? Math.min(store.getFreeCapacity(), target.store.energy)
                : Math.min(amount, store.getFreeCapacity(), target.store.energy);
            store.energy += got;
            target.store.energy -= got;
            return OK;
        },
        upgradeController(controller) {
            const d = Math.max(Math.abs(this.pos.x - controller.pos.x), Math.abs(this.pos.y - controller.pos.y));
            if (d > 3) {
                this.actions.push(['upgrade-fail']);
                return ERR_NOT_IN_RANGE;
            }
            this.actions.push(['upgrade']);
            return OK;
        },
        transfer(target) {
            this.actions.push(['transfer', target.pos.x, target.pos.y]);
            return ERR_NOT_IN_RANGE;
        },
        moveTo(target) {
            this.actions.push(['moveTo', target.x, target.y]);
            return OK;
        },
        moveByPath() { return -4; }
    };
}

function makeRoom(opts) {
    opts = opts || {};
    const creeps = (opts.creeps || []).map(([x, y, role, energy]) => makeCreep(x, y, role, energy));
    const sites = (opts.sites || []).map(([x, y]) => ({
        structureType: C.STRUCTURE_EXTENSION, pos: pos(x, y), my: true, progress: 0, progressTotal: 3000, room: null
    }));
    const extensions = (opts.extensions || []).map(([x, y, energy]) => ({
        structureType: C.STRUCTURE_EXTENSION, pos: pos(x, y), my: true, hits: 1000, hitsMax: 1000,
        store: { energy: energy === undefined ? 0 : energy }, room: null
    }));
    const source = { type: 'source', pos: pos(19, 23), energy: 3000, room: null };
    const controller = {
        my: true, level: 3, progress: 0, progressTotal: 600000, safeMode: 0,
        ticksToDowngrade: 100000, reservation: null, upgradeBlocked: false, pos: pos(17, 24)
    };
    const spawn = {
        name: 'Spawn1', structureType: C.STRUCTURE_SPAWN, pos: pos(19, 26), my: true,
        store: { energy: opts.spawnEnergy === undefined ? 300 : opts.spawnEnergy },
        spawning: null, room: null, spawnCreep() { return -4; }
    };
    const structures = [controller, spawn, ...extensions];

    const room = {
        name: 'E34S53',
        controller,
        memory: {},
        get energyAvailable() {
            return structures
                .filter((s) => s.structureType === C.STRUCTURE_SPAWN || s.structureType === C.STRUCTURE_EXTENSION)
                .reduce((sum, s) => sum + (s.store ? s.store.energy : 0), 0);
        },
        find(type, o) {
            const filter = o && o.filter;
            let list = [];
            if (type === C.FIND_MY_SPAWNS) list = [spawn];
            else if (type === C.FIND_STRUCTURES || type === C.FIND_MY_STRUCTURES) list = structures;
            else if (type === C.FIND_CONSTRUCTION_SITES || type === C.FIND_MY_CONSTRUCTION_SITES) list = sites;
            else if (type === C.FIND_CREEPS || type === C.FIND_MY_CREEPS) list = creeps;
            else if (type === C.FIND_SOURCES || type === C.FIND_SOURCES_ACTIVE) list = [source];
            else list = [];
            if (filter) {
                const f = typeof filter === 'function' ? filter : (s) => s.structureType === filter.structureType;
                list = list.filter(f);
            }
            return list;
        },
        getTerrain() {
            return { get(x, y) { return WALLS.has(`${x},${y}`) ? 1 : 0; } };
        },
        createConstructionSite(x, y, structureType) {
            createdSites.push([x, y, structureType]);
            sites.push({ structureType, pos: pos(x, y), my: true, progress: 0, progressTotal: 3000, room });
            return OK;
        },
        lookAt(x, y) { return []; }
    };

    for (const s of structures) s.room = room;
    for (const c of creeps) c.room = room;
    source.room = room;
    currentRoom = room;

    return { room, spawn, controller, extensions, sites, source, creeps };
}

let world = null;

function makeGame(sim) {
    world = sim;
    const creeps = {};
    for (const c of sim.creeps) creeps[c.name] = c;
    return {
        rooms: { E34S53: sim.room },
        creeps,
        spawns: { Spawn1: sim.spawn },
        structures: {},
        time: tick,
        cpu: { getUsed: () => 0, bucket: 0, limit: 20 },
        notify: (msg) => notifications.push(msg),
        getObjectById: () => null,
        map: { describeExits: () => ({ E34S53: { 1: 'E35S53', 2: 'E33S53' } }) },
        shards: []
    };
}

const results = [];
function check(name, cond, detail) {
    results.push({ name, ok: !!cond, detail: detail || '' });
    console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' :: ' + detail : ''}`);
}

const bot = require(require('path').join(__dirname, '..', 'dist', 'main.js'));

function runTicks(sim, n) {
    for (let i = 0; i < n; i++) {
        tick += 1;
        global.Game = makeGame(sim);
        global.Memory = { creeps: {} };
        bot.loop();
    }
}

function actions(creep, kind) {
    return creep.actions.filter((a) => a[0] === kind);
}

// --- Scenario 1: a harvester goes to a harvest tile, never to the source -----
// The source is on a wall tile: moving onto it is impossible, so the bot must
// aim at one of the three walkable neighbours.
{
    const sim = makeRoom({ creeps: [[21, 21, 'harvester', 0]] });
    runTicks(sim, 1);
    const creep = sim.creeps[0];
    const moves = actions(creep, 'moveTo');
    const targets = moves.map((m) => `${m[1]},${m[2]}`);
    check('harvester aims at a tile next to the source, not at the source itself',
        moves.length > 0 && targets.every((t) => t !== '19,23'),
        JSON.stringify(targets));
    check('harvester aims at a walkable tile next to the source',
        moves.length > 0 && targets.every((t) => ['20,22', '20,23', '20,24'].includes(t)),
        JSON.stringify(targets));
}

// --- Scenario 2: the source is saturated -> upgraders take energy from the spawn
{
    const sim = makeRoom({
        creeps: [
            [21, 21, 'harvester', 0],
            [21, 22, 'harvester', 0],
            [21, 23, 'harvester', 0],
            [21, 24, 'upgrader', 0],
            [21, 25, 'upgrader', 0]
        ]
    });
    runTicks(sim, 1);
    const upgraders = sim.creeps.filter((c) => c.memory.role === 'upgrader');
    const harvestCalls = upgraders.reduce((n, c) => n + actions(c, 'harvest').length + actions(c, 'harvest-fail').length, 0);
    const withdrawCalls = upgraders.reduce((n, c) => n + actions(c, 'withdraw').length, 0);
    const moveCalls = upgraders.reduce((n, c) => n + actions(c, 'moveTo').length, 0);

    check('upgraders do not fight the harvesters for the source slots',
        harvestCalls === 0,
        `harvest calls=${harvestCalls}`);
    check('upgraders take energy from the spawn instead',
        withdrawCalls + moveCalls > 0,
        `withdraw=${withdrawCalls} moveTo=${moveCalls}`);
}

// --- Scenario 3: a room with room to spare keeps the old behaviour ---------
{
    const sim = makeRoom({
        creeps: [
            [21, 21, 'harvester', 0],
            [21, 24, 'upgrader', 0]
        ]
    });
    runTicks(sim, 1);
    const upgrader = sim.creeps.find((c) => c.memory.role === 'upgrader');
    const harvestCalls = actions(upgrader, 'harvest').length + actions(upgrader, 'harvest-fail').length;
    const withdrawCalls = actions(upgrader, 'withdraw').length;

    check('with free harvest slots the upgrader still harvests by itself',
        harvestCalls > 0 && withdrawCalls === 0,
        `harvest=${harvestCalls} withdraw=${withdrawCalls}`);
}

// --- Scenario 4: the upgrader does not park on the spawn's birth ring -------
// The donor is the spawn, so the upgrader stands next to it while withdrawing.
// A creep on a birth tile seals the spawn, so it must step aside afterwards.
{
    const sim = makeRoom({
        creeps: [
            [21, 21, 'harvester', 0],
            [21, 22, 'harvester', 0],
            [21, 23, 'harvester', 0],
            [20, 27, 'upgrader', 50]
        ]
    });
    runTicks(sim, 1);
    const upgrader = sim.creeps.find((c) => c.memory.role === 'upgrader');
    const moves = actions(upgrader, 'moveTo').map((m) => `${m[1]},${m[2]}`);
    const onRing = moves.filter((t) => Math.max(Math.abs(Number(t.split(',')[0]) - 19), Math.abs(Number(t.split(',')[1]) - 26)) === 1);

    check('the upgrader leaves the birth ring of the spawn',
        moves.length > 0 && onRing.length === 0,
        `moves=${JSON.stringify(moves)}`);
    check('the upgrader stays within the upgrade range of the controller',
        moves.length > 0 && moves.every((t) => {
            const [x, y] = t.split(',').map(Number);
            return Math.max(Math.abs(x - 17), Math.abs(y - 24)) <= 3;
        }),
        JSON.stringify(moves));
}


// --- Scenario 5: the reserve for creep spawning is respected ----------------
// The spawn pays for new creeps, so the room must keep enough energy to spawn
// one. Taking everything from the spawn leaves the colony with no reserves.
{
    const sim = makeRoom({
        spawnEnergy: 250,
        creeps: [
            [21, 21, 'harvester', 0],
            [21, 22, 'harvester', 0],
            [21, 23, 'harvester', 0],
            [20, 27, 'upgrader', 0]
        ]
    });
    runTicks(sim, 1);
    const upgrader = sim.creeps.find((c) => c.memory.role === 'upgrader');
    const withdraws = actions(upgrader, 'withdraw');
    check('the upgrader takes energy from the spawn',
        withdraws.length > 0,
        JSON.stringify(withdraws));
    check('the reserve for one creep spawn is left in the room',
        sim.room.energyAvailable >= 200,
        `room energy=${sim.room.energyAvailable}`);
}

// --- Scenario 6: energy in hand is used, not hoarded ------------------------
// The upgrader must not wait for a full backpack while the controller is
// standing idle.
{
    const sim = makeRoom({
        spawnEnergy: 0,
        creeps: [
            [21, 21, 'harvester', 0],
            [21, 22, 'harvester', 0],
            [21, 23, 'harvester', 0],
            [20, 21, 'upgrader', 16]
        ]
    });
    runTicks(sim, 1);
    const upgrader = sim.creeps.find((c) => c.memory.role === 'upgrader');
    const withdraws = actions(upgrader, 'withdraw').length;
    const moves = actions(upgrader, 'moveTo').map((m) => `${m[1]},${m[2]}`);
    const upgrades = actions(upgrader, 'upgrade').length;

    check('the upgrader does not look for more energy while it has some',
        withdraws === 0,
        `withdraw=${withdraws}`);
    check('the upgrader goes to a place from which it can upgrade',
        moves.length > 0 || upgrades > 0,
        `moves=${JSON.stringify(moves)} upgrades=${upgrades}`);
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
