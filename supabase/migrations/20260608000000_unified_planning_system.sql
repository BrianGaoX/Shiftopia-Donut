-- =============================================================================
-- Unified Planning Request System — Database Migration
-- =============================================================================
--
-- Promoted from:
--   src/modules/planning/unified/db/migration.sql  (DDL)
--   src/modules/planning/unified/db/rpc.sql        (RPC function)
--
-- All DDL is idempotent (uses IF NOT EXISTS / ADD COLUMN IF NOT EXISTS /
-- CREATE OR REPLACE). Safe to re-run.
--
-- Objects created:
--   1. workflow_status column on shifts
--   2. planning_requests table
--   3. planning_offers table
--   4. Indexes for performance and uniqueness
--   5. updated_at triggers for both tables
--   6. sm_finalize_planning_request RPC (SECURITY DEFINER)
--
-- See also:
--   src/modules/planning/unified/db/pre-migration-checks.sql
--     ↑ Run those checks before doing any legacy data backfill.


-- =============================================================================
-- 1. ADD workflow_status TO shifts
-- =============================================================================

ALTER TABLE shifts
  ADD COLUMN IF NOT EXISTS workflow_status text
    NOT NULL
    DEFAULT 'IDLE'
    CHECK (workflow_status IN (
      'IDLE',
      'OPEN_FOR_BIDS',
      'OPEN_FOR_TRADE',
      'PENDING_APPROVAL',
      'LOCKED'
    ));


-- =============================================================================
-- 2. planning_requests TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS planning_requests (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Request classification
  type                    text        NOT NULL
    CHECK (type IN ('BID', 'SWAP')),

  -- Lifecycle state — no EVALUATING state; compliance runs synchronously
  status                  text        NOT NULL DEFAULT 'OPEN'
    CHECK (status IN (
      'OPEN',
      'MANAGER_PENDING',
      'APPROVED',
      'REJECTED',
      'BLOCKED',
      'CANCELLED',
      'EXPIRED'
    )),

  -- The shift being bid on / traded away by the initiator
  shift_id                uuid        NOT NULL REFERENCES shifts(id) ON DELETE RESTRICT,

  -- Employee who created this request
  initiated_by            uuid        NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,

  -- For SWAP: the employee whose shift was selected; populated on offer selection
  -- For BID:  populated with the winning bidder on offer selection
  -- NULL while status = OPEN (unless targeted SWAP where known up front)
  target_employee_id      uuid        REFERENCES profiles(id) ON DELETE SET NULL,

  -- Free-text reason supplied by the initiator
  reason                  text,

  -- Compliance snapshot persisted at offer-selection time (JSONB for flexibility)
  compliance_snapshot     jsonb,
  compliance_evaluated_at timestamptz,

  -- Manager decision fields
  manager_id              uuid        REFERENCES profiles(id) ON DELETE SET NULL,
  manager_notes           text,
  decided_at              timestamptz,

  -- Operational Log Entries
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),

  -- BID requests must NOT have a target shift (target_employee_id may be set for targeted bids)
  -- This is enforced at the application layer; no DB constraint needed for shift_id

  -- SWAP requests that have moved past OPEN must have a target_employee_id
  -- (enforced in application logic; too complex for a simple CHECK)

  CONSTRAINT chk_bid_no_target_shift CHECK (
    -- BID requests cannot reference a second shift — the shift_id IS the open shift
    -- We don't store a "target_shift_id" on the request for BID type
    type != 'BID' OR true  -- placeholder; actual enforcement is in app layer
  )
);

COMMENT ON TABLE planning_requests IS
  'Unified planning requests for both BID and SWAP workflows. '
  'One request per shift per lifecycle. Compliance snapshot stored at selection time.';

COMMENT ON COLUMN planning_requests.type IS
  'BID = employee requests an open shift; SWAP = employee offers to trade their shift.';

COMMENT ON COLUMN planning_requests.compliance_snapshot IS
  'JSON blob: BidComplianceSnapshot or SwapComplianceSnapshot depending on type. '
  'Populated at the moment an offer is selected, before manager decision.';


-- =============================================================================
-- 3. planning_offers TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS planning_offers (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- FK to the parent request
  request_id       uuid        NOT NULL REFERENCES planning_requests(id) ON DELETE CASCADE,

  -- The employee making this offer
  offered_by       uuid        NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,

  -- For SWAP: the shift the offerer is willing to give up.
  -- NULL for BID offers (no shift to trade, just applying).
  offered_shift_id uuid        REFERENCES shifts(id) ON DELETE SET NULL,

  -- Offer lifecycle
  status           text        NOT NULL DEFAULT 'SUBMITTED'
    CHECK (status IN (
      'SUBMITTED',
      'SELECTED',
      'REJECTED',
      'WITHDRAWN'
    )),

  -- History Storage
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE planning_offers IS
  'One row per employee who responds to a planning_request. '
  'For BID: just a claim (offered_shift_id is NULL). '
  'For SWAP: offered_shift_id is the shift the responder trades away.';


-- =============================================================================
-- 4. INDEXES
-- =============================================================================

-- Only one active (non-terminal) request per shift.
-- Terminal statuses: APPROVED, REJECTED, BLOCKED, CANCELLED, EXPIRED
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_request_per_shift
  ON planning_requests (shift_id)
  WHERE status NOT IN ('APPROVED', 'REJECTED', 'BLOCKED', 'CANCELLED', 'EXPIRED');

-- Only one active SWAP request per target shift (the shift being offered in the swap).
-- We derive "target shift" from the selected offer's offered_shift_id, which is
-- reflected in planning_offers. The application enforces single-active-offer-per-shift
-- at the service layer. This index covers the request side for the initiator's shift.

-- Prevent offering the same shift into multiple active swap requests simultaneously.
-- An offer is "active" when status = SUBMITTED or SELECTED.
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_offer_per_offered_shift
  ON planning_offers (offered_shift_id)
  WHERE offered_shift_id IS NOT NULL
    AND status IN ('SUBMITTED', 'SELECTED');

-- Fast lookup: find the single selected offer for any request
CREATE UNIQUE INDEX IF NOT EXISTS idx_planning_offers_selected
  ON planning_offers (request_id)
  WHERE status = 'SELECTED';

-- Fast lookup: all offers for a given request (used by manager views)
CREATE INDEX IF NOT EXISTS idx_planning_offers_request_id
  ON planning_offers (request_id);

-- Fast lookup: requests initiated by a specific employee
CREATE INDEX IF NOT EXISTS idx_planning_requests_initiated_by
  ON planning_requests (initiated_by);

-- Fast lookup: requests in a specific status (manager dashboard)
CREATE INDEX IF NOT EXISTS idx_planning_requests_status
  ON planning_requests (status)
  WHERE status IN ('OPEN', 'MANAGER_PENDING');


-- =============================================================================
-- 5. updated_at TRIGGERS
-- =============================================================================

-- Generic trigger function (create once; reuse across tables)
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Attach to planning_requests
DROP TRIGGER IF EXISTS trg_planning_requests_updated_at ON planning_requests;
CREATE TRIGGER trg_planning_requests_updated_at
  BEFORE UPDATE ON planning_requests
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- Attach to planning_offers
DROP TRIGGER IF EXISTS trg_planning_offers_updated_at ON planning_offers;
CREATE TRIGGER trg_planning_offers_updated_at
  BEFORE UPDATE ON planning_offers
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();


-- =============================================================================
-- 6. sm_finalize_planning_request RPC
-- =============================================================================
--
-- Atomically finalises an approved planning request.
--
-- For BID:
--   Assigns the winning offerer (offer.offered_by) to the open shift.
--
-- For SWAP:
--   Performs a two-way atomic swap of assigned_employee_id between the
--   initiator's shift and the selected offerer's shift.
--
-- Safety guarantees:
--   • Row-level lock on planning_requests prevents concurrent finalisations.
--   • Optimistic lock on shifts.updated_at prevents acting on stale shift data.
--   • All mutations occur inside a single implicit transaction (plpgsql function).
--
-- Error codes raised (via SQLSTATE 'P0001' with the listed strings):
--   WRONG_STATE              — request is not in MANAGER_PENDING status
--   NO_SELECTED_OFFER        — no SELECTED offer found for this request
--   SHIFT_MUTATED: shift_id=X        — initiator's shift was modified since snapshot
--   SHIFT_MUTATED: target_shift_id=X — offerer's shift was modified since snapshot
--   MISSING_TARGET_SHIFT_TIMESTAMP   — SWAP request missing target_shift updated_at
--
-- Parameters:
--   p_request_id              UUID of the planning_request to finalise
--   p_offer_id                UUID of the planning_offer (must have status=SELECTED)
--   p_manager_id              UUID of the approving manager
--   p_manager_notes           Free-text manager notes (may be NULL)
--   p_shift_updated_at        updated_at of the initiator's shift at snapshot time
--   p_target_shift_updated_at updated_at of the offerer's shift at snapshot time (SWAP only)

CREATE OR REPLACE FUNCTION sm_finalize_planning_request(
  p_request_id              uuid,
  p_offer_id                uuid,
  p_manager_id              uuid,
  p_manager_notes           text,
  p_shift_updated_at        timestamptz,
  p_target_shift_updated_at timestamptz DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_request       planning_requests%ROWTYPE;
  v_offer         planning_offers%ROWTYPE;
  v_shift_updated timestamptz;
  v_target_updated timestamptz;
BEGIN

  -- ===========================================================================
  -- STEP 1: Lock the planning_request row for the duration of this transaction.
  -- This prevents two concurrent approve calls from both proceeding.
  -- ===========================================================================

  SELECT *
    INTO v_request
    FROM planning_requests
   WHERE id = p_request_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Planning request % not found', p_request_id;
  END IF;


  -- ===========================================================================
  -- STEP 2: Validate request status.
  -- ===========================================================================

  IF v_request.status <> 'MANAGER_PENDING' THEN
    RAISE EXCEPTION 'WRONG_STATE: request % has status % (expected MANAGER_PENDING)',
      p_request_id, v_request.status;
  END IF;


  -- ===========================================================================
  -- STEP 3: Fetch and validate the selected offer.
  -- ===========================================================================

  SELECT *
    INTO v_offer
    FROM planning_offers
   WHERE id         = p_offer_id
     AND request_id = p_request_id
     AND status     = 'SELECTED';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NO_SELECTED_OFFER: no SELECTED offer % for request %',
      p_offer_id, p_request_id;
  END IF;


  -- ===========================================================================
  -- STEP 4: Optimistic lock check — initiator's shift.
  -- ===========================================================================

  SELECT updated_at
    INTO v_shift_updated
    FROM shifts
   WHERE id = v_request.shift_id;

  IF v_shift_updated IS DISTINCT FROM p_shift_updated_at THEN
    RAISE EXCEPTION 'SHIFT_MUTATED: shift_id=%', v_request.shift_id;
  END IF;


  -- ===========================================================================
  -- STEP 5: Optimistic lock check — offerer's shift (SWAP only).
  -- ===========================================================================

  IF v_request.type = 'SWAP' AND v_offer.offered_shift_id IS NOT NULL THEN

    IF p_target_shift_updated_at IS NULL THEN
      RAISE EXCEPTION 'MISSING_TARGET_SHIFT_TIMESTAMP: SWAP request requires p_target_shift_updated_at';
    END IF;

    SELECT updated_at
      INTO v_target_updated
      FROM shifts
     WHERE id = v_offer.offered_shift_id;

    IF v_target_updated IS DISTINCT FROM p_target_shift_updated_at THEN
      RAISE EXCEPTION 'SHIFT_MUTATED: target_shift_id=%', v_offer.offered_shift_id;
    END IF;

  END IF;


  -- ===========================================================================
  -- STEP 6 / 7: Perform the shift mutation.
  -- BID  → assign initiator to the shift.
  -- SWAP → atomic two-way assignment swap.
  -- ===========================================================================

  IF v_request.type = 'BID' THEN

    -- Assign the winning bidder (the offer submitter) to the open shift.
    UPDATE shifts
       SET assigned_employee_id = v_offer.offered_by,
           workflow_status      = 'IDLE',
           updated_at           = now()
     WHERE id = v_request.shift_id;

  ELSIF v_request.type = 'SWAP' THEN

    -- Two-way atomic swap: both employees exchange shifts simultaneously.
    -- We capture the existing owners first to avoid ordering issues.
    DECLARE
      v_initiator_current_owner uuid;
      v_offerer_current_owner   uuid;
    BEGIN
      SELECT assigned_employee_id INTO v_initiator_current_owner
        FROM shifts WHERE id = v_request.shift_id;

      SELECT assigned_employee_id INTO v_offerer_current_owner
        FROM shifts WHERE id = v_offer.offered_shift_id;

      -- Assign offerer to initiator's shift
      UPDATE shifts
         SET assigned_employee_id = v_offerer_current_owner,
             workflow_status      = 'IDLE',
             updated_at           = now()
       WHERE id = v_request.shift_id;

      -- Assign initiator to offerer's shift
      UPDATE shifts
         SET assigned_employee_id = v_initiator_current_owner,
             workflow_status      = 'IDLE',
             updated_at           = now()
       WHERE id = v_offer.offered_shift_id;
    END;

  END IF;


  -- ===========================================================================
  -- STEP 8: Mark the planning_request as APPROVED.
  -- ===========================================================================

  UPDATE planning_requests
     SET status       = 'APPROVED',
         manager_id   = p_manager_id,
         manager_notes = p_manager_notes,
         decided_at   = now(),
         updated_at   = now()
   WHERE id = p_request_id;

END;
$$;

-- Grant execute to authenticated role (adjust as needed for your RLS setup)
GRANT EXECUTE ON FUNCTION sm_finalize_planning_request(uuid, uuid, uuid, text, timestamptz, timestamptz)
  TO authenticated;
