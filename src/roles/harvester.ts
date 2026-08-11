/* ============================================================================
 * Роль `harvester`: добыча энергии и снабжение spawn/extension/tower.
 *
 * Тело: [WORK, CARRY, MOVE] (минимально достаточное).
 * Цикл:
 *   1. Если есть свободное место в store — добыть с `memory.sourceId`
 *      (если задан) или с ближайшего активного источника.
 *   2. Если store полон — передать энергию в ближайшую структуру
 *      из [SPAWN, EXTENSION, TOWER] с запасом места.
 *   3. Если таких структур нет — апгрейдить контроллер (harvester
 *      выполняет роль «последнего рубежа» экономики).
 * ==========================================================================*/

import {
    harvestEnergy,
    findClosestSource,
    transferEnergy,
    findEnergyTransferTarget,
    upgradeRoomController
} from '../utilities';

/**
 * Выполняет один шаг harvester-а. См. описание модуля.
 *
 * @param creep Крип с `role === ROLE.HARVESTER`. Назначенный источник
 *              хранится в `creep.memory.sourceId` (проставляется при
 *              спавне через `_harvesterIndex`).
 */
export function run(creep: Creep): void {
    if (creep.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
        let source = Game.getObjectById(creep.memory.sourceId ?? ('' as Id<Source>));

        if (!source) {
            source = findClosestSource(creep);
        }

        if (!source) {
            return;
        }

        harvestEnergy(creep, source, {
            visualizePathStyle: { stroke: '#ffaa00' }
        });

        return;
    }

    const transferTarget = findEnergyTransferTarget(creep, [
        STRUCTURE_SPAWN,
        STRUCTURE_EXTENSION,
        STRUCTURE_TOWER
    ]);

    if (transferTarget) {
        transferEnergy(creep, transferTarget, {
            visualizePathStyle: { stroke: '#ffffff' }
        });

        return;
    }

    upgradeRoomController(creep, {
        visualizePathStyle: { stroke: '#ffffff' }
    });
}
