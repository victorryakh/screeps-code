/* Offline smoke test: a creep locked in by our own workers.
 *
 * Reproduces the state E34S53 was in on 2026-11-05: the third harvester sat
 * on tile (19,25), a dead end whose only two walkable neighbours were taken
 * by our own creeps — the harvester on the harvest slot (20,24) and the
 * upgrader in the spawn pocket (20,26). The engine does not let a creep walk
 * onto an occupied tile, and `Room.findPath` treats creeps as obstacles, so
 * the harvester had no path to any harvest slot at all: it stood there with an
 * empty backpack for days and a third of the room's income was never mined.
 *
 * The fix: a room level check finds a creep that is locked into a tiny region
 * and tells the worker that holds the exit to step aside.
 *
 * Usage:
 *   bun run build && node tools/smoke-confined-creep.js
 *
 * Exit code 0 - all checks passed; 1 - at least one check failed.
 */
const C = {
    FIND_CONSTRUCTION_SITES: 111,
    FIND_CREEPS: 101,
    FIND_DEPOSITS: 122,
    FIND_DROPPED_RESOURCES: 106,
    FIND_EXIT: 10,
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
    STRUCTURE_ROAD: 'road',
    STRUCTURE_SPAWN: 'spawn',
    STRUCTURE_STORAGE: 'storage',
    STRUCTURE_TOWER: 'tower',
    STRUCTURE_WALL: 'constructedWall',
    STRUCTURE_LINK: 'link',
    STRUCTURE_LAB: 'lab',
    STRUCTURE_FACTORY: 'factory',
    STRUCTURE_POWER_SPAWN: 'powerSpawn',
    STRUCTURE_NUKER: 'nuker',
    STRUCTURE_INVADER_CORE: 'invaderCore',
    STRUCTURE_KEEPER_LAIR: 'keeperLair',
    STRUCTURE_EXTRACTOR: 'extractor',
    STRUCTURE_OBSERVER: 'observer',
    STRUCTURE_PORTAL: 'portal',
    STRUCTURE_POWER_BANK: 'powerBank',
    STRUCTURE_RAMPART: 'rampart',
    STRUCTURE_TERMINAL: 'terminal'
};
const OK = 0;

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
    ERR_INVALID_TARGET: -9, ERR_FULL: -5, ERR_TIRED: -6, ERR_NO_PATH: -4, ERR_NOT_IN_RANGE: -5,
    MOVE: 'move', WORK: 'work', CARRY: 'carry', ATTACK: 'attack',
    RANGED_ATTACK: 'ranged_attack', TOUGH: 'tough', HEAL: 'heal', CLAIM: 'claim',
    CONTROLLER_STRUCTURES: {
        [C.STRUCTURE_EXTENSION]: { 0: 0, 1: 0, 2: 3, 3: 5, 4: 10, 5: 20, 6: 30, 7: 40, 8: 60 },
        [C.STRUCTURE_SPAWN]: { 0: 1, 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 7: 3, 8: 3 },
        [C.STRUCTURE_TOWER]: { 0: 0, 1: 0, 2: 0, 3: 1, 4: 2, 5: 3, 6: 4, 7: 5, 8: 6 },
        [C.STRUCTURE_STORAGE]: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 1, 5: 1, 6: 1, 7: 1, 8: 1 },
        [C.STRUCTURE_LINK]: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 1, 6: 1, 7: 1, 8: 1 },
        [C.STRUCTURE_LAB]: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 1, 7: 1, 8: 1 }
    },
    SOURCE_ENERGY_CAPACITY: 3000,
    SPAWN_ENERGY_CAPACITY: 300,
    EXTENSION_ENERGY_CAPACITY: 50,
    BUILT_EXTENSIONS: { 0: 0, 1: 0, 2: 3, 3: 5, 4: 10, 5: 20, 6: 30, 7: 40, 8: 60 },
    global: global
});
global.global = global;
global.console = console;
global.RoomPosition = class RoomPosition {
    constructor(x, y, roomName) {
        this.x = x;
        this.y = y;
        this.roomName = roomName;
    }
};

const { installPathFinder } = require('./mock-pathfinder');

const notifications = [];
const createdSites = [];
const destroyed = [];
const removedSites = [];
const movedCreeps = [];
let tick = 1000;
let currentRoom = null;

// ---- the real E34S53 terrain (measured in the game) --------------------
// The full 50x50 grid, fetched from the game API on 2026-11-05.
// 0 = plain, 1 = wall, 2 = swamp.
const TERRAIN_ROWS = [
    '11111111111111111111111111111111111111111111111111',
    '11111111111001111110000022000011111100011111111111',
    '11111111110000111100000000000001111222001111111111',
    '11100111110000111000000000000001111222201111111111',
    '11000011111001111220000000000001112222201111111111',
    '11000011111001111122000000000001112222211111111111',
    '10000011111000111112000000000011110222211110001111',
    '10000001110000011111000000000011100000001102200111',
    '10000000000000011111100000000111100000000022200011',
    '10000000000000011111110000001111000000000222200001',
    '10000000000000001111110000011111000000000222200001',
    '11000000000000000111110000011111122000000222200001',
    '11000000000000000111110000011111112200000222200001',
    '10000000000000000011110000001111111200000022000001',
    '00000000000000000001100002222001111000011000000001',
    '00000000000000000000000022222200111100111000000001',
    '00000000000110000000000002222220111111111000000001',
    '00000000001111000000000000222221111111111000000001',
    '00000000001111000000000000000001111111111100000001',
    '00011000011111220000222220000001111111111100000001',
    '00111100111111222002222222000011111111111000000011',
    '00111100111110220112222222200111111111110000011111',
    '11111110011000001111222222201111111111100000111111',
    '11111111000000001111222222211111111111000001111111',
    '11111111000000001111222222201111111100022211111111',
    '11111111000000000112222222200111200000222111111111',
    '11111111100000000000222222200022220000221111111111',
    '11111111111100000000022222000222222000021111111111',
    '11111110011112222000000000000222222200000111111001',
    '11111100001112222000000000000022222200000222110000',
    '00111100001122222000002222220002222200000222222000',
    '00011000001122222000022222222000222200000222222000',
    '00000000011122222000222222222200000000000222222000',
    '00000000111112220002222222222220111000000222222000',
    '00000000111111111111222222222221111100000022220000',
    '00000001111111111111122222222211111100000002200000',
    '00000001111111111111122222222211111000000000000000',
    '00000000111111111111112222222211110000002200000001',
    '00000000011111111111111112222111102200022220000001',
    '00000000000000111111111111111111102220002220000011',
    '00022222000002211000011111111111002222000200000011',
    '00022222200002220000000000011110002222200000000111',
    '00011222200002220000222000000000002222200000000111',
    '00111122000002220000222000000000002222200000000011',
    '00111100000000200000000000000000000112000000000001',
    '00111100000000000000000000000000001111000000000001',
    '11111100000000000000000000000000001111000000000001',
    '11111100000000000000000000000000000110000000000011',
    '11111110011000000000000000000000000000000001111111',
    '11111111111111111111111111100000000000011111111111'
];

function terrainAt(x, y) {
    if (x < 0 || x > 49 || y < 0 || y > 49) {
        return 1;
    }

    return Number(TERRAIN_ROWS[y][x]);
}

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

function makeRoom(opts) {
    opts = opts || {};

    const extensions = (opts.extensions || []).map(([x, y, energy]) => {
        const stored = energy === undefined ? 50 : energy;
        return {
            structureType: C.STRUCTURE_EXTENSION, pos: pos(x, y), my: true, hits: 1000, hitsMax: 1000,
            store: {
                energy: stored,
                getCapacity() { return 50; },
                getFreeCapacity() { return 50 - stored; },
                getUsedCapacity() { return stored; }
            },
            room: null,
            destroy() {
                destroyed.push([x, y]);
                const idx = structures.indexOf(this);
                if (idx !== -1) structures.splice(idx, 1);
                return OK;
            }
        };
    });

    const sites = (opts.sites || []).map(([x, y]) => ({
        structureType: C.STRUCTURE_EXTENSION, pos: pos(x, y), my: true, progress: 0, progressTotal: 3000,
        room: null,
        remove() {
            removedSites.push([x, y]);
            const idx = sites.indexOf(this);
            if (idx !== -1) sites.splice(idx, 1);
            return OK;
        }
    }));

    const creeps = (opts.creeps || []).map(([x, y, role, memory], i) => ({
        name: `creep_${i}`, pos: pos(x, y), my: true, hits: 300, hitsMax: 300,
        fatigue: 0,
        store: { energy: (memory && memory.energy) || 0, getFreeCapacity() { return 100; } },
        body: [{ type: 'work', hits: 100 }, { type: 'carry', hits: 100 }, { type: 'move', hits: 100 }],
        memory: Object.assign({ role, homeRoom: 'E34S53' }, memory || {}),
        room: null,
        moveTo(target) {
            movedCreeps.push([this.name, this.pos.x, this.pos.y, target.x, target.y]);
            return OK;
        },
        upgradeController() { return OK; },
        moveByPath() { return -4; },
        harvest(target) {
            const dx = Math.abs(this.pos.x - target.pos.x);
            const dy = Math.abs(this.pos.y - target.pos.y);
            return Math.max(dx, dy) <= 1 ? OK : -5;
        },
        transfer() { return OK; },
        withdraw() { return -5; },
        build() { return -6; }
    }));

    const source = { type: 'source', pos: pos(19, 23), energy: 3000, room: null };

    const controller = {
        my: true, level: 4, progress: 263803, progressTotal: 800000, safeMode: 0,
        ticksToDowngrade: 100000, reservation: null, upgradeBlocked: false, pos: pos(17, 24)
    };

    const spawn = {
        name: 'Spawn1', structureType: C.STRUCTURE_SPAWN, pos: pos(19, 26), my: true,
        store: {
            energy: 50,
            getCapacity() { return 300; },
            getFreeCapacity() { return 250; },
            getUsedCapacity() { return 50; }
        },
        spawning: null, room: null, usedEnergy: 0,
        spawnCreep() { return -4; }
    };

    const structures = [controller, spawn, ...extensions];
    const room = {
        name: 'E34S53',
        controller,
        memory: {},
        find(type, o) {
            const filter = o && o.filter;
            let list = [];
            if (Array.isArray(type)) {
                const f = typeof filter === 'function' ? filter : null;
                return f ? type.filter(f) : type;
            }
            if (type === C.FIND_MY_SPAWNS) list = [spawn];
            else if (type === C.FIND_STRUCTURES || type === C.FIND_MY_STRUCTURES) list = structures;
            else if (type === C.FIND_CONSTRUCTION_SITES || type === C.FIND_MY_CONSTRUCTION_SITES) list = sites;
            else if (type === C.FIND_CREEPS || type === C.FIND_MY_CREEPS) list = creeps;
            else if (type === C.FIND_SOURCES || type === C.FIND_SOURCES_ACTIVE) list = [source];
            else if (type === C.FIND_MINERALS || type === C.FIND_DEPOSITS) list = [];
            else if (type === C.FIND_HOSTILE_CREEPS || type === C.FIND_HOSTILE_POWER_CREEPS) list = [];
            else list = [];
            if (filter) {
                const f = typeof filter === 'function' ? filter : (s) => s.structureType === filter.structureType;
                list = list.filter(f);
            }
            return list;
        },
        getTerrain() {
            return { get(x, y) { return terrainAt(x, y); } };
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
    installPathFinder(() => currentRoom);
    return { room, spawn, controller, extensions, sites, source, creeps };
}

function makeGame(sim) {
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

// The live creep layout of E34S53 on 2026-11-05.
const LIVE = {
    extensions: [
        [18, 26, 0], [18, 27, 0], [21, 26, 50], [20, 28, 0], [18, 28, 0],
        [19, 28, 50], [17, 27, 50], [17, 26, 50], [20, 25, 50], [21, 24, 50], [21, 25, 0]
    ],
    sites: [[17, 28], [21, 28], [16, 26], [19, 29], [22, 26], [16, 27], [18, 29]],
    creeps: [
        [20, 23, 'harvester', { _harvestTile: { x: 20, y: 23 }, energy: 100 }],
        [20, 26, 'upgrader', { energy: 12 }],
        [20, 24, 'harvester', { _harvestTile: { x: 20, y: 24 }, energy: 16 }],
        [19, 25, 'harvester', { _harvestTile: { x: 20, y: 24 }, energy: 0 }],
        [21, 27, 'builder', { energy: 0 }]
    ]
};

const allMoves = [];

function runTicks(sim, n) {
    for (let i = 0; i < n; i++) {
        tick += 1;
        global.Game = makeGame(sim);
        global.Memory = global.Memory || {};

        movedCreeps.length = 0;
        bot.loop();
        allMoves.push(...movedCreeps);

        // Apply the moves the bot ordered, one tile per tick.
        for (const [name, , , tx, ty] of movedCreeps) {
            const creep = sim.creeps.find((c) => c.name === name);
            if (creep && Number.isFinite(tx) && Number.isFinite(ty)) {
                creep.pos = pos(tx, ty);
            }
        }
    }
}

// --- Scenario 1: the trapped harvester is released -------------------------
{
    const sim = makeRoom(LIVE);
    global.Memory = {};
    allMoves.length = 0;

    const trapped = sim.creeps[3];
    const upgrader = sim.creeps[1];
    const builder = sim.creeps[4];

    check('the trapped harvester starts on the dead end tile',
        trapped.pos.x === 19 && trapped.pos.y === 25);

    runTicks(sim, 40);

    const upgraderMoved = upgrader.pos.x !== 20 || upgrader.pos.y !== 26;
    const builderMoved = builder.pos.x !== 21 || builder.pos.y !== 27;

    check('the upgrader leaves the exit it was holding',
        upgraderMoved,
        `upgrader at ${upgrader.pos.x},${upgrader.pos.y}`);
    check('the builder leaves the exit it was holding',
        builderMoved,
        `builder at ${builder.pos.x},${builder.pos.y}`);

    const moves = [];
    for (const [name, , , tx, ty] of allMoves) {
        if (name === trapped.name) moves.push([tx, ty]);
    }

    const aimedAtSlot = moves.some(([tx, ty]) =>
        (tx === 20 && ty === 22) || (tx === 20 && ty === 23) || (tx === 20 && ty === 24));

    check('the trapped harvester finally aims at a harvest slot',
        aimedAtSlot,
        JSON.stringify(moves));

    check('the trapped harvester leaves the dead end tile',
        trapped.pos.x !== 19 || trapped.pos.y !== 25,
        `trapped harvester at ${trapped.pos.x},${trapped.pos.y}`);
}

// --- Scenario 1b: the live pocket, fully occupied --------------------------
// The state of E34S53 on 2026-11-05: all six cells of the spawn pocket are
// taken by our own creeps, and the builder sits on the only way out.
{
    const sim = makeRoom({
        extensions: LIVE.extensions,
        sites: LIVE.sites,
        creeps: [
            [20, 24, 'harvester', { _harvestTile: { x: 20, y: 24 }, energy: 10 }],
            [20, 26, 'upgrader', { energy: 8 }],
            [19, 27, 'harvester', { _harvestTile: { x: 20, y: 22 }, energy: 0 }],
            [19, 25, 'harvester', { energy: 0 }],
            [21, 27, 'builder', { energy: 0 }]
        ]
    });
    global.Memory = {};
    allMoves.length = 0;

    const builder = sim.creeps[4];
    const pocket = sim.creeps[3];

    runTicks(sim, 40);

    check('the builder leaves the exit of the spawn pocket',
        builder.pos.x !== 21 || builder.pos.y !== 27,
        `builder at ${builder.pos.x},${builder.pos.y}`);

    // A harvester born inside the pocket must be able to reach a harvest slot
    // through the freed exit.
    const newborn = sim.creeps[2];
    const escapes = allMoves.some(([name, , , tx, ty]) =>
        name === newborn.name && (tx === 20 || tx === 21) && ty >= 22 && ty <= 24);

    check('a harvester in the pocket can now reach a harvest slot',
        escapes || newborn.pos.x >= 21,
        JSON.stringify(allMoves.filter(([n]) => n === newborn.name)));
}

// --- Scenario 2: a healthy room is left alone ------------------------------
{
    const sim = makeRoom({
        extensions: LIVE.extensions,
        sites: LIVE.sites,
        creeps: [
            [20, 23, 'harvester', { _harvestTile: { x: 20, y: 23 }, energy: 100 }],
            [20, 24, 'harvester', { _harvestTile: { x: 20, y: 24 }, energy: 100 }],
            [22, 24, 'upgrader', { energy: 50 }]
        ]
    });
    global.Memory = {};

    runTicks(sim, 30);

    const stepAsides = sim.creeps.filter((c) => c.memory._stepAside);

    check('no creep is told to step aside when nobody is locked in',
        stepAsides.length === 0,
        JSON.stringify(stepAsides.map((c) => c.name)));
    check('no creep is marked as a failed step aside',
        sim.creeps.every((c) => !c.memory._stepAsideFailed),
        JSON.stringify(sim.creeps.map((c) => c.memory._stepAsideFailed)));
}

// --- Scenario 3: the upgrader keeps working even when it cannot move ------
{
    const sim = makeRoom({
        extensions: LIVE.extensions,
        sites: LIVE.sites,
        creeps: [
            [20, 26, 'upgrader', { energy: 50 }],
            [19, 25, 'harvester', { _harvestTile: { x: 20, y: 24 }, energy: 0 }]
        ]
    });
    global.Memory = {};

    runTicks(sim, 25);

    const upgrader = sim.creeps[0];
    const dx = Math.abs(upgrader.pos.x - 17);
    const dy = Math.abs(upgrader.pos.y - 24);

    check('the upgrader stays within upgrade range of the controller',
        Math.max(dx, dy) <= 3,
        `upgrader at ${upgrader.pos.x},${upgrader.pos.y} range=${Math.max(dx, dy)}`);
    check('the upgrader keeps its role',
        upgrader.memory.role === 'upgrader',
        JSON.stringify(upgrader.memory));
}

const failed = results.filter((r) => !r.ok);

console.log('');
console.log(`${results.length - failed.length}/${results.length} checks passed`);

if (failed.length > 0) {
    process.exit(1);
}
