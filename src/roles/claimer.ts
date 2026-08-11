/* ============================================================================
 * Роль `claimer`: захват контроллера целевой комнаты.
 *
 * Тело: задаётся в `EXPANSION.claimerBody` (по умолчанию
 * [CLAIM, MOVE, MOVE, MOVE] — один CLAIM, дешёвый).
 * Маршрут: к (25, 25) целевой комнаты, у контроллера — `claimController`.
 * Кэш пути — `REMOTE_PATH_TTL`.
 *
 * @remarks
 * Сразу после успешного клейма (`OK && controller.my`) крип вызывает
 * `creep.suicide()`. Это намеренное поведение: клейм-крип с одним CLAIM
 * экономически невыгодно держать, и освобождение слота быстрее готовит
 * следующего rharvester-а.
 * ==========================================================================*/

import { moveCached } from '../utilities';
import { REMOTE_PATH_TTL } from '../constants';

/**
 * Выполняет один шаг claimer-а. См. описание модуля.
 *
 * @param creep Крип с `role === ROLE.CLAIMER`. Требует заполненного
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

    const result = creep.claimController(controller);

    if (result === ERR_NOT_IN_RANGE) {
        moveCached(creep, controller, { reusePath: REMOTE_PATH_TTL });
        return;
    }

    if (result === OK && controller.my) {
        if (Memory.debug) {
            console.log(`[claim] claimed ${controller.room.name}, suiciding claimer`);
        }

        creep.suicide();
    }
}
