import {
    ROLE,
    HOME_PATH_TTL,
    REPAIR_THRESHOLD,
    BIRTH_BLOCKING_TYPES,
    WALL_TERRAIN,
    UPGRADE_RANGE,
    HARVEST_RATE_PER_WORK
} from './constants';
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
 * @remarks
 * Движок записывает цель в `creep.memory._move.dest` как `{ x, y, room }` —
 * поле называется `room`, а не `roomName`. Поэтому кэш проверяется по обоим
 * именам: иначе ветка кэша никогда не срабатывала, и бот всегда звал
 * `Creep.moveTo` заново, хотя путь уже был посчитан.
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
        (moveMemory.dest.roomName ?? moveMemory.dest.room) === pos.roomName &&
        Game.time - (moveMemory.time || 0) < (opts.reusePath ?? HOME_PATH_TTL)
    ) {
        const result = creep.moveByPath(moveMemory.path);

        if (result === OK || result === ERR_TIRED) {
            return result;
        }
    }

    if (opts.reusePath === undefined) {
        // Копия, а не мутация аргумента: иначе `reusePath` залипает в
        // вызывающем коде и «заражает» следующие вызовы с тем же объектом.
        opts = { ...opts, reusePath: HOME_PATH_TTL };
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
            // Тело харвестера подобрано под реальную геометрию комнаты:
            // 2 CARRY (рюкзак на 100 энергии — вдвое меньше походов) и
            // 2 MOVE (на болоте один MOVE даёт 0.4 клетки за тик, два — 0.8).
            //
            // Прежнее тело [WORK, CARRY, MOVE] было «бегуном»: рюкзак на 50 и
            // один MOVE. В комнате, где источник лежит в стенном кармане и
            // доставка энергии занимает ~10 клеток по болоту, крип проводил в
            // дороге две трети жизни, и источник давал ~1.4 энергии за тик
            // вместо расчётных 4.2.
            return [WORK, CARRY, CARRY, MOVE, MOVE];

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
 * @remarks
 * Если крип вне зоны действия, целью движения становится не сам источник, а
 * свободная клетка рядом с ним: на клетку источника крип встать не может
 * (источник — препятствие, а в «кармане» из стен он ещё и лежит на стене,
 * так что пути к нему не существует вовсе). Такой подход не даёт крипу
 * замереть на подходе к источнику — а замерший крип на клетке рождения
 * закрывает спавн.
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
        const tiles = findHarvestTiles(creep, source);
        const moveOpts = withCreepsIgnored(opts);

        for (const tile of tiles) {
            const result = moveCached(creep, tile, moveOpts);

            if (result === OK || result === ERR_TIRED) {
                // Запоминаем клетку: распределение клеток добычи должно быть
                // устойчивым, иначе харвестеры каждый тик меняются местами
                // и в итоге не копает никто (см. `findHarvestTiles`).
                creep.memory._harvestTile = { x: tile.x, y: tile.y };

                return result;
            }
        }

        // Ни одна соседняя клетка не подошла — пробуем цель напрямую.
        return moveCached(creep, source, moveOpts);
    }

    return OK;
}

/**
 * Дополняет опции перемещения правилом «крипов не считать препятствием».
 *
 * @remarks
 * По умолчанию поиск пути считает других крипов препятствиями, и в тесной
 * комнате (узкий проход к источнику, кольцо вокруг спавна) путь не
 * находится вовсе: крип стоит и не работает. Для экономики это хуже, чем
 * риск пройти рядом с другим крипом.
 *
 * @param opts Исходные опции.
 */
function withCreepsIgnored(opts?: MoveToOpts): MoveToOpts {
    const merged: MoveToOpts = { ...(opts ?? {}) };

    if (!merged.ignore) {
        merged.ignore = [FIND_CREEPS];
    }

    return merged;
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
        return moveCached(creep, target, withCreepsIgnored(opts));
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
 *
 * @remarks
 * Крипов в поиске пути игнорируем — по той же причине, что и при перемещении
 * (см. {@link withCreepsIgnored}): в тесной комнате один стоящий крип
 * перекрывает единственный проход, и цель перестаёт находиться вообще.
 *
 * Выбирается не «самое вместительное», а самое **быстрое**: хранилище, в
 * которое крип успеет принести больше энергии в тик. Для хранилища с
 * вместимостью `F` (не больше рюкзака) на расстоянии `D`:
 *
 * ```
 * время цикла = F / скорость добычи + 2D   (дорога туда-обратно)
 * скорость    = F / (F / скорость добычи + 2D)
 * ```
 *
 * «Влезает весь рюкзак» — самоцель не в том, что большое хранилище
 * экономит одну дорогу: в E34S53 спавн вмещает 100 энергии, но стоит в
 * «кармане», из которого к источнику возвращаются только через клетку
 * добычи, — и харвестер, сдавший туда энергию, оказывался заперт в
 * кармане без работы. Соседнее с клеткой добычи расширение (вместимость 50)
 * даёт не меньшую скорость и крипа не запирает.
 */
export function findEnergyTransferTarget(
    creep: Creep,
    types: StructureConstant[] = [STRUCTURE_SPAWN, STRUCTURE_EXTENSION]
): Structure | null {
    const room = creep.room;

    const candidates = room.find(FIND_STRUCTURES, {
        filter: (s): s is AnyStoreStructure =>
            (types as StructureConstant[]).indexOf(s.structureType) !== -1 &&
            'store' in s &&
            (s as AnyStoreStructure).store.getFreeCapacity(RESOURCE_ENERGY) > 0
    }) as AnyStoreStructure[];

    if (candidates.length === 0) {
        return null;
    }

    const load = Math.max(1, creep.store[RESOURCE_ENERGY]);
    let work = 0;

    for (const part of creep.body) {
        if (part.type === WORK) {
            work++;
        }
    }

    const harvestRate = Math.max(1, work * HARVEST_RATE_PER_WORK);

    let best: AnyStoreStructure | null = null;
    let bestRate = 0;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const candidate of candidates) {
        const capacity = Math.min(candidate.store.getFreeCapacity(RESOURCE_ENERGY), load);
        const distance = Math.max(
            Math.abs(candidate.pos.x - creep.pos.x),
            Math.abs(candidate.pos.y - creep.pos.y)
        );

        const rate = capacity / (capacity / harvestRate + 2 * distance);

        if (rate > bestRate || (rate === bestRate && distance < bestDistance)) {
            best = candidate;
            bestRate = rate;
            bestDistance = distance;
        }
    }

    return best;
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
 * Ищет construction site, который выгоднее построить в первую очередь:
 * расширение рядом с клеткой добычи.
 *
 * @remarks
 * Такое расширение сокращает доставку энергии с десяти клеток до одной и
 * потому поднимает доход комнаты сильнее любого другого расширения. Поэтому
 * билдер строит их раньше остальных площадок — тем более что в комнате с
 * источником в стенном кармане запас расширений по лимиту RCL расходуется
 * именно на неудобные места, и добраться до удобных потом уже нельзя.
 *
 * Из нескольких подходящих площадок выбирается та, что ближе к завершению
 * (в ней уже вложено больше энергии) и после этого — ближе к крипу.
 *
 * @param creep  Крип-билдер.
 * @param filter Фильтр площадок (как в {@link findConstructionSite}).
 * @returns Площадка или `null`, если подходящих нет.
 */
export function findDeliverySite(
    creep: Creep,
    filter: (s: ConstructionSite) => boolean = (s) => s.progress < s.progressTotal
): ConstructionSite | null {
    const room = creep.room;
    const delivery = collectDeliveryTileKeys(room);

    if (delivery.size === 0) {
        return null;
    }

    const useful = room
        .find(FIND_MY_CONSTRUCTION_SITES, { filter: filter })
        .filter((s) => delivery.has(`${s.pos.x},${s.pos.y}`));

    if (useful.length === 0) {
        return null;
    }

    const byDistance = (a: ConstructionSite, b: ConstructionSite): number => {
        if (a.progress !== b.progress) {
            return b.progress - a.progress;
        }

        const da = Math.max(Math.abs(a.pos.x - creep.pos.x), Math.abs(a.pos.y - creep.pos.y));
        const db = Math.max(Math.abs(b.pos.x - creep.pos.x), Math.abs(b.pos.y - creep.pos.y));

        if (da !== db) {
            return da - db;
        }

        return a.pos.x + a.pos.y - (b.pos.x + b.pos.y);
    };

    return [...useful].sort(byDistance)[0] ?? null;
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

/**
 * Собирает множество клеток комнаты, занятых объектами, которые не дают
 * движку поставить рядом со спавном нового крипа.
 *
 * @remarks
 * Список препятствий повторяет `OBSTACLE_OBJECT_TYPES` движка
 * (`screeps/engine`, `src/processor/intents/spawns/_born-creep.js`):
 * structures и construction sites из {@link BIRTH_BLOCKING_TYPES}, а также
 * source/mineral/deposit.
 *
 * Крипы учитываются только при `includeCreeps === true`. Движок считает
 * крипа препятствием (`OBSTACLE_OBJECT_TYPES` включает `creep`), поэтому
 * стоящий крип закрывает клетку рождения ровно так же, как расширение.
 * Раньше бот крипов игнорировал — и из-за этого не видел запечатанный
 * спавн: кольцо вокруг спавна было занято пятью расширениями, одно из них
 * бот снёс, и на освободившуюся клетку родился крип, который там и замер.
 * Спавн перестал работать, а бот считал, что всё в порядке.
 *
 * @param room          Комната.
 * @param includeCreeps Учитывать ли крипов как препятствия.
 */
function collectBirthBlockingTiles(room: Room, includeCreeps: boolean): Set<string> {
    const blocked = new Set<string>();

    for (const s of room.find(FIND_STRUCTURES)) {
        if (BIRTH_BLOCKING_TYPES.indexOf(s.structureType) !== -1) {
            blocked.add(`${s.pos.x},${s.pos.y}`);
        }
    }

    for (const c of room.find(FIND_CONSTRUCTION_SITES)) {
        if (BIRTH_BLOCKING_TYPES.indexOf(c.structureType) !== -1) {
            blocked.add(`${c.pos.x},${c.pos.y}`);
        }
    }

    for (const src of room.find(FIND_SOURCES)) {
        blocked.add(`${src.pos.x},${src.pos.y}`);
    }

    for (const m of room.find(FIND_MINERALS)) {
        blocked.add(`${m.pos.x},${m.pos.y}`);
    }

    for (const d of room.find(FIND_DEPOSITS)) {
        blocked.add(`${d.pos.x},${d.pos.y}`);
    }

    if (includeCreeps) {
        for (const c of room.find(FIND_CREEPS)) {
            blocked.add(`${c.pos.x},${c.pos.y}`);
        }
    }

    return blocked;
}

/**
 * Проверяет, есть ли на клетке дорога.
 *
 * @remarks
 * Дорога — единственное исключение из правила «стена рельефа блокирует
 * появление крипа»: `_born-creep.js` пропускает стену, если на клетке есть
 * дорога.
 */
function hasRoadAt(room: Room, x: number, y: number): boolean {
    return room.find(FIND_STRUCTURES, {
        filter: (s) =>
            s.structureType === STRUCTURE_ROAD && s.pos.x === x && s.pos.y === y
    }).length > 0;
}

/**
 * Считает свободные клетки в окрестности спавна, в которые движок может
 * поместить нового крипа.
 *
 * @remarks
 * Движок создаёт крипа на одной из восьми соседних клеток спавна. Если
 * свободных клеток нет, движок бесконечно откладывает появление крипа, и
 * спавн остаётся занятым навсегда — колония не может завести ни одного
 * крипа. Поэтому количество свободных клеток — это не «эстетика», а
 * условие жизни колонии.
 *
 * По умолчанию крипы считаются препятствиями: движок не поставит крипа на
 * клетку, занятую другим крипом. `includeCreeps = false` даёт «структурное»
 * число свободных клеток — без учёта подвижных крипов.
 *
 * @param spawn         Спавн, окрестность которого проверяется.
 * @param includeCreeps Учитывать ли крипов, занявших клетки.
 * @returns Количество клеток, пригодных для появления крипа (0..8).
 */
export function countFreeBirthTiles(
    room: Room,
    spawn: StructureSpawn,
    includeCreeps = true
): number {
    const blocked = collectBirthBlockingTiles(room, includeCreeps);
    const terrain = room.getTerrain();
    let free = 0;

    for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
            if (dx === 0 && dy === 0) {
                continue;
            }

            const x = spawn.pos.x + dx;
            const y = spawn.pos.y + dy;

            if (x < 1 || x > 48 || y < 1 || y > 48) {
                continue;
            }

            if (blocked.has(`${x},${y}`)) {
                continue;
            }

            if (terrain.get(x, y) === WALL_TERRAIN && !hasRoadAt(room, x, y)) {
                continue;
            }

            free++;
        }
    }

    return free;
}

/**
 * Снимок состояния кольца клеток рождения вокруг спавна.
 */
export interface SpawnRingInfo {
    /** Все восемь клеток рождения (те, что не отсеяны стенами рельефа). */
    birthTiles: { x: number; y: number }[];
    /** Клетки, в которые движок может поставить крипа прямо сейчас. */
    freeTiles: { x: number; y: number }[];
    /** Сколько клеток свободно, если не учитывать крипов. */
    freeTilesWithoutCreeps: number;
    /** Наши крипы, стоящие на клетках рождения. */
    creepsOnBirthTiles: Creep[];
    /** Расширения в кольце радиуса 1 вокруг спавна. */
    adjacentExtensions: StructureExtension[];
}

/**
 * Собирает состояние кольца клеток рождения вокруг спавна.
 *
 * @remarks
 * Кольцо — это восемь соседних клеток: движок ставит там новорождённого
 * крипа. Каждая клетка может быть занята структурой, construction site,
 * источником, стеной рельефа или крипом — и тогда она не годится.
 *
 * Функция отдаёт обе точки зрения: с учётом крипов (как считает движок) и
 * без них (структурная). Разница между ними показывает, кто именно мешает:
 * если структурно клетки есть, а с крипами нет — мешают наши собственные
 * крипы, и лечить надо их, а не ломать постройки.
 *
 * @param room  Комната.
 * @param spawn Спавн.
 */
export function inspectSpawnRing(room: Room, spawn: StructureSpawn): SpawnRingInfo {
    const blockedWithCreeps = collectBirthBlockingTiles(room, true);
    const blockedWithoutCreeps = collectBirthBlockingTiles(room, false);
    const terrain = room.getTerrain();

    const freeTiles: { x: number; y: number }[] = [];
    const birthTileList: { x: number; y: number }[] = [];
    const birthTiles = new Set<string>();
    let freeTilesWithoutCreeps = 0;

    for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
            if (dx === 0 && dy === 0) {
                continue;
            }

            const x = spawn.pos.x + dx;
            const y = spawn.pos.y + dy;

            if (x < 1 || x > 48 || y < 1 || y > 48) {
                continue;
            }

            if (terrain.get(x, y) === WALL_TERRAIN && !hasRoadAt(room, x, y)) {
                continue;
            }

            birthTiles.add(`${x},${y}`);
            birthTileList.push({ x, y });

            if (!blockedWithoutCreeps.has(`${x},${y}`)) {
                freeTilesWithoutCreeps++;
            }

            if (!blockedWithCreeps.has(`${x},${y}`)) {
                freeTiles.push({ x, y });
            }
        }
    }

    const creepsOnBirthTiles = room.find(FIND_MY_CREEPS, {
        filter: (c) => birthTiles.has(`${c.pos.x},${c.pos.y}`)
    });

    const adjacentExtensions: StructureExtension[] = [];

    for (const s of room.find(FIND_MY_STRUCTURES)) {
        if (s.structureType !== STRUCTURE_EXTENSION) {
            continue;
        }

        if (
            Math.max(
                Math.abs(s.pos.x - spawn.pos.x),
                Math.abs(s.pos.y - spawn.pos.y)
            ) !== 1
        ) {
            continue;
        }

        adjacentExtensions.push(s);
    }

    return {
        birthTiles: birthTileList,
        freeTiles,
        freeTilesWithoutCreeps,
        creepsOnBirthTiles,
        adjacentExtensions
    };
}

/**
 * Ищет ближайшую к точке свободную клетку, куда можно встать.
 *
 * @remarks
 * Клетка считается пригодной, если это не стена рельефа, на ней нет
 * препятствующей структуры и нет другого крипа. Клетки из `exclude`
 * (например, клетки рождения рядом со спавном) пропускаются.
 *
 * @param room    Комната.
 * @param pos     Точка, от которой ищем.
 * @param exclude Клетки, которые нельзя занимать (в формате `x,y`).
 * @param radius  Максимальный радиус поиска.
 */
export function findFreeTileNear(
    room: Room,
    pos: RoomPosition,
    exclude: Set<string>,
    radius = 3
): RoomPosition | null {
    const terrain = room.getTerrain();

    const occupied = new Set<string>();

    for (const s of room.find(FIND_STRUCTURES)) {
        if (BIRTH_BLOCKING_TYPES.indexOf(s.structureType) !== -1) {
            occupied.add(`${s.pos.x},${s.pos.y}`);
        }
    }

    // Стройплощадка — тоже препятствие: на её клетке крип стоять не может.
    for (const c of room.find(FIND_CONSTRUCTION_SITES)) {
        occupied.add(`${c.pos.x},${c.pos.y}`);
    }

    for (const c of room.find(FIND_CREEPS)) {
        occupied.add(`${c.pos.x},${c.pos.y}`);
    }

    let best: RoomPosition | null = null;
    let bestDist = Number.POSITIVE_INFINITY;

    for (let dx = -radius; dx <= radius; dx++) {
        for (let dy = -radius; dy <= radius; dy++) {
            if (dx === 0 && dy === 0) {
                continue;
            }

            const x = pos.x + dx;
            const y = pos.y + dy;

            if (x < 1 || x > 48 || y < 1 || y > 48) {
                continue;
            }

            if (terrain.get(x, y) === WALL_TERRAIN) {
                continue;
            }

            if (occupied.has(`${x},${y}`) || exclude.has(`${x},${y}`)) {
                continue;
            }

            const dist = Math.max(Math.abs(dx), Math.abs(dy));

            if (dist < bestDist) {
                bestDist = dist;
                best = new RoomPosition(x, y, room.name);
            }
        }
    }

    return best;
}

/**
 * Проверяет, что клетка входит в кольцо рождения (радиус 1) вокруг одного из
 * наших спавнов.
 *
 * @remarks
 * Расширение (или его construction site) на такой клетке занимает клетку
 * рождения и приближает спавн к тому состоянию, из которого он не
 * выходит: все восемь клеток заняты, движок не может поставить крипа.
 * Поэтому такие расширения бот не строит, а уже построенные — сносит.
 *
 * @param room Комната.
 * @param x    X клетки.
 * @param y    Y клетки.
 */
export function blocksBirthRing(room: Room, x: number, y: number): boolean {
    for (const spawn of room.find(FIND_MY_SPAWNS)) {
        if (
            Math.max(Math.abs(x - spawn.pos.x), Math.abs(y - spawn.pos.y)) === 1
        ) {
            return true;
        }
    }

    return false;
}

/**
 * Считает клетки добычи вокруг цели: те, с которых крип может добывать
 * (радиус действия добычи — 1 клетка) и на которых может стоять.
 *
 * @remarks
 * Клетки добычи — это ограниченный ресурс: в комнате, где источник лежит на
 * стене рельефа, проходимых соседей у него всего три. Поэтому список
 * считается один раз на комнату и используется и для выбора клетки добычи,
 * и для оценки «насыщенности» источника (см. {@link isSourceSaturated}).
 *
 * Крипы в расчёт не входят: занятая крипом клетка добычи не перестаёт быть
 * клеткой добычи — она просто ждёт очереди (см. {@link findHarvestTiles}).
 *
 * @param room   Комната с целью.
 * @param target Цель добычи (`Source`, `Mineral`, `Deposit`).
 * @returns Список пригодных клеток добычи.
 */
export function collectHarvestSlots(
    room: Room,
    target: Source | Mineral | Deposit
): RoomPosition[] {
    const terrain = room.getTerrain();
    const blocked = new Set<string>();

    for (const s of room.find(FIND_STRUCTURES)) {
        // Дорогу крип может занимать, любую другую структуру — нет.
        if (s.structureType === STRUCTURE_ROAD) {
            continue;
        }

        blocked.add(`${s.pos.x},${s.pos.y}`);
    }

    for (const c of room.find(FIND_CONSTRUCTION_SITES)) {
        blocked.add(`${c.pos.x},${c.pos.y}`);
    }

    const slots: RoomPosition[] = [];

    for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
            if (dx === 0 && dy === 0) {
                continue;
            }

            const x = target.pos.x + dx;
            const y = target.pos.y + dy;

            if (x < 1 || x > 48 || y < 1 || y > 48) {
                continue;
            }

            if (terrain.get(x, y) === WALL_TERRAIN) {
                continue;
            }

            if (blocked.has(`${x},${y}`)) {
                continue;
            }

            slots.push(new RoomPosition(x, y, room.name));
        }
    }

    return slots;
}

/**
 * Ищет клетки рядом с целью, на которые крип может встать и всё равно
 * достать до цели (радиус действия добычи — 1 клетка).
 *
 * @remarks
 * Нужно потому, что на клетку самого источника крип встать не может:
 * источник — препятствие для движения (`OBSTACLE_OBJECT_TYPES`), и если он
 * ещё и лежит на стене рельефа, путь к нему в принципе не существует.
 * Классический случай: источник в «кармане» из стен, где к нему ведёт
 * единственный проход, а крип намертво застревает на своём подходе, потому
 * что `moveTo(source)` не находит пути.
 *
 * Занятые клетки не отбрасываются, а уходят в конец списка: если все клетки
 * добычи заняты, крип должен стоять и ждать освобождения, а не бродить по
 * комнате в поисках цели, которой для него всё равно не существует. Именно
 * это и убивало колонию в E34S53: три апгрейдера держали все три клетки
 * добычи, харвестеры не получали цели вовсе и копили энергию по нулям.
 *
 * Своя клетка (запомненная в `creep.memory._harvestTile`) всегда идёт
 * первой. Распределение клеток должно быть устойчивым: если каждый тик
 * брать «ближайшую клетку», харвестеры меняются местами (ближайшая клетка
 * меняется по мере движения крипа), толкают друг друга с источника, и в
 * итоге никто не копает. В E34S53 третий харвестер так и ходил между
 * двумя клетками в кармане у источника, а доход комнаты был втрое ниже
 * возможного.
 *
 * @param creep  Крип, которому нужен подход.
 * @param target Цель добычи (`Source`, `Mineral`, `Deposit`).
 * @returns Подходящие клетки: сначала своя, затем свободные, затем занятые;
 *          ближайшая к крипу — первой.
 */
export function findHarvestTiles(
    creep: Creep,
    target: Source | Mineral | Deposit
): RoomPosition[] {
    const room = creep.room;
    const slots = collectHarvestSlots(room, target);

    const occupied = new Set<string>();

    for (const c of room.find(FIND_CREEPS)) {
        if (c.name === creep.name) {
            continue;
        }

        occupied.add(`${c.pos.x},${c.pos.y}`);
    }

    const cached = creep.memory._harvestTile;
    const free: RoomPosition[] = [];
    const taken: RoomPosition[] = [];
    const mine: RoomPosition[] = [];

    for (const slot of slots) {
        const key = `${slot.x},${slot.y}`;
        const isMine =
            cached !== undefined && cached.x === slot.x && cached.y === slot.y;

        if (isMine && !occupied.has(key)) {
            mine.push(slot);
            continue;
        }

        if (occupied.has(key)) {
            taken.push(slot);
        } else {
            free.push(slot);
        }
    }

    const byDistance = (a: RoomPosition, b: RoomPosition): number => {
        const da = Math.max(Math.abs(a.x - creep.pos.x), Math.abs(a.y - creep.pos.y));
        const db = Math.max(Math.abs(b.x - creep.pos.x), Math.abs(b.y - creep.pos.y));

        if (da !== db) {
            return da - db;
        }

        return a.x + a.y - (b.x + b.y);
    };

    free.sort(byDistance);
    taken.sort(byDistance);

    return mine.concat(free, taken);
}

/**
 * Ищет ближайшую структуру, из которой можно забрать энергию: спавн или
 * расширение с ненулевым запасом.
 *
 * @remarks
 * Это «донор» для ролей, которые не могут добывать сами (см.
 * {@link withdrawEnergy}): когда источник насыщен и все клетки добычи
 * заняты, энергию для апгрейда/стройки/ремонта приходится брать из
 * структуры, куда её сливают харвестеры.
 *
 * Донором выбирается хранилище, ближайшее **к клеткам добычи**, а не
 * ближайшее к крипу. Разница принципиальная: харвестер сдаёт энергию в
 * ближайшее к нему хранилище, где есть место, — то есть в то, что стоит
 * у источника. Если рабочий крип брал энергию из «ближайшего к нему»
 * хранилища, возникал замкнутый круг: харвестеры сдавали энергию в дальний
 * конец комнаты (ближние хранилища были полны), рабочий крип опустошал
 * дальний конец (он был к нему ближе), и ближние хранилища не пустели
 * никогда. Рейс харвестера так и оставался длинным, а доход комнаты — в
 *трое ниже расчётного.
 *
 * @param creep Крип, относительно которого ищется донор.
 * @returns Структура с энергией или `null`.
 */
export function findEnergyDonor(creep: Creep): AnyStoreStructure | null {
    const room = creep.room;

    const candidates = room.find(FIND_MY_STRUCTURES, {
        filter: (s) =>
            (s.structureType === STRUCTURE_SPAWN ||
                s.structureType === STRUCTURE_EXTENSION) &&
            'store' in s &&
            (s as AnyStoreStructure).store.energy > 0
    }) as AnyStoreStructure[];

    if (candidates.length === 0) {
        return null;
    }

    const slots = collectHarvestSlotKeys(room);
    let pool = candidates;
    let best = Number.POSITIVE_INFINITY;

    for (const candidate of candidates) {
        const distance = distanceToHarvestSlots(candidate.pos, slots);

        if (distance < best) {
            best = distance;
            pool = [candidate];
        } else if (distance === best) {
            pool.push(candidate);
        }
    }

    const donor = creep.pos.findClosestByPath(pool, {
        ignore: [FIND_CREEPS]
    });

    if (!donor) {
        return null;
    }

    return donor as AnyStoreStructure;
}

/**
 * Считает расстояние от точки до ближайшей клетки добычи.
 *
 * @param pos   Точка.
 * @param slots Клетки добычи в формате `"x,y"`.
 * @returns Расстояние в клетках (0, если клеток добычи нет).
 */
function distanceToHarvestSlots(pos: RoomPosition, slots: Set<string>): number {
    if (slots.size === 0) {
        return 0;
    }

    let best = Number.POSITIVE_INFINITY;

    for (const key of slots) {
        const [x, y] = key.split(',').map(Number);

        if (x === undefined || y === undefined) {
            continue;
        }

        const distance = Math.max(Math.abs(pos.x - x), Math.abs(pos.y - y));

        if (distance < best) {
            best = distance;
        }
    }

    return best === Number.POSITIVE_INFINITY ? 0 : best;
}

/**
 * Забирает энергию из структуры-донора. Если крип не рядом — перемещается
 * к ней через {@link moveCached}.
 *
 * @remarks
 * Забирается весь свободный запас структуры: полный рюкзак — это ~25 тиков
 * работы, и сходить за энергией по частям рабочий крип не должен (каждый
 * поход — это потерянное время и CPU). Сколько рабочих крипов в комнате
 * нужно, решает бюджет (`computeWorkBudget`), а не размер рюкзака.
 *
 * @param creep  Крип, который берёт энергию.
 * @param donor  Спавн или расширение с энергией. `null`/`undefined`
 *               возвращает `ERR_INVALID_TARGET`.
 * @param opts   Опции `MoveToOpts`, пробрасываемые в `moveCached`.
 * @returns `OK`, `ERR_INVALID_TARGET` или код перемещения/ошибки движка.
 */
export function withdrawEnergy(
    creep: Creep,
    donor: AnyStoreStructure | null | undefined,
    opts?: MoveToOpts
): ScreepsReturnCode {
    if (!donor) {
        return ERR_INVALID_TARGET;
    }

    const amount = Math.min(
        creep.store.getFreeCapacity(RESOURCE_ENERGY),
        donor.store.energy
    );

    if (amount <= 0) {
        return ERR_NOT_ENOUGH_RESOURCES;
    }

    const result = creep.withdraw(donor, RESOURCE_ENERGY, amount);

    if (result === ERR_NOT_IN_RANGE) {
        return moveCached(creep, donor, withCreepsIgnored(opts));
    }

    return result;
}

/**
 * Возвращает множество клеток добычи комнаты в виде ключей `"x,y"`.
 *
 * @remarks
 * Клетки добычи — конечный ресурс: в комнате, где источник лежит на стене
 * рельефа, их всего три. Крип, вставший на такую клетку, отнимает её у
 * харвестеров, а это — треть дохода комнаты. Поэтому рабочие крипы
 * (билдер, апгрейдер) не должны на них стоять.
 *
 * @param room Комната.
 * @returns Множество занятых клеток добычи.
 */
export function collectHarvestSlotKeys(room: Room): Set<string> {
    const keys = new Set<string>();

    for (const source of room.find(FIND_SOURCES)) {
        for (const slot of collectHarvestSlots(room, source)) {
            keys.add(`${slot.x},${slot.y}`);
        }
    }

    return keys;
}

/**
 * Возвращает множество клеток, с которых харвестер может сдать энергию
 * без ходьбы: клетки, соседние с клетками добычи.
 *
 * @remarks
 * Это главный показатель «дальности доставки» комнаты. Харвестер стоит на
 * клетке добычи и сдаёт энергию в структуру на расстоянии 1 (радиус
 * `transfer`). Если ни одной такой структуры нет, энергию некуда сдать, и
 * харвестер вынужден идти к хранилищу через всю комнату.
 *
 * В E34S53 источник лежит в стенном кармане, а все хранилища — по ту
 * сторону стены: путь от клетки добычи до ближайшего расширения занимает
 * 8–10 клеток, и харвестер тратит на дорогу столько же времени, сколько на
 * добычу. Расширение, поставленное рядом с клеткой добычи, превращает
 * десять клеток пути в одну.
 *
 * Множество содержит и сами клетки добычи? Нет: клетка добычи должна
 * оставаться свободной для харвестера, и на ней нельзя ставить расширение
 * (см. {@link collectHarvestSlots}).
 *
 * @param room Комната.
 * @returns Множество клеток доставки в виде ключей `"x,y"`.
 */
export function collectDeliveryTileKeys(room: Room): Set<string> {
    const slots = collectHarvestSlotKeys(room);
    const keys = new Set<string>();

    for (const slotKey of slots) {
        const [sx, sy] = slotKey.split(',').map(Number);

        if (sx === undefined || sy === undefined) {
            continue;
        }

        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                if (dx === 0 && dy === 0) {
                    continue;
                }

                const x = sx + dx;
                const y = sy + dy;

                if (x < 1 || x > 48 || y < 1 || y > 48) {
                    continue;
                }

                if (slots.has(`${x},${y}`)) {
                    continue;
                }

                keys.add(`${x},${y}`);
            }
        }
    }

    return keys;
}

/**
 * Проверяет, находится ли клетка рядом с клеткой добычи — то есть может ли
 * харвестер сдать в неё энергию, не сходя с клетки добычи.
 *
 * @param room Комната.
 * @param x    X клетки.
 * @param y    Y клетки.
 * @returns `true`, если клетка соседствует с клеткой добычи.
 */
export function isDeliveryTile(room: Room, x: number, y: number): boolean {
    return collectDeliveryTileKeys(room).has(`${x},${y}`);
}

/**
 * Определяет, нужно ли комнате «чинить доставку».
 *
 * @remarks
 * Возвращает `true`, когда в комнате есть площадка расширения рядом с
 * клеткой добычи, но рядом с клеткой добычи ещё нет ни одного хранилища.
 *
 * Такая комната ограничена дальностью доставки: харвестер несёт энергию
 * через всю комнату, и на дорогу уходит столько же времени, сколько на
 * добычу. Пока это так, доход комнаты не растёт, а значит, не растёт и
 * бюджет: не хватает энергии ни на апгрейд, ни на замену умирающих крипов.
 * Единственный способ разоржать этот круг — достроить расширение рядом с
 * клеткой добычи, а для этого нужен билдер.
 *
 * @param room Комната.
 * @returns `true`, если доставку в комнате надо чинить.
 */
export function hasDeliverySite(room: Room): boolean {
    const delivery = collectDeliveryTileKeys(room);

    if (delivery.size === 0) {
        return false;
    }

    for (const site of room.find(FIND_MY_CONSTRUCTION_SITES, {
        filter: (s) =>
            s.structureType === STRUCTURE_EXTENSION && s.progress < s.progressTotal
    })) {
        if (delivery.has(`${site.pos.x},${site.pos.y}`)) {
            return true;
        }
    }

    return false;
}

/**
 * Измеряет расстояние доставки комнаты: сколько клеток пути в среднем
 * проходит харвестер от клетки добычи до ближайшего хранилища.
 *
 * @remarks
 * Это и есть та величина, которая ограничивает доход: харвестер уходит
 * с клетки добычи, несёт энергию и возвращается. Дорога занимает столько
 * же тиков, сколько добыча, и тем хуже, чем длиннее путь.
 *
 * Расстояние меряется по ПУТИ, а не по прямой: в E34S53 источник лежит в
 * стенном кармане, и по прямой до хранилища три клетки, а по пути — десять,
 * потому что стена отрезает карман от остальной комнаты.
 *
 * Усреднение по всем клеткам добычи, а не минимум: клетки добычи в комнате
 * бывают очень разными по расстоянию до хранилища, и харвестеры занимают
 * их все. В E34S53 от клетки (20,24) до спавна два шага, а от (20,22) —
 * десять; среднее — около семи.
 *
 * @param room Комната.
 * @returns Средняя длина пути в клетках; `0`, если доставлять некуда.
 */
export function measureDeliveryDistance(room: Room): number {
    try {
        return measureDeliveryDistanceUnsafe(room);
    } catch {
        // Замер не удался — считаем, что доставка короткая, и не ломаем из-за
        // этого решение по составу крипов.
        return 0;
    }
}

/**
 * Измеряет расстояние доставки комнаты без защиты от ошибок: сама логика
 * замера (см. {@link measureDeliveryDistance}).
 *
 * @param room Комната.
 * @returns Средняя длина пути в клетках.
 */
function measureDeliveryDistanceUnsafe(room: Room): number {
    const slots = collectHarvestSlotKeys(room);

    if (slots.size === 0) {
        return 0;
    }

    const storages = room.find(FIND_MY_STRUCTURES, {
        filter: (s) =>
            s.structureType === STRUCTURE_SPAWN || s.structureType === STRUCTURE_EXTENSION
    });

    if (storages.length === 0) {
        return 0;
    }

    // Считаем расстояние до того хранилища, куда харвестер реально может
    // сдать энергию, — до ближайшего с местом. Если свободного места нет
    // нигде, берём ближайшее хранилище вообще.
    //
    // Разница существенная: в E34S53 спавн и расширения у источника забиты
    // под завязку, и единственное свободное место — у расширений на другом
    // конце коридора. Харвестер идёт туда за восемь-девять клеток, чтобы
    // сдать пятьдесят энергии, и вот это и ограничивает доход комнаты.
    const withRoom = storages.filter(
        (s) => s.store.getFreeCapacity(RESOURCE_ENERGY) > 0
    );
    const pool = withRoom.length > 0 ? withRoom : storages;

    const goals = pool.map((s) => ({ pos: s.pos, range: 1 }));
    let total = 0;
    let counted = 0;

    for (const slotKey of slots) {
        const [x, y] = slotKey.split(',').map(Number);

        if (x === undefined || y === undefined) {
            continue;
        }

        try {
            const path = PathFinder.search(new RoomPosition(x, y, room.name), goals);

            if (path) {
                total += path.path.length;
                counted++;
            }
        } catch {
            return 0;
        }
    }

    if (counted === 0) {
        return 0;
    }

    return Math.round((total / counted) * 10) / 10;
}

/**
 * Ищет клетку, с которой можно строить construction site.
 *
 * @remarks
 * Строить можно только с соседней клетки (радиус действия — 1), и выбор
 * клетки не случаен: билдер, вставший на клетку добычи, отнимает её у
 * харвестеров, а вставший на клетку рождения — закрывает спавн. Поэтому
 * предпочтение отдаётся свободной клетке, которая не является ни клеткой
 * добычи, ни клеткой рождения.
 *
 * @param creep Крип-билдер.
 * @param site  Стройплощадка, которую нужно достроить.
 * @returns Подходящая клетка или `null`, если такой нет.
 */
export function findBuildSpot(creep: Creep, site: ConstructionSite): RoomPosition | null {
    const room = creep.room;
    const terrain = room.getTerrain();
    const occupied = new Set<string>();

    for (const s of room.find(FIND_STRUCTURES)) {
        if (s.structureType === STRUCTURE_ROAD) {
            continue;
        }

        occupied.add(`${s.pos.x},${s.pos.y}`);
    }

    for (const c of room.find(FIND_CONSTRUCTION_SITES)) {
        occupied.add(`${c.pos.x},${c.pos.y}`);
    }

    for (const c of room.find(FIND_CREEPS)) {
        if (c.name === creep.name) {
            continue;
        }

        occupied.add(`${c.pos.x},${c.pos.y}`);
    }

    for (const key of collectHarvestSlotKeys(room)) {
        occupied.add(key);
    }

    const candidates: RoomPosition[] = [];

    for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
            if (dx === 0 && dy === 0) {
                continue;
            }

            const x = site.pos.x + dx;
            const y = site.pos.y + dy;

            if (x < 1 || x > 48 || y < 1 || y > 48) {
                continue;
            }

            if (terrain.get(x, y) === WALL_TERRAIN) {
                continue;
            }

            if (occupied.has(`${x},${y}`)) {
                continue;
            }

            if (blocksBirthRing(room, x, y)) {
                continue;
            }

            candidates.push(new RoomPosition(x, y, room.name));
        }
    }

    if (candidates.length === 0) {
        return null;
    }

    candidates.sort((a, b) => {
        const da = Math.max(Math.abs(a.x - creep.pos.x), Math.abs(a.y - creep.pos.y));
        const db = Math.max(Math.abs(b.x - creep.pos.x), Math.abs(b.y - creep.pos.y));

        if (da !== db) {
            return da - db;
        }

        return a.x + a.y - (b.x + b.y);
    });

    return candidates[0] ?? null;
}

/**
 * Ищет ближайшую к точке клетку из списка по длине пути.
 *
 * @remarks
 * Расстояние по прямой не годится: в комнатах со стенами рельефа две
 * клетки в метре друг от друга могут быть соединены пятнадцатикилометровым
 * обходом. Здесь длина пути считается движком (`PathFinder.search` с
 * несколькими целями) — движок возвращает путь к ближайшей достижимой цели.
 *
 * @param origin     Откуда считаем путь.
 * @param candidates Клетки-кандидаты.
 * @returns Ближайшая по пути клетка с длиной пути либо `null`, если путь не
 *          найден.
 */
function findClosestCandidateByPath(
    origin: RoomPosition,
    candidates: RoomPosition[]
): { pos: RoomPosition; length: number } | null {
    if (candidates.length === 0) {
        return null;
    }

    try {
        const goals = candidates.map((pos) => ({ pos: pos, range: 0 }));

        // `ignore` движок понимает, но в типах его нет — отсюда приведение.
        const path = PathFinder.search(origin, goals, {
            ignore: [FIND_CREEPS]
        } as unknown as PathFinderOpts);

        if (!path || !path.path || path.path.length === 0) {
            return null;
        }

        const end = path.path[path.path.length - 1];

        if (!end) {
            return null;
        }

        const pos = candidates.find((candidate) => candidate.x === end.x && candidate.y === end.y);

        if (!pos) {
            return null;
        }

        return { pos: pos, length: path.path.length };
    } catch {
        return null;
    }
}

/**
 * Ищет клетку, с которой можно апгрейдить контроллер, не занимая при этом
 * ни клетку добычи, ни клетку рождения.
 *
 * @remarks
 * Апгрейд контроллера работает с расстояния 3 (`upgradeController` проверяет
 * `inRangeTo(pos, 3)`), поэтому апгрейдеру не обязательно стоять вплотную к
 * контроллеру. Это важно в тесных комнатах: клетка вплотную к контроллеру
 * может быть единственной, и тогда несколько апгрейдеров забиваются на одну
 * точку.
 *
 * Клетки добычи исключены — они принадлежат харвестерам. Кольцо рождения
 * вокруг спавна тоже исключено: вставший на него крип закрывает спавн.
 *
 * Из оставшихся клеток предпочтение отдаётся тем, что соседствуют с
 * донором (спавном или расширением с энергией): апгрейдер работает циклами
 * «набрал — потратил», и дорога к донору — потерянное время. В E34S53 клетка
 * (16,25) соседствует и с расширением (17,26), и с зоной апгрейда
 * контроллера (17,24) — апгрейдеру с неё не нужно никуда идти.
 *
 * @param room  Комната.
 * @param creep Крип, для которого ищется место (его собственная клетка не
 *              считается занятой).
 * @returns Клетка для апгрейда или `null`, если подходящих клеток нет.
 */
export function findUpgradeSpot(room: Room, creep: Creep): RoomPosition | null {
    const controller = room.controller;

    if (!controller) {
        return null;
    }

    const terrain = room.getTerrain();
    const blocked = new Set<string>();

    for (const s of room.find(FIND_STRUCTURES)) {
        if (s.structureType === STRUCTURE_ROAD) {
            continue;
        }

        blocked.add(`${s.pos.x},${s.pos.y}`);
    }

    for (const c of room.find(FIND_CONSTRUCTION_SITES)) {
        blocked.add(`${c.pos.x},${c.pos.y}`);
    }

    // Крипов в список занятых клеток не добавляем: они подвижны, и клетка,
    // которую крип занимает сейчас, через десять тиков будет свободна. Если
    // учитывать их, выбор клетки апгрейда зависел бы от того, где в этот
    // момент оказался харвестер: в E34S53 харвестер проходил через
    // (20,21) — единственную клетку рядом с клетками добычи, — и апгрейдер
    // из-за этого уходил в дальний конец комнаты, а харвестеры ходили за
    // энергией через полкомнаты. Занятость клетки живым крипом проверит
    // `ensureUpgradeSpot` отдельно.

    for (const source of room.find(FIND_SOURCES)) {
        for (const slot of collectHarvestSlots(room, source)) {
            blocked.add(`${slot.x},${slot.y}`);
        }
    }

    const candidates: RoomPosition[] = [];

    for (let dx = -UPGRADE_RANGE; dx <= UPGRADE_RANGE; dx++) {
        for (let dy = -UPGRADE_RANGE; dy <= UPGRADE_RANGE; dy++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) > UPGRADE_RANGE) {
                continue;
            }

            const x = controller.pos.x + dx;
            const y = controller.pos.y + dy;

            if (x < 1 || x > 48 || y < 1 || y > 48) {
                continue;
            }

            if (terrain.get(x, y) === WALL_TERRAIN) {
                continue;
            }

            if (blocked.has(`${x},${y}`)) {
                continue;
            }

            if (blocksBirthRing(room, x, y)) {
                continue;
            }

            candidates.push(new RoomPosition(x, y, room.name));
        }
    }

    // Клетку выбираем по длине пути до клеток добычи: именно туда
    // харвестеры приносят энергию, и оттуда она уходит к апгрейдеру. Чем
    // ближе апгрейдер к добыче, тем короче рейс харвестера и тем выше
    // доход комнаты.
    //
    // Расстояние «по прямой» здесь обманывает: в E34S53 клетка (16,25) в
    // трёх шагах от крипа, но в пятнадцати по пути — между ними стена
    // рельефа. Прежний выбор (клетка рядом с любым донором) тянул
    // апгрейдера в дальний угол комнаты, к расширению (17,26): контроллер
    // получал понемногу прогресса, а харвестеры ходили за энергией через
    // всю комнату, и доход падал втрое.
    const slots = collectHarvestSlotKeys(room);
    let best: { pos: RoomPosition; length: number } | null = null;

    for (const key of slots) {
        const [x, y] = key.split(',').map(Number);

        if (x === undefined || y === undefined) {
            continue;
        }

        const found = findClosestCandidateByPath(
            new RoomPosition(x, y, room.name),
            candidates
        );

        if (found && (!best || found.length < best.length)) {
            best = found;
        }
    }

    if (best) {
        return best.pos;
    }

    // Источника нет или клетки добычи недостижимы — берём клетку рядом с
    // хранилищем, из которого апгрейдер берёт энергию.
    const donor = findEnergyDonor(creep);

    if (donor) {
        const byPath = findClosestCandidateByPath(donor.pos, candidates);

        if (byPath) {
            return byPath.pos;
        }
    }

    // Запасной вариант: если путь посчитать не удалось, берём клетку рядом с
    // донором, а затем — ближайшую к крипу.
    //
    // Клетки, с которых можно без ходьбы взять энергию: апгрейдер работает
    // циклами «набрал — потратил», и каждая дорога к донору — это потерянное
    // время. Кандидат рядом с донором лучше кандидата, который ближе к
    // текущей позиции крипа, но на 3 клетки дальше от хранилища.
    const donorAdjacent = new Set<string>();

    for (const s of room.find(FIND_MY_STRUCTURES)) {
        if (
            (s.structureType !== STRUCTURE_SPAWN && s.structureType !== STRUCTURE_EXTENSION) ||
            !('store' in s) ||
            (s as AnyStoreStructure).store.energy <= 0
        ) {
            continue;
        }

        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                if (dx === 0 && dy === 0) {
                    continue;
                }

                donorAdjacent.add(`${s.pos.x + dx},${s.pos.y + dy}`);
            }
        }
    }

    candidates.sort((a, b) => {
        const na = donorAdjacent.has(`${a.x},${a.y}`) ? 1 : 0;
        const nb = donorAdjacent.has(`${b.x},${b.y}`) ? 1 : 0;

        if (na !== nb) {
            return nb - na;
        }

        const da = Math.max(Math.abs(a.x - creep.pos.x), Math.abs(a.y - creep.pos.y));
        const db = Math.max(Math.abs(b.x - creep.pos.x), Math.abs(b.y - creep.pos.y));

        if (da !== db) {
            return da - db;
        }

        return a.x + a.y - (b.x + b.y);
    });

    return candidates[0] ?? null;
}

/**
 * Сообщает, насыщен ли источник комнаты: хватает ли клеток добычи на всех
 * харвестеров.
 *
 * @remarks
 * Флаг ставится в `room.run` раз в `EXTENSION_CHECK_INTERVAL` тиков. Когда
 * источник насыщен, роли, которые тоже умеют добывать (апгрейдер, билдер,
 * ремонтник), берут энергию из спавна/расширений, а не вытесняют
 * харвестеров с клеток добычи. В обычных комнатах, где клеток добычи
 * хватает всем, поведение не меняется.
 *
 * @param room Комната.
 * @returns `true`, если источник насыщен.
 */
export function isSourceSaturated(room: Room): boolean {
    return room.memory._sourceSaturated === true;
}
