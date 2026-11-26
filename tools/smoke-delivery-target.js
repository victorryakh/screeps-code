/* Offline smoke test for the delivery target of a harvester.
 *
 * Reproduces the state E34S53 was in on 2026-11-23.
 *
 * The source lies on a wall tile, so its three harvest tiles (20,22), (20,23)
 * and (20,24) form a one-cell-wide alley. The only way out of the alley is
 * (20,21) - and the storages next to the harvest tiles are the extensions
 * (21,24), (20,25), (21,25) plus the tower (21,23). In the live room all of
 * them were full (50 of 50, 1000 of 1000), so the harvester on (20,24) had
 * no storage of its own to deliver to.
 *
 * The bot is supposed to answer "no delivery target" then and keep the energy
 * on the spot (it goes into the controller). Instead it picked the container
 * on (19,21): the only storage with free space near the source. That
 * container is unreachable from (20,24) - the only corridor runs through
 * (20,22), where another harvester stands - so the harvester walked to the
 * west of the room with a full backpack, left its harvest tile, and the
 * income of the room halved (measured: 4.0 -> 2.36 energy per tick).
 *
 * The check below pins the intended behaviour:
 *   1. A harvester whose own harvest tile has storages next to it, but no
 *      free space in them, has NO delivery target and does not walk away -
 *      it upgrades the controller on the spot.
 *   2. A harvester with a free storage next to its harvest tile delivers
 *      there, even when a bigger storage stands further away.
 *   3. A harvester whose harvest tile is next to a free storage delivers
 *      into that storage.
 *
 * Usage:
 *   bun run build && node tools/smoke-delivery-target.js
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
        [C.STRUCTURE_CONTAINER]: { 0: 5, 1: 5, 2: 5, 3: 5, 4: 5, 5: 5, 6: 5, 7: 5, 8: 5 },
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

// Terrain of E34S53 around the source, the controller and the pocket: the
// source stands on a wall tile, and the alley of harvest tiles is closed on
// the west by walls and on the east by our own towers and extensions.
const WALLS = new Set([
    '16,22', '16,23', '16,24',
    '17,21', '17,22', '17,23', '17,24', '17,25',
    '18,21', '18,22', '18,23', '18,24', '18,25',
    '19,22', '19,23', '19,24'
]);

const { installPathFinder } = require('./mock-pathfinder');

const notifications = [];
const createdSites = [];
let tick = 9000;
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

const BODIES = {
    // The real harvester body (see `bodyFor`): two WORK parts, one CARRY
    // part - a 50-energy backpack. The mock must match it, otherwise the
    // delivery rules are exercised on a body the bot never spawns.
    harvester: ['work', 'work', 'carry', 'move'],
    upgrader: ['work', 'work', 'carry', 'move'],
    builder: ['work', 'carry', 'carry', 'move', 'move'],
    repairer: ['work', 'carry', 'move', 'move']
};

function makeCreep(x, y, role, energy, memory) {
    const bodyParts = (BODIES[role] || BODIES.harvester).map((type) => ({ type, hits: 100 }));
    const capacity = bodyParts.filter((p) => p.type === 'carry').length * 50;
    const workParts = bodyParts.filter((p) => p.type === 'work').length;
    const store = {
        energy: energy || 0,
        getCapacity() { return capacity; },
        getFreeCapacity() { return Math.max(0, capacity - this.energy); }
    };

    return {
        name: `${role}_${x}_${y}`,
        pos: pos(x, y),
        my: true,
        hits: 300,
        hitsMax: 300,
        fatigue: 0,
        store,
        body: bodyParts,
        memory: Object.assign({ role, homeRoom: 'E34S53' }, memory || {}),
        room: null,
        actions: [],
        harvest(source) {
            if (!near(this.pos, source.pos)) {
                this.actions.push(['harvest-fail', source.pos.x, source.pos.y]);
                return ERR_NOT_IN_RANGE;
            }
            this.actions.push(['harvest', source.pos.x, source.pos.y]);
            // The engine gives 2 energy per tick per WORK part.
            const got = Math.min(2 * workParts, store.getFreeCapacity(), source.energy);
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
            // The engine spends one energy per WORK part per tick out of the
            // backpack: that is what keeps the backpack two energy below its
            // capacity while the harvester digs and upgrades in the same tick.
            store.energy -= Math.min(store.energy, workParts);
            return OK;
        },
        transfer(target) {
            if (!near(this.pos, target.pos)) {
                this.actions.push(['transfer-fail', target.pos.x, target.pos.y]);
                return ERR_NOT_IN_RANGE;
            }
            this.actions.push(['transfer', target.pos.x, target.pos.y]);
            const got = Math.min(store.getFreeCapacity(), target.store.energy);
            store.energy -= got;
            target.store.energy += got;
            return OK;
        },
        moveTo(target) {
            const p = target && target.pos ? target.pos : target;
            this.actions.push(['moveTo', p.x, p.y]);
            return OK;
        },
        moveByPath() { return -4; }
    };
}

function makeStore(energy, capacity) {
    return {
        energy: energy === undefined ? 0 : energy,
        getCapacity() { return capacity; },
        getFreeCapacity() { return capacity - this.energy; },
        getUsedCapacity() { return this.energy; }
    };
}

/**
 * Builds the pocket of E34S53 as it was on 2026-11-23.
 *
 * @param opts.extensions Energy in the extension on (21,24) - the storage next
 *                         to the harvest tile (20,24).
 */
function makeRoom(opts) {
    opts = opts || {};
    const creeps = (opts.creeps || []).map(([x, y, role, energy, memory]) =>
        makeCreep(x, y, role, energy, memory));

    const source = { type: 'source', pos: pos(19, 23), energy: 3000, room: null };
    const controller = {
        my: true, level: 5, progress: 600000, progressTotal: 1215000, safeMode: 0,
        ticksToDowngrade: 80000, reservation: null, upgradeBlocked: false, pos: pos(17, 24)
    };
    const spawn = {
        name: 'Spawn1', structureType: C.STRUCTURE_SPAWN, pos: pos(19, 26), my: true,
        store: makeStore(opts.spawnEnergy === undefined ? 165 : opts.spawnEnergy, 300),
        spawning: null, room: null,
        spawnCreep() { return -6; }
    };
    // The container is the big buffer of the pocket: it has free space, but it
    // stands next to the harvest tile (20,22) only.
    const container = {
        structureType: C.STRUCTURE_CONTAINER, pos: pos(19, 21), hits: 170000, hitsMax: 250000,
        store: makeStore(opts.containerEnergy === undefined ? 50 : opts.containerEnergy, 2000),
        room: null
    };
    const extensions = [
        [21, 24, 50],
        [20, 25, 50],
        [21, 25, 50]
    ].map(([x, y, energy]) => ({
        structureType: C.STRUCTURE_EXTENSION, pos: pos(x, y), my: true, hits: 1000, hitsMax: 1000,
        store: makeStore(energy, 50),
        room: null
    }));
    if (opts.extensionEnergy !== undefined) {
        extensions[0].store.energy = opts.extensionEnergy;
    }
    // The towers of the pocket: (21,23) stands right next to the harvest tile
    // (20,24), and it is full.
    const towers = [[21, 23], [21, 22]].map(([x, y]) => ({
        structureType: C.STRUCTURE_TOWER, pos: pos(x, y), my: true, hits: 3000, hitsMax: 3000,
        store: makeStore(1000, 1000),
        room: null
    }));

    const structures = [controller, spawn, container, ...extensions, ...towers];
    const sites = [];

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
            if (Array.isArray(type)) {
                const f = typeof filter === 'function' ? filter : null;
                return f ? type.filter(f) : type;
            }
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
    installPathFinder(() => currentRoom);

    return { room, spawn, controller, container, extensions, towers, source, creeps };
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

function runTick(sim) {
    tick += 1;
    global.Game = makeGame(sim);
    global.Memory = { creeps: {} };
    bot.loop();
}

function actions(creep, kind) {
    return creep.actions.filter((a) => a[0] === kind);
}

// --- Case 1: the storages next to the harvest tile are full ----------------
// The harvester on (20,24) has a full backpack and no free storage next to
// its own tile. It must not walk to the container on (19,21): that one is
// unreachable, and the walk costs the room its harvest tile.
{
    const sim = makeRoom({
        creeps: [
            [20, 22, 'harvester', 0, { _harvestTile: { x: 20, y: 22 } }],
            [20, 24, 'harvester', 60, { _harvestTile: { x: 20, y: 24 } }],
            [21, 21, 'harvester', 0, {}],
            [20, 21, 'upgrader', 30, {}],
            [16, 21, 'builder', 0, {}]
        ]
    });
    runTick(sim);
    const creep = sim.creeps[1];
    const moves = actions(creep, 'moveTo');
    const transfers = actions(creep, 'transfer');
    const upgrades = actions(creep, 'upgrade');

    check('a harvester with no free storage next to its tile does not walk away',
        moves.length === 0,
        JSON.stringify(moves.map((m) => `${m[1]},${m[2]}`)));
    check('a harvester with no free storage next to its tile does not deliver to a far storage',
        transfers.length === 0,
        JSON.stringify(transfers.map((m) => `${m[1]},${m[2]}`)));
    check('a harvester with no free storage next to its tile upgrades the controller on the spot',
        upgrades.length > 0);
    check('a harvester with no free storage next to its tile keeps digging',
        actions(creep, 'harvest').length > 0,
        JSON.stringify(actions(creep, 'harvest')));
}

// --- Case 2: the storage next to the harvest tile has free space -----------
// The harvester on (20,24) must deliver into the extension on (21,24) - one
// step away - and not into the container on (19,21).
{
    const sim = makeRoom({
        extensionEnergy: 0,
        creeps: [
            [20, 22, 'harvester', 0, { _harvestTile: { x: 20, y: 22 } }],
            [20, 24, 'harvester', 60, { _harvestTile: { x: 20, y: 24 } }],
            [21, 21, 'harvester', 0, {}],
            [20, 21, 'upgrader', 30, {}],
            [16, 21, 'builder', 0, {}]
        ]
    });
    runTick(sim);
    const creep = sim.creeps[1];
    const transfers = actions(creep, 'transfer');

    check('a harvester delivers into the free storage next to its own tile',
        transfers.length === 1 && transfers[0][1] === 21 && transfers[0][2] === 24,
        JSON.stringify(transfers.map((m) => `${m[1]},${m[2]}`)));
}

// --- Case 3: the neighbour of the other harvest tile has free space -------
// The harvester on (20,22) must keep delivering into the container on
// (19,21): the storages next to its tile have no free space, but the target
// it has always used is reachable and free.
{
    const sim = makeRoom({
        creeps: [
            [20, 22, 'harvester', 60, { _harvestTile: { x: 20, y: 22 } }],
            [20, 24, 'harvester', 0, { _harvestTile: { x: 20, y: 24 } }],
            [21, 21, 'harvester', 0, {}],
            [20, 21, 'upgrader', 30, {}],
            [16, 21, 'builder', 0, {}]
        ]
    });
    runTick(sim);
    const creep = sim.creeps[0];
    const transfers = actions(creep, 'transfer');

    check('a harvester with a free storage next to its tile delivers there',
        transfers.length === 1 && transfers[0][1] === 19 && transfers[0][2] === 21,
        JSON.stringify(transfers.map((m) => `${m[1]},${m[2]}`)));
}

// --- Case 4: a harvester without a delivery target keeps digging ----------
// The harvester has no storage to deliver to, so its energy goes into the
// controller. It must not stop working: it has to go back to its harvest
// tile and dig. Before the fix the harvester stood still with a full
// backpack until the backpack ran empty, and the room earned 2.0 energy per
// tick instead of 4.0.
{
    const sim = makeRoom({
        creeps: [
            [20, 22, 'harvester', 0, { _harvestTile: { x: 20, y: 22 } }],
            [20, 26, 'harvester', 100, { _harvestTile: { x: 20, y: 24 } }],
            [21, 21, 'harvester', 0, {}],
            [20, 21, 'upgrader', 30, {}],
            [16, 21, 'builder', 0, {}]
        ]
    });
    runTick(sim);
    const creep = sim.creeps[1];
    const moves = actions(creep, 'moveTo');
    const harvests = actions(creep, 'harvest');

    check('a harvester without a delivery target goes back to its harvest tile',
        moves.length > 0 && moves[0][1] === 20 && moves[0][2] === 24,
        JSON.stringify(moves.map((m) => `${m[1]},${m[2]}`)));
    check('a harvester without a delivery target does not stand still',
        moves.length > 0,
        JSON.stringify(harvests));
}

const failed = results.filter((r) => !r.ok);

console.log('');
console.log(`${results.length - failed.length}/${results.length} checks passed`);

if (failed.length > 0) {
    process.exit(1);
}
