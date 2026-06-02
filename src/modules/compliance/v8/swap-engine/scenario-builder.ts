/**
 * Scenario Builder — Layer 1
 *
 * Builds a SwapScenario by applying the swap to each party's current roster.
 * Produces the hypothetical schedule each employee would have AFTER the swap.
 *
 * Layer 2 (V8SwapEngine) then evaluates this scenario against all
 * constraints simultaneously — no sequential rule checks needed.
 *
 * Supports:
 *   - Standard 2-way swap: build(partyA, partyB)
 *   - Chain swap A→B→C→...: buildChain([A, B, C, ...])   (Case #13)
 */

import type { SwapScenario, SwapPartyInput, RosterShift, SwapParty } from './types';

/**
 * Exclude a specific shift from a roster.
 * Matching by ID when available, falling back to date+time equality.
 */
function withoutShift(roster: RosterShift[], shift: RosterShift): RosterShift[] {
    return roster.filter(s => {
        if (shift.id && s.id) return s.id !== shift.id;
        return !(
            (s.shift_date ?? s.date) === (shift.shift_date ?? shift.date) &&
            s.start_time === shift.start_time &&
            s.end_time === shift.end_time
        );
    });
}

// =============================================================================
// CHAIN SWAP TYPES
// =============================================================================

/**
 * Result of a chain swap scenario evaluation.
 * Contains a SwapScenario (partyA + partyB) for each adjacent pair in the chain.
 *
 * Chain: A→B→C  produces:
 *   pairs[0] = SwapScenario(A gives shift_A to B, B gives shift_B to A)
 *   pairs[1] = SwapScenario(B gives shift_B to C, C gives shift_C to B)
 *
 * The V8SwapEngine evaluates each pair separately.
 * A chain is only feasible if ALL pairs are feasible.
 */
export interface ChainSwapScenario {
    /** Each adjacent pair in the chain. */
    pairs: SwapScenario[];
    /** All parties in order. */
    parties: SwapParty[];
}

// =============================================================================
// SCENARIO BUILDER
// =============================================================================

/**
 * ScenarioBuilder — constructs hypothetical SwapScenarios.
 *
 * Standard 2-way swap (A gives shift_A, B gives shift_B):
 *   partyA.hypothetical_schedule = A's current shifts − shift_A + shift_B
 *   partyB.hypothetical_schedule = B's current shifts − shift_B + shift_A
 */
export class ScenarioBuilder {
    /**
     * Build a standard 2-way swap scenario.
     */
    build(partyA: SwapPartyInput, partyB: SwapPartyInput): SwapScenario {
        const partyASchedule: RosterShift[] = [
            ...withoutShift(partyA.current_shifts, partyA.shift_to_give),
            partyB.shift_to_give,
        ];

        const partyBSchedule: RosterShift[] = [
            ...withoutShift(partyB.current_shifts, partyB.shift_to_give),
            partyA.shift_to_give,
        ];

        return {
            partyA: {
                employee_id: partyA.employee_id,
                name: partyA.name,
                hypothetical_schedule: partyASchedule,
                received_shift: partyB.shift_to_give,
                given_shift: partyA.shift_to_give,
                is_student_visa: partyA.is_student_visa,
            },
            partyB: {
                employee_id: partyB.employee_id,
                name: partyB.name,
                hypothetical_schedule: partyBSchedule,
                received_shift: partyA.shift_to_give,
                given_shift: partyB.shift_to_give,
                is_student_visa: partyB.is_student_visa,
            },
        };
    }

    /**
     * Build a chain swap scenario for A→B→C→... rotations. (Case #13)
     *
     * In a chain swap, each employee gives their shift to the NEXT employee
     * in the chain and receives the PREVIOUS employee's shift.
     *
     * Example chain [A, B, C]:
     *   A gives shift_A → B receives shift_A
     *   B gives shift_B → C receives shift_B
     *   C gives shift_C → A receives shift_C  (wraps around)
     *
     * Returns a ChainSwapScenario with one SwapScenario per adjacent pair,
     * plus the hypothetical schedule for every party in the chain.
     *
     * Critical insight (Case #13): Sequential validation of A-B and B-C separately
     * may pass individually but fail when combined (e.g. B ends up with two shifts
     * on the same day). This builder computes B's FINAL schedule (after giving AND
     * receiving) so the engine evaluates the fully-resolved state.
     */
    buildChain(parties: SwapPartyInput[]): ChainSwapScenario {
        if (parties.length < 2) throw new Error('Chain swap requires at least 2 parties.');

        const n = parties.length;

        // Compute each party's hypothetical schedule:
        //   party[i] gives shift[i] and receives shift[(i-1+n) % n]
        const hypotheticalSchedules: RosterShift[][] = parties.map((party, i) => {
            const receivedShift = parties[(i - 1 + n) % n].shift_to_give;
            return [
                ...withoutShift(party.current_shifts, party.shift_to_give),
                receivedShift,
            ];
        });

        // Build SwapParty objects for every participant
        const swapParties: SwapParty[] = parties.map((party, i) => ({
            employee_id: party.employee_id,
            name: party.name,
            hypothetical_schedule: hypotheticalSchedules[i],
            received_shift: parties[(i - 1 + n) % n].shift_to_give,
            given_shift: party.shift_to_give,
        }));

        // Build adjacent pairs for incremental evaluation
        const pairs: SwapScenario[] = [];
        for (let i = 0; i < n - 1; i++) {
            pairs.push({
                partyA: swapParties[i],
                partyB: swapParties[i + 1],
            });
        }
        // Wrap-around pair (last → first) if chain is circular
        if (n > 2) {
            pairs.push({
                partyA: swapParties[n - 1],
                partyB: swapParties[0],
            });
        }

        return { pairs, parties: swapParties };
    }
}
