/* ============================================================================
 * Спавн крипов.
 *
 * Тонкая обёртка над `StructureSpawn.spawnCreep`: проверяет кулдаун,
 * энергетическую обеспеченность, проставляет роли и служебные поля
 * памяти (для harvester — индекс источника, для remote-ролей — targetRoom).
 * ==========================================================================*/

import { ROLE } from './constants';
import { REMOTE_ROLES } from './strategy';
import { bodyFor, bodyCost, rescueBodiesFor } from './utilities';
import { recordSpawn } from './metrics';
import * as log from './log';

/**
 * Опции попытки спавна.
 */
export interface SpawnOptions {
    /**
     * Разрешено ли заказать **уменьшенное** тело, если обычное не влезает
     * в бюджет комнаты.
     *
     * @remarks
     * Уменьшенное тело — это аварийный путь для комнаты, которая больше не
     * производит энергию: в спавнах и расширениях вместе меньше, чем стоит
     * обычное тело, а добывать больше некому. Без аварийного пути такая
     * комната не может заказать ни одного крипа никогда — энергию в комнату
     * приносить больше нечем.
     *
     * В обычной работе уменьшенное тело недопустимо: комната завела бы
     * урезанных харвестеров вместо полноценных. Единственное исключение —
     * когда в комнате не осталось ни одного харвестера: тогда энергию в
     * комнату больше никто не принесёт, и деградация тела — меньшее зло,
     * чем смерть колонии.
     */
    allowReducedBody?: boolean;
}

/**
 * Пытается создать крипа заданной роли в комнате. Алгоритм:
 * 1. Возвращает `false`, если в этой комнате на текущем тике уже был
 *    спавн (`room.memory._spawnCooldown === Game.time`).
 * 2. Ищет свободный спавн (`!spawning`) в комнате.
 * 3. Подбирает тело через {@link bodyFor} и предлагает его движку:
 *    `spawnCreep` берёт энергию **из всех спавнов и расширений комнаты**
 *    (сначала из спавнов, потом из расширений), поэтому affordability решает
 *    движок, а не бот.
 * 4. Если обычное тело движок не оплатил, аварийный путь
 *    ({@link SpawnOptions.allowReducedBody}) предлагает уменьшенные тела по
 *    лестнице — от лучшего к худшему, через {@link rescueBodiesFor}.
 * 5. Для ролей из {@link REMOTE_ROLES} требуется `Memory.targetRoom` —
 *    иначе спавн отменяется.
 * 6. Для `ROLE.HARVESTER` циклически выбирает источник комнаты по
 *    `room.memory._harvesterIndex`.
 * 7. Спавнит крипа; при успехе проставляет `_spawnCooldown = Game.time`.
 *
 * @param room    Комната, в которой создаётся крип.
 * @param role    Имя роли. Расширено до `string` ради совместимости с
 *                устаревшими данными в `Memory.creeps`; для неизвестных ролей
 *                {@link bodyFor} вернёт минимальное тело.
 * @param options Опции попытки спавна (см. {@link SpawnOptions}).
 * @returns `true`, если спавн успешно поставлен в очередь; `false` в остальных
 *          случаях (кулдаун, нет спавна, не хватает энергии, ошибка `spawnCreep`).
 */
export function trySpawn(room: Room, role: string, options: SpawnOptions = {}): boolean {
    if (room.memory._spawnCooldown === Game.time) {
        return false;
    }

    const spawn = room.find(FIND_MY_SPAWNS, {
        filter: (s) => !s.spawning
    })[0];

    if (!spawn) {
        return false;
    }

    const fullBody = bodyFor(role);

    if (!fullBody) {
        return false;
    }

    const name = `${role}_${Game.time}_${Math.floor(Math.random() * 1000)}`;

    const memory: CreepMemory = {
        role: role,
        homeRoom: room.name
    };

    if (REMOTE_ROLES.indexOf(role as (typeof REMOTE_ROLES)[number]) !== -1) {
        if (!Memory.targetRoom) {
            return false;
        }

        memory.targetRoom = Memory.targetRoom;
    }

    if (role === ROLE.HARVESTER) {
        const sources = room.find(FIND_SOURCES);

        if (sources.length > 0) {
            room.memory._harvesterIndex = (room.memory._harvesterIndex || 0) + 1;
            const source = sources[room.memory._harvesterIndex % sources.length];
            if (source) {
                memory.sourceId = source.id;
            }
        }
    }

    // Лестница тел: от полного к аварийному.
    //
    // Движок сам решает, какое тело комната может оплатить: `spawnCreep`
    // берёт энергию **из всех спавнов и расширений комнаты** (сначала из
    // спавнов, потом из расширений) — «The required energy amount can be
    // withdrawn from all spawns and extensions in the room» (документация
    // движка). Поэтому бот не решает за движок, хватает ли энергии: он
    // предлагает тела по очереди, и первое, которое движок принял, и есть
    // ответ.
    //
    // Собственная проверка `spawn.store.energy >= cost` была неверной — и
    // именно она убивала комнату: бот отказывался заказывать крипа там, где
    // движок заказал бы его спокойно. В E34S53 (19.11.2026) в спавне было
    // 104 энергии, в расширениях 200 — всего 304, ровно на полноценного
    // харвестера, но бот «не видел» этих 200 и объявил комнату мёртвой. А
    // мёртвая комната — это ноль крипов, ноль дохода и медленный даунгрейд
    // контроллера.
    const ladder = options.allowReducedBody
        ? [fullBody, ...rescueBodiesFor(role)]
        : [fullBody];

    let chosen: BodyPartConstant[] | null = null;
    let cheapest = bodyCost(fullBody);

    for (const candidate of ladder) {
        if (candidate !== fullBody) {
            memory.rescue = true;
        }

        const result = spawn.spawnCreep(candidate, name, { memory: memory });

        if (result === OK) {
            chosen = candidate;

            break;
        }

        cheapest = bodyCost(candidate);

        if (result !== ERR_NOT_ENOUGH_ENERGY) {
            // Любая другая ошибка (спавн занят, имя занято, тело недопустимо)
            // повтором не лечится — и следующее тело её тоже не исправит.
            break;
        }
    }

    if (!chosen) {
        // Ни одно тело комната не осилила: в спавнах и расширениях вместе
        // меньше, чем стоит самое дешёвое из предложенных.
        //
        // Это не «нет денег», это «денег мало»: спавн регенерирует по 1
        // энергии за тик, пока в комнате меньше 300, — так что комната
        // выкарабкается сама, как только энергия дойдёт до нужной отметки.
        log.warnOnce(
            'spawn',
            `spawn-short|${room.name}|${role}`,
            `cannot spawn ${role} in ${room.name}: the room holds ` +
            `${room.energyAvailable} energy in spawns and extensions, and the ` +
            `cheapest body the bot may order costs ${cheapest} — the spawn ` +
            'regains 1 energy per tick while the room holds less than 300'
        );

        return false;
    }

    if (chosen !== fullBody) {
        log.warnOnce(
            'spawn',
            `emergency-body|${room.name}|${role}`,
            `emergency body for ${role} in ${room.name}: the room could not ` +
            `pay for the normal body (${bodyCost(fullBody)}), so a reduced ` +
            `body (${bodyCost(chosen)}) was ordered to restart the colony`
        );
    }

    room.memory._spawnCooldown = Game.time;
    recordSpawn(role, bodyCost(chosen), chosen.length);

    return true;
}

/**
 * Проверяет, может ли комната позволить себе спавн крипа заданной роли
 * по `energyCapacityAvailable` (ёмкость, а не текущий запас).
 *
 * @param room Комната.
 * @param role Имя роли (расширено до `string`; см. {@link trySpawn}).
 * @returns `true`, если `room.energyCapacityAvailable >= bodyCost(bodyFor(role))`.
 */
export function canAffordBody(room: Room, role: string): boolean {
    const body = bodyFor(role);

    if (!body) {
        return false;
    }

    return room.energyCapacityAvailable >= bodyCost(body);
}
