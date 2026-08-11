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
    buildAt,
    upgradeRoomController
} from '../utilities';

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
        let site = findConstructionSite(creep, (s) =>
            s.structureType !== STRUCTURE_ROAD && s.progress < s.progressTotal
        );

        if (!site) {
            site = findConstructionSite(creep);
        }

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
