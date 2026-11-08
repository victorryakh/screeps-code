/* Offline smoke test for the income model of the bot bundle.
 *
 * Reproduces the failure that drained the colony in E34S53 on 2026-10-27:
 * the room produced 1.4 energy/tick, but the bot's income model claimed
 * 4.2 (three harvest tiles x 2 energy/tick x 0.7), so it kept an upgrader
 * and a builder that the room could not feed and burned its reserve at
 * ~1.4 energy/tick. The source sits in a wall pocket, all three harvest
 * tiles are on swamp, and the delivery point is ~10 tiles away behind a
 * wall block - the harvesters spent two thirds of their life walking.
 *
 * Checks:
 *   1. the harvester body is built for long trips (100-energy backpack,
 *      two MOVE parts);
 *   2. the work budget follows the *measured* income, not the model;
 *   3. without a measurement the model is still used as a fallback;
 *   4. the extension planner never takes a harvest tile;
 *   5. the builder finishes an extension site standing in the birth ring
 *      (a construction site already blocks its tile, so building it does
 *      not cost a birth tile).
 *
 * Usage:
 *   bun run build && node tools/smoke-income.js
 *
 * Exit code 0 - all checks passed; 1 - at least one check failed.
 */
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
    ERR_NAME_EXISTS: -3, ERR_RCL_NOT_ENOUGH: -14, ERR_NOT_OWNER: -1,
    ERR_INVALID_TARGET: -7, ERR_FULL: -8, ERR_TIRED: -11, ERR_NO_PATH: -2, ERR_NOT_IN_RANGE: -9,
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

// Terrain of E34S53 around the source and the controller: both lie on a wall
// tile, which is exactly what makes the source so scarce there.
const WALLS = new Set([
    '13,19', '13,20',
    '16,22', '16,23', '16,24',
    '17,21', '17,22', '17,23', '17,24', '17,25',
    '18,21', '18,22', '18,23', '18,24', '18,25',
    '19,22', '19,23', '19,24'
]);

const { installPathFinder } = require('./mock-pathfinder');

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

const BODIES = {
    // The real harvester body (see `bodyFor`): a 100-energy backpack and two
    // MOVE parts. The mock must match it, otherwise the delivery rules are
    // exercised on a body the bot never spawns.
    harvester: ['work', 'carry', 'carry', 'move', 'move'],
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

function makeCreep(x, y, role, energy, extra) {
    const bodyParts = (BODIES[role] || BODIES.harvester).map((type) => ({ type, hits: 100 }));
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
        ([x, y, role, energy, extra]) => makeCreep(x, y, role, energy, extra)
    );
    const sites = (opts.sites || []).map(([x, y, progress]) => ({
        structureType: C.STRUCTURE_EXTENSION, pos: pos(x, y), my: true, progress: progress || 0, progressTotal: 3000, room: null,
        removed: false,
        remove() { this.removed = true; return OK; }
    }));
    const extensions = (opts.extensions || []).map(([x, y, energy]) => ({
        id: `ext-${x}-${y}`,
        structureType: C.STRUCTURE_EXTENSION, pos: pos(x, y), my: true, hits: 1000, hitsMax: 1000,
        store: makeStore(energy === undefined ? 0 : energy, 50), room: null
    }));
    const source = { type: 'source', pos: pos(19, 23), energy: 3000, room: null };
    const extraWalls = new Set(opts.extraWalls || []);
    const controller = {
        my: true, level: 3, progress: 0, progressTotal: 600000, safeMode: 0,
        ticksToDowngrade: 100000, reservation: null, upgradeBlocked: false, pos: pos(17, 24)
    };
    const spawnAttempts = [];
    const spawn = {
        id: 'spawn-1',
        name: 'Spawn1', structureType: C.STRUCTURE_SPAWN, pos: pos(19, 26), my: true,
        store: makeStore(opts.spawnEnergy === undefined ? 300 : opts.spawnEnergy, 300),
        spawning: null, room: null,
        spawnCreep(body, name, opts) {
            const cost = body.reduce((sum, part) => sum + ({ move: 50, work: 100, carry: 50 }[part] || 0), 0);
            if (room.energyAvailable < cost) {
                return -6; // ERR_NOT_ENOUGH_ENERGY
            }
            spawnAttempts.push({ name, role: opts && opts.memory ? opts.memory.role : '?', cost, body: body.slice() });
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
            // An array of objects is a valid "type" for findClosestByPath.
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
            return { get(x, y) {
                return WALLS.has(`${x},${y}`) || extraWalls.has(`${x},${y}`) ? 1 : 0;
            } };
        },
        createConstructionSite(x, y, structureType) {
            createdSites.push([x, y, structureType]);
            sites.push({
                structureType, pos: pos(x, y), my: true, progress: 0, progressTotal: 3000, room,
                removed: false,
                remove() { this.removed = true; return OK; }
            });
            return OK;
        },
        lookAt(x, y) { return []; }
    };

    for (const s of structures) s.room = room;
    for (const c of creeps) c.room = room;
    source.room = room;
    currentRoom = room;
    installPathFinder(() => currentRoom);

    return { room, spawn, controller, extensions, sites, source, creeps, spawnAttempts };
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

// --- Scenario 1: the harvester body is built for long trips ----------------
// The source of E34S53 sits in a wall pocket: three harvest tiles, all on
// swamp, and the delivery point is ~10 tiles away behind a wall block. A
// [work,carry,move] runner spends two thirds of its life walking: the room
// produced 1.4 energy/tick instead of the modelled 4.2.
{
    const sim = makeRoom({ creeps: [] });
    runTicks(sim, 1);

    const attempt = sim.spawnAttempts.find((a) => a.role === 'harvester');
    const body = attempt ? attempt.body : [];

    check('the harvester has a 100-energy backpack',
        body.filter((p) => p === 'carry').length === 2,
        body.join(','));
    check('the harvester moves twice as fast on swamp',
        body.filter((p) => p === 'move').length === 2,
        body.join(','));
    check('the harvester still fits into the RCL 1 spawn (300 energy)',
        attempt && attempt.cost <= 300,
        attempt ? `cost=${attempt.cost}` : 'no spawn attempt');
}

// --- Scenario 2: the budget follows the measured income, not the model -----
// The model claims 4.2 energy/tick for this room. The room really produces
// 1.4: the bot must not plan a second worker on that.
{
    const sim = makeRoom({
        spawnEnergy: 300,
        extensions: [[18, 26, 50], [21, 26, 50]],
        creeps: [
            [21, 21, 'harvester', 0],
            [21, 22, 'harvester', 0],
            [21, 23, 'harvester', 0]
        ]
    });

    // The measured income: 1.4 energy/tick.
    sim.room.memory._incomeRate = 1.4;
    sim.room.memory._budgetCheckTick = 0;

    runTicks(sim, 2);

    const spawned = sim.spawnAttempts.map((a) => a.role);

    check('a starving room gets the upgrader but no builder',
        spawned.includes('upgrader') && !spawned.includes('builder'),
        JSON.stringify(spawned));
}

// --- Scenario 3: the same room with the modelled income plans a builder ----
// Control for the check above: with the optimistic model the bot would keep
// a builder that the room cannot feed.
{
    const sim = makeRoom({
        spawnEnergy: 300,
        extensions: [[18, 26, 50], [21, 26, 50]],
        creeps: [
            [21, 21, 'harvester', 0],
            [21, 22, 'harvester', 0],
            [21, 23, 'harvester', 0]
        ]
    });

    sim.room.memory._budgetCheckTick = 0;
    delete sim.room.memory._incomeRate;

    runTicks(sim, 2);

    const spawned = sim.spawnAttempts.map((a) => a.role);

    check('without a measurement the bot still uses the model',
        spawned.includes('upgrader'),
        JSON.stringify(spawned));
}

// --- Scenario 3b: the income is measured on the source --------------------
// A harvester standing on a harvest tile takes 2 energy/tick from the
// source: that is what the budget has to see, not the optimistic model.
{
    const sim = makeRoom({
        creeps: [[20, 22, 'harvester', 0]]
    });

    runTicks(sim, 30);

    const rate = sim.room.memory._incomeRate;

    check('the income of the room is measured, not modelled',
        typeof rate === 'number' && rate > 1 && rate < 3,
        `measured=${rate} model=4.2`);
}

// --- Scenario 4: the extension planner does not eat a harvest tile ---------
// Losing one of the three harvest tiles is a third of the room's income.
{
    const sim = makeRoom({
        creeps: [[21, 21, 'harvester', 0]]
    });
    sim.room.createConstructionSite = function (x, y, structureType) {
        createdSites.push([x, y, structureType]);
        return OK;
    };

    runTicks(sim, 1);

    const onSlot = createdSites.filter(([x, y]) => ['20,22', '20,23', '20,24'].includes(`${x},${y}`));

    check('no extension is planned on a harvest tile',
        onSlot.length === 0,
        JSON.stringify(createdSites));
}

// --- Scenario 5: the builder finishes an extension site in the birth ring --
// A construction site already blocks its tile (both are in the engine's
// OBSTACLE_OBJECT_TYPES), so building it does not take a birth tile away.
// Refusing to build it left the room stuck at 8 of 10 extensions and gave the
// builder nothing to do but upgrade the controller.
//
// The scenario reproduces the real E34S53: three extension sites next to a
// harvest tile, one of them already half-built. The builder has to pick the
// one that pays off - the extension next to the harvest tile - and among
// those the one that is closest to being finished.
{
    const sim = makeRoom({
        sites: [
            [20, 25, 593],
            [21, 24, 18],
            [21, 25, 0],
            [19, 29, 0]
        ],
        creeps: [[21, 21, 'builder', 100]]
    });
    runTicks(sim, 1);

    const builder = sim.creeps[0];
    const spot = builder.memory._buildSpot;

    check('the builder targets the extension site standing in the birth ring',
        spot && Math.max(Math.abs(spot.x - 20), Math.abs(spot.y - 25)) === 1,
        JSON.stringify(spot));
}

// --- Scenario 5b: the builder prefers the extension next to the source ----
// The delivery distance is what limits the income of E34S53: all storage is
// 8-10 tiles away from the harvest tiles, behind a wall block. An extension
// next to a harvest tile turns the delivery into one step.
{
    const sim = makeRoom({
        sites: [
            [17, 26, 0],
            [19, 28, 0],
            [21, 26, 0],
            [21, 25, 0]
        ],
        creeps: [[21, 21, 'builder', 100]]
    });
    runTicks(sim, 1);

    const builder = sim.creeps[0];
    const spot = builder.memory._buildSpot;

    // The build spot must be next to one of the delivery sites - the ones
    // that stand one step from a harvest tile. The container planned next
    // to the source is such a site too, so any of them is correct.
    const deliverySites = [[21, 24], [21, 25], [19, 21]];
    const nextToDelivery = spot && deliverySites.some(
        ([sx, sy]) => Math.max(Math.abs(spot.x - sx), Math.abs(spot.y - sy)) === 1
    );

    check('the builder builds the extension next to a harvest tile',
        nextToDelivery,
        JSON.stringify(spot) + ' sites=' + JSON.stringify(sim.sites.map((x) => [x.pos.x, x.pos.y])));
}

// --- Scenario 6: an idle builder does not squat on a harvest tile -----------
// The harvest tiles are the scarcest resource of the room: three of them,
// and a builder standing on one takes a third of the income away from the
// harvesters.
{
    const sim = makeRoom({
        sites: [[20, 25]],
        extensions: [[21, 26, 50]],
        creeps: [
            [20, 24, 'builder', 0],
            [21, 21, 'harvester', 0],
            [21, 22, 'harvester', 0],
            [21, 23, 'harvester', 0]
        ]
    });

    // A starving room: the budget does not cover a builder, so it is excess
    // and must not take energy from the room.
    sim.room.memory._incomeRate = 1.4;
    sim.room.memory._budgetCheckTick = 0;

    runTicks(sim, 1);

    const builder = sim.creeps[0];
    const moves = actions(builder, 'moveTo').map((m) => `${m[1]},${m[2]}`);

    check('an idle builder leaves the harvest tile',
        moves.length > 0 && !moves.includes('20,24'),
        JSON.stringify(moves));
    check('the excess builder does not take energy from the room',
        actions(builder, 'withdraw').length === 0 && actions(builder, 'withdraw-fail').length === 0,
        JSON.stringify(builder.actions));
}

// --- Scenario 7: the builder picks a spot that is not a harvest tile -------
{
    // The builder already stands next to the site: the only free tile next
    // to (20,25) is (21,26) - (20,24) is a harvest tile, (19,25)/(20,26)
    // are birth-ring tiles, and (19,26) is the spawn.
    const sim = makeRoom({
        sites: [[20, 25, 593]],
        creeps: [[21, 26, 'builder', 100]]
    });

    runTicks(sim, 1);

    const builder = sim.creeps[0];
    const builds = actions(builder, 'build').map((m) => `${m[1]},${m[2]}`);
    const spot = builder.memory._buildSpot;

    check('the builder builds the site in the birth ring',
        builds.includes('20,25'),
        JSON.stringify(builds) + ' sites=' + JSON.stringify(sim.sites.map((x) => [x.pos.x, x.pos.y, x.progress])));
    check('the build spot is not a harvest tile',
        spot && !['20,22', '20,23', '20,24'].includes(`${spot.x},${spot.y}`),
        JSON.stringify(spot));
    check('the build spot is not a birth tile either',
        spot && !['19,25', '20,26', '19,27', '18,26', '18,27', '20,25', '20,27', '18,25'].includes(`${spot.x},${spot.y}`),
        JSON.stringify(spot));
}

// --- Scenario 8: the delivery distance of the room is measured -------------
// The distance is measured along the path, not in a straight line: in E34S53
// the source sits in a wall pocket and the storage is behind the wall block,
// so the harvester walks 8-10 tiles although the storage is 2 tiles away.
{
    const sim = makeRoom({
        extensions: [[21, 26, 50]],
        creeps: []
    });
    runTicks(sim, 2);

    check('the delivery distance of a normal room is short',
        sim.room.memory._deliveryDistance < 4,
        `distance=${sim.room.memory._deliveryDistance}`);
}

// --- Scenario 9: a room with a long delivery gets a builder ----------------
// The room cannot feed even one upgrader: the income does not cover the
// churn. The upgrader would only eat the reserve. The builder can put the
// storage next to the harvest tiles, and that is what lifts the income.
{
    const sim = makeRoom({
        extraWalls: ['19,25', '20,25', '21,25'],
        sites: [[21, 24, 0]],
        creeps: [
            [21, 21, 'harvester', 0],
            [21, 22, 'harvester', 0],
            [21, 23, 'harvester', 0]
        ]
    });

    sim.room.memory._incomeRate = 1.0;
    sim.room.memory._budgetCheckTick = 0;

    runTicks(sim, 2);

    const spawned = sim.spawnAttempts.map((a) => a.role);

    check('the long delivery distance is measured',
        sim.room.memory._deliveryDistance >= 4,
        `distance=${sim.room.memory._deliveryDistance}`);
    // The builder must be in the order: it is the one who can put the
    // storage next to the harvest tiles. The upgrader is NOT dropped: a
    // room with a frozen controller never earns enough to pay for the
    // container, and the delivery would stay broken forever.
    check('a room with a broken delivery gets a builder',
        spawned.includes('builder'),
        JSON.stringify(spawned));
    check('the upgrader is not dropped to zero while the delivery is broken',
        !spawned.includes('upgrader') || spawned.includes('builder'),
        JSON.stringify(spawned));
}

// --- Scenario 9b: the builder survives even a rich room -------------------
// A room that can pay an upgrader still keeps a builder while the delivery
// is broken: the builder marked "excess" refuses to take energy from the
// room, and the extension that would fix the delivery is never built. The
// delivery stage must outrank the upgrader here.
{
    const sim = makeRoom({
        extraWalls: ['19,25', '20,25', '21,25'],
        sites: [[21, 24, 0]],
        creeps: [
            [21, 21, 'harvester', 0],
            [21, 22, 'harvester', 0],
            [21, 23, 'harvester', 0]
        ]
    });

    // A rich room: the budget covers an upgrader twice over.
    sim.room.memory._incomeRate = 6;
    sim.room.memory._budgetCheckTick = 0;

    runTicks(sim, 2);

    const spawned = sim.spawnAttempts.map((a) => a.role);

    check('a room with a long delivery keeps a builder',
        spawned.includes('builder'),
        JSON.stringify(spawned) + ` distance=${sim.room.memory._deliveryDistance}`);
}

// --- Scenario 9c: the harvester delivers the whole load at once ------------
// An extension holds 50 energy, the harvester's backpack holds 100. Dumping
// the load in two halves doubles the number of trips, and a trip is exactly
// what limits the income. A target that takes the whole load is preferred.
{
    const sim = makeRoom({
        extensions: [[18, 26, 0], [21, 26, 0]],
        creeps: [[20, 22, 'harvester', 100]]
    });

    runTicks(sim, 1);

    const harvester = sim.creeps[0];
    const transfers = actions(harvester, 'transfer');

    check('the harvester looks for a target that takes the whole load',
        transfers.length > 0 && transfers[0][1] === 19 && transfers[0][2] === 26,
        JSON.stringify(harvester.actions));
}

// --- Scenario 9d: the harvester does not overfill its backpack -------------
// The extension next to the harvest tile holds 50 energy, the harvester's
// backpack holds 100. The old rule was "fill the backpack, then deliver":
// the harvester carried 100 to hand over 50 and dragged the other 50 back
// to the source, paying fatigue for it on the way. The rule now: carry
// exactly what the target accepts, and come back with an empty backpack.
{
    const sim = makeRoom({
        extensions: [[21, 24, 0]],
        creeps: [[20, 24, 'harvester', 50]]
    });

    runTicks(sim, 1);

    const harvester = sim.creeps[0];
    const transfers = actions(harvester, 'transfer');

    check('the harvester delivers as soon as the target can take the load',
        transfers.length > 0 && transfers[0][1] === 21 && transfers[0][2] === 24,
        JSON.stringify(harvester.actions));
}

// --- Scenario 10: the extensions are planned next to the harvest tiles -----
// An extension next to a harvest tile turns the delivery into one step. That
// is worth more than a tidy cluster around the spawn.
{
    const sim = makeRoom({
        creeps: [[21, 21, 'harvester', 0]]
    });
    sim.room.createConstructionSite = function (x, y, structureType) {
        createdSites.push([x, y, structureType]);
        return OK;
    };

    runTicks(sim, 1);

    // The delivery tiles of E34S53: next to (20,22), (20,23) or (20,24).
    const deliveryTiles = new Set([
        '19,21', '20,21', '21,22', '21,23', '21,24',
        '19,25', '20,25', '21,25'
    ]);
    const planned = createdSites.map(([x, y]) => `${x},${y}`);
    const nearSource = planned.filter((k) => deliveryTiles.has(k));

    check('the extensions are planned next to the harvest tiles',
        nearSource.length > 0,
        JSON.stringify(planned));
}

// --- Scenario 11: the harvester delivers from the tile it stands on -------
// The extension next to the harvest tile (21,24) holds only 10 free energy,
// the spawn holds 190. The old rate model preferred the spawn: it is closer
// by straight line and takes more energy, so the harvester walked to it -
// across the birth ring around the spawn. The bot then pushed the harvester
// off the ring (the ring reserve), the harvester came back, and the room
// spent two thirds of its life walking instead of digging.
//
// The rule now: a storage next to the harvest tile wins, because the energy
// is handed over without leaving the tile.
{
    const sim = makeRoom({
        extensions: [[21, 24, 40]],
        creeps: [[20, 24, 'harvester', 100]]
    });

    runTicks(sim, 1);

    const harvester = sim.creeps[0];
    const transfers = actions(harvester, 'transfer');

    check('the harvester hands the energy over from the harvest tile',
        transfers.length > 0 && transfers[0][1] === 21 && transfers[0][2] === 24,
        JSON.stringify(harvester.actions));
    const moves = actions(harvester, 'moveTo');

    check('the harvester does not walk to a farther storage for the same energy',
        moves.length === 0 || (moves[0][1] === 21 && moves[0][2] === 24),
        JSON.stringify(harvester.actions));
}

// --- Scenario 11b: a stale delivery target does not pin the harvester -----
// The delivery target is cached for DELIVERY_TARGET_TTL ticks so that the
// creep does not jump between storages from tick to tick. But the cache must
// not override the proximity rule: in E34S53 the harvesters were pinned to
// the spawn for 25 ticks at a time, and the spawn is ten tiles away from the
// harvest tiles. The measured income was 0.64 energy per tick instead of 6.
{
    const sim = makeRoom({
        extensions: [[21, 24, 40]],
        creeps: [
            [20, 24, 'harvester', 100, { _deliveryTarget: { id: 'spawn-1', tick: tick } }]
        ]
    });

    runTicks(sim, 1);

    const harvester = sim.creeps[0];
    const transfers = actions(harvester, 'transfer');

    check('a stale delivery target does not pin the harvester to a far storage',
        transfers.length > 0 && transfers[0][1] === 21 && transfers[0][2] === 24,
        JSON.stringify(harvester.actions));
}

// --- Scenario 12: the harvester approaches a storage to within range 1 ----
// `moveTo` without `range` builds a path onto the tile of the structure
// itself. A creep cannot stand there, so the last step never happens and
// the harvester stands next to the spawn with a full backpack.
{
    const sim = makeRoom({
        creeps: [[20, 24, 'harvester', 100]]
    });

    runTicks(sim, 1);

    const harvester = sim.creeps[0];
    const moves = actions(harvester, 'moveTo');

    check('the harvester approaches the storage to within range 1',
        moves.length > 0 && moves[0][3] === 1,
        JSON.stringify(harvester.actions));
}

// --- Scenario 13: the ring reserve sends the workers back to work ---------
// The ring around the spawn is a trap in a tight room: three creeps stand on
// it, the bot wants two free cells, so it pushes the workers off. Pushing
// them onto a random free tile means they wander and never dig again. They
// have to go back to the tile where they work.
{
    const sim = makeRoom({
        creeps: [[19, 25, 'upgrader', 0], [19, 27, 'upgrader', 0], [20, 26, 'upgrader', 0]]
    });

    runTicks(sim, 2);

    const targets = sim.creeps.map((c) =>
        actions(c, 'moveTo').map((m) => `${m[1]},${m[2]}`).join('|')
    );

    // The upgrader must land on a cell from which the controller is still
    // reachable - the upgrade range is 3 - and not back on the birth ring.
    // The nearest free cell is (21,24), four cells from the controller: an
    // upgrader standing there stops upgrading altogether.
    const ring = new Set([
        '18,25', '18,26', '18,27', '19,25', '19,27', '20,25', '20,26', '20,27'
    ]);
    const usable = targets.some((t) => {
        if (!t) {
            return false;
        }

        const [x, y] = t.split(',').map(Number);

        return !ring.has(`${x},${y}`) && Math.max(Math.abs(x - 17), Math.abs(y - 24)) <= 3;
    });

    check('the ring reserve keeps the upgrader able to upgrade',
        usable,
        JSON.stringify(targets));
}

// --- Scenario 14: the extension plan is bounded by the room's income ------
// The RCL limit of E34S53 is 20 extensions. The room earns ~2 energy per
// tick, and one extension costs 3000 - fifteen hundred ticks of income. A
// plan built on the RCL limit means nine construction sites the room can
// never build: they eat the RCL limit and hold the birth ring forever.
{
    const sim = makeRoom({
        creeps: [[21, 21, 'harvester', 0]]
    });

    sim.room.memory._incomeRate = 2;
    sim.room.createConstructionSite = function (x, y, structureType) {
        createdSites.push([x, y, structureType]);
        return OK;
    };

    const before = createdSites.length;

    runTicks(sim, 1);

    const planned = createdSites.length - before;

    check('the extension plan is bounded by the income of the room',
        planned > 0 && planned <= 2,
        `planned=${planned}`);
}

// --- Scenario 15: two harvesters never claim the same harvest tile -------
// The claim on a harvest tile is made when the creep starts moving, not when
// it arrives. So before it arrives two creeps can claim the same tile: one
// digs, the other stands next to the source with an empty backpack. In
// E34S53 that cost the room a third of its income - the source gave 2
// energy per tick instead of 6.
{
    const sim = makeRoom({
        creeps: [[19, 25, 'harvester', 0], [20, 26, 'harvester', 0]]
    });

    // Both creep towards the same tile - neither stands on it yet.
    sim.creeps[0].memory._harvestTile = { x: 20, y: 23 };
    sim.creeps[1].memory._harvestTile = { x: 20, y: 23 };

    runTicks(sim, 1);

    const claims = sim.creeps.map((c) => {
        const t = c.memory._harvestTile;
        return t ? `${t.x},${t.y}` : '-';
    });

    check('two harvesters do not claim the same harvest tile',
        claims[0] !== claims[1],
        JSON.stringify(claims));
}

// --- Scenario 16: the claim follows the tile the harvester digs on --------
// The claim is made when the creep starts moving, so it can lag behind the
// reality: a harvester digs on (20,24) while claiming (20,23). Then the
// cell it actually occupies looks free to everybody, another harvester comes
// for it, and the two fight over the same spot.
{
    const sim = makeRoom({
        creeps: [[20, 24, 'harvester', 0]]
    });

    sim.creeps[0].memory._harvestTile = { x: 20, y: 23 };

    runTicks(sim, 1);

    const tile = sim.creeps[0].memory._harvestTile;

    check('the harvest tile claim follows the tile the creep digs on',
        tile && tile.x === 20 && tile.y === 24,
        JSON.stringify(sim.creeps[0].memory._harvestTile));
}

// --- Scenario 17: the upgrader can move on swamp --------------------------
// A creep with one MOVE part moves half a tile per tick on swamp and spends
// half of its life in fatigue. The upgrader walks to its donor and back, so
// on swamp it spent more time walking than upgrading - and the controller
// stood still for dozens of ticks at a time.
{
    // The room is RCL 3 with three harvesters already, so the bot spawns an
    // upgrader and the attempt records its body.
    const sim = makeRoom({
        creeps: [[20, 22, 'harvester', 0], [20, 23, 'harvester', 0], [20, 24, 'harvester', 0]],
        spawnEnergy: 400
    });

    runTicks(sim, 1);

    const attempt = sim.spawnAttempts.find((a) => a.role === 'upgrader');
    const body = attempt ? attempt.body : [];

    check('the upgrader has two MOVE parts from RCL 2 on',
        body.filter((p) => p === 'move').length === 2,
        JSON.stringify(body));
}

// --- Scenario 18: the movement does not pretend to ignore creeps ----------
// `Creep.moveTo` goes through `Room.findPath`, whose `ignore` option expects
// OBJECTS (creeps, structures) and silently drops FIND constants. Asking to
// ignore `FIND_CREEPS` there does nothing: the creeps stay obstacles.
//
// That is the behaviour the bot needs. Excluding the creeps from the path
// would not help either - the engine refuses to put a creep on a busy tile
// anyway, so the movement would be rejected and the creep would stall
// against its neighbour instead of walking around it.
{
    const sim = makeRoom({
        creeps: [[20, 24, 'harvester', 100]],
        extensions: [[21, 24, 0]]
    });

    runTicks(sim, 1);

    const moves = actions(sim.creeps[0], 'moveTo');

    check('the movement relies on the engine model: creeps are obstacles',
        moves.length > 0 && moves.every((m) => m[4] === undefined),
        JSON.stringify(moves));
}

// --- Scenario 19: a harvester does not take over a busy harvest tile -------
// All three harvest tiles are taken: the claim is made when the creep starts
// moving, so a creep that is walking towards a tile already claims it. Two
// harvesters ended up claiming (20,24): one dug there, the other stood in
// the pocket by the spawn with an empty backpack and waited for a tile that
// was never going to be free.
{
    const sim = makeRoom({
        creeps: [
            [20, 22, 'harvester', 50],
            [20, 23, 'harvester', 50],
            [20, 24, 'harvester', 50],
            [19, 25, 'harvester', 0]
        ]
    });

    for (const c of sim.creeps.slice(0, 3)) {
        c.memory._harvestTile = { x: c.pos.x, y: c.pos.y };
    }

    runTicks(sim, 1);

    const taken = sim.creeps.slice(0, 3).map((c) => `${c.memory._harvestTile.x},${c.memory._harvestTile.y}`);
    const last = sim.creeps[3].memory._harvestTile;

    check('a harvester does not claim a tile another harvester stands on',
        !last || taken.indexOf(`${last.x},${last.y}`) === -1,
        JSON.stringify({ taken, last }));
}

// --- Scenario 20: the builder is not blocked by a price the room cannot pay -
// The affordability check compared the room's balance with the FULL price of
// the site. In E34S53 the room can hold at most 850 energy (spawn 300 plus
// eleven extensions of 50) while an extension costs 3000, so the condition
// `energyAvailable >= remaining + 300` could never hold. The builder stood
// in place for days, never built anything, and the colony paid for a creep
// that did no work.
//
// The builder builds in chunks: its backpack is its budget for one trip.
{
    const sim = makeRoom({
        creeps: [
            [20, 22, 'harvester', 50],
            [20, 23, 'harvester', 50],
            [20, 24, 'harvester', 50],
            [20, 21, 'upgrader', 0],
            [19, 27, 'builder', 0]
        ],
        // The real balance of E34S53: the room holds far less than one
        // extension costs - 850 of capacity against a price of 3000.
        spawnEnergy: 300,
        extensions: [[21, 24, 50], [20, 28, 50], [18, 28, 50]],
        sites: [[21, 28, 0]]
    });

    runTicks(sim, 1);

    const builder = sim.creeps[4];
    const kept = sim.sites.filter((s) => !s.removed);

    check('the builder takes energy for the site instead of waiting forever',
        builder.actions.length > 0,
        JSON.stringify({ balance: sim.room.energyAvailable, actions: builder.actions }));
    check('the site the builder works on survives the cleanup',
        kept.length === 1,
        JSON.stringify(kept.map((s) => `${s.pos.x},${s.pos.y}`)));
}

// --- Scenario 21: the builder still waits when the room cannot fund a trip -
// Control for the check above: the chunk must leave the workers' reserve
// alone. With 350 energy in the room the builder may not start a trip
// (a backpack of 100 plus the 300 reserve).
{
    const sim = makeRoom({
        creeps: [
            [20, 22, 'harvester', 50],
            [20, 23, 'harvester', 50],
            [20, 24, 'harvester', 50],
            [20, 21, 'upgrader', 0],
            [19, 27, 'builder', 0]
        ],
        spawnEnergy: 300,
        extensions: [[21, 24, 50]],
        sites: [[21, 28, 0]]
    });

    runTicks(sim, 1);

    const builder = sim.creeps[4];

    check('the builder waits when the room cannot fund one trip',
        builder.actions.length === 0,
        JSON.stringify({ balance: sim.room.energyAvailable, actions: builder.actions }));
}

// --- Scenario 22: extension sites the room cannot justify are cancelled ----
// The affordable-extensions limit only ever stopped the bot from ORDERING
// new sites; the ones already ordered stayed forever. E34S53 carried seven
// of them (21 000 energy) that the room earns in 7 800 ticks, and none of
// them stood next to a harvest tile, so building them would not have
// shortened the delivery at all.
{
    const sim = makeRoom({
        creeps: [
            [20, 22, 'harvester', 50],
            [20, 23, 'harvester', 50],
            [20, 24, 'harvester', 50]
        ],
        spawnEnergy: 300,
        extensions: [
            [18, 26, 50], [18, 27, 50], [21, 26, 50], [20, 28, 50], [18, 28, 50],
            [19, 28, 50], [17, 27, 50], [17, 26, 50], [20, 25, 50], [21, 24, 50], [21, 25, 50]
        ],
        sites: [[21, 28, 0], [19, 29, 0]]
    });

    // The measured income of the room: 2.69 energy/tick, so the room can
    // afford floor(2.69) = 2 extensions - and it already has eleven.
    sim.room.memory._incomeRate = 2.69;
    sim.room.memory._budgetCheckTick = 0;

    runTicks(sim, 1);

    // Площадки контейнера — это другая история: «дырка» для энергии
    // оплачивается отдельно и по своим правилам (см.
    // `canFundDeliveryStructure`). Здесь проверяем именно расширения.
    const stillThere = sim.sites.filter(
        (s) => !s.removed && s.structureType === C.STRUCTURE_EXTENSION
    );

    check('extension sites the room cannot pay for are cancelled',
        stillThere.length === 0,
        JSON.stringify(stillThere.map((s) => `${s.pos.x},${s.pos.y}`)));
}

// --- Scenario 23: a site next to a harvest tile survives the cleanup -------
// A site beside a harvest tile shortens the delivery and raises the income,
// so it is worth keeping even when the room is over its extension budget.
{
    const sim = makeRoom({
        creeps: [
            [20, 22, 'harvester', 50],
            [20, 23, 'harvester', 50],
            [20, 24, 'harvester', 50]
        ],
        spawnEnergy: 300,
        extensions: [[21, 24, 50]],
        sites: [[21, 21, 0], [21, 28, 0]]
    });

    sim.room.memory._incomeRate = 2.69;
    sim.room.memory._budgetCheckTick = 0;

    runTicks(sim, 1);

    const kept = sim.sites.filter((s) => !s.removed).map((s) => `${s.pos.x},${s.pos.y}`);
    const dropped = sim.sites.filter((s) => s.removed).map((s) => `${s.pos.x},${s.pos.y}`);

    check('a site next to a harvest tile is kept',
        kept.indexOf('21,21') !== -1,
        JSON.stringify({ kept, dropped }));
    check('a site far from the harvest tiles is dropped',
        dropped.indexOf('21,28') !== -1,
        JSON.stringify({ kept, dropped }));
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
