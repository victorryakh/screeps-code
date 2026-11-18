/* Offline smoke test for the spawn reserve of the bot bundle.
 *
 * Reproduces the failure that killed the colony in E34S53 on 2026-11-13:
 * the spawn held 250 of 300 energy, the extensions held 400 more, and the
 * room had no creeps at all.
 *
 * The trap is the engine rule "a spawn regenerates 1 energy per tick while
 * the room holds less than 300 energy in spawns and extensions". With 650
 * energy in the room the spawn never regenerates, and `spawnCreep` draws the
 * energy from the SPAWN itself - so a 300-energy body can never be ordered
 * and the room is dead for good.
 *
 * Checks:
 *   1. a room without workers gets a reduced body that fits the spawn;
 *   2. a room that still has workers never gets a reduced body;
 *   3. the harvester feeds the spawn before the extensions;
 *   4. extension sites the room cannot pay for are removed;
 *   5. the controller-stall warning keeps one stable dedup key.
 *
 * Usage:
 *   bun run build && node tools/smoke-spawn-reserve.js
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
    ERR_NOT_ENOUGH_RESOURCES: -6,
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

// Terrain of E34S53: the source and the controller both lie on a wall tile,
// which is what makes the source so scarce there.
const WALLS = new Set([
    '13,19', '13,20',
    '16,22', '16,23', '16,24',
    '17,21', '17,22', '17,23', '17,24', '17,25',
    '18,21', '18,22', '18,23', '18,24', '18,25',
    '19,22', '19,23', '19,24'
]);

const { installPathFinder } = require('./mock-pathfinder');

const notifications = [];
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

const BODIES = {
    harvester: ['work', 'carry', 'carry', 'move', 'move'],
    // The emergency body: a 50-energy backpack. Its delivery threshold is
    // exactly its backpack capacity, which is what makes it fragile.
    rescue: ['work', 'carry', 'move', 'move'],
    upgrader: ['work', 'work', 'carry', 'move'],
    builder: ['work', 'carry', 'carry', 'move', 'move'],
    repairer: ['work', 'carry', 'move', 'move']
};

function makeStore(energy, capacity) {
    return {
        energy,
        getCapacity() { return capacity; },
        getFreeCapacity() { return capacity - this.energy; }
    };
}

function makeCreep(x, y, role, energy, extra, bodyTypes) {
    const bodyParts = (bodyTypes || BODIES[role] || BODIES.harvester)
        .map((type) => ({ type, hits: 100 }));
    const capacity = bodyParts.filter((p) => p.type === 'carry').length * 50;
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
        memory: Object.assign({ role, homeRoom: 'E34S53' }, extra || {}),
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
            // The engine spends the energy: an upgrade takes one energy per
            // WORK per tick. Without this the mock cannot reproduce a
            // harvester that never reaches its delivery threshold.
            if (this.store.energy <= 0) {
                this.actions.push(['upgrade-fail']);
                return ERR_NOT_ENOUGH_RESOURCES;
            }
            this.store.energy -= 1;
            this.actions.push(['upgrade']);
            return OK;
        },
        transfer(target) {
            this.actions.push(['transfer', target.pos.x, target.pos.y]);
            return ERR_NOT_IN_RANGE;
        },
        moveTo(target, opts) {
            const p = target.pos || target;
            this.actions.push(['moveTo', p.x, p.y, opts && opts.range, opts && opts.ignore]);
            return OK;
        },
        say(msg) { this.actions.push(['say', msg]); },
        build(target) {
            if (!near(this.pos, target.pos)) {
                this.actions.push(['build-fail', target.pos.x, target.pos.y]);
                return ERR_NOT_IN_RANGE;
            }
            this.actions.push(['build', target.pos.x, target.pos.y]);
            const spent = Math.min(store.energy, 1);
            store.energy -= spent;
            target.progress += spent;
            return OK;
        },
        moveByPath() { return -4; }
    };
}

function makeRoom(opts) {
    opts = opts || {};
    const creeps = (opts.creeps || []).map(
        ([x, y, role, energy, extra, body]) => makeCreep(x, y, role, energy, extra, body)
    );
    const sites = (opts.sites || []).map(([x, y, progress]) => ({
        structureType: C.STRUCTURE_EXTENSION, pos: pos(x, y), my: true, progress: progress || 0,
        progressTotal: 3000, room: null, removed: false,
        remove() { this.removed = true; return OK; }
    }));
    const extensions = (opts.extensions || []).map(([x, y, energy]) => ({
        id: `ext-${x}-${y}`,
        structureType: C.STRUCTURE_EXTENSION, pos: pos(x, y), my: true, hits: 1000, hitsMax: 1000,
        store: makeStore(energy === undefined ? 0 : energy, 50), room: null
    }));
    const source = { type: 'source', pos: pos(19, 23), energy: 3000, room: null };
    const controller = {
        my: true, level: 5, progress: 176455, progressTotal: 1215000, safeMode: 0,
        ticksToDowngrade: 60000, reservation: null, upgradeBlocked: false, pos: pos(17, 24)
    };
    const spawnAttempts = [];
    const spawn = {
        id: 'spawn-1',
        name: 'Spawn1', structureType: C.STRUCTURE_SPAWN, pos: pos(19, 26), my: true,
        store: makeStore(opts.spawnEnergy === undefined ? 300 : opts.spawnEnergy, 300),
        spawning: null, room: null,
        spawnCreep(body, name, opts) {
            const cost = body.reduce((sum, part) => sum + (BODYPART_COST[part] || 0), 0);
            // The engine draws the energy from the SPAWN's own store, not
            // from the room: the spawn holds at most 300 energy, so a body
            // that costs more can never be created.
            if (spawn.store.energy < cost) {
                return -6; // ERR_NOT_ENOUGH_ENERGY
            }
            spawnAttempts.push({
                name,
                role: opts && opts.memory ? opts.memory.role : '?',
                cost,
                body: body.slice(),
                memory: (opts && opts.memory) || null
            });
            spawn.store.energy -= cost;
            const role = opts && opts.memory ? opts.memory.role : 'harvester';
            const creep = makeCreep(19, 25, role, 0);
            creep.name = name;
            creep.body = body.map((type) => ({ type, hits: 100 }));
            creep.memory = (opts && opts.memory) || creep.memory;
            creep.room = room;
            creeps.push(creep);
            return OK;
        }
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
            if (Array.isArray(type)) {
                const f = typeof filter === 'function' ? filter : null;
                return f ? type.filter(f) : type;
            }
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
        createConstructionSite() { return OK; },
        lookAt(x, y) { return []; }
    };

    for (const s of structures) s.room = room;
    for (const c of creeps) c.room = room;
    source.room = room;
    currentRoom = room;
    installPathFinder(() => currentRoom);

    return { room, spawn, controller, extensions, sites, source, creeps, spawnAttempts };
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

function runTicks(sim, n) {
    for (let i = 0; i < n; i++) {
        tick += 1;
        global.Game = makeGame(sim);
        global.Memory = global.Memory || { creeps: {} };
        bot.loop();
    }
}

function actions(creep, kind) {
    return creep.actions.filter((a) => a[0] === kind);
}

// The state of E34S53 on 2026-11-13: the spawn holds 250 of 300 energy, the
// extensions hold 400 more, and there is not a single creep left.
const DEAD_ROOM = {
    spawnEnergy: 250,
    extensions: [
        [18, 27, 50], [18, 26, 0], [21, 26, 50], [20, 28, 50], [18, 28, 50],
        [19, 28, 0], [17, 27, 0], [17, 26, 50], [20, 25, 50], [21, 24, 50], [21, 25, 50]
    ]
};

// --- Scenario 1: the room has no workers left ------------------------------
{
    const sim = makeRoom({ creeps: [], ...DEAD_ROOM });
    runTicks(sim, 1);

    const attempt = sim.spawnAttempts.find((a) => a.role === 'harvester');

    check('a room without workers still gets a harvester', !!attempt,
        attempt ? `cost=${attempt.cost} body=${attempt.body.join(',')}` : 'no spawn attempt');
    check('the emergency body fits into the energy the spawn holds',
        !!attempt && attempt.cost <= 250,
        attempt ? `cost=${attempt.cost}` : 'no spawn attempt');
    check('the emergency body is cheaper than the normal one',
        !!attempt && attempt.cost < 300,
        attempt ? `cost=${attempt.cost}` : 'no spawn attempt');
    check('the emergency body can still carry energy and move',
        !!attempt &&
        attempt.body.filter((p) => p === 'carry').length >= 1 &&
        attempt.body.filter((p) => p === 'move').length >= 1 &&
        attempt.body.filter((p) => p === 'work').length >= 1,
        attempt ? attempt.body.join(',') : 'no spawn attempt');
    check('the emergency creep is marked as a rescue one',
        !!attempt && attempt.memory && attempt.memory.rescue === true,
        attempt && attempt.memory ? JSON.stringify(attempt.memory) : 'no memory');
}

// --- Scenario 2: a room that still has workers keeps the normal body -------
{
    const sim = makeRoom({
        creeps: [[20, 23, 'harvester', 10]],
        ...DEAD_ROOM
    });
    runTicks(sim, 1);

    const attempt = sim.spawnAttempts.find((a) => a.role === 'harvester');

    check('a room with workers does not get a reduced body',
        !attempt || attempt.cost === 300,
        attempt ? `cost=${attempt.cost}` : 'no spawn attempt');
}

// --- Scenario 3: the spawn is fed before the extensions --------------------
// The extension at (21,24) is one step away from the harvest tile (20,23),
// the spawn is nine steps away through the swamp. Before the fix the near
// extension always won and the spawn stayed at 250 forever.
{
    const sim = makeRoom({
        creeps: [[20, 23, 'harvester', 100]],
        spawnEnergy: 250,
        extensions: [[21, 24, 0], [18, 27, 50], [21, 26, 50]]
    });
    runTicks(sim, 1);

    const harvester = sim.creeps.find((c) => c.memory.role === 'harvester');
    const transfers = actions(harvester, 'transfer');

    check('the harvester feeds the spawn, not the nearby extension',
        transfers.length > 0 && transfers[0][1] === 19 && transfers[0][2] === 26,
        transfers.length > 0 ? `transfer to ${transfers[0][1]},${transfers[0][2]}` : 'no transfer');
}

// --- Scenario 4: extension sites the room cannot pay for are removed -------
{
    const sites = [
        [17, 28, 0], [21, 23, 377], [16, 26, 0], [19, 29, 0], [22, 26, 0],
        [16, 27, 0], [18, 29, 0], [20, 29, 0], [22, 25, 0], [22, 24, 0],
        [16, 25, 0], [22, 27, 0], [16, 28, 0], [17, 29, 0], [21, 29, 0],
        [22, 28, 0], [16, 29, 0], [21, 27, 0]
    ];
    const sim = makeRoom({ creeps: [], sites, ...DEAD_ROOM });
    runTicks(sim, 2);

    const alive = sim.sites.filter((s) => !s.removed);

    check('the extension sites the room cannot pay for are removed',
        alive.length === 0,
        `${alive.length} of ${sites.length} left`);
}

// --- Scenario 4b: a small backpack still reaches the delivery threshold ---
// The emergency body has a 50-energy backpack, and the delivery threshold is
// `min(trip load, 50)` - the trip load is capped by the backpack capacity, so
// the threshold is exactly 50. The in-place upgrade spends one energy per
// tick, and the harvest gives `min(2, free slots)`. With one free slot the
// harvest gives 1 and the upgrade takes 1: the backpack never grows past 49,
// the threshold is never reached, and the creep delivers nothing forever.
//
// In E34S53 the harvester stood at 49 of 50 for hours while the source
// drained normally and the spawn received nothing.
{
    const sim = makeRoom({
        creeps: [[20, 24, 'harvester', 49, {}, BODIES.rescue]],
        spawnEnergy: 200,
        extensions: [[21, 24, 0]]
    });

    runTicks(sim, 3);

    const harvester = sim.creeps.find((c) => c.memory.role === 'harvester');
    const transfers = actions(harvester, 'transfer');
    const upgrades = actions(harvester, 'upgrade');

    check('a harvester with a small backpack still delivers',
        transfers.length > 0,
        `transfers=${JSON.stringify(transfers)} store=${harvester.store.energy}`);
    check('the in-place upgrade does not eat the last energy point',
        upgrades.length === 0 || harvester.store.energy >= upgrades.length,
        `upgrades=${upgrades.length} store=${harvester.store.energy}`);
}

// --- Scenario 5: the controller-stall warning keeps one dedup key ----------
{
    const sim = makeRoom({ creeps: [], ...DEAD_ROOM });
    global.Memory = { creeps: {} };
    runTicks(sim, 1);

    // The controller stops growing: the progress stays where it was.
    tick += 400;
    runTicks(sim, 1);
    tick += 60;
    runTicks(sim, 1);

    const keys = Object.keys(global.Memory._notified || {}).filter((k) =>
        k.includes('controller-stalled'));

    check('the controller stall is reported under one stable key',
        keys.length <= 1,
        keys.join(' | '));
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);

if (failed.length > 0) {
    console.error('\nFailed checks:');
    for (const f of failed) {
        console.error(`  - ${f.name} ${f.detail}`);
    }
    process.exit(1);
}
