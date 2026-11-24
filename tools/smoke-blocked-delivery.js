/* Offline smoke test: a harvester must not freeze when its delivery target
 * cannot be reached.
 *
 * Reproduces the state E34S53 was in on 2026-11-24. The source (19,23) lies
 * in a dead-end pocket: the three harvest tiles (20,22), (20,23), (20,24)
 * form a one-tile-wide chain, the defence towers (21,22) and (21,23) close
 * the eastern way around, and the only entrance to the chain is (20,22).
 *
 * A harvester that stood on (20,23) picked the extension (21,25) as its
 * delivery target: it is two tiles away by straight line, so the "deliver
 * near your own harvest tile" rule accepted it. In reality the route ran
 * through the towers, and the bot's pathfinder believed it existed - the
 * cost matrix it built marked only creeps as obstacles and let the path
 * pass through the towers and the extensions. The engine's own grid does
 * mark them (`makePathfindingGrid2` in `screeps/engine`,
 * `src/game/rooms.js`), so `moveTo` answered `ERR_NO_PATH`.
 *
 * The harvester code ignored that answer and returned from the tick: the
 * creep neither harvested nor upgraded the controller, it just stood there
 * with a full backpack, holding one of the three harvest tiles hostage. The
 * room lost a third of its income.
 *
 * The fix has two parts, and this test covers both:
 *   1. the cost matrix marks the room's structures, so the bot's path model
 *      matches the engine's and an impossible target is never chosen;
 *   2. if the target turns out to be unreachable anyway (the world changes
 *      between the decision and the move), the harvester drops it and works
 *      the source instead of standing still.
 *
 * Usage:
 *   bun run build && node tools/smoke-blocked-delivery.js
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
    ERR_NOT_FOUND: -12,
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

/**
 * Модель `Creep.moveTo` движка: путь ищется по правилам движка (структуры
 * и крипы — препятствия), и если маршрута нет, движок отвечает
 * `ERR_NO_PATH`.
 */
function engineMoveTo(creep, target, opts) {
    const p = target.pos || target;
    const range = opts && opts.range !== undefined ? opts.range : 0;

    movedCreeps.push([creep.name, creep.pos.x, creep.pos.y, p.x, p.y]);

    const matrix = new PathFinder.CostMatrix();

    for (const other of currentRoom.find(C.FIND_CREEPS)) {
        if (other.name === creep.name) {
            continue;
        }

        matrix.set(other.pos.x, other.pos.y, 255);
    }

    const path = PathFinder.search(
        creep.pos,
        { pos: p, range: Math.max(1, range) },
        { roomCallback: () => matrix }
    );

    if (!path || !path.path || path.path.length === 0) {
        return ERR_NO_PATH;
    }

    return OK;
}

function makeRoom(opts) {
    opts = opts || {};

    let nextId = 1;

    const extensions = (opts.extensions || []).map(([x, y, energy]) => {
        const stored = energy === undefined ? 50 : energy;

        return {
            id: `ext${nextId++}`,
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

    const towers = (opts.towers || []).map(([x, y]) => ({
        id: `tower${nextId++}`,
        structureType: C.STRUCTURE_TOWER, pos: pos(x, y), my: true, hits: 3000, hitsMax: 3000,
        store: {
            energy: 1000,
            getCapacity() { return 1000; },
            getFreeCapacity() { return 0; },
            getUsedCapacity() { return 1000; }
        },
        room: null
    }));

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

    const creeps = (opts.creeps || []).map(([x, y, role, memory], i) => {
        const creep = {
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
            moveTo(target, opts) {
                return engineMoveTo(this, target, opts);
            },
            moveByPath() {
                // Кэш пути в моке пустой: движок отвечает `ERR_NOT_FOUND`,
                // и бот обязан пересчитать маршрут.
                return ERR_NOT_FOUND;
            },
            upgradeController(controller) {
                const dx = Math.abs(this.pos.x - controller.pos.x);
                const dy = Math.abs(this.pos.y - controller.pos.y);

                if (Math.max(dx, dy) > 3) {
                    return ERR_NOT_IN_RANGE;
                }

                if (this.store.energy <= 0) {
                    return ERR_NOT_ENOUGH_ENERGY;
                }

                upgrades.push([this.name, this.pos.x, this.pos.y]);
                return OK;
            },
            harvest(target) {
                const dx = Math.abs(this.pos.x - target.pos.x);
                const dy = Math.abs(this.pos.y - target.pos.y);

                harvestIntents.push([this.name, this.pos.x, this.pos.y, target.pos.x, target.pos.y]);

                if (Math.max(dx, dy) > 1) {
                    return ERR_NOT_IN_RANGE;
                }

                this.store.energy += 2;
                return OK;
            },
            transfer(target) {
                // Движок отдаёт `ERR_NOT_IN_RANGE`, если крип дальше одной
                // клетки от цели: сдавать энергию на расстоянии нельзя.
                const dx = Math.abs(this.pos.x - target.pos.x);
                const dy = Math.abs(this.pos.y - target.pos.y);

                if (Math.max(dx, dy) > 1) {
                    return ERR_NOT_IN_RANGE;
                }

                transfers.push([this.name, target.structureType, target.pos.x, target.pos.y]);
                return OK;
            },
            withdraw() {
                return ERR_NOT_IN_RANGE;
            },
            build() {
                return ERR_NOT_IN_RANGE;
            }
        };

        return creep;
    });

    const source = { id: 'source1', type: 'source', pos: pos(19, 23), energy: 2500, room: null };

    const controller = {
        id: 'ctl1',
        my: true,
        level: 5, progress: 670000, progressTotal: 1215000, safeMode: 0,
        ticksToDowngrade: 60000, reservation: null, upgradeBlocked: false, pos: pos(17, 24)
    };

    const spawnEnergy = opts.spawnEnergy === undefined ? 250 : opts.spawnEnergy;
    const spawn = {
        id: 'spawn1',
        name: 'Spawn1', structureType: C.STRUCTURE_SPAWN, pos: pos(19, 26), my: true,
        store: {
            energy: spawnEnergy,
            getCapacity() { return 300; },
            getFreeCapacity() { return 300 - spawnEnergy; },
            getUsedCapacity() { return spawnEnergy; }
        },
        spawning: null, room: null, usedEnergy: 0,
        spawnCreep() { return ERR_BUSY; }
    };

    const structures = [controller, spawn, ...extensions, ...towers];

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

    room.memory._incomeRate = 2.9;
    room.memory._harvestSlots = 3;
    room.memory._sourceSaturated = true;
    room.memory._workBudget = 1.96;

    for (const s of structures) s.room = room;
    for (const c of creeps) c.room = room;
    source.room = room;
    currentRoom = room;
    installPathFinder(() => currentRoom);

    return { room, spawn, controller, extensions, towers, sites, source, creeps };
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
    global.Memory = global.Memory || {};

    upgrades.length = 0;
    harvestIntents.length = 0;
    transfers.length = 0;
    movedCreeps.length = 0;
    bot.loop();
}

// The live layout of E34S53 on 2026-11-24: the two extensions next to the
// source are full, the third one (21,25) still has room.
const EXTENSIONS = [
    [21, 24, 50], [20, 25, 50], [21, 25, 0],
    [18, 26, 0], [18, 27, 0], [21, 26, 0], [20, 28, 0], [18, 28, 0],
    [19, 28, 0], [17, 27, 0], [17, 26, 0]
];
const TOWERS = [[21, 22], [21, 23]];

// --- Scenario 1: the delivery target cannot be reached --------------------
//
// The harvester stands on (20,23) with a full trip. The extension (21,25)
// is two tiles away by straight line, so the "deliver near your own harvest
// tile" rule picks it - but the route runs through the towers, and the
// engine answers `ERR_NO_PATH`.
//
// The two other harvesters close both entrances to the pocket: (20,22)
// blocks the western way in, (20,24) blocks the eastern one ((19,25) ->
// (20,24)). The harvester on (20,23) is therefore sealed in - and before the
// fix it stood there for the rest of its life: no harvest, no upgrade, one
// of the three harvest tiles wasted.
{
    const sim = makeRoom({
        extensions: EXTENSIONS,
        towers: TOWERS,
        creeps: [
            [20, 23, 'harvester', {
                _harvestTile: { x: 20, y: 23 },
                energy: 50,
                _deliveryTarget: { id: 'ext3', tick: tick - 1 }
            }],
            [20, 22, 'harvester', { _harvestTile: { x: 20, y: 22 } }],
            [20, 24, 'harvester', { _harvestTile: { x: 20, y: 24 } }]
        ]
    });
    global.Memory = {};

    runTick(sim);

    const harvester = sim.creeps[0];

    check('a harvester with an unreachable delivery target still harvests',
        harvestIntents.some((h) => h[0] === harvester.name && h[3] === 19 && h[4] === 23),
        JSON.stringify(harvestIntents));

    check('a harvester with an unreachable delivery target still upgrades the controller',
        upgrades.some((u) => u[0] === harvester.name),
        JSON.stringify(upgrades));

    check('the impossible delivery target is dropped',
        harvester.memory._deliveryTarget === undefined,
        JSON.stringify(harvester.memory._deliveryTarget));
}

// --- Scenario 2: the eastern entrance is free ----------------------------
//
// The same harvester, but nobody stands on (20,24): the pocket has an exit,
// the target is reachable, and the delivery works as before. The fix must
// not break the normal path.
{
    const sim = makeRoom({
        extensions: EXTENSIONS,
        towers: TOWERS,
        creeps: [
            [20, 23, 'harvester', {
                _harvestTile: { x: 20, y: 23 },
                energy: 50,
                _deliveryTarget: { id: 'ext3', tick: tick - 1 }
            }],
            [20, 22, 'harvester', { _harvestTile: { x: 20, y: 22 } }]
        ]
    });
    global.Memory = {};

    runTick(sim);

    check('a harvester with a reachable target still walks to it',
        movedCreeps.some((m) => m[0] === sim.creeps[0].name),
        JSON.stringify(movedCreeps));

    check('a harvester with a reachable target does not freeze',
        !harvestIntents.some((h) => h[0] === sim.creeps[0].name),
        JSON.stringify(harvestIntents));
}

// --- Scenario 3: the bot does not plan a route through a tower -----------
//
// The towers (21,22) and (21,23) stand between the harvest tiles and the
// extension (21,25). The bot's cost matrix must mark them as obstacles,
// exactly like the engine's own grid does - otherwise the bot believes in
// routes that do not exist and picks impossible targets.
{
    const sim = makeRoom({
        extensions: EXTENSIONS,
        towers: TOWERS,
        creeps: [
            [20, 23, 'harvester', { _harvestTile: { x: 20, y: 23 }, energy: 0 }],
            [20, 22, 'harvester', { _harvestTile: { x: 20, y: 22 } }],
            [20, 24, 'harvester', { _harvestTile: { x: 20, y: 24 } }]
        ]
    });
    global.Memory = {};

    runTick(sim);

    const harvester = sim.creeps[0];

    check('the harvester keeps working when no target is reachable',
        harvestIntents.some((h) => h[0] === harvester.name),
        JSON.stringify(harvestIntents));

    check('the harvester does not walk through the towers',
        !movedCreeps.some((m) => m[3] === 21 && m[4] === 23),
        JSON.stringify(movedCreeps));
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
