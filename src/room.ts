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
    SPAWN_BIRTH_TILES_MIN,
    SEALED_SPAWN_HEAL_DELAY,
    SEALED_SPAWN_HEAL_RETRY
} from './constants';
import { trySpawn } from './spawn';
import {
    inspectSpawnRing,
    findFreeTileNear,
    blocksBirthRing,
    type SpawnRingInfo
} from './utilities';
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
    ensureSpawnRingReserve(room);

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
    });

    // Сайты расширений в кольце радиуса 1 вокруг спавна бот не строит (см.
    // `roles/builder.ts`): они занимают клетку рождения. Считать их
    // «запланированными» расширениями нельзя — иначе бот не закажет
    // замену, и кольцо так и останется занятым.
    const buildableExtensionSites = extensionSites.filter(
        (s) => !blocksBirthRing(room, s.pos.x, s.pos.y)
    ).length;

    const need = layout.maxExtensions - existingExtensions - buildableExtensionSites;

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
 * Держит вокруг спавна запас свободных клеток, в которые движок может
 * поставить нового крипа.
 *
 * @remarks
 * Вокруг спавна восемь клеток. Если свободна хотя бы одна — спавн работает,
 * но держится на одном крипе: как только этот крип встаёт на единственную
 * свободную клетку, спавн запечатывается и колония замирает без единой
 * ошибки. Именно так выглядела остановка 2026-10-25: пять расширений в
 * кольце радиуса 1, из них бот снёс одно, и на освободившуюся клетку
 * родился крип, который там и замер.
 *
 * Поэтому бот старается держать вокруг спавна хотя бы
 * {@link SPAWN_BIRTH_TILES_MIN} свободных клеток. Если свободных меньше,
 * сносится одно расширение в кольце радиуса 1 — постройка на расстоянии
 * вытяжки от спавна того же стоит, а вот запечатанный спавн не лечится сам.
 *
 * Проверка идёт раз в {@link EXTENSION_CHECK_INTERVAL} тиков, сносится не
 * больше одного расширения за проверку.
 *
 * @param room Комната, которой мы владеем.
 */
function ensureSpawnRingReserve(room: Room): void {
    if (
        room.memory._ringReserveCheckTick &&
        Game.time - room.memory._ringReserveCheckTick < EXTENSION_CHECK_INTERVAL
    ) {
        return;
    }

    room.memory._ringReserveCheckTick = Game.time;

    for (const spawn of room.find(FIND_MY_SPAWNS)) {
        const ring = inspectSpawnRing(room, spawn);

        if (ring.freeTilesWithoutCreeps >= SPAWN_BIRTH_TILES_MIN) {
            continue;
        }

        const target = ring.adjacentExtensions[0];

        if (!target || typeof target.destroy !== 'function') {
            continue;
        }

        if (target.destroy() === OK) {
            log.warn(
                'room',
                `destroyed extension at ${target.pos.x},${target.pos.y}: only ` +
                `${ring.freeTilesWithoutCreeps} birth tile(s) left around spawn ` +
                `${spawn.name} in ${room.name}`
            );
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
 * они заняты — расширениями, их construction sites, стеной рельефа или
 * крипом, — движок не может разместить крипа и бесконечно откладывает его
 * появление: спавн остаётся занятым, `trySpawn` не находит свободного
 * спавна, и колония умирает молча (тики идут, CPU расходуется, но ничего
 * не происходит).
 *
 * Крипы считаются занявшими клетку: движок не поставит крипа на клетку с
 * другим крипом (`OBSTACLE_OBJECT_TYPES` включает `creep`). Раньше бот их
 * игнорировал — и поэтому не видел запечатанный спавн в тот самый момент,
 * когда кольцо закрывал единственный застрявший крип.
 *
 * Проверка идёт раз в {@link EXTENSION_CHECK_INTERVAL} тиков. Если спавн
 * запечатан дольше {@link SEALED_SPAWN_HEAL_DELAY} тиков, бот освобождает
 * клетку. Что именно освобождать — решает структура запечатывания:
 * - если структурно свободные клетки есть, мешают наши крипы: бот двигает
 *   их с клеток рождения;
 * - если свободных клеток нет вообще, кольцо забито постройками: бот сносит
 *   расширения в кольце радиуса 1 (construction sites в штатном API
 *   отменить нельзя, а расширения — можно).
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
        const ring = inspectSpawnRing(room, spawn);

        // Снимок состояния кольца — только когда кольцо действительно тесное.
        // В этот момент чаще всего и нужен разбор: кто занял клетку.
        if (ring.freeTiles.length < 4) {
            room.memory._ringDebug = {
                tick: Game.time,
                spawn: `${spawn.pos.x},${spawn.pos.y}`,
                terrain: ring.birthTiles
                    .map((t) => `${t.x},${t.y}=${room.getTerrain().get(t.x, t.y)}`)
                    .join(' '),
                free: ring.freeTiles.map((t) => `${t.x},${t.y}`).join(' '),
                freeNoCreeps: ring.freeTilesWithoutCreeps,
                creeps: room
                    .find(FIND_CREEPS)
                    .map((c) => `${c.name}@${c.pos.x},${c.pos.y}`)
                    .join(' ')
            };
        }

        if (ring.freeTiles.length > 0) {
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
                `new creeps, the colony is idle. Blocked by ${ring.birthTiles.length - ring.freeTiles.length} ` +
                'birth tile(s); the bot will free a cell shortly.'
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

        // Клетки есть, но заняты нашими крипами: лечим не постройки, а их.
        if (ring.freeTilesWithoutCreeps > 0) {
            const moved = moveCreepsOffBirthTiles(room, spawn, ring);

            room.memory._sealedSpawnTick = Game.time;
            room.memory._sealedSpawnHealTick = Game.time;

            log.warn(
                'room',
                `spawn ${spawn.name} in ${room.name} is blocked by ` +
                `${ring.creepsOnBirthTiles.length} of our creeps on the birth ring — ` +
                `${moved} moved away`
            );

            continue;
        }

        // Кольцо забито постройками: сносим расширения, освобождая клетки.
        if (ring.adjacentExtensions.length > 0) {
            let destroyed = 0;

            for (const ext of ring.adjacentExtensions) {
                if (typeof ext.destroy !== 'function') {
                    continue;
                }

                if (ext.destroy() === OK) {
                    destroyed++;
                }
            }

            room.memory._sealedSpawnTick = Game.time;
            room.memory._sealedSpawnHealTick = Game.time;

            log.warn(
                'room',
                `destroyed ${destroyed} extension(s) around spawn ${spawn.name} in ` +
                `${room.name} to unseal it`
            );

            continue;
        }

        log.warn(
            'room',
            `spawn ${spawn.name} in ${room.name} is sealed and cannot be fixed ` +
            'automatically: construction sites cannot be cancelled via the API and ' +
            'there are no extensions to destroy. Manual action required.'
        );
    }
}

/**
 * Сдвигает наших крипов с клеток рождения вокруг спавна.
 *
 * @remarks
 * Клетку рождения занимает чаще всего крип, который не может уйти: цель его
 * движения недостижима (например, источник лежит на стене рельефа, и пути к
 * нему не существует), поэтому крип замирает на месте. Если свободна только
 * эта клетка, спавн запечатывается.
 *
 * @param room  Комната.
 * @param spawn Спавн, вокруг которого ищем занятые клетки.
 * @param ring  Снимок состояния кольца клеток рождения.
 * @returns Сколько крипов получили новую цель.
 */
function moveCreepsOffBirthTiles(
    room: Room,
    spawn: StructureSpawn,
    ring: SpawnRingInfo
): number {
    const birthTiles = new Set<string>();

    for (const tile of ring.birthTiles) {
        birthTiles.add(`${tile.x},${tile.y}`);
    }

    let moved = 0;

    for (const creep of ring.creepsOnBirthTiles) {
        const target = findFreeTileNear(room, creep.pos, birthTiles);

        if (!target) {
            continue;
        }

        if (creep.moveTo(target) === OK) {
            moved++;
        }
    }

    return moved;
}
