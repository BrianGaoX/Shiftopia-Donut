-- Persistent audit trail for BLOCKING compliance rejections.
--
-- Written by the V8 orchestrator (src/modules/compliance/v8/orchestrator/audit.ts)
-- whenever a runV8Orchestrator() result is BLOCKING. One row per rule hit so
-- the admin "Compliance Rejections" page can aggregate by rule_id, employee,
-- or operation_type without parsing JSON.
--
-- Inserts are fire-and-forget; they MUST never block the engine. The audit
-- helper logs to console.warn + Sentry breadcrumb in parallel so a DB outage
-- never blinds operators to a rejection event.

create table public.compliance_rejections (
    id              uuid primary key default gen_random_uuid(),
    created_at      timestamptz not null default now(),
    user_id         uuid references public.profiles(id) on delete set null,
    employee_id     uuid not null,
    operation_type  text not null,
    mode            text not null,
    stage           text,
    rule_id         text not null,
    rule_status     text not null,
    summary         text not null,
    details         text,
    affected_shifts uuid[] not null default '{}'::uuid[],
    calculation     jsonb,
    -- True when the COMPLIANCE_BLOCKING_ENABLED feature flag was off and the
    -- BLOCKING hit was downgraded to WARNING by the orchestrator. Lets ops
    -- distinguish "would have blocked" vs "did block".
    bypassed        boolean not null default false
);

create index idx_compliance_rejections_employee_id on public.compliance_rejections (employee_id);
create index idx_compliance_rejections_created_at  on public.compliance_rejections (created_at desc);
create index idx_compliance_rejections_rule_id     on public.compliance_rejections (rule_id);

alter table public.compliance_rejections enable row level security;

-- Managers (delta+) can read all rejection rows in their access scope.
create policy "managers_read_compliance_rejections" on public.compliance_rejections
  for select using (
    exists (
      select 1 from public.app_access_certificates
      where user_id = auth.uid()
        and access_level in ('delta', 'epsilon', 'zeta')
    )
  );

-- Any authenticated user can insert their own rejection record. The orchestrator
-- attempts to read auth.getUser() at write time; if that fails user_id is null.
create policy "users_insert_own_compliance_rejection" on public.compliance_rejections
  for insert with check (auth.uid() = user_id or user_id is null);
