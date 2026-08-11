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

export const DOWNGRADE_BUFFER_TICKS = 2000;
export const REPAIR_THRESHOLD = 0.8;
export const EXITS_CACHE_TTL = 5000;
export const HOME_PATH_TTL = 25;
export const REMOTE_PATH_TTL = 50;
export const EXTENSION_PLAN_RADIUS = 6;
export const EXTENSION_CHECK_INTERVAL = 10;

export const WALL_TERRAIN: TERRAIN_MASK_WALL = (typeof TERRAIN_MASK_WALL !== 'undefined') ? TERRAIN_MASK_WALL : 1;
