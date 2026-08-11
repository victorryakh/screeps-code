/* ============================================================================
 * Роль `reserver`: резервирование контроллера удалённой комнаты.
 *
 * Тело: задаётся в `EXPANSION.reserverBody` (по умолчанию
 * [CLAIM, CLAIM, MOVE, MOVE] — два CLAIM дают быстрый резерв:
 * 1 тик CLAIM-части = 1 тик резерва).
 * Маршрут: идёт к центру (25, 25) целевой комнаты, у контроллера —
 * `Creep.reserveController`. Кэш пути — `REMOTE_PATH_TTL`.
 * ==========================================================================*/

import { moveCached } from '../utilities';
import { REMOTE_PATH_TTL } from '../constants';

/**
 * Выполняет один шаг reserver-а. См. описание модуля.
 *
 * @param creep Крип с `role === ROLE.RESERVER`. Требует заполненного
 *              `memory.targetRoom`.
 */
export function run(creep: Creep): void {
    if (!creep.memory.targetRoom) {
        return;
    }

    if (creep.room.name !== creep.memory.targetRoom) {
        moveCached(
            creep,
            new RoomPosition(25, 25, creep.memory.targetRoom),
            { reusePath: REMOTE_PATH_TTL }
        );
        return;
    }

    const controller = creep.room.controller;

    if (!controller) {
        return;
    }

    if (creep.reserveController(controller) === ERR_NOT_IN_RANGE) {
        moveCached(creep, controller, { reusePath: REMOTE_PATH_TTL });
    }
}
