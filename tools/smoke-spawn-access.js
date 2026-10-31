/* Offline smoke test for the deployed bot bundle.
 *
 * Reproduces the failure that killed the colony in E34S53 on 2026-10-24: a
 * spawn whose eight neighbour tiles are all blocked, so the engine can never
 * place a new creep and the colony dies silently.
 *
 * Usage:
 *   bun run build && node tools/smoke-spawn-access.js
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
    STRUCTURE_CONTAINER: "container",
    STRUCTURE_CONTROLLER: "controller",
    STRUCTURE_EXTENSION: "extension",
    STRUCTURE_EXTRACTOR: "extractor",
    STRUCTURE_FACTORY: "factory",
    STRUCTURE_INVADER_CORE: "invaderCore",
    STRUCTURE_KEEPER_LAIR: "keeperLair",
    STRUCTURE_LAB: "lab",
    STRUCTURE_LINK: "link",
    STRUCTURE_NUKER: "nuker",
    STRUCTURE_OBSERVER: "observer",
    STRUCTURE_PORTAL: "portal",
    STRUCTURE_POWER_BANK: "powerBank",
    STRUCTURE_POWER_SPAWN: "powerSpawn",
    STRUCTURE_RAMPART: "rampart",
    STRUCTURE_ROAD: "road",
    STRUCTURE_SPAWN: "spawn",
    STRUCTURE_STORAGE: "storage",
    STRUCTURE_TERMINAL: "terminal",
    STRUCTURE_TOWER: "tower",
    STRUCTURE_WALL: "constructedWall",
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
        [C.STRUCTURE_SPAWN]: { 0: 1, 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 7: 3, 8: 3 }
    },
    global: global
});
global.global = global;
global.console = console;

const notifications = [];
const createdSites = [];
const destroyed = [];
let tick = 1000;

// ---- fake room -----------------------------------------------------------
const WALLS = new Set(['18,25']);
const SWAMP = new Set(['19,25', '20,25', '20,26']);

function pos(x, y) { return { x, y, roomName: 'E34S53' }; }

function makeRoom(opts) {
    opts = opts || {};
    const extensions = (opts.extensions || []).map(([x, y]) => ({
        structureType: C.STRUCTURE_EXTENSION, pos: pos(x, y), my: true, hits: 1000, hitsMax: 1000,
        store: { energy: 50 }, room: null,
        destroy() { destroyed.push([x, y]); return OK; }
    }));
    const sites = (opts.sites || []).map(([x, y]) => ({
        structureType: C.STRUCTURE_EXTENSION, pos: pos(x, y), my: true, progress: 0, progressTotal: 3000
    }));
    const source = { type: 'source', pos: pos(19, 23), energy: 3000, room: null };

    const controller = {
        my: true, level: 3, progress: 0, progressTotal: 600000, safeMode: 0,
        ticksToDowngrade: 100000, reservation: null, upgradeBlocked: false, pos: pos(17, 24)
    };
    const spawn = {
        name: 'Spawn1', structureType: C.STRUCTURE_SPAWN, pos: pos(19, 26), my: true,
        store: { energy: 300 }, spawning: null, room: null, usedEnergy: 0,
        spawnCreep() { return -4; } // ERR_BUSY — nothing spawns in the simulation
    };

    const structures = [controller, spawn, ...extensions];
    const room = {
        name: 'E34S53',
        controller,
        memory: {},
        find(type, o) {
            const filter = o && o.filter;
            let list = [];
            if (type === C.FIND_MY_SPAWNS) list = [spawn];
            else if (type === C.FIND_STRUCTURES || type === C.FIND_MY_STRUCTURES) list = structures;
            else if (type === C.FIND_CONSTRUCTION_SITES || type === C.FIND_MY_CONSTRUCTION_SITES) list = sites;
            else if (type === C.FIND_CREEPS || type === C.FIND_MY_CREEPS) list = [];
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
            return { get(x, y) {
                const k = `${x},${y}`;
                if (WALLS.has(k)) return 1;
                if (SWAMP.has(k)) return 2;
                return 0;
            } };
        },
        createConstructionSite(x, y, structureType) {
            createdSites.push([x, y, structureType]);
            sites.push({ structureType, pos: pos(x, y), my: true, progress: 0, progressTotal: 3000 });
            return OK;
        },
        lookAt(x, y) { return []; }
    };
    for (const s of structures) s.room = room;
    source.room = room;
    return { room, spawn, controller, extensions, sites, source };
}

// ---- game ----------------------------------------------------------------
let world = null;

function makeGame(sim) {
    world = sim;
    return {
        rooms: { E34S53: sim.room },
        creeps: {},
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

// ---- scenarios -----------------------------------------------------------
const results = [];
function check(name, cond, detail) {
    results.push({ name, ok: !!cond, detail: detail || '' });
    console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' :: ' + detail : ''}`);
}

const bot = require('/workspace/repo/dist/main.js');

function runTicks(sim, n, step) {
    for (let i = 0; i < n; i++) {
        tick += 1;
        global.Game = makeGame(sim);
        global.Memory = global.Memory || {};
        if (step) step(i);
        bot.loop();
    }
}

// --- Scenario 1: extensions must not be planned on the spawn's ring-1 ----
{
    const sim = makeRoom({ extensions: [[17, 25]], sites: [] });
    global.Memory = {};
    runTicks(sim, 3);
    const ring1 = createdSites.filter(([x, y]) => Math.max(Math.abs(x - 19), Math.abs(y - 26)) === 1);
    check('no extension site planned on the 8 tiles around the spawn',
        ring1.length === 0,
        `created=${JSON.stringify(createdSites)} ring1=${JSON.stringify(ring1)}`);
    check('extension sites are planned further out',
        createdSites.length > 0 && createdSites.every(([x, y]) => Math.max(Math.abs(x - 19), Math.abs(y - 26)) >= 2),
        JSON.stringify(createdSites));
}

// --- Scenario 2: sealed spawn is detected and reported --------------------
{
    createdSites.length = 0; destroyed.length = 0; notifications.length = 0;
    const sim = makeRoom({
        extensions: [[19, 25], [18, 26], [20, 26], [18, 27], [19, 27]],
        sites: [[20, 25], [20, 27], [17, 26], [19, 28], [21, 26]]
    });
    global.Memory = {};
    runTicks(sim, 3);
    check('sealed spawn is reported to the user',
        notifications.some((m) => /sealed/i.test(m)),
        JSON.stringify(notifications));
    check('nothing is destroyed before the heal delay',
        destroyed.length === 0, JSON.stringify(destroyed));
}

// --- Scenario 3: sealed spawn is self-healed --------------------------------
{
    destroyed.length = 0; notifications.length = 0;
    const sim = makeRoom({
        extensions: [[19, 25], [18, 26], [20, 26], [18, 27], [19, 27]],
        sites: [[20, 25], [20, 27], [17, 26], [19, 28], [21, 26]]
    });
    global.Memory = {};
    runTicks(sim, 40, () => { tick += 3; });
    check('an adjacent extension is destroyed to unseal the spawn',
        destroyed.length === 1 && Math.max(Math.abs(destroyed[0][0] - 19), Math.abs(destroyed[0][1] - 26)) === 1,
        JSON.stringify(destroyed));
    check('extensions are not destroyed repeatedly while the spawn stays sealed',
        destroyed.length === 1, JSON.stringify(destroyed));
}

// --- Scenario 4: a healthy spawn is left alone ------------------------------
{
    destroyed.length = 0; notifications.length = 0;
    const sim = makeRoom({
        extensions: [[19, 25], [18, 26], [20, 26]],
        sites: []
    });
    global.Memory = {};
    runTicks(sim, 40, () => { tick += 3; });
    check('a healthy spawn is not touched',
        destroyed.length === 0 && notifications.every((m) => !/sealed/i.test(m)),
        `destroyed=${JSON.stringify(destroyed)} notified=${JSON.stringify(notifications)}`);
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
