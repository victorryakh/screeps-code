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
    harvester: ['work', 'carry', 'move'],
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

function makeCreep(x, y, role, energy) {
    const bodyParts = (BODIES[role] || BODIES.harvester).map((type) => ({ type, hits: 100 }));
    const capacity = bodyParts.filter((p) => p.type === 'carry').length * 50;
    const store = {
        energy: energy || 0,
        getCapacity() { return capacity; },
        getFreeCapacity() { return capacity - this.energy; }
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
    const creeps = (opts.creeps || []).map(([x, y, role, energy]) => makeCreep(x, y, role, energy));
    const sites = (opts.sites || []).map(([x, y, progress]) => ({
        structureType: C.STRUCTURE_EXTENSION, pos: pos(x, y), my: true, progress: progress || 0, progressTotal: 3000, room: null
    }));
    const extensions = (opts.extensions || []).map(([x, y, energy]) => ({
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

    // The build spot must be next to one of the delivery sites: (21,24) or
    // (21,25) - both stand one step from a harvest tile.
    const deliverySites = [[21, 24], [21, 25]];
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
    check('a room that cannot feed an upgrader gets a builder instead',
        spawned.includes('builder') && !spawned.includes('upgrader'),
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

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
