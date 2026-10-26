/* ============================================================================
 * Роль `builder`: строительство и fallback-апгрейд.
 *
 * Тело: [WORK, CARRY, CARRY, MOVE, MOVE] (2 CARRY для переноски).
 * Стейт-машина:
 *   - `memory.building === true`  → ищет и строит construction-сайт.
 *   - `memory.building === false` → добывает энергию.
 *   - Переход `true → false`: store пуст (с эмоутом 🔄 harvest).
 *   - Переход `false → true`: store полон (с эмоутом 🚧 build).
 * При поиске сайта сначала исключаются ROAD (их бот не строит), затем —
 * любой оставшийся недостроенный. Если сайтов нет — апгрейдит контроллер.
 * ==========================================================================*/

import {
    harvestEnergy,
    findClosestSource,
    findConstructionSite,
    findEnergyDonor,
    buildAt,
    blocksBirthRing,
    isSourceSaturated,
    upgradeRoomController,
    withdrawEnergy
} from '../utilities';

/**
 * Фильтр construction sites: бот не строит расширения в кольце радиуса 1
 * вокруг спавна.
 *
 * @remarks
 * Такое расширение занимает клетку рождения. Восемь таких клеток вокруг
 * спавна — и движок больше не может поставить крипа: спавн запечатывается и
 * колония замирает без ошибок. Строить такое расширение бессмысленно:
 * `ensureSpawnRingReserve` снесёт его обратно.
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

    const room = site.room;

    if (
        room &&
        site.structureType === STRUCTURE_EXTENSION &&
        blocksBirthRing(room, site.pos.x, site.pos.y)
    ) {
        return false;
    }

    return true;
}

/**
 * Выполняет один шаг builder-а. См. описание модуля.
 *
 * @param creep Крип с `role === ROLE.BUILDER`.
 */
export function run(creep: Creep): void {
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
        const site = findConstructionSite(creep, isBuildable);

        if (site) {
            buildAt(creep, site, {
                visualizePathStyle: { stroke: '#ffffff' }
            });

            return;
        }

        upgradeRoomController(creep, {
            visualizePathStyle: { stroke: '#ffffff' }
        });

        return;
    }

    if (isSourceSaturated(creep.room)) {
        // Источник насыщен: клетки добычи отданы харвестерам, энергию для
        // стройки берём из спавна/расширений. Строим тем, что уже есть —
        // ждать полного рюкзака незачем.
        if (energy === 0) {
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

        const site = findConstructionSite(creep, isBuildable);

        if (site) {
            buildAt(creep, site, {
                visualizePathStyle: { stroke: '#ffffff' }
            });

            return;
        }

        upgradeRoomController(creep, {
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
