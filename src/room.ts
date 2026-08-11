import { ROLE } from './constants';
import { trySpawn } from './spawn';
import * as harvester from './roles/harvester';
import * as upgrader from './roles/upgrader';
import * as builder from './roles/builder';
import * as repairer from './roles/repairer';
import * as rharvester from './roles/rharvester';
import * as reserver from './roles/reserver';
import * as claimer from './roles/claimer';
import {
    planSpawnOrder,
    planBaseLayout,
    planDefense
} from './strategy';
import type { BaseLayoutDecision } from './strategy';

export function run(room: Room): void {
    if (!room.controller || !room.controller.my) {
        return;
    }

    const counts: Record<string, number> = {};
    const homeCreeps: Creep[] = [];

    for (const name in Game.creeps) {
        const creep = Game.creeps[name];

        if (!creep) {
            continue;
        }

        if (creep.memory.homeRoom !== room.name) {
            continue;
        }

        const role = creep.memory.role;
        counts[role] = (counts[role] || 0) + 1;
        homeCreeps.push(creep);
    }

    const layout = planBaseLayout(room);
    if (layout.enabled) {
        ensureExtensions(room, layout);
    }

    const defense = planDefense(room);
    if (defense.enabled) {
        runTowers(room, defense);
    }

    const spawnOrder = planSpawnOrder(room, counts);

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

function runCreep(creep: Creep): void {
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

function ensureExtensions(room: Room, layout: BaseLayoutDecision): void {
    if (
        room.memory._extensionCheckTick &&
        Game.time - room.memory._extensionCheckTick < layout.checkInterval
    ) {
        return;
    }

    room.memory._extensionCheckTick = Game.time;

    const existingExtensions = room.find(FIND_MY_STRUCTURES, {
        filter: (s) => s.structureType === STRUCTURE_EXTENSION
    }).length;

    const extensionSites = room.find(FIND_MY_CONSTRUCTION_SITES, {
        filter: (s) => s.structureType === STRUCTURE_EXTENSION
    }).length;

    const need = layout.maxExtensions - existingExtensions - extensionSites;

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
    const candidates: { x: number; y: number }[] = [];

    for (let radius = 1; radius <= layout.planRadius; radius++) {
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

                if (terrain.get(x, y) === layout.wallTerrain) {
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

function runTowers(room: Room, defense: { attackHostiles: boolean; healInjured: boolean }): void {
    if (!defense.attackHostiles && !defense.healInjured) {
        return;
    }

    const towers = room.find(FIND_MY_STRUCTURES, {
        filter: (s) => s.structureType === STRUCTURE_TOWER
    });

    if (!towers.length) {
        return;
    }

    const hostiles = defense.attackHostiles ? room.find(FIND_HOSTILE_CREEPS) : [];

    const injuredCreeps = hostiles.length || !defense.healInjured
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
