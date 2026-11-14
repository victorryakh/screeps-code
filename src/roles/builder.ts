/* ============================================================================
 * Роль `builder`: строительство и fallback-апгрейд.
 *
 * Тело: [WORK, CARRY, CARRY, MOVE, MOVE] (2 CARRY для переноски).
 * Стейт-машина:
 *   - `memory.building === true`  → ищет и строит construction-сайт.
 *   - `memory.building === false` → добывает энергию.
 *   - Переход `true → false`: store пуст (с эмоутом 🔄 harvest).
 *   - Переход `false → true`: store полон (с эмоутом 🚧 build).
 * При поиске сайта исключаются ROAD (их бот не строит) и уже достроенные
 * сайты. Если сайтов нет — апгрейдит контроллер.
 * ==========================================================================*/

import { BUILDER_RESERVE_ENERGY } from '../constants';
import {
    harvestEnergy,
    findClosestSource,
    findConstructionSite,
    findDeliverySite,
    findEnergyDonor,
    findBuildSpot,
    findFreeTileNear,
    collectHarvestSlotKeys,
    buildAt,
    isSourceSaturated,
    upgradeFromWorkSpot,
    withdrawEnergy,
    moveCached,
    runStepAside
} from '../utilities';

/**
 * Фильтр construction sites: бот не строит расширения в кольце радиуса 1
 * вокруг спавна.
 *
 * @remarks
 * Такое расширение занимает клетку рождения. Восемь таких клеток вокруг
 * спавна — и движок больше не может поставить крипа: спавн запечатывается и
 * колония замирает без ошибок.
 *
 * **Но** construction site занимает клетку рождения уже сейчас: и сайт
 * расширения, и готовое расширение входят в `OBSTACLE_OBJECT_TYPES` движка.
 * Поэтому достроить такой сайт число свободных клеток рождения не меняет —
 * оно и до, и после равно нулю свободных клеток на этой позиции.
 *
 * Из-за этого отказ строить такие сайты был вредным: в E34S53 два сайта
 * (20,25) и (20,27) так и висели незастроенными, занимая две клетки
 * рождения, но не давая комнате добраться до лимита расширений по RCL
 * (RCL 3 = 10 расширений, а сайт тоже считается в лимите). Билдеру было
 * нечего строить, и он вырождался во второго апгрейдера.
 *
 * @param site  Construction site.
 */
function isBuildable(site: ConstructionSite): boolean {
    if (site.structureType === STRUCTURE_ROAD) {
        return false;
    }

    if (site.progress >= site.progressTotal) {
        return false;
    }

    return true;
}

/**
 * Выбирает площадку, которую билдер строит в первую очередь.
 *
 * @remarks
 * Расширение рядом с клеткой добычи поднимает доход комнаты сильнее всего
 * (доставка энергии сокращается с десяти клеток до одной), поэтому такие
 * площадки билдер строит первыми. Остальные — по ближайшей.
 *
 * **Исключение — башня обороны.** Она стоит в первом ряду всегда:
 * - вторгатели бьют по харвестерам, и без башни колония вымирает. В E34S53
 *   14.11.2026 они оставили комнату с одним билдером — и комната перестала
 *   производить энергию вовсе;
 * - башня обходится дешевле контейнера (1000 против 5000), а контейнер — это
 *   «дырка» для излишка, то есть оптимизация дохода, а не выживание.
 *
 * @param creep Крип-билдер.
 * @returns Площадка или `null`, если строить нечего.
 */
function findSiteToBuild(creep: Creep): ConstructionSite | null {
    const tower = findConstructionSite(
        creep,
        (s) => isBuildable(s) && s.structureType === STRUCTURE_TOWER
    );

    if (tower) {
        return tower;
    }

    return findDeliverySite(creep, isBuildable) ?? findConstructionSite(creep, isBuildable);
}

/**
 * Запоминает клетку, с которой выгодно строить стройплощадку.
 *
 * @remarks
 * Клетка кэшируется, чтобы билдер не пересчитывал её каждый тик, но
 * пересчитывается, если её занял другой крип или площадка сменилась.
 *
 * @param creep Крип-билдер.
 * @param site  Стройплощадка, которую нужно достроить.
 * @returns Клетка для стройки или `null`, если подходящей нет.
 */
function ensureBuildSpot(creep: Creep, site: ConstructionSite): RoomPosition | null {
    const room = creep.room;
    const cached = creep.memory._buildSpot;

    if (
        cached &&
        cached.roomName === room.name &&
        cached.siteId === site.id
    ) {
        const busy = room.find(FIND_CREEPS, {
            filter: (c) =>
                c.name !== creep.name && c.pos.x === cached.x && c.pos.y === cached.y
        });

        if (busy.length === 0) {
            return new RoomPosition(cached.x, cached.y, cached.roomName);
        }
    }

    const spot = findBuildSpot(creep, site);

    if (spot) {
        creep.memory._buildSpot = {
            x: spot.x,
            y: spot.y,
            roomName: spot.roomName,
            siteId: site.id
        };
    } else {
        delete creep.memory._buildSpot;
    }

    return spot;
}

/**
 * Уводит крипа с клетки добычи, если он на ней оказался.
 *
 * @remarks
 * Клетки добычи — конечный ресурс. В E34S53 их три, и билдер, вставший на
 * одну из них, отнимал у харвестеров треть дохода комнаты, стоя там без
 * дела. Клетка добычи также не место для ожидания.
 *
 * @param creep Крип.
 */
function stepOffHarvestSlots(creep: Creep): void {
    const room = creep.room;
    const slots = collectHarvestSlotKeys(room);

    if (!slots.has(`${creep.pos.x},${creep.pos.y}`)) {
        return;
    }

    const spot = findFreeTileNear(room, creep.pos, slots);

    if (spot) {
        moveCached(creep, spot, {
            visualizePathStyle: { stroke: '#ffaa00' }
        });
    }
}

/**
 * Выполняет один шаг builder-а. См. описание модуля.
 *
 * @param creep Крип с `role === ROLE.BUILDER`.
 */
export function run(creep: Creep): void {
    // Сдвиг в сторону — исключение из правил роли: он важнее стройки,
    // потому что без него другой наш крип простаивает взаперти (см.
    // `ensureCreepsNotConfined` в `room.ts`).
    if (runStepAside(creep)) {
        return;
    }

    if (typeof creep.memory.building !== 'boolean') {
        creep.memory.building = false;
    }

    const energy = creep.store[RESOURCE_ENERGY];
    const freeCapacity = creep.store.getFreeCapacity(RESOURCE_ENERGY);

    if (creep.memory.building && energy === 0) {
        creep.memory.building = false;
        creep.say('🔄 harvest');
    }

    if (!creep.memory.building && freeCapacity === 0) {
        creep.memory.building = true;
        creep.say('🚧 build');
    }

    if (creep.memory.building) {
        const site = findSiteToBuild(creep);

        if (site) {
            const spot = ensureBuildSpot(creep, site);

            if (spot && !creep.pos.isEqualTo(spot)) {
                moveCached(creep, spot, {
                    visualizePathStyle: { stroke: '#ffffff' }
                });

                return;
            }

            buildAt(creep, site, {
                visualizePathStyle: { stroke: '#ffffff' }
            });

            return;
        }

        upgradeFromWorkSpot(creep, {
            visualizePathStyle: { stroke: '#ffffff' }
        });

        return;
    }

    if (isSourceSaturated(creep.room)) {
        // Источник насыщен: клетки добычи отданы харвестерам, энергию для
        // стройки берём из спавна/расширений. Строим тем, что уже есть —
        // ждать полного рюкзака незачем.
        if (energy === 0) {
            if (creep.memory._excess) {
                // Лишний рабочий не берёт энергию из структур: она нужна
                // тем, кто в бюджете комнаты. Но и стоять на клетке добычи
                // или клетке рождения он не должен — они отнимают доход у
                // харвестеров и закрывают спавн. Ждём у стройки: там клетка
                // заведомо свободна.
                const site = findSiteToBuild(creep);

                if (site) {
                    const spot = ensureBuildSpot(creep, site);

                    if (spot && !creep.pos.isEqualTo(spot)) {
                        moveCached(creep, spot, {
                            visualizePathStyle: { stroke: '#ffffff' }
                        });

                        return;
                    }
                }

                // Строить нечего — но и стоять нельзя: из «кармана» спавна
                // выход один, и стоящий на нём билдер запирал половину
                // колонии (см. `ensureCreepsNotBlocking` в `room.ts`). Поэтому
                // лишний билдер работает на контроллере тем, что уже есть в
                // рюкзаке: энергию из структур он не берёт, а с клетки
                // выхода уходит.
                //
                // `upgradeFromWorkSpot` уводит крипа с кольца рождения на
                // выбранную клетку апгрейда: в E34S53 билдер стоял на
                // (19,27) и перекрывал коридор между клетками добычи и
                // спавном, из-за чего харвестеры обходили полкомнаты, а
                // доход комнаты был 0.64 энергии в тик.
                upgradeFromWorkSpot(creep, {
                    visualizePathStyle: { stroke: '#ffffff' }
                });

                return;
            }

            // Билдер берёт энергию из структур комнаты — тех же самых,
            // из которых берёт апгрейдер. Съесть весь запас нельзя: тогда
            // апгрейдер останется без энергии и контроллер замрёт.
            //
            // Сравнивать надо с тем, что билдер увозит за один заход, а не с
            // полной стоимостью площадки. Полная стоимость недостижима
            // принципиально: комната копит энергию в структурах, а их
            // суммарная ёмкость в E34S53 — 850 (спавн 300 + 11 расширений по
            // 50), тогда как расширение стоит 3000. Условие «в комнате есть
            // 3300 энергии» не может выполниться никогда, и билдер стоял
            // и ждал, не построив ничего: колония платила за крипа, который
            // не делал работы.
            //
            // Билдер строит по частям: рюкзак — это его бюджет на один
            // заход, а площадка набирает прогресс за несколько заходов.
            const pending = findSiteToBuild(creep);

            if (pending) {
                const remaining = pending.progressTotal - pending.progress;
                const chunk = Math.min(
                    remaining,
                    creep.store.getFreeCapacity(RESOURCE_ENERGY)
                );

                if (creep.room.energyAvailable < chunk + BUILDER_RESERVE_ENERGY) {
                    // Денег пока нет — ждём, но с клетки добычи уходим:
                    // она принадлежит харвестерам.
                    stepOffHarvestSlots(creep);
                    return;
                }
            }

            const donor = findEnergyDonor(creep);

            if (!donor) {
                return;
            }

            withdrawEnergy(creep, donor, {
                visualizePathStyle: { stroke: '#ffaa00' }
            });

            return;
        }

        creep.memory.building = true;

        const site = findSiteToBuild(creep);

        if (site) {
            const spot = ensureBuildSpot(creep, site);

            if (spot && !creep.pos.isEqualTo(spot)) {
                moveCached(creep, spot, {
                    visualizePathStyle: { stroke: '#ffffff' }
                });

                return;
            }

            buildAt(creep, site, {
                visualizePathStyle: { stroke: '#ffffff' }
            });

            return;
        }

        upgradeFromWorkSpot(creep, {
            visualizePathStyle: { stroke: '#ffffff' }
        });

        return;
    }

    const source = findClosestSource(creep);

    if (!source) {
        return;
    }

    harvestEnergy(creep, source, {
        visualizePathStyle: { stroke: '#ffaa00' }
    });
}
