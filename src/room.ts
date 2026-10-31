/* ============================================================================
 * Жизненный цикл комнаты за один тик.
 *
 * Управляет планировкой (extensions), обороной (towers) и спавном
 * «домашних» крипов на основе решений, возвращаемых {@link strategy}.
 * Также маршрутизирует выполнение ролей через {@link runCreep}.
 * ==========================================================================*/

import {
    ROLE,
    WALL_TERRAIN,
    EXTENSION_CHECK_INTERVAL,
    SPAWN_CLEAR_RADIUS,
    SEALED_SPAWN_HEAL_DELAY,
    SEALED_SPAWN_HEAL_RETRY
} from './constants';
import { trySpawn } from './spawn';
import { countFreeBirthTiles } from './utilities';
import * as log from './log';
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

    ensureSpawn(room);
    ensureSpawnAccessible(room);

    const defense = planDefense(room);
    if (defense.enabled) {
        runTowers(room, defense);
    }

    const spawnOrder = planSpawnOrder(room, counts);

    for (const pair of spawnOrder) {
        const role = pair[0];
        const targetCount = pair[1];

        if ((counts[role] || 0) < targetCount) {
            if (trySpawn(room, role)) {
                // Не больше одного крипа за тик.
                break;
            }

            // Спавн не удался (не хватило энергии, нет свободного спавна) —
            // пробуем следующую роль в списке: она может быть дешевле.
            // Раньше здесь был безусловный `break`, из-за чего более дорогая
            // первая роль блокировала спавн дешёвой второй.
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
 * Проверяет, что в owned-комнате есть спавн, и при необходимости планирует
 * construction site для `STRUCTURE_SPAWN`.
 *
 * @remarks
 * Без спавна комната не может породить ни одного крипа: `trySpawn` не
 * находит `FIND_MY_SPAWNS` и молча выходит. Раньше бот умел планировать
 * только extensions (`ensureExtensions`), поэтому не мог ни восстановить
 * уничтоженный спавн, ни развернуться в захваченной комнате. Молчание
 * особенно опасно: колония выглядит живой (тики идут, ошибок нет), но
 * не делает ничего — поэтому здесь же выдаётся явное предупреждение.
 *
 * Место для спавна выбирается кольцами вокруг контроллера (радиус 1..3):
 * так спавн оказывается рядом с контроллером и в зоне крипов.
 *
 * @param room Комната, которой мы владеем.
 */
function ensureSpawn(room: Room): void {
    if (
        room.memory._spawnCheckTick &&
        Game.time - room.memory._spawnCheckTick < EXTENSION_CHECK_INTERVAL
    ) {
        return;
    }

    room.memory._spawnCheckTick = Game.time;

    const hasSpawn = room.find(FIND_MY_SPAWNS).length > 0;

    const hasSpawnSite = room.find(FIND_MY_CONSTRUCTION_SITES, {
        filter: (s) => s.structureType === STRUCTURE_SPAWN
    }).length > 0;

    if (hasSpawn || hasSpawnSite) {
        return;
    }

    log.warn(
        'room',
        `owned room ${room.name} has no spawn — the colony cannot spawn creeps; ` +
        'build a spawn or respawn'
    );

    const controller = room.controller;

    if (!controller) {
        return;
    }

    const occupied = new Set<string>();

    for (const s of room.find(FIND_STRUCTURES)) {
        occupied.add(`${s.pos.x},${s.pos.y}`);
    }

    for (const s of room.find(FIND_CONSTRUCTION_SITES)) {
        occupied.add(`${s.pos.x},${s.pos.y}`);
    }

    for (const c of room.find(FIND_CREEPS)) {
        occupied.add(`${c.pos.x},${c.pos.y}`);
    }

    const terrain = room.getTerrain();

    for (let radius = 1; radius <= 3; radius++) {
        for (let dx = -radius; dx <= radius; dx++) {
            for (let dy = -radius; dy <= radius; dy++) {
                if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) {
                    continue;
                }

                const x = controller.pos.x + dx;
                const y = controller.pos.y + dy;

                if (x < 1 || x > 48 || y < 1 || y > 48) {
                    continue;
                }

                if (terrain.get(x, y) === WALL_TERRAIN) {
                    continue;
                }

                if (occupied.has(`${x},${y}`)) {
                    continue;
                }

                if (room.createConstructionSite(x, y, STRUCTURE_SPAWN) === OK) {
                    return;
                }
            }
        }
    }
}

/**
 * Планирует недостающие construction sites для `STRUCTURE_EXTENSION` вокруг
 * спавна. Алгоритм:
 * - Вызывается не чаще, чем раз в `layout.checkInterval` тиков
 *   (через `room.memory._extensionCheckTick`).
 * - Сканируются кольца от спавна с радиусом
 *   `SPAWN_CLEAR_RADIUS + 1..layout.planRadius`, берутся только граничные
 *   клетки `max(|dx|,|dy|) === radius`. Кольцо радиуса 1 не занимается:
 *   движок создаёт крипа на соседней клетке, и занятое кольцо делает спавн
 *   неработоспособным.
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

    // Кольцо радиуса 1 вокруг спавна пропускается: движок ставит нового
    // крипа на одну из восьми соседних клеток, и если все они заняты,
    // спавн навсегда остаётся занятым (см. ensureSpawnAccessible).
    for (let radius = SPAWN_CLEAR_RADIUS + 1; radius <= layout.planRadius; radius++) {
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

/**
 * Проверяет, что у спавна есть свободная соседняя клетка, в которую движок
 * сможет поставить нового крипа, и при необходимости освобождает её.
 *
 * @remarks
 * Новый крип появляется на одной из восьми клеток, соседних со спавном
 * (`screeps/engine`, `src/processor/intents/spawns/_born-creep.js`). Если все
 * они заняты — расширениями, их construction sites, стеной рельефа, —
 * движок не может разместить крипа и бесконечно откладывает его появление:
 * спавн остаётся занятым, `trySpawn` не находит свободного спавна, и
 * колония умирает молча (тики идут, CPU расходуется, но ничего не
 * происходит).
 *
 * Проверка идёт раз в {@link EXTENSION_CHECK_INTERVAL} тиков. Если спавн
 * запечатан дольше {@link SEALED_SPAWN_HEAL_DELAY} тиков, бот сносит одно
 * соседнее расширение, освобождая клетку: восстановить спавн иначе нечем —
 * construction sites в штатном API отменить нельзя, а структуры сносить
 * больше нечем.
 *
 * @param room Комната, которой мы владеем.
 */
function ensureSpawnAccessible(room: Room): void {
    if (
        room.memory._spawnAccessCheckTick &&
        Game.time - room.memory._spawnAccessCheckTick < EXTENSION_CHECK_INTERVAL
    ) {
        return;
    }

    room.memory._spawnAccessCheckTick = Game.time;

    for (const spawn of room.find(FIND_MY_SPAWNS)) {
        if (countFreeBirthTiles(room, spawn) > 0) {
            delete room.memory._sealedSpawnTick;
            delete room.memory._sealedSpawnHealTick;
            continue;
        }

        const sealedSince = room.memory._sealedSpawnTick;

        if (!sealedSince) {
            room.memory._sealedSpawnTick = Game.time;
            log.warn(
                'room',
                `spawn ${spawn.name} in ${room.name} is sealed — the engine cannot place ` +
                'new creeps, the colony is idle. The bot will free a cell shortly.'
            );
            continue;
        }

        if (Game.time - sealedSince < SEALED_SPAWN_HEAL_DELAY) {
            continue;
        }

        // Не чаще, чем раз в SEALED_SPAWN_HEAL_RETRY тиков: если снос
        // расширения не помог, следующее расширение трогать нельзя.
        const lastHeal = room.memory._sealedSpawnHealTick;

        if (lastHeal !== undefined && Game.time - lastHeal < SEALED_SPAWN_HEAL_RETRY) {
            continue;
        }

        const blocked = room.find(FIND_MY_STRUCTURES, {
            filter: (s) =>
                s.structureType === STRUCTURE_EXTENSION &&
                Math.max(
                    Math.abs(s.pos.x - spawn.pos.x),
                    Math.abs(s.pos.y - spawn.pos.y)
                ) === 1
        });

        const target = blocked[0];

        if (!target || typeof target.destroy !== 'function') {
            continue;
        }

        const result = target.destroy();

        if (result === OK) {
            room.memory._sealedSpawnTick = Game.time;
            room.memory._sealedSpawnHealTick = Game.time;
            log.warn(
                'room',
                `destroyed extension at ${target.pos.x},${target.pos.y} to unseal spawn ` +
                `${spawn.name} in ${room.name}`
            );
        }
    }
}
