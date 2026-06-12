-- The Cutaway — 4th fixed roster group ("warmest white" / amber).
-- The enum value MUST be added in its own committed transaction before any
-- function body or DML references it (PostgreSQL: a new enum value cannot be
-- used in the same transaction that adds it). Keep this as a standalone migration.
ALTER TYPE public.template_group_type ADD VALUE IF NOT EXISTS 'the_cutaway';
