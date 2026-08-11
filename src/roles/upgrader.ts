/* ============================================================================
 * Роль `upgrader`: апгрейд контроллера комнаты.
 *
 * Тело: [WORK, WORK, CARRY, MOVE] (2 WORK для эффективности).
 * Стейт-машина:
 *   - `memory.upgrading === true`  → апгрейдит контроллер.
 *   - `memory.upgrading === false` → добывает с ближайшего источника.
 *   - Переход `true → false`: энергия кончилась или контроллер чужой/потерян.
 *   - Переход `false → true`: store полон и контроллер свой.
 * Если контроллер не наш — апгрейд невозможен, крип молча простаивает.
 * ==========================================================================*/

import {
    harvestEnergy,
    findClosestSource,
    upgradeRoomController
} from '../utilities';

/**
 * Выполняет один шаг upgrader-а. См. описание модуля.
 *
 * @param creep Крип с `role === ROLE.UPGRADER`.
 */
export function run(creep: Creep): void {
    if (typeof creep.memory.upgrading !== 'boolean') {
        creep.memory.upgrading = false;
    }

    const energy = creep.store[RESOURCE_ENERGY];
    const freeCapacity = creep.store.getFreeCapacity(RESOURCE_ENERGY);
    const controller = creep.room.controller;

    if (
        creep.memory.upgrading &&
        (energy === 0 || !controller || !controller.my)
    ) {
        creep.memory.upgrading = false;
    }

    if (
        !creep.memory.upgrading &&
        freeCapacity === 0 &&
        controller &&
        controller.my
    ) {
        creep.memory.upgrading = true;
    }

    if (creep.memory.upgrading) {
        upgradeRoomController(creep, {
            visualizePathStyle: { stroke: '#00ff00' }
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
