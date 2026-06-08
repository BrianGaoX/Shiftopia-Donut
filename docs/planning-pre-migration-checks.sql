-- =============================================================================
-- Unified Planning Request System — Pre-Migration Integrity Checks
-- =============================================================================
--
-- Run ALL of these queries against your Supabase database BEFORE executing
-- the backfill step of migration.sql.
--
-- Protocol:
--   1. Execute each numbered check individually.
--   2. Any check that returns rows signals a data quality problem.
--   3. Resolve every problem before running the backfill.
--   4. Run CHECK 7 (row-count preview) before AND after the backfill.
--   5. Run CHECK 10 (summary) last to get a single pass/fail table.
--
-- Tables referenced (must exist before running):
--   shifts          — base shift records
--   shift_bids      — legacy bidding rows
--   shift_swaps     — legacy swap request rows
--   swap_offers     — legacy swap offer rows (1-to-many against shift_swaps)
--
-- Column reference confirmed from application source:
--   shift_bids  : id, shift_id, employee_id, status, notes, created_at
--   shift_swaps : id, requester_shift_id, requester_id, target_id,
--                 target_shift_id, reason, status, created_at, updated_at
--   swap_offers : id, swap_request_id, offerer_id, offered_shift_id,
--                 status, compliance_snapshot, created_at
--   shifts      : id, assigned_employee_id, workflow_status, bidding_status,
--                 trading_status, shift_date, start_time, updated_at
-- =============================================================================


-- =============================================================================
-- CHECK 1: Shifts with BOTH an active bid AND an active swap
-- =============================================================================
-- Expected : 0 rows
-- Why      : The new unique index uq_active_request_per_shift allows only ONE
--            non-terminal planning_request per shift. A shift appearing in both
--            shift_bids (status = 'pending') and shift_swaps (status OPEN /
--            MANAGER_PENDING) will cause the backfill INSERT to violate that
--            index on the second row.
-- Action   : For each returned shift_id, either withdraw all pending bids OR
--            cancel / reject the swap request so only one active record remains.
-- =============================================================================

SELECT
    s.id                                        AS shift_id,
    COUNT(DISTINCT sb.id)                       AS bid_count,
    COUNT(DISTINCT ss.id)                       AS swap_count,
    s.shift_date,
    s.start_time
FROM shifts s
INNER JOIN shift_bids sb
    ON sb.shift_id = s.id
    AND sb.status = 'pending'
INNER JOIN shift_swaps ss
    ON (
           ss.requester_shift_id = s.id
        OR ss.target_shift_id    = s.id
    )
    AND ss.status IN ('OPEN', 'MANAGER_PENDING')
GROUP BY
    s.id,
    s.shift_date,
    s.start_time
HAVING
    COUNT(DISTINCT sb.id) > 0
    AND COUNT(DISTINCT ss.id) > 0
ORDER BY
    s.shift_date,
    s.start_time;


-- =============================================================================
-- CHECK 2: Swap requests in MANAGER_PENDING with no SELECTED offer
-- =============================================================================
-- Expected : 0 rows (ideally); any returned rows need manual review
-- Why      : A shift_swaps row with status = 'MANAGER_PENDING' means the
--            requester already selected an offer, which should have been
--            written to swap_offers with status = 'SELECTED'. If no such row
--            exists the manager console will display the request but have
--            nothing to approve — the manager cannot act.
-- Action   : Either re-select an offer for the swap (set one swap_offers row
--            to 'SELECTED') or reject and recreate the swap request so it
--            re-enters the OPEN state with a clean offer pool.
-- =============================================================================

SELECT
    ss.id                   AS swap_id,
    ss.created_at,
    ss.requester_id,
    ss.requester_shift_id,
    ss.status
FROM shift_swaps ss
LEFT JOIN swap_offers so
    ON  so.swap_request_id = ss.id
    AND so.status          = 'SELECTED'
WHERE ss.status   = 'MANAGER_PENDING'
  AND so.id       IS NULL
ORDER BY ss.created_at;


-- =============================================================================
-- CHECK 3: Duplicate active requests per shift (post-backfill safety preview)
-- =============================================================================
-- Expected : 0 rows
-- Why      : Simulates what the partial unique index uq_active_request_per_shift
--            would catch during INSERT. A shift_id that appears in BOTH
--            active shift_bids and active shift_swaps (or more than once in
--            either table) will produce a duplicate-key violation during the
--            backfill. This check surfaces those conflicts before they happen.
-- Action   : Resolve the underlying conflict identified in CHECK 1 first;
--            re-run this check to confirm it then returns 0 rows.
-- =============================================================================

WITH active_bids AS (
    SELECT
        shift_id,
        COUNT(*) AS active_count
    FROM shift_bids
    WHERE status = 'pending'
    GROUP BY shift_id
    HAVING COUNT(*) > 0
),
active_swaps AS (
    SELECT
        requester_shift_id   AS shift_id,
        COUNT(*)             AS active_count
    FROM shift_swaps
    WHERE status IN ('OPEN', 'MANAGER_PENDING')
    GROUP BY requester_shift_id
    HAVING COUNT(*) > 0
),
bid_only AS (
    SELECT
        ab.shift_id,
        'bid'       AS source,
        ab.active_count
    FROM active_bids ab
    LEFT JOIN active_swaps as2 ON as2.shift_id = ab.shift_id
    WHERE as2.shift_id IS NULL
      AND ab.active_count > 1   -- more than one pending bid is fine for bidding,
                                -- but flag shifts with >1 pending bid that would each
                                -- become a separate planning_request (violating unique index)
),
swap_only AS (
    SELECT
        as2.shift_id,
        'swap'      AS source,
        as2.active_count
    FROM active_swaps as2
    LEFT JOIN active_bids ab ON ab.shift_id = as2.shift_id
    WHERE ab.shift_id IS NULL
      AND as2.active_count > 1  -- more than one active swap for the same shift
),
both_sources AS (
    SELECT
        ab.shift_id,
        'both'      AS source,
        (ab.active_count + as2.active_count)    AS active_count
    FROM active_bids ab
    INNER JOIN active_swaps as2 ON as2.shift_id = ab.shift_id
)
SELECT shift_id, source, active_count FROM bid_only
UNION ALL
SELECT shift_id, source, active_count FROM swap_only
UNION ALL
SELECT shift_id, source, active_count FROM both_sources
ORDER BY source, shift_id;


-- =============================================================================
-- CHECK 4: shift_bids rows with invalid status values
-- =============================================================================
-- Expected : 0 rows
-- Why      : The backfill maps shift_bids.status via CASE:
--              'pending'   -> 'OPEN'
--              'accepted'  -> 'APPROVED'
--              'rejected'  -> 'REJECTED'
--              'withdrawn' -> 'CANCELLED'
--              ELSE        -> 'REJECTED'   (silent fallback)
--            An ELSE hit means a typo or undocumented status value in the DB.
--            The row will be migrated with status 'REJECTED', which destroys
--            its original meaning and is very hard to fix post-migration.
-- Action   : Manually correct the status value in shift_bids before migrating.
--            Known valid values: 'pending', 'accepted', 'rejected', 'withdrawn'.
-- =============================================================================

SELECT
    id,
    shift_id,
    employee_id,
    status,
    created_at
FROM shift_bids
WHERE status NOT IN ('pending', 'accepted', 'rejected', 'withdrawn')
ORDER BY created_at;


-- =============================================================================
-- CHECK 5: swap_offers rows with invalid status values
-- =============================================================================
-- Expected : 0 rows
-- Why      : The backfill maps swap_offers.status to planning_offers.status.
--            Any value outside the known vocabulary will either hit a CHECK
--            constraint violation on the new table or silently fall through
--            to an incorrect status. Both outcomes corrupt the migrated data.
-- Action   : Correct the status value in swap_offers before migrating.
--            Valid values per application source and new schema:
--              'SUBMITTED', 'SELECTED', 'REJECTED', 'WITHDRAWN', 'EXPIRED'
--            The legacy aliases 'pending' and 'accepted' are included below
--            in case old rows exist that predate the UPPERCASE convention.
-- =============================================================================

SELECT
    id,
    swap_request_id,
    offerer_id,
    status
FROM swap_offers
WHERE status NOT IN (
    'SUBMITTED',
    'SELECTED',
    'REJECTED',
    'WITHDRAWN',
    'EXPIRED',
    'pending',      -- legacy alias — maps to SUBMITTED
    'accepted'      -- legacy alias — maps to SELECTED
)
ORDER BY swap_request_id;


-- =============================================================================
-- CHECK 6: shift_bids where employee is bidding on a shift they already own
-- =============================================================================
-- Expected : 0 rows
-- Why      : The new system prohibits self-bids. A shift_bids row where
--            employee_id = shifts.assigned_employee_id means the employee who
--            currently owns the shift also has an active bid on it. Backfilling
--            this produces a planning_offer where offered_by = the shift owner,
--            which is logically nonsensical and may trip application-layer guards.
-- Action   : Delete or withdraw these self-bid rows before running the backfill.
-- =============================================================================

SELECT
    sb.id                           AS bid_id,
    sb.shift_id,
    sb.employee_id,
    sb.status                       AS bid_status,
    s.assigned_employee_id          AS shift_assigned_employee_id
FROM shift_bids sb
INNER JOIN shifts s
    ON  s.id               = sb.shift_id
    AND s.assigned_employee_id = sb.employee_id
ORDER BY sb.created_at;


-- =============================================================================
-- CHECK 7: Backfill row-count preview (INFORMATIONAL — not a pass/fail)
-- =============================================================================
-- Expected : Always returns 3 rows (shift_bids, shift_swaps, TOTAL)
-- Why      : Run this BEFORE the backfill to capture expected counts.
--            Run it again AFTER by comparing legacy_count to the rows actually
--            inserted into planning_requests and planning_offers.
-- Action   : If post-backfill counts in planning_requests / planning_offers
--            do not match the "expected_planning_requests" /
--            "expected_planning_offers" columns here, investigate missing rows.
-- =============================================================================

WITH bid_stats AS (
    SELECT
        COUNT(*)                                AS legacy_count,
        COUNT(DISTINCT shift_id)                AS expected_planning_requests,
        COUNT(*)                                AS expected_planning_offers
    FROM shift_bids
),
swap_stats AS (
    SELECT
        COUNT(*)                                AS legacy_count,
        COUNT(*)                                AS expected_planning_requests,
        (
            SELECT COUNT(*)
            FROM swap_offers
        )                                       AS expected_planning_offers
    FROM shift_swaps
),
totals AS (
    SELECT
        (b.legacy_count        + s.legacy_count)                    AS legacy_count,
        (b.expected_planning_requests + s.expected_planning_requests) AS expected_planning_requests,
        (b.expected_planning_offers   + s.expected_planning_offers)   AS expected_planning_offers
    FROM bid_stats b
    CROSS JOIN swap_stats s
)
SELECT 'shift_bids'  AS source_table,
       legacy_count,
       expected_planning_requests,
       expected_planning_offers
FROM bid_stats
UNION ALL
SELECT 'shift_swaps' AS source_table,
       legacy_count,
       expected_planning_requests,
       expected_planning_offers
FROM swap_stats
UNION ALL
SELECT 'TOTAL'       AS source_table,
       legacy_count,
       expected_planning_requests,
       expected_planning_offers
FROM totals;


-- =============================================================================
-- CHECK 8: Shifts with workflow_status already set to non-IDLE
-- =============================================================================
-- Expected : 0 rows before any new system usage
-- Why      : The migration.sql ALTER TABLE adds workflow_status with DEFAULT
--            'IDLE'. If migration.sql has already been run and application code
--            (the new system) has written any rows, those shifts already carry
--            a non-IDLE workflow_status. The backfill UPDATE uses:
--              WHERE workflow_status = 'IDLE'
--            so those rows will be SKIPPED. This is safe by design, but if
--            the expected counts in CHECK 7 do not reconcile, these rows are
--            the explanation.
-- Action   : Before any new system usage this should be 0 rows.
--            If rows are returned, document them and confirm they were written
--            intentionally by the new system (not data corruption).
-- =============================================================================

SELECT
    id              AS shift_id,
    workflow_status,
    bidding_status,
    trading_status,
    updated_at
FROM shifts
WHERE workflow_status IS NOT NULL
  AND workflow_status != 'IDLE'
ORDER BY updated_at DESC;


-- =============================================================================
-- CHECK 9: Orphaned swap_offers (no parent shift_swaps row)
-- =============================================================================
-- Expected : 0 rows
-- Why      : swap_offers.swap_request_id must reference a shift_swaps.id row.
--            An orphaned offer has no parent planning_request to attach to
--            after migration. The backfill would skip it (LEFT JOIN would
--            produce a NULL request_id), causing a NOT NULL constraint
--            violation on planning_offers.request_id.
-- Action   : Either delete these orphaned swap_offers rows, or investigate
--            whether the parent shift_swaps row was deleted accidentally and
--            needs to be restored before migration.
-- =============================================================================

SELECT
    so.id               AS offer_id,
    so.swap_request_id,
    so.offerer_id,
    so.status
FROM swap_offers so
LEFT JOIN shift_swaps ss
    ON ss.id = so.swap_request_id
WHERE ss.id IS NULL
ORDER BY so.swap_request_id;


-- =============================================================================
-- CHECK 10: Master pass/fail summary — run this last
-- =============================================================================
-- Expected : result = 'PASS' for every row except CHECK 7 (informational)
-- Why      : Gives a single at-a-glance view of all checks. Run after fixing
--            individual issues; a clean migration is safe when every row shows
--            PASS (CHECK 7 will always show 'INFO').
-- Action   : Any 'FAIL' row means the corresponding numbered check still
--            returns data quality problems. Fix those before proceeding.
-- =============================================================================

WITH
  c1 AS (
    -- CHECK 1: shifts with both an active bid and an active swap
    SELECT COUNT(*) AS n
    FROM shifts s
    INNER JOIN shift_bids sb
        ON sb.shift_id = s.id
        AND sb.status  = 'pending'
    INNER JOIN shift_swaps ss
        ON (
               ss.requester_shift_id = s.id
            OR ss.target_shift_id    = s.id
        )
        AND ss.status IN ('OPEN', 'MANAGER_PENDING')
  ),

  c2 AS (
    -- CHECK 2: MANAGER_PENDING swaps with no SELECTED offer
    SELECT COUNT(*) AS n
    FROM shift_swaps ss
    LEFT JOIN swap_offers so
        ON  so.swap_request_id = ss.id
        AND so.status          = 'SELECTED'
    WHERE ss.status = 'MANAGER_PENDING'
      AND so.id     IS NULL
  ),

  c3 AS (
    -- CHECK 3: duplicate active requests per shift
    SELECT COUNT(*) AS n
    FROM (
        WITH active_bids AS (
            SELECT shift_id FROM shift_bids
            WHERE status = 'pending'
            GROUP BY shift_id HAVING COUNT(*) > 1
        ),
        active_swaps AS (
            SELECT requester_shift_id AS shift_id FROM shift_swaps
            WHERE status IN ('OPEN', 'MANAGER_PENDING')
            GROUP BY requester_shift_id HAVING COUNT(*) > 1
        ),
        both_sources AS (
            SELECT ab.shift_id
            FROM (
                SELECT shift_id FROM shift_bids WHERE status = 'pending' GROUP BY shift_id
            ) ab
            INNER JOIN (
                SELECT requester_shift_id AS shift_id FROM shift_swaps
                WHERE status IN ('OPEN', 'MANAGER_PENDING') GROUP BY requester_shift_id
            ) as2 ON as2.shift_id = ab.shift_id
        )
        SELECT shift_id FROM active_bids
        UNION
        SELECT shift_id FROM active_swaps
        UNION
        SELECT shift_id FROM both_sources
    ) problems
  ),

  c4 AS (
    -- CHECK 4: shift_bids with invalid status
    SELECT COUNT(*) AS n
    FROM shift_bids
    WHERE status NOT IN ('pending', 'accepted', 'rejected', 'withdrawn')
  ),

  c5 AS (
    -- CHECK 5: swap_offers with invalid status
    SELECT COUNT(*) AS n
    FROM swap_offers
    WHERE status NOT IN (
        'SUBMITTED', 'SELECTED', 'REJECTED', 'WITHDRAWN', 'EXPIRED',
        'pending', 'accepted'
    )
  ),

  c6 AS (
    -- CHECK 6: self-bids (employee bidding on their own shift)
    SELECT COUNT(*) AS n
    FROM shift_bids sb
    INNER JOIN shifts s
        ON  s.id                   = sb.shift_id
        AND s.assigned_employee_id = sb.employee_id
  ),

  c8 AS (
    -- CHECK 8: shifts with workflow_status already non-IDLE
    SELECT COUNT(*) AS n
    FROM shifts
    WHERE workflow_status IS NOT NULL
      AND workflow_status != 'IDLE'
  ),

  c9 AS (
    -- CHECK 9: orphaned swap_offers
    SELECT COUNT(*) AS n
    FROM swap_offers so
    LEFT JOIN shift_swaps ss ON ss.id = so.swap_request_id
    WHERE ss.id IS NULL
  )

SELECT
    'CHECK 1: shifts with active bid AND active swap conflict'   AS check_name,
    c1.n                                                         AS problem_rows,
    CASE WHEN c1.n = 0 THEN 'PASS' ELSE 'FAIL' END              AS result
FROM c1

UNION ALL

SELECT
    'CHECK 2: MANAGER_PENDING swaps with no SELECTED offer',
    c2.n,
    CASE WHEN c2.n = 0 THEN 'PASS' ELSE 'FAIL' END
FROM c2

UNION ALL

SELECT
    'CHECK 3: duplicate active requests per shift (index simulation)',
    c3.n,
    CASE WHEN c3.n = 0 THEN 'PASS' ELSE 'FAIL' END
FROM c3

UNION ALL

SELECT
    'CHECK 4: shift_bids with unrecognised status values',
    c4.n,
    CASE WHEN c4.n = 0 THEN 'PASS' ELSE 'FAIL' END
FROM c4

UNION ALL

SELECT
    'CHECK 5: swap_offers with unrecognised status values',
    c5.n,
    CASE WHEN c5.n = 0 THEN 'PASS' ELSE 'FAIL' END
FROM c5

UNION ALL

SELECT
    'CHECK 6: employees bidding on shifts they already own (self-bids)',
    c6.n,
    CASE WHEN c6.n = 0 THEN 'PASS' ELSE 'FAIL' END
FROM c6

UNION ALL

SELECT
    'CHECK 7: row-count preview (informational — always INFO)',
    NULL,
    'INFO'

UNION ALL

SELECT
    'CHECK 8: shifts with workflow_status != IDLE (new system already active)',
    c8.n,
    CASE WHEN c8.n = 0 THEN 'PASS' ELSE 'FAIL' END
FROM c8

UNION ALL

SELECT
    'CHECK 9: orphaned swap_offers with no parent shift_swaps row',
    c9.n,
    CASE WHEN c9.n = 0 THEN 'PASS' ELSE 'FAIL' END
FROM c9

ORDER BY
    result DESC,    -- PASS sorts before INFO sorts before FAIL (alphabetical desc)
    check_name;
