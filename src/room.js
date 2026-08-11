const { ROLE, TARGETS, DOWNGRADE_BUFFER_TICKS, EXTENSION_PLAN_RADIUS, EXTENSION_CHECK_INTERVAL, WALL_TERRAIN } = require('./constants');
const { trySpawn } = require('./spawn');

const harvester = require('./role.harvester');
const upgrader = require('./role.upgrader');
const builder = require('./role.builder');
const repairer = require('./role.repairer');
const rharvester = require('./role.rharvester');
const reserver = require('./role.reserver');
const claimer = require('./role.claimer');

function run(room) {
    if (!room.controller || !room.controller.my) {
        return;
    }

    const rcl = room.controller.level;

    const counts = {};
    const homeCreeps = [];

    for (const name in Game.creeps) {
        const creep = Game.creeps[name];

        if (creep.memory.homeRoom !== room.name) {
            continue;
        }

        const role = creep.memory.role;
        counts[role] = (counts[role] || 0) + 1;
        homeCreeps.push(creep);
    }

    ensureExtensions(room);

    runTowers(room);

    const targets = TARGETS[rcl] || TARGETS[5];

    const canUpgrade = room.controller.ticksToDowngrade > DOWNGRADE_BUFFER_TICKS;
    const upgraderTarget = canUpgrade
        ? targets.upgrader
        : Math.min(counts[ROLE.UPGRADER] || 0, 1);

    const spawnOrder = [
        [ROLE.UPGRADER, upgraderTarget],
        [ROLE.HARVESTER, targets.harvester],
        [ROLE.BUILDER, targets.builder],
        [ROLE.REPAIRER, targets.repairer]
    ];

    for (const pair of spawnOrder) {
        const role = pair[0];
        const targetCount = pair[1];

        if ((counts[role] || 0) < targetCount) {
            trySpawn(room, role);
            break;
        }
    }

    for (const creep of homeCreeps) {
        runCreep(creep);
    }
}

function runCreep(creep) {
    if (creep.spawning) {
        return;
    }

    switch (creep.memory.role) {
        case ROLE.HARVESTER:
            return harvester.run(creep);

        case ROLE.UPGRADER:
            return upgrader.run(creep);

        case ROLE.BUILDER:
            return builder.run(creep);

        case ROLE.REPAIRER:
            return repairer.run(creep);

        case ROLE.RHARVESTER:
            return rharvester.run(creep);

        case ROLE.RESERVER:
            return reserver.run(creep);

        case ROLE.CLAIMER:
            return claimer.run(creep);

        default:
            return;
    }
}

function ensureExtensions(room) {
    const rcl = room.controller.level;

    if (rcl < 2) {
        return;
    }

    if (
        room.memory._extensionCheckTick &&
        Game.time - room.memory._extensionCheckTick < EXTENSION_CHECK_INTERVAL
    ) {
        return;
    }

    room.memory._extensionCheckTick = Game.time;

    const maxExtensions = CONTROLLER_STRUCTURES[STRUCTURE_EXTENSION][rcl];

    const existingExtensions = room.find(FIND_MY_STRUCTURES, {
        filter: (s) => s.structureType === STRUCTURE_EXTENSION
    }).length;

    const extensionSites = room.find(FIND_MY_CONSTRUCTION_SITES, {
        filter: (s) => s.structureType === STRUCTURE_EXTENSION
    }).length;

    const need = maxExtensions - existingExtensions - extensionSites;

    if (need <= 0) {
        return;
    }

    const spawn = room.find(FIND_MY_SPAWNS, {
        filter: (s) => s.my
    })[0];

    if (!spawn) {
        return;
    }

    const terrain = room.getTerrain();
    const candidates = [];

    for (let radius = 1; radius <= EXTENSION_PLAN_RADIUS; radius++) {
        for (let dx = -radius; dx <= radius; dx++) {
            for (let dy = -radius; dy <= radius; dy++) {
                if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) {
                    continue;
                }

                const x = spawn.pos.x + dx;
                const y = spawn.pos.y + dy;

                if (x < 1 || x > 48 || y < 1 || y > 48) {
                    continue;
                }

                if (terrain.get(x, y) === WALL_TERRAIN) {
                    continue;
                }

                candidates.push({ x, y });
            }
        }
    }

    let created = 0;

    for (const pos of candidates) {
        if (created >= need) {
            break;
        }

        const result = room.createConstructionSite(pos.x, pos.y, STRUCTURE_EXTENSION);

        if (result === OK) {
            created++;
        }
    }
}

function runTowers(room) {
    if (room.controller.level < 3) {
        return;
    }

    const towers = room.find(FIND_MY_STRUCTURES, {
        filter: (s) => s.structureType === STRUCTURE_TOWER
    });

    if (!towers.length) {
        return;
    }

    const hostiles = room.find(FIND_HOSTILE_CREEPS);

    const injuredCreeps = hostiles.length
        ? []
        : room.find(FIND_MY_CREEPS, {
            filter: (c) => c.hits < c.hitsMax
        });

    for (const tower of towers) {
        if (hostiles.length) {
            const target = tower.pos.findClosestByRange(hostiles);

            if (target) {
                tower.attack(target);
                continue;
            }
        }

        if (injuredCreeps.length) {
            const target = tower.pos.findClosestByRange(injuredCreeps);

            if (target) {
                tower.heal(target);
                continue;
            }
        }
    }
}

module.exports = {
    run,
    runCreep
};
