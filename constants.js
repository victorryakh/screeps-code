const ROLE = {
    HARVESTER: 'harvester',
    UPGRADER: 'upgrader',
    BUILDER: 'builder',
    REPAIRER: 'repairer',
    RHARVESTER: 'rharvester',
    RESERVER: 'reserver',
    CLAIMER: 'claimer'
};

const TARGETS = {
    1: { upgrader: 2, harvester: 2, builder: 1, repairer: 0 },
    2: { upgrader: 2, harvester: 2, builder: 2, repairer: 0 },
    3: { upgrader: 3, harvester: 3, builder: 2, repairer: 1 },
    4: { upgrader: 3, harvester: 3, builder: 2, repairer: 1 },
    5: { upgrader: 4, harvester: 3, builder: 2, repairer: 1 }
};

const EXPANSION = {
    reserverBody: [CLAIM, CLAIM, MOVE, MOVE],
    claimerBody: [CLAIM, MOVE, MOVE, MOVE],
    rharvesterBody: [WORK, WORK, CARRY, MOVE, MOVE],
    reserverCount: 1,
    claimerCount: 1,
    rharvesterCount: 2,
    preferredTarget: 'E55N31',
    blacklist: ['E54N32', 'E54N30']
};

const REMOTE_ROLES = [
    ROLE.RHARVESTER,
    ROLE.RESERVER,
    ROLE.CLAIMER
];

const DOWNGRADE_BUFFER_TICKS = 2000;
const REPAIR_THRESHOLD = 0.8;
const EXITS_CACHE_TTL = 5000;
const HOME_PATH_TTL = 25;
const REMOTE_PATH_TTL = 50;
const EXTENSION_PLAN_RADIUS = 6;
const EXTENSION_CHECK_INTERVAL = 10;

const WALL_TERRAIN = (typeof TERRAIN_MASK_WALL !== 'undefined') ? TERRAIN_MASK_WALL : 1;

module.exports = {
    ROLE,
    TARGETS,
    EXPANSION,
    REMOTE_ROLES,
    DOWNGRADE_BUFFER_TICKS,
    REPAIR_THRESHOLD,
    EXITS_CACHE_TTL,
    HOME_PATH_TTL,
    REMOTE_PATH_TTL,
    EXTENSION_PLAN_RADIUS,
    EXTENSION_CHECK_INTERVAL,
    WALL_TERRAIN
};
