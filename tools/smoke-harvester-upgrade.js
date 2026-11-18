/* Offline smoke test: the harvester must upgrade the controller on the spot.
 *
 * The state reproduced here is E34S53 as of 2026-11-12: the room earned
 * 2.8 energy/tick and the controller grew by only 1.5 progress/tick, while
 * the theoretical ceiling of the room (3 harvest slots x 2 energy/tick, and
 * the upgrade power of all six WORK parts) is 6.
 *
 * Why it was slow: a harvester only upgraded the controller when the room
 * had NO storage with free space at all. As long as any structure had room,
 * the harvester carried its energy to that structure - across the swamp, at
 * the cost of most of its working time - and the energy then had to travel
 * to the controller a second time, carried by another creep.
 *
 * The engine allows both intents in the same tick: in
 * `processor/intents/creeps/intents.js` `harvest` and `upgradeController`
 * do not block each other, `harvest` runs first and immediately raises
 * `creep.store`, and `upgradeController` runs later and spends it. A source
 * gives 2 energy/tick per WORK part and an upgrade costs 1 energy per WORK
 * part, so a harvester standing on a harvest tile can feed the controller
 * directly, without going anywhere.
 *
 * Three things are checked here:
 *
 *   1. A harvester inside the upgrade range (3) issues the harvest AND the
 *      upgrade intent in the same tick.
 *   2. A harvester outside the upgrade range does not issue a pointless
 *      upgrade intent.
 *   3. A harvester with a full backpack still delivers the energy to the
 *      storage - the fix must not break the delivery.
 *
 * Usage:
 *   bun run build && node tools/smoke-harvester-upgrade.js
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
    ERR_NAME_EXISTS: -3, ERR_RCL_NOT_ENOUGH: -14, ERR_NOT_OWNER: -1,
    ERR_INVALID_TARGET: -7, ERR_FULL: -8, ERR_TIRED: -11, ERR_NO_PATH: -2, ERR_NOT_IN_RANGE: -9,
    MOVE: 'move', WORK: 'work', CARRY: 'carry', ATTACK: 'attack',
    RANGED_ATTACK: 'ranged_attack', TOUGH: 'tough', HEAL: 'heal', CLAIM: 'claim',
    CONTROLLER_STRUCTURES: {
        [C.STRUCTURE_EXTENSION]: { 0: 0, 1: 0, 2: 3, 3: 5, 4: 10, 5: 20, 6: 30, 7: 40, 8: 60 },
        [C.STRUCTURE_CONTAINER]: { 0: 5, 1: 5, 2: 5, 3: 5, 4: 5, 5: 5, 6: 5, 7: 5, 8: 5 },
        [C.STRUCTURE_SPAWN]: { 0: 1, 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 7: 3, 8: 3 },
        [C.STRUCTURE_TOWER]: { 0: 0, 1: 0, 2: 0, 3: 1, 4: 2, 5: 3, 6: 4, 7: 5, 8: 6 },
        [C.STRUCTURE_STORAGE]: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 1, 5: 1, 6: 1, 7: 1, 8: 1 },
        [C.STRUCTURE_LINK]: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 1, 6: 1, 7: 1, 8: 1 },
        [C.STRUCTURE_LAB]: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 1, 5: 1, 6: 1, 7: 1, 8: 1 }
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
const upgrades = [];
const harvestIntents = [];
const transfers = [];
let tick = 1000;
let currentRoom = null;

// ---- the real E34S53 terrain (measured in the game) --------------------
// 0 = plain, 1 = wall, 2 = swamp. Row = y, column = x.
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
        inRangeTo(other, range) {
            return Math.max(Math.abs(this.x - other.x), Math.abs(this.y - other.y)) <= range;
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

    const containerEnergy = opts.containerEnergy === undefined ? 1950 : opts.containerEnergy;
    const container = {
        structureType: C.STRUCTURE_CONTAINER, pos: pos(19, 21), hits: 250000, hitsMax: 250000,
        store: {
            energy: containerEnergy,
            getCapacity() { return 2000; },
            getFreeCapacity() { return 2000 - containerEnergy; },
            getUsedCapacity() { return containerEnergy; }
        },
        room: null
    };

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
        name: `${role}_${i}`, pos: pos(x, y), my: true, hits: 300, hitsMax: 300,
        fatigue: 0,
        store: {
            energy: (memory && memory.energy) || 0,
            getFreeCapacity() { return 100 - this.energy; },
            getUsedCapacity() { return this.energy; }
        },
        body: [
            { type: 'work', hits: 100 }, { type: 'carry', hits: 100 }, { type: 'carry', hits: 100 },
            { type: 'move', hits: 100 }, { type: 'move', hits: 100 }
        ],
        memory: Object.assign({ role, homeRoom: 'E34S53' }, memory || {}),
        room: null,
        moveTo(target) {
            const p = target.pos || target;
            movedCreeps.push([this.name, this.pos.x, this.pos.y, p.x, p.y]);
            return OK;
        },
        upgradeController(controller) {
            const dx = Math.abs(this.pos.x - controller.pos.x);
            const dy = Math.abs(this.pos.y - controller.pos.y);
            const inRange = Math.max(dx, dy) <= 3;

            if (!inRange) {
                return ERR_NOT_IN_RANGE;
            }

            // The engine refuses to upgrade without energy in the backpack
            // (`Creep.upgradeController` -> `ERR_NOT_ENOUGH_RESOURCES`).
            if (this.store.energy <= 0) {
                return ERR_NOT_ENOUGH_ENERGY;
            }

            upgrades.push([this.name, this.pos.x, this.pos.y]);
            return OK;
        },
        moveByPath() { return -4; },
        harvest(target) {
            const dx = Math.abs(this.pos.x - target.pos.x);
            const dy = Math.abs(this.pos.y - target.pos.y);
            harvestIntents.push([this.name, this.pos.x, this.pos.y, target.pos.x, target.pos.y]);

            if (Math.max(dx, dy) > 1) {
                return ERR_NOT_IN_RANGE;
            }

            // The engine raises `creep.store` inside the harvest intent, and
            // `upgradeController` is executed later in the same tick - so a
            // creep that harvests 2 energy can spend 1 of them on the
            // controller right away, with an empty backpack beforehand.
            this.store.energy += 2;
            return OK;
        },
        transfer(target) {
            transfers.push([this.name, target.structureType, target.pos.x, target.pos.y]);
            return OK;
        },
        withdraw(target) {
            const dx = Math.abs(this.pos.x - target.pos.x);
            const dy = Math.abs(this.pos.y - target.pos.y);
            return Math.max(dx, dy) <= 1 ? OK : -9;
        },
        build() { return ERR_NOT_IN_RANGE; }
    }));

    const source = { type: 'source', pos: pos(19, 23), energy: 2500, room: null };

    const controller = {
        my: opts.controllerMy === undefined ? true : opts.controllerMy,
        level: 5, progress: 108500, progressTotal: 1215000, safeMode: 0,
        ticksToDowngrade: 40000, reservation: null, upgradeBlocked: false, pos: pos(17, 24)
    };

    const spawnEnergy = opts.spawnEnergy === undefined ? 300 : opts.spawnEnergy;
    const spawn = {
        name: 'Spawn1', structureType: C.STRUCTURE_SPAWN, pos: pos(19, 26), my: true,
        store: {
            energy: spawnEnergy,
            getCapacity() { return 300; },
            getFreeCapacity() { return 300 - spawnEnergy; },
            getUsedCapacity() { return spawnEnergy; }
        },
        spawning: null, room: null, usedEnergy: 0,
        spawnCreep() { return -4; }
    };

    const structures = [controller, spawn, container, ...extensions];
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

    // The live measurements of E34S53 on 2026-11-12: the income is 2.8
    // energy/tick, the churn of five creeps costs about 1.0, so the room's
    // budget is about 1.8 - enough for one upgrader and no builder.
    room.memory._incomeRate = 2.8;
    room.memory._harvestSlots = 3;
    room.memory._sourceSaturated = true;
    room.memory._workBudget = 1.77;

    for (const s of structures) s.room = room;
    for (const c of creeps) c.room = room;
    source.room = room;
    currentRoom = room;
    installPathFinder(() => currentRoom);
    return { room, spawn, controller, container, extensions, sites, source, creeps };
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

// The live layout of E34S53 on 2026-11-12: three harvest slots, the source
// on a wall tile, the container one tile away from the slot (20,22).
const EXTENSIONS = [
    [18, 26, 50], [18, 27, 50], [21, 26, 50], [20, 28, 50], [18, 28, 50],
    [19, 28, 50], [17, 27, 50], [17, 26, 50], [20, 25, 50], [21, 24, 50], [21, 25, 50]
];

function runTick(sim) {
    tick += 1;
    global.Game = makeGame(sim);
    global.Memory = global.Memory || {};

    upgrades.length = 0;
    harvestIntents.length = 0;
    transfers.length = 0;
    movedCreeps.length = 0;
    bot.loop();

    for (const [name, , , tx, ty] of movedCreeps) {
        const creep = sim.creeps.find((c) => c.name === name);
        if (creep && Number.isFinite(tx) && Number.isFinite(ty)) {
            creep.pos = pos(tx, ty);
        }
    }
}

// --- Scenario 1: a harvester on a harvest tile upgrades the controller ----
//
// The harvester stands on (20,23), one of the three harvest slots. The
// controller (17,24) is 3 cells away - the edge of the upgrade range, but
// inside it. The container has 50 free, so the harvester HAS a delivery
// target: before the fix it carried its energy across the swamp instead of
// upgrading the controller.
{
    const sim = makeRoom({
        extensions: EXTENSIONS,
        creeps: [[20, 23, 'harvester', { _harvestTile: { x: 20, y: 23 }, energy: 0 }]]
    });
    global.Memory = {};

    runTick(sim);

    const harvester = sim.creeps[0];

    check('the harvester harvests the source',
        harvestIntents.some((h) => h[0] === harvester.name && h[3] === 19 && h[4] === 23),
        JSON.stringify(harvestIntents));

    check('the harvester upgrades the controller in the same tick',
        upgrades.some((u) => u[0] === harvester.name && u[1] === 20 && u[2] === 23),
        JSON.stringify(upgrades));

    check('the harvester does not carry the energy away instead',
        transfers.length === 0,
        JSON.stringify(transfers));
}

// --- Scenario 2: outside the upgrade range there is no upgrade intent ----
//
// (24,23) is 7 cells from the controller: the upgrade would be refused by
// the engine (`ERR_NOT_IN_RANGE`), so no intent must be issued.
{
    const sim = makeRoom({
        extensions: EXTENSIONS,
        creeps: [[24, 23, 'harvester', { _harvestTile: { x: 24, y: 23 }, energy: 0 }]]
    });
    global.Memory = {};

    runTick(sim);

    check('a harvester outside the upgrade range does not upgrade',
        upgrades.length === 0,
        JSON.stringify(upgrades));
}

// --- Scenario 3: a full backpack is still delivered ------------------------
//
// The delivery must not break: with 99 energy in the backpack and 50 free
// in the container, the harvester hands the energy over. The upgrade intent
// is harmless here - the engine executes `transfer` before
// `upgradeController`, and the room's structures still get the energy.
{
    const sim = makeRoom({
        extensions: EXTENSIONS,
        creeps: [[20, 23, 'harvester', { _harvestTile: { x: 20, y: 23 }, energy: 99 }]]
    });
    global.Memory = {};

    runTick(sim);

    check('a harvester with a full backpack still delivers the energy',
        transfers.length === 1 && transfers[0][1] === C.STRUCTURE_CONTAINER,
        JSON.stringify(transfers));
}

// --- Scenario 4: a foreign controller is never upgraded --------------------
{
    const sim = makeRoom({
        extensions: EXTENSIONS,
        controllerMy: false,
        creeps: [[20, 23, 'harvester', { _harvestTile: { x: 20, y: 23 }, energy: 0 }]]
    });
    global.Memory = {};

    runTick(sim);

    check('a foreign controller is not upgraded',
        upgrades.length === 0,
        JSON.stringify(upgrades));
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);

if (failed > 0) {
    console.log('\nFailed checks:');
    for (const r of results.filter((x) => !x.ok)) {
        console.log(`  - ${r.name} ${r.detail}`);
    }
}

process.exit(failed > 0 ? 1 : 0);
