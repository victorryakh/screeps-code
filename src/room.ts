/* ============================================================================
 * Жизненный цикл комнаты за один тик.
 *
 * Управляет планировкой (extensions), обороной (towers) и спавном
 * «домашних» крипов на основе решений, возвращаемых {@link strategy}.
 * Также маршрутизирует выполнение ролей через {@link runCreep}.
 * ==========================================================================*/

import {
    ROLE,
    type RoleKey,
    WALL_TERRAIN,
    EXTENSION_CHECK_INTERVAL,
    SPAWN_CLEAR_RADIUS,
    SPAWN_BIRTH_TILES_CRITICAL,
    SEALED_SPAWN_HEAL_DELAY,
    SEALED_SPAWN_HEAL_RETRY,
    HARVEST_RATE_PER_WORK,
    HARVEST_EFFICIENCY,
    CREEP_LIFE_TICKS,
    INCOME_SAMPLE_INTERVAL,
    DELIVERY_DISTANCE_THRESHOLD,
    DELIVERY_CHECK_INTERVAL,
    EXTENSION_BUILD_COST,
    EXTENSION_PAYBACK_TICKS
} from './constants';
import { trySpawn } from './spawn';
import {
    inspectSpawnRing,
    findFreeTileNear,
    findUpgradeSpot,
    collectHarvestSlots,
    collectHarvestSlotKeys,
    collectDeliveryTileKeys,
    hasDeliverySite,
    measureDeliveryDistance,
    bodyCost,
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

    const layout = planBaseLayout(room, affordableExtensions(room, counts));
    if (layout.enabled) {
        ensureExtensions(room, layout);
    }

    ensureSpawn(room);
    ensureSpawnAccessible(room);
    ensureSpawnRingReserve(room);
    updateSourceSaturation(room, counts);
    updateIncomeRate(room);

    const defense = planDefense(room);
    if (defense.enabled) {
        runTowers(room, defense);
    }

    const spawnOrder = planSpawnOrder(
        room,
        counts,
        computeWorkBudget(room, counts),
        needsDeliveryRepair(room)
    );

    markExcessWorkers(room, homeCreeps, spawnOrder);

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

    // Движок считает в лимит РCL и построенные расширения, и их
    // construction sites: `checkControllerAvailability` в `screeps/engine`
    // (`src/utils.js`) считает `type == structureType || type ==
    // 'constructionSite' && structureType == type`. Значит, сайт расширения
    // тоже занимает место в лимите — считать нужно все сайты, а не только
    // те, что бот собирается достроить.
    //
    // При этом сам билдер site в кольце рождения достраивает (см.
    // `roles/builder.ts`): и сайт, и готовое расширение одинаково занимают
    // клетку рождения, поэтому достройка не уменьшает число свободных
    // клеток. Значит, исключать такие сайты из подсчёта нельзя — иначе бот
    // считает, что план ещё не выполнен, и не заказывает замену.
    const need = layout.maxExtensions - existingExtensions - extensionSites.length;

    if (need <= 0) {
        return;
    }

    const spawn = room.find(FIND_MY_SPAWNS)[0];

    if (!spawn) {
        return;
    }

    // Клетки добычи — неприкосновенны: расширение на такой клетке убирает
    // её из числа доступных источнику. В E34S53 клеток добычи всего три
    // (источник лежит на стене), и потеря любой из них — минус треть
    // дохода комнаты. Поэтому такие клетки исключаются из кандидатов.
    const harvestSlots = new Set<string>();

    for (const source of room.find(FIND_SOURCES)) {
        for (const slot of collectHarvestSlots(room, source)) {
            harvestSlots.add(`${slot.x},${slot.y}`);
        }
    }

    // Клетки доставки: рядом с клеткой добычи. Расширение на такой клетке
    // превращает доставку энергии в один шаг вместо десяти.
    //
    // Это главный критерий расстановки, а не плотность кластера вокруг
    // спавна: харвестер стоит на клетке добычи, и расстояние от неё до
    // хранилища — это ровно та часть его цикла, которая не даёт добывать.
    // В E34S53 источник лежит в стенном кармане, и путь от клетки добычи до
    // хранилища, где ещё есть свободное место, занимает 8–10 клеток в обход
    // стены. Расширение, поставленное вплотную к клетке добычи, сокращает
    // дорогу до одного шага и заметно поднимает доход комнаты.
    const deliveryTiles = collectDeliveryTileKeys(room);

    // Занятые клетки: на них уже есть структура или стройплощадка, и
    // повторный `createConstructionSite` там бесползен.
    const occupied = new Set<string>();

    for (const s of room.find(FIND_STRUCTURES)) {
        occupied.add(`${s.pos.x},${s.pos.y}`);
    }

    for (const c of room.find(FIND_CONSTRUCTION_SITES)) {
        occupied.add(`${c.pos.x},${c.pos.y}`);
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

                // Клетки добычи не отдаём под расширения: источник в этой
                // комнате добывает лишь с трёх клеток, и потеря одной — минус
                // треть дохода.
                if (harvestSlots.has(`${x},${y}`)) {
                    continue;
                }

                // На занятой клетке расширение уже есть (или там стоит
                // другая структура) — второй раз его не заказать.
                if (occupied.has(`${x},${y}`)) {
                    continue;
                }

                ring.push({ x, y });
            }
        }

        ring.sort((a, b) => {
            // Клетки доставки — наивысший приоритет.
            const deliveryDiff =
                (deliveryTiles.has(`${b.x},${b.y}`) ? 1 : 0) -
                (deliveryTiles.has(`${a.x},${a.y}`) ? 1 : 0);
            if (deliveryDiff !== 0) return deliveryDiff;

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
 * Кэширует измеренное расстояние доставки комнаты.
 *
 * @remarks
 * Замер считает путь до ближайшего хранилища, а путь считать дорого, поэтому
 * расстояние перемеряется раз в {@link DELIVERY_CHECK_INTERVAL} тиков. Для
 * стратегического решения «чинить ли доставку» такая точность достаточна.
 *
 * @param room Комната.
 * @returns Расстояние доставки в клетках пути.
 */
function updateDeliveryDistance(room: Room): number {
    if (
        room.memory._deliveryCheckTick &&
        Game.time - room.memory._deliveryCheckTick < DELIVERY_CHECK_INTERVAL
    ) {
        return room.memory._deliveryDistance ?? 0;
    }

    room.memory._deliveryCheckTick = Game.time;
    room.memory._deliveryDistance = measureDeliveryDistance(room);

    return room.memory._deliveryDistance;
}

/**
 * Определяет, нужно ли комнате чинить доставку энергии.
 *
 * @remarks
 * Чинить есть что, когда хранилище далеко от клетки добычи (измеренное
 * расстояние доставки) и при этом рядом с клеткой добычи есть площадка
 * расширения, которую ещё можно достроить.
 *
 * @param room Комната.
 * @returns `true`, если доставку надо чинить.
 */
function needsDeliveryRepair(room: Room): boolean {
    return (
        updateDeliveryDistance(room) >= DELIVERY_DISTANCE_THRESHOLD &&
        hasDeliverySite(room)
    );
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
 * Поэтому бот старается держать вокруг спавна свободные клетки рождения.
 * Свободными считаются и те, что заняты нашими крипами: движок не поставит
 * крипа на клетку с другим крипом, поэтому занятая клетка свободной не
 * является.
 *
 * Порядок действий:
 * - если свободных клеток хватает — ничего не делаем;
 * - если свободных клеток мало, но структурно их достаточно — мешают
 *   наши крипы: сдвигаем их с кольца (постройки не трогаем);
 * - если свободных клеток нет вовсе — кольцо забито постройками: сносится
 *   одно расширение в кольце радиуса 1 — постройка на расстоянии вытяжки
 *   от спавна того же стоит, а вот запечатанный спавн не лечится сам.
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

        // Кольцо в порядке: свободных клеток (с учётом крипов) хватает.
        //
        // Порог — две клетки, а не три: две свободные клетки дают рабочий
        // спавн (новорождённый займёт одну, вторая останется), а одна —
        // спавн на одном крипе, который запечатает его, стоит лишь на
        // клетку. Требовать три клетки в тесной комнате бессмысленно: там
        // рабочие крипы вынуждены стоять рядом со спавном, и бот начал бы
        // бесконечно сдвигать их с кольца.
        if (ring.freeTiles.length >= SPAWN_BIRTH_TILES_CRITICAL) {
            continue;
        }

        // Мешают наши собственные крипы: структурно свободных клеток
        // достаточно — сдвигаем их с кольца.
        //
        // Раньше проверялось только `freeTilesWithoutCreeps`. В E34S53
        // структурно свободных клеток было ровно три (столько же, сколько
        // требует `SPAWN_BIRTH_TILES_MIN`), а два крипа стояли на двух из
        // них. Бот считал кольцо в порядке, хотя свободной оставалась одна
        // клетка — ровно столько, чтобы спавн произвёл одного крипа и
        // запечатался навсегда: второму крипу места уже не было бы.
        if (ring.freeTilesWithoutCreeps >= SPAWN_BIRTH_TILES_CRITICAL) {
            // Сдвигаем ровно столько крипов, сколько не хватает до нормы:
            // каждый сдвинутый крип на время теряет свою работу, а лишних
            // движений делать не нужно.
            const needed = SPAWN_BIRTH_TILES_CRITICAL - ring.freeTiles.length;
            const moved = moveCreepsOffBirthTiles(room, spawn, ring, needed);

            if (moved > 0) {
                log.warn(
                    'room',
                    `moved ${moved} creep(s) off the birth ring of spawn ${spawn.name} ` +
                    `in ${room.name}: only ${ring.freeTiles.length} free birth tile(s) left`
                );
            }

            continue;
        }

        // Структурно свободных клеток нет — кольцо забито постройками.
        // Сносим одно расширение: постройка на расстоянии вытяжки от
        // спавна того же стоит, а вот запечатанный спавн не лечится сам.
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
 * Помечает лишних рабочих крипов: их больше, чем комната может прокормить.
 *
 * @remarks
 * Бюджет (`computeWorkBudget`) ограничивает состав, но не уменьшает уже
 * работающий состав: пока лишний апгрейдер жив, он забирает энергию из
 * спавна/расширений и отнимает её у тех, кто в бюджете уложился. В E34S53
 * это означало, что контроллер получал втрое меньше прогресса, чем мог.
 *
 * Лишние рабочие не берут энергию из структур: они дорабатывают тот запас,
 * который уже у них в рюкзаке, и не мешают остальным. Пометка стабильна
 * (сортировка по имени), чтобы крипы не «переизбирались» каждый тик.
 *
 * @param room       Комната.
 * @param homeCreeps Крипы этой комнаты.
 * @param spawnOrder План спавна: пары `[роль, целевое количество]`.
 */
function markExcessWorkers(
    room: Room,
    homeCreeps: Creep[],
    spawnOrder: [RoleKey, number][]
): void {
    const allowed = new Map<string, number>();

    for (const [role, target] of spawnOrder) {
        allowed.set(role, target);
    }

    const byRole = new Map<string, Creep[]>();

    for (const creep of homeCreeps) {
        const role = creep.memory.role;

        if (!allowed.has(role)) {
            continue;
        }

        const list = byRole.get(role) || [];
        list.push(creep);
        byRole.set(role, list);
    }

    for (const [role, list] of byRole) {
        const limit = allowed.get(role) ?? list.length;

        list.sort((a, b) => (a.name < b.name ? -1 : 1));

        for (let i = 0; i < list.length; i++) {
            const creep = list[i] as Creep;

            if (i >= limit) {
                creep.memory._excess = true;
            } else {
                delete creep.memory._excess;
            }
        }
    }
}

/**
 * Считает, сколько энергии в тик комната может тратить на работу: апгрейд
 * контроллера, стройку, ремонт.
 *
 * @remarks
 * Бюджет = доход от добычи − стоимость замены умирающих крипов.
 *
 * - Доход: клеток добычи у источника может быть всего три (если источник лежит
 *   на стене рельефа), и каждый харвестер добывает по 2 энергии за тик на
 *   1 WORK, но часть энергии теряется на дороге до спавна и обратно.
 * - Крипы умирают от старости на 1500-м тике, и замену нужно оплатить из
 *   того же дохода — иначе колония постепенно теряет роли.
 *
 * Если бюджет не считать, бот будет планировать состав по одному только RCL
 * и заведёт в комнату больше рабочих крипов, чем она может прокормить: в
 * E34S53 доход ~4 энергии в тик, а состав RCL 3 (3 апгрейдера + 2 билдера +
 * 1 ремонтник) требует ~8.
 *
 * Доход берётся не из модели, а из измерения (см. {@link updateIncomeRate}):
 * модель считает, что крип копает всегда, и в геометрии E34S53 (источник в
 * стенном кармане, три клетки добычи на болоте, доставка через десять клеток
 * в обход стены) завышала доход втрое — бот держал рабочих, которых комната
 * не прокармливала, и выедал запас.
 *
 * @param room   Комната.
 * @param counts Текущий состав ролей комнаты.
 * @returns Бюджет энергии в тик.
 */
function computeWorkBudget(room: Room, counts: Record<string, number>): number {
    if (
        room.memory._budgetCheckTick &&
        Game.time - room.memory._budgetCheckTick < EXTENSION_CHECK_INTERVAL
    ) {
        return room.memory._workBudget ?? 0;
    }

    room.memory._budgetCheckTick = Game.time;

    const income = effectiveIncome(room, counts);

    let churn = 0;

    for (const creep of room.find(FIND_MY_CREEPS)) {
        churn += bodyCost(creep.body.map((part) => part.type)) / CREEP_LIFE_TICKS;
    }

    room.memory._workBudget = Math.max(0, income - churn);

    return room.memory._workBudget;
}

/**
 * Эффективный доход комнаты в энергии за тик: измеренный, а если замера ещё
 * нет — модельный.
 *
 * @remarks
 * Модель (клетки добычи × 2 энергии за тик × потери на доставке) — это
 * верхняя граница: она не учитывает ни время на дорогу, ни болото, ни
 * длину рейса. Поэтому, как только замер состоялся, он заменяет модель.
 *
 * @param room   Комната.
 * @param counts Текущий состав ролей комнаты.
 * @returns Доход в энергии за тик.
 */
function effectiveIncome(room: Room, counts: Record<string, number>): number {
    const source = room.find(FIND_SOURCES)[0];
    const slots = source ? collectHarvestSlots(room, source).length : 0;
    const harvesters = counts[ROLE.HARVESTER] || 0;

    const modelIncome =
        Math.min(slots, harvesters) * HARVEST_RATE_PER_WORK * HARVEST_EFFICIENCY;

    const measuredIncome = room.memory._incomeRate ?? 0;

    return measuredIncome > 0 ? measuredIncome : modelIncome;
}

/**
 * Сколько расширений комната может оплатить своим доходом.
 *
 * @remarks
 * Расширение стоит 3000 энергии — в комнате с доходом в 2 энергии за тик
 * это полторы тысячи тиков дохода, то есть в несколько раз больше всего
 * запаса комнаты. Планировать расширения по лимиту RCL — значит заказать
 * стройки, которые комната не выполнит: площадки висят, занимают лимит RCL
 * и клетки, а билдер (если он появится) тратит доход на постройки вместо
 * апгрейда контроллера.
 *
 * Поэтому число расширений, которое комната может себе позволить, считается
 * из дохода: расширение должно окупаться за {@link EXTENSION_PAYBACK_TICKS}
 * тиков. Практически это «не больше расширений, чем комната зарабатывает
 * энергии в тик».
 *
 * Нижняя граница — одно расширение: без него харвестеру некуда сдавать
 * энергию, кроме спавна, и рейс удлиняется.
 *
 * @param room   Комната.
 * @param counts Текущий состав ролей комнаты.
 * @returns Максимальное число расширений, которое комната может оплатить.
 */
function affordableExtensions(room: Room, counts: Record<string, number>): number {
    const income = effectiveIncome(room, counts);

    if (income <= 0) {
        // Дохода нет совсем — ограничивать нечем.
        return Number.POSITIVE_INFINITY;
    }

    const affordable = Math.floor(
        (income * EXTENSION_PAYBACK_TICKS) / EXTENSION_BUILD_COST
    );

    return Math.max(1, affordable);
}

/**
 * Меряет реальный доход комнаты: сколько энергии в тик комната добывает.
 *
 * @remarks
 * Оценка «сколько может добыть комната» по геометрии (число клеток добычи ×
 * 2 энергии за тик) систематически завышает реальность: крип половину времени
 * идёт, а не копает. В E34S53 модель давала 4.2 энергии в тик, реально
 * приходило 1.4 — и именно этот разрыв съедал запас комнаты.
 *
 * Поэтому доход измеряется по источнику: сколько энергии из него забрали за
 * интервал. Это ровно тот темп, с которым комната получает энергию, —
 * независимо от рельефа, геометрии и того, сколько крип тратит на дорогу.
 *
 * Два важных свойства движка, из-за которых измерение именно такое:
 *
 * - Источник регенерирует **одним куском** (сразу до полного запаса), а не
 *   по 1 энергии за тик (`processor/intents/sources/tick.js`). Значит, скачок
 *   энергии вверх — это регенерация, а не добыча: такие замеры отбрасываются.
 * - Содержимое `creep.store` обновляется движком в конце тика, поэтому
 *   переданную энергию нельзя посчитать как разницу `store` внутри одного
 *   тика — она всегда нулевая.
 *
 * @param room Комната.
 */
function updateIncomeRate(room: Room): void {
    const source = room.find(FIND_SOURCES)[0];

    if (!source) {
        return;
    }

    const now = Game.time;
    const lastTick = room.memory._incomeSampleTick;
    const lastEnergy = room.memory._incomeSampleEnergy;

    if (lastTick === undefined || lastEnergy === undefined) {
        room.memory._incomeSampleTick = now;
        room.memory._incomeSampleEnergy = source.energy;
        return;
    }

    if (now - lastTick < INCOME_SAMPLE_INTERVAL) {
        return;
    }

    const drained = lastEnergy - source.energy;

    room.memory._incomeSampleTick = now;
    room.memory._incomeSampleEnergy = source.energy;

    // Энергия в источнике не уменьшилась: либо ничего не добывали, либо
    // сработала регенерация. Такой замер ничего не говорит о доходе.
    if (drained <= 0) {
        return;
    }

    const rate = drained / (now - lastTick);
    const previous = room.memory._incomeRate ?? 0;

    room.memory._incomeRate = previous > 0 ? previous * 0.5 + rate * 0.5 : rate;
}

/**
 * Определяет, насыщен ли источник комнаты: хватает ли клеток добычи на всех
 * харвестеров.
 *
 * @remarks
 * Клетки добычи — соседи источника, с которых можно добывать. В обычной
 * комнате их восемь, и хватает всем. Но источник может лежать на стене
 * рельефа, и тогда проходимых соседей у него — три (в E34S53 именно так:
 * источник (19,23) стоит на стене, доступны только (20,22), (20,23) и
 * (20,24)).
 *
 * Если клеток не хватает, те, кто тоже умеет добывать (апгрейдер, билдер,
 * ремонтник), вытесняют харвестеров с клеток добычи — и колония остаётся
 * без энергии: харвестеры стоят с пустым рюкзаком, а весь источник уходит
 * в контроллер. Поэтому при насыщении остальные роли берут энергию из
 * спавна/расширений, а клетки добычи остаются за харвестерами.
 *
 * Проверка идёт раз в {@link EXTENSION_CHECK_INTERVAL} тиков.
 *
 * @param room   Комната.
 * @param counts Состав ролей комнаты (`роль → количество`).
 */
function updateSourceSaturation(room: Room, counts: Record<string, number>): void {
    if (
        room.memory._sourceCheckTick &&
        Game.time - room.memory._sourceCheckTick < EXTENSION_CHECK_INTERVAL
    ) {
        return;
    }

    room.memory._sourceCheckTick = Game.time;

    const harvesters = counts[ROLE.HARVESTER] || 0;

    if (harvesters === 0) {
        room.memory._sourceSaturated = false;
        return;
    }

    let slots = 0;

    for (const source of room.find(FIND_SOURCES)) {
        slots += collectHarvestSlots(room, source).length;
    }

    room.memory._sourceSaturated = slots > 0 && harvesters >= slots;
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
 * Куда сдвигать — не «на любую свободную клетку рядом», а туда, откуда
 * крип всё ещё полезен: харвестер возвращается на свою клетку добычи
 * (это один шаг и никакой потери дохода), апгрейдер — на клетку, с которой
 * виден контроллер. Иначе сдвиг просто ломает работу: в E34S53 рабочих
 * выгоняло с кольца на клетку, откуда они уже не могли ни добывать, ни
 * качать контроллер, и кольцо забивалось снова — бесконечный цикл.
 *
 * Клетки добычи тоже исключаются: сдвинув рабочего крипа на клетку добычи,
 * мы отнимем её у харвестера — а это треть дохода комнаты.
 *
 * @param room     Комната.
 * @param spawn    Спавн, вокруг которого ищем занятые клетки.
 * @param ring     Снимок состояния кольца клеток рождения.
 * @param maxMoves Максимум крипов, которых нужно сдвинуть за этот раз.
 * @returns Сколько крипов получили новую цель.
 */
function moveCreepsOffBirthTiles(
    room: Room,
    spawn: StructureSpawn,
    ring: SpawnRingInfo,
    maxMoves: number = Number.POSITIVE_INFINITY
): number {
    const ringTiles = new Set<string>();

    for (const tile of ring.birthTiles) {
        ringTiles.add(`${tile.x},${tile.y}`);
    }

    // Клетки добычи не занимаем: сдвинув рабочего крипа на клетку добычи,
    // мы отнимем её у харвестера — а это треть дохода комнаты.
    const exclude = new Set<string>(ringTiles);

    for (const key of collectHarvestSlotKeys(room)) {
        exclude.add(key);
    }

    // Порядок ролей: сначала харвестеры. У них есть своя клетка добычи, и
    // вернуться на неё стоит одного шага. Апгрейдеру же придётся идти в
    // другую часть комнаты, и на это время он перестаёт качать контроллер,
    // поэтому трогать его — последнее дело.
    const creeps = [...ring.creepsOnBirthTiles].sort((a, b) => {
        const ra = a.memory.role === ROLE.HARVESTER ? 0 : 1;
        const rb = b.memory.role === ROLE.HARVESTER ? 0 : 1;

        if (ra !== rb) {
            return ra - rb;
        }

        return a.name < b.name ? -1 : 1;
    });

    let moved = 0;

    for (const creep of creeps) {
        if (moved >= maxMoves) {
            break;
        }

        const target =
            workPositionFor(room, creep, ringTiles) ??
            findFreeTileNear(room, creep.pos, exclude, 4);

        if (!target) {
            continue;
        }

        if (creep.moveTo(target) === OK) {
            moved++;
        }
    }

    return moved;
}

/**
 * Рабочая клетка крипа: та, с которой он всё ещё полезен и с которой можно
 * уйти с кольца рождения без потери работы.
 *
 * @remarks
 * Для харвестера это его клетка добычи: вернуться на неё стоит одного шага,
 * и доход комнаты не страдает. Для апгрейдера — клетка, с которой виден
 * контроллер (апгрейд работает с расстояния 3): сдвинувшись с кольца без
 * такой клетки, он перестанет качать контроллер вовсе.
 *
 * @param room      Комната.
 * @param creep     Крип, стоящий на кольце рождения.
 * @param ringTiles Клетки кольца рождения (с них крипа сдвигают).
 * @returns Рабочая клетка или `null`, если её нет.
 */
function workPositionFor(
    room: Room,
    creep: Creep,
    ringTiles: Set<string>
): RoomPosition | null {
    if (creep.memory.role === ROLE.HARVESTER) {
        const tile = creep.memory._harvestTile;

        if (tile && !ringTiles.has(`${tile.x},${tile.y}`)) {
            const busy = room.find(FIND_CREEPS, {
                filter: (c) =>
                    c.name !== creep.name && c.pos.x === tile.x && c.pos.y === tile.y
            });

            if (busy.length === 0) {
                return new RoomPosition(tile.x, tile.y, room.name);
            }
        }

        return null;
    }

    if (creep.memory.role === ROLE.UPGRADER) {
        const spot = findUpgradeSpot(room, creep);

        if (spot && !ringTiles.has(`${spot.x},${spot.y}`)) {
            return spot;
        }
    }

    return null;
}
