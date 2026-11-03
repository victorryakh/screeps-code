/* ============================================================================
 * Роль `harvester`: добыча энергии и снабжение spawn/extension/tower.
 *
 * Тело: [WORK, CARRY, CARRY, MOVE, MOVE] (минимально достаточное).
 * Цикл:
 *   1. Найти хранилище, которое может принять энергию, и посчитать груз
 *      рейса (см. `deliveryTripLoad`).
 *   2. Если в рюкзаке уже есть этот груз — сдать энергию в хранилище.
 *   3. Иначе — добыть недостающее: с `memory.sourceId` (если задан) или
 *      с ближайшего активного источника.
 *   4. Если хранилища нет (комната переполнена) и рюкзак полон —
 *      апгрейдить контроллер (харвестер выполняет роль «последнего
 *      рубежа» экономики).
 *
 * Ключевое правило: харвестер возит ровно столько энергии, сколько
 * принимает хранилище, и возвращается к источнику с пустым рюкзаком.
 * Набитый рюкзак при узком хранилище означает, что половина энергии
 * едет обратно вхолостую, а усталость за это платит крип.
 * ==========================================================================*/

import {
    harvestEnergy,
    findClosestSource,
    transferEnergy,
    findEnergyTransferTarget,
    deliveryTripLoad,
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
    const transferTarget = findEnergyTransferTarget(creep, [
        STRUCTURE_SPAWN,
        STRUCTURE_EXTENSION,
        STRUCTURE_TOWER
    ]);

    if (transferTarget) {
        const tripLoad = deliveryTripLoad(creep, transferTarget);

        // Энергии хватает на рейс — сдаём. Ждать, пока наберётся весь
        // рюкзак, не нужно: лишнее хранилище всё равно не примет, а крип
        // нёс лишнее обратно к источнику и платит за дорогу усталостью.
        if (creep.store[RESOURCE_ENERGY] >= tripLoad) {
            transferEnergy(creep, transferTarget, {
                visualizePathStyle: { stroke: '#ffffff' }
            });

            return;
        }
    } else if (creep.store.getFreeCapacity(RESOURCE_ENERGY) === 0) {
        // Сдать энергию некуда (комната переполнена), а рюкзак полон:
        // качаем контроллер — энергия в рюкзаке всё равно пропадёт.
        upgradeRoomController(creep, {
            visualizePathStyle: { stroke: '#ffffff' }
        });

        return;
    }

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
}
