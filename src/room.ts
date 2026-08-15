/* ============================================================================
 * Жизненный цикл комнаты за один тик.
 *
 * Управляет планировкой (extensions), обороной (towers) и спавном
 * «домашних» крипов на основе решений, возвращаемых {@link strategy}.
 * Также маршрутизирует выполнение ролей через {@link runCreep}.
 * ==========================================================================*/

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

/**
 * Выполняет один тик собственной (owned) комнаты: собирает её крипов,
 * применяет решения планировки и обороны, выполняет один проход спавна
 * (не более одного крипа за тик), затем вызывает роль каждого крипа.
 *
 * Алгоритм:
 * 1. Собрать крипов с `memory.homeRoom === room.name` и посчитать их по ролям.
 * 2. При `planBaseLayout.enabled` — {@link ensureExtensions}.
 * 3. При `planDefense.enabled` — {@link runTowers}.
 * 4. Пройти по `planSpawnOrder` и попытаться создать первого недостающего
 *    крипа через {@link trySpawn} (один крип за тик, `break`).
 * 5. Для каждого крипа вызвать {@link runCreep}.
 *
 * @param room Комната, которой мы владеем (`room.controller.my === true`).
 *             Чужие/нейтральные комнаты молча игнорируются.
 */
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

/**
 * Маршрутизирует крип на соответствующий модуль роли по `creep.memory.role`.
 * Крипы в состоянии `spawning` пропускаются. Неизвестные роли тихо
 * игнорируются (`default` ветка).
 */
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

/**
 * Планирует недостающие construction sites для `STRUCTURE_EXTENSION` вокруг
 * спавна. Алгоритм:
 * - Вызывается не чаще, чем раз в `layout.checkInterval` тиков
 *   (через `room.memory._extensionCheckTick`).
 * - Сканируются кольца от спавна с радиусом `1..layout.planRadius`,
 *   берутся только граничные клетки `max(|dx|,|dy|) === radius`.
 * - Пропускаются стены (`terrain.get === layout.wallTerrain`) и клетки
 *   за пределами `[1,48]`.
 * - Внутри кольца клетки сортируются по числу смежных существующих
 *   extensions (по убыванию), затем по манхэттенскому расстоянию до
 *   спавна — для плотной кластеризации.
 * - Создаются construction sites, пока не набран нужный лимит.
 *
 * @param room   Комната, для которой планируются расширения.
 * @param layout Решение планировки, возвращённое {@link planBaseLayout}.
 */
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

    const spawn = room.find(FIND_MY_SPAWNS)[0];

    if (!spawn) {
        return;
    }

    const terrain = room.getTerrain();

    const adjacentSet = new Set<string>();
    adjacentSet.add(`${spawn.pos.x},${spawn.pos.y}`);

    const extensionStructures = room.find(FIND_MY_STRUCTURES, {
        filter: (s) => s.structureType === STRUCTURE_EXTENSION
    });
    for (const s of extensionStructures) {
        adjacentSet.add(`${s.pos.x},${s.pos.y}`);
    }

    const extensionSitesArr = room.find(FIND_MY_CONSTRUCTION_SITES, {
        filter: (s) => s.structureType === STRUCTURE_EXTENSION
    });
    for (const s of extensionSitesArr) {
        adjacentSet.add(`${s.pos.x},${s.pos.y}`);
    }

    const adjacencyScore = (x: number, y: number): number => {
        let score = 0;
        if (x > 0 && adjacentSet.has(`${x - 1},${y}`)) score++;
        if (x < 49 && adjacentSet.has(`${x + 1},${y}`)) score++;
        if (y > 0 && adjacentSet.has(`${x},${y - 1}`)) score++;
        if (y < 49 && adjacentSet.has(`${x},${y + 1}`)) score++;
        return score;
    };

    const candidates: { x: number; y: number }[] = [];

    for (let radius = 1; radius <= layout.planRadius; radius++) {
        const ring: { x: number; y: number }[] = [];

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

                ring.push({ x, y });
            }
        }

        ring.sort((a, b) => {
            const diff = adjacencyScore(b.x, b.y) - adjacencyScore(a.x, a.y);
            if (diff !== 0) return diff;
            const da = Math.abs(a.x - spawn.pos.x) + Math.abs(a.y - spawn.pos.y);
            const db = Math.abs(b.x - spawn.pos.x) + Math.abs(b.y - spawn.pos.y);
            return da - db;
        });

        candidates.push(...ring);
    }

    let created = 0;

    for (const pos of candidates) {
        if (created >= need) {
            break;
        }

        const result = room.createConstructionSite(pos.x, pos.y, STRUCTURE_EXTENSION);

        if (result === OK) {
            created++;
            adjacentSet.add(`${pos.x},${pos.y}`);
        }
    }
}

/**
 * Управляет башнями комнаты по политике обороны:
 * 1. Если `defense.attackHostiles` — каждая башня атакует ближайшего
 *    враждебного крипа (`tower.pos.findClosestByRange`).
 * 2. Иначе, если `defense.healInjured` и ранёные есть — лечит ближайшего
 *    раненого своего крипа.
 *
 * @param room    Комната с башнями.
 * @param defense Решение, возвращённое {@link planDefense}.
 */
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
