import { AccessLevel, Role, User, UserContract, AccessCertificate, PermissionObject } from './types';

/**
 * Maps database system roles to application roles
 */
export const mapRole = (r: string | null): Role => {
    const map: Record<string, Role> = {
        admin: 'admin',
        manager: 'manager',
        team_lead: 'teamlead',
        team_member: 'member',
    };
    return map[(r || '').toLowerCase()] || 'member';
};

// =============================================
// Access Level Hierarchies (ordered low → high)
// =============================================

/** Type X (Personal) levels, ordered by privilege */
const TYPE_X_LEVELS: AccessLevel[] = ['alpha', 'beta'];

/** Type Y (Managerial) levels, ordered by privilege */
const TYPE_Y_LEVELS: AccessLevel[] = ['gamma', 'delta', 'epsilon', 'zeta'];

/** All levels ordered by privilege (for backwards compat) */
const ALL_ACCESS_LEVELS: AccessLevel[] = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta'];

// =============================================
// Page Classification
// =============================================

/** Personal pages — accessible via Type X certificates */
export const PERSONAL_PAGES: Record<string, AccessLevel> = {
    'my_roster': 'alpha',
    'my_availabilities': 'alpha',
    'my_bids': 'alpha',
    'my_swaps': 'alpha',
    'my_broadcasts': 'alpha',
    'timesheets_view': 'beta', // Beta has read-only timesheets
};

/** Managerial pages — accessible via Type Y certificates */
export const MANAGERIAL_PAGES: Record<string, AccessLevel> = {
    'templates': 'gamma',
    'rosters': 'delta',
    'timesheets': 'gamma',
    'open_bids': 'gamma',
    'swap_requests': 'gamma',

    'broadcasts': 'gamma',
    'configs': 'delta',
    'users': 'epsilon',
    'insights': 'delta',
};

/**
 * Combined ACCESS_MATRIX for backward compatibility.
 * Maps feature → minimum access level required.
 */
export const ACCESS_MATRIX: Record<string, AccessLevel> = {
    ...PERSONAL_PAGES,
    ...MANAGERIAL_PAGES,
};

// =============================================
// Access Check Functions
// =============================================

/**
 * Checks if a level meets the minimum required level within a given hierarchy.
 */
const meetsLevel = (current: AccessLevel, required: AccessLevel, hierarchy: AccessLevel[]): boolean => {
    const currentIdx = hierarchy.indexOf(current);
    const requiredIdx = hierarchy.indexOf(required);
    if (currentIdx === -1 || requiredIdx === -1) return false;
    return currentIdx >= requiredIdx;
};

/**
 * Checks if the user has access to a personal page based on Type X certificates.
 * Access is granted if ANY active Type X certificate meets the minimum level.
 */
export const hasPersonalAccess = (
    certificates: AccessCertificate[],
    feature: string,
): boolean => {
    const requiredLevel = PERSONAL_PAGES[feature];
    if (!requiredLevel) return false;

    const activeTypeX = certificates.filter(c => c.certificateType === 'X' && c.isActive);
    return activeTypeX.some(c => meetsLevel(c.accessLevel, requiredLevel, TYPE_X_LEVELS));
};

/**
 * Checks if the user has access to a managerial page based on Type Y certificate.
 * Access is granted if the single active Type Y certificate meets the minimum level.
 */
export const hasManagerialAccess = (
    certificates: AccessCertificate[],
    feature: string,
): boolean => {
    const requiredLevel = MANAGERIAL_PAGES[feature];
    if (!requiredLevel) return false;

    const activeTypeY = certificates.find(c => c.certificateType === 'Y' && c.isActive);
    if (!activeTypeY) return false;

    return meetsLevel(activeTypeY.accessLevel, requiredLevel, TYPE_Y_LEVELS);
};

/**
 * Checks if a user has access to a specific feature.
 * Checks both personal (Type X) and managerial (Type Y) access.
 *
 * For backwards compatibility, also accepts activeContract/activeCertificate params.
 */
export const hasAccess = (
    user: User | null,
    feature: string,
    activeContract: UserContract | null = null,
    activeCertificate: AccessCertificate | null = null
): boolean => {
    if (!user) return false;

    const certificates = user.certificates || [];

    // Check if this is a personal page
    if (feature in PERSONAL_PAGES) {
        return hasPersonalAccess(certificates, feature);
    }

    // Check if this is a managerial page
    if (feature in MANAGERIAL_PAGES) {
        return hasManagerialAccess(certificates, feature);
    }

    // Fallback for unknown features: use combined hierarchy
    const requiredLevel = ACCESS_MATRIX[feature] || 'delta';

    // Check active certificate first
    if (activeCertificate) {
        return meetsLevel(activeCertificate.accessLevel, requiredLevel, ALL_ACCESS_LEVELS);
    }

    // Check any certificate
    return certificates.some(c =>
        c.isActive && meetsLevel(c.accessLevel, requiredLevel, ALL_ACCESS_LEVELS)
    );
};

/**
 * Returns whether the user is a personal-only user (no Type Y certificate).
 */
export const isPersonalOnly = (certificates: AccessCertificate[]): boolean => {
    return !certificates.some(c => c.certificateType === 'Y' && c.isActive);
};

/**
 * Returns the user's active Type Y certificate level, or null if none.
 */
export const getManagerialLevel = (certificates: AccessCertificate[]): AccessLevel | null => {
    const typeY = certificates.find(c => c.certificateType === 'Y' && c.isActive);
    return typeY?.accessLevel ?? null;
};
