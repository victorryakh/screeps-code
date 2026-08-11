export const ROLE = {
    HARVESTER: 'harvester',
    UPGRADER: 'upgrader',
    BUILDER: 'builder',
    REPAIRER: 'repairer',
    RHARVESTER: 'rharvester',
    RESERVER: 'reserver',
    CLAIMER: 'claimer'
} as const;

export type RoleKey = (typeof ROLE)[keyof typeof ROLE];

export interface RoomTargets {
    upgrader: number;
    harvester: number;
    builder: number;
    repairer: number;
}

export const TARGETS: Record<number, RoomTargets> = {
    1: { upgrader: 2, harvester: 2, builder: 1, repairer: 0 },
    2: { upgrader: 2, harvester: 2, builder: 2, repairer: 0 },
    3: { upgrader: 3, harvester: 3, builder: 2, repairer: 1 },
    4: { upgrader: 3, harvester: 3, builder: 2, repairer: 1 },
    5: { upgrader: 4, harvester: 3, builder: 2, repairer: 1 }
};

export const EXPANSION = {
    reserverBody: [CLAIM, CLAIM, MOVE, MOVE] as BodyPartConstant[],
    claimerBody: [CLAIM, MOVE, MOVE, MOVE] as BodyPartConstant[],
    rharvesterBody: [WORK, WORK, CARRY, MOVE, MOVE] as BodyPartConstant[],
    reserverCount: 1,
    claimerCount: 1,
    rharvesterCount: 2,
    preferredTarget: 'E55N31',
    blacklist: ['E54N32', 'E54N30']
};

export const REMOTE_ROLES: RoleKey[] = [
    ROLE.RHARVESTER,
    ROLE.RESERVER,
    ROLE.CLAIMER
];

export const DOWNGRADE_BUFFER_TICKS = 2000;
export const REPAIR_THRESHOLD = 0.8;
export const EXITS_CACHE_TTL = 5000;
export const HOME_PATH_TTL = 25;
export const REMOTE_PATH_TTL = 50;
export const EXTENSION_PLAN_RADIUS = 6;
export const EXTENSION_CHECK_INTERVAL = 10;

export const WALL_TERRAIN: TERRAIN_MASK_WALL = (typeof TERRAIN_MASK_WALL !== 'undefined') ? TERRAIN_MASK_WALL : 1;
