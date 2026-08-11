/* ============================================================================
 * Роль `repairer`: ремонт структур и fallback-апгрейд.
 *
 * Тело: [WORK, CARRY, MOVE, MOVE].
 * Стейт-машина:
 *   - `memory.repairing === true`  → ищет цель и чинит.
 *   - `memory.repairing === false` → добывает энергию.
 *   - Переходы аналогичны builder-у, но без эмоутов.
 * Стены и рампарты исключены из кандидатов на ремонт — бот их сейчас
 * не чинит. Если починить нечего — апгрейдит контроллер.
 * ==========================================================================*/

import {
    harvestEnergy,
    findClosestSource,
    findRepairTarget,
    repairAt,
    upgradeRoomController
} from '../utilities';

/**
 * Выполняет один шаг repairer-а. См. описание модуля.
 *
 * @param creep Крип с `role === ROLE.REPAIRER`.
 */
export function run(creep: Creep): void {
    if (typeof creep.memory.repairing !== 'boolean') {
        creep.memory.repairing = false;
    }

    const energy = creep.store[RESOURCE_ENERGY];
    const freeCapacity = creep.store.getFreeCapacity(RESOURCE_ENERGY);

    if (creep.memory.repairing && energy === 0) {
        creep.memory.repairing = false;
    }

    if (!creep.memory.repairing && freeCapacity === 0) {
        creep.memory.repairing = true;
    }

    if (creep.memory.repairing) {
        const repairTarget = findRepairTarget(creep);

        if (repairTarget) {
            repairAt(creep, repairTarget, {
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
