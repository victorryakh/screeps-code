import { ROLE, HOME_PATH_TTL, REPAIR_THRESHOLD } from './constants';
import { EXPANSION } from './strategy';

/**
 * Допустимая цель для функций перемещения: явная `RoomPosition` или
 * любой игровой объект с полем `pos` (`Source`, `Structure`, `Creep`,
 * `ConstructionSite` и т.п.).
 */
type MoveDest = RoomPosition | { pos: RoomPosition };

/**
 * Перемещает крипа к указанной точке, используя закэшированный в памяти крипа путь
 * для экономии CPU. При повторных вызовах с тем же назначением и в пределах TTL
 * применяется сохранённый маршрут через `Creep.moveByPath`; при его устаревании,
 * отсутствии или ошибке повторно выполняется полный поиск пути через `Creep.moveTo`.
 *
 * Путь хранится в `creep.memory._move` в формате `{ path, dest: { x, y, roomName }, time }`
 * и считается валидным, пока `Game.time - time < opts.reusePath ?? HOME_PATH_TTL`.
 *
 * @param creep  Крип, который должен переместиться.
 * @param dest   Цель перемещения: `RoomPosition` или любой объект с полем `pos`
 *               (например, `Source`, `Structure`, `Creep`, `ConstructionSite`).
 * @param opts   Дополнительные опции `MoveToOpts`. Поле `reusePath` ограничивает
 *               время жизни кэша; если не задано, используется `HOME_PATH_TTL`.
 * @returns Результат перемещения: `OK`, `ERR_TIRED`, `ERR_INVALID_ARGS`
 *          или код ошибки от `Creep.moveTo` / `Creep.moveByPath`.
 */
export function moveCached(
    creep: Creep,
    dest: MoveDest,
    opts?: MoveToOpts
): ScreepsReturnCode {
    opts = opts ?? {};

    const pos: RoomPosition | undefined = 'pos' in dest ? dest.pos : dest;

    if (!pos || pos.roomName === undefined) {
        return ERR_INVALID_ARGS;
    }

    if (creep.fatigue > 0) {
        return ERR_TIRED;
    }

    const moveMemory = creep.memory._move;

    if (
        moveMemory &&
        moveMemory.path &&
        moveMemory.dest &&
        moveMemory.dest.x === pos.x &&
        moveMemory.dest.y === pos.y &&
        moveMemory.dest.roomName === pos.roomName &&
        Game.time - (moveMemory.time || 0) < (opts.reusePath ?? HOME_PATH_TTL)
    ) {
        const result = creep.moveByPath(moveMemory.path);

        if (result === OK || result === ERR_TIRED) {
            return result;
        }
    }

    if (opts.reusePath === undefined) {
        opts.reusePath = HOME_PATH_TTL;
    }

    return creep.moveTo(dest, opts);
}

/**
 * Считает суммарную стоимость тела крипа в энергии по прайсу `BODYPART_COST`.
 *
 * @param body Массив частей тела.
 * @returns Полная стоимость спавна крипа с таким телом.
 */
export function bodyCost(body: BodyPartConstant[]): number {
    let cost = 0;

    for (const part of body) {
        cost += BODYPART_COST[part];
    }

    return cost;
}

/**
 * Возвращает массив частей тела по имени роли. Базовые роли хардкоднуты,
 * удалённые (`RHARVESTER`, `RESERVER`, `CLAIMER`) берутся из {@link EXPANSION}.
 *
 * @param role Имя роли. Лучше передавать значения из {@link ROLE}, но тип
 *             расширен до `string` ради совместимости с устаревшими данными
 *             в `Memory.creeps`. Для неизвестной роли возвращается
 *             минимальное тело `[WORK, CARRY, MOVE]`.
 */
export function bodyFor(role: string): BodyPartConstant[] {
    switch (role) {
        case ROLE.HARVESTER:
            return [WORK, CARRY, MOVE];

        case ROLE.UPGRADER:
            return [WORK, WORK, CARRY, MOVE];

        case ROLE.BUILDER:
            return [WORK, CARRY, CARRY, MOVE, MOVE];

        case ROLE.REPAIRER:
            return [WORK, CARRY, MOVE, MOVE];

        case ROLE.RHARVESTER:
            return EXPANSION.rharvesterBody;

        case ROLE.RESERVER:
            return EXPANSION.reserverBody;

        case ROLE.CLAIMER:
            return EXPANSION.claimerBody;

        default:
            return [WORK, CARRY, MOVE];
    }
}

/**
 * Добывает ресурс из источника. Если крип не в зоне действия — перемещается
 * к нему через {@link moveCached}.
 *
 * @param creep  Добывающий крип.
 * @param source Источник (`Source`, `Mineral`, `Deposit`). `null`/`undefined`
 *               считается ошибкой и возвращает `ERR_INVALID_TARGET`.
 * @param opts   Опции `MoveToOpts`, пробрасываемые в `moveCached`.
 * @returns `OK` при успешной добыче, `ERR_INVALID_TARGET` без источника,
 *          или код перемещения.
 */
export function harvestEnergy(
    creep: Creep,
    source: Source | Mineral | Deposit | null | undefined,
    opts?: MoveToOpts
): ScreepsReturnCode {
    if (!source) {
        return ERR_INVALID_TARGET;
    }

    if (creep.harvest(source) === ERR_NOT_IN_RANGE) {
        return moveCached(creep, source, opts);
    }

    return OK;
}

/**
 * Возвращает ближайший к крипу источник по пути (`findClosestByPath`).
 *
 * @param creep      Крип, относительно которого ищется источник.
 * @param activeOnly Если `true`, ищет только среди активных
 *                   (`FIND_SOURCES_ACTIVE`); иначе — все источники в комнате.
 * @returns Ближайший `Source` или `null`, если в комнате нет подходящих.
 */
export function findClosestSource(creep: Creep, activeOnly = false): Source | null {
    return creep.pos.findClosestByPath(activeOnly ? FIND_SOURCES_ACTIVE : FIND_SOURCES);
}

/**
 * Передаёт `RESOURCE_ENERGY` в цель. Если не в зоне — перемещается через
 * {@link moveCached}.
 *
 * @param creep  Крип-донор.
 * @param target Получатель энергии: `Creep`, `Structure` и т.п. `null`/
 *               `undefined` возвращает `ERR_INVALID_TARGET`.
 * @param opts   Опции `MoveToOpts`, пробрасываемые в `moveCached`.
 * @returns `OK`, `ERR_INVALID_TARGET` или код перемещения.
 */
export function transferEnergy(
    creep: Creep,
    target: AnyCreep | Structure | null | undefined,
    opts?: MoveToOpts
): ScreepsReturnCode {
    if (!target) {
        return ERR_INVALID_TARGET;
    }

    if (creep.transfer(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
        return moveCached(creep, target, opts);
    }

    return OK;
}

/**
 * Ищет ближайшую структуру заданного типа, у которой есть свободный объём
 * под `RESOURCE_ENERGY` (например, `SPAWN`/`EXTENSION` по умолчанию).
 *
 * @param creep Крип, относительно которого ищется цель.
 * @param types Допустимые `StructureConstant`. По умолчанию —
 *              `[STRUCTURE_SPAWN, STRUCTURE_EXTENSION]`.
 * @returns Подходящая `Structure` или `null`, если в комнате нет
 *          структур со свободным местом.
 */
export function findEnergyTransferTarget(
    creep: Creep,
    types: StructureConstant[] = [STRUCTURE_SPAWN, STRUCTURE_EXTENSION]
): Structure | null {
    return creep.pos.findClosestByPath(FIND_STRUCTURES, {
        filter: (s): s is AnyStoreStructure =>
            (types as StructureConstant[]).indexOf(s.structureType) !== -1 &&
            'store' in s &&
            (s as AnyStoreStructure).store.getFreeCapacity(RESOURCE_ENERGY) > 0
    });
}

/**
 * Апгрейдит контроллер текущей комнаты крипа. Если не в зоне — перемещается
 * через {@link moveCached}. Работает только в owned-комнате (`controller.my`).
 *
 * @param creep Крип-апгрейдер.
 * @param opts  Опции `MoveToOpts`, пробрасываемые в `moveCached`.
 * @returns `OK`, `ERR_INVALID_TARGET` (нет контроллера или он чужой) или
 *          код перемещения.
 */
export function upgradeRoomController(creep: Creep, opts?: MoveToOpts): ScreepsReturnCode {
    const controller = creep.room.controller;

    if (!controller || !controller.my) {
        return ERR_INVALID_TARGET;
    }

    if (creep.upgradeController(controller) === ERR_NOT_IN_RANGE) {
        return moveCached(creep, controller, opts);
    }

    return OK;
}

/**
 * Возвращает ближайший к крипу свой construction site, удовлетворяющий
 * фильтру. По умолчанию выбираются любые недостроенные сайты.
 *
 * @param creep  Крип-строитель.
 * @param filter Дополнительный предикат отбора. По умолчанию —
 *               `s.progress < s.progressTotal`.
 * @returns Подходящий `ConstructionSite` или `null`.
 */
export function findConstructionSite(
    creep: Creep,
    filter: (s: ConstructionSite) => boolean = (s) => s.progress < s.progressTotal
): ConstructionSite | null {
    return creep.pos.findClosestByPath(FIND_MY_CONSTRUCTION_SITES, {
        filter: filter
    });
}

/**
 * Строит на конкретном construction site. Если крип не в зоне — перемещается
 * через {@link moveCached}.
 *
 * @param creep Крип-строитель.
 * @param site  Целевой сайт. `null`/`undefined` возвращает `ERR_INVALID_TARGET`.
 * @param opts  Опции `MoveToOpts`, пробрасываемые в `moveCached`.
 * @returns `OK`, `ERR_INVALID_TARGET` или код перемещения.
 */
export function buildAt(
    creep: Creep,
    site: ConstructionSite | null | undefined,
    opts?: MoveToOpts
): ScreepsReturnCode {
    if (!site) {
        return ERR_INVALID_TARGET;
    }

    if (creep.build(site) === ERR_NOT_IN_RANGE) {
        return moveCached(creep, site, opts);
    }

    return OK;
}

/**
 * Возвращает ближайшую структуру, требующую ремонта: `hits < hitsMax * threshold`.
 * Стены и рампарты намеренно исключены — бот их сейчас не чинит.
 *
 * @param creep     Крип-ремонтник.
 * @param threshold Доля от `hitsMax` (диапазон `0..1`), ниже которой объект
 *                  считается повреждённым. По умолчанию — {@link REPAIR_THRESHOLD}.
 * @returns Подходящая `Structure` или `null`.
 */
export function findRepairTarget(creep: Creep, threshold: number = REPAIR_THRESHOLD): Structure | null {
    return creep.pos.findClosestByPath(FIND_STRUCTURES, {
        filter: (s) => {
            if (s.hitsMax <= 0) {
                return false;
            }

            if (
                s.structureType === STRUCTURE_WALL ||
                s.structureType === STRUCTURE_RAMPART
            ) {
                return false;
            }

            return s.hits < s.hitsMax * threshold;
        }
    });
}

/**
 * Чинит целевую структуру. Если крип не в зоне — перемещается через
 * {@link moveCached}.
 *
 * @param creep  Крип-ремонтник.
 * @param target Целевая `Structure`. `null`/`undefined` возвращает
 *               `ERR_INVALID_TARGET`.
 * @param opts   Опции `MoveToOpts`, пробрасываемые в `moveCached`.
 * @returns `OK`, `ERR_INVALID_TARGET` или код перемещения.
 */
export function repairAt(
    creep: Creep,
    target: Structure | null | undefined,
    opts?: MoveToOpts
): ScreepsReturnCode {
    if (!target) {
        return ERR_INVALID_TARGET;
    }

    if (creep.repair(target) === ERR_NOT_IN_RANGE) {
        return moveCached(creep, target, opts);
    }

    return OK;
}
