import re

file_path = "/Users/vinayakkuanr/Documents/Superman_ULTIMATE/supabase/migrations/20251015000000_baseline_schema.sql"

with open(file_path, "r", encoding="utf-8") as f:
    content = f.read()

# 1. Update the first overload of get_shift_state_id (already succeeded, but let's make sure it's correct)
target1 = r"-- S3: Published \+ Offered\r?\n\s*WHEN v_shift\.lifecycle = 'Published' AND v_shift\.outcome = 'offered' THEN 'S3'"
replacement1 = """-- S3: Published + Offered (awaiting decision: outcome is NULL or 'offered')
        WHEN v_shift.lifecycle = 'Published' AND v_shift.assignment = 'assigned' AND (v_shift.outcome IS NULL OR v_shift.outcome = 'offered') THEN 'S3'"""

content = re.sub(target1, replacement1, content)

# 2. Update the second overload of get_shift_state_id
# Let's locate the entire function body between BEGIN and END; and patch S2 and S3 inside it.
# Specifically, we want to find:
# -- S2: Draft + Assigned + Pending ...
# -- S3: Published + Assigned + Offered ...
# Let's write regex to replace:
# -- S2: Draft + Assigned + Pending
# WHEN p_lifecycle = 'Draft' AND p_assignment = 'assigned' AND p_outcome = 'pending' ...
# and the same for S3.

s2_pattern = r"-- S2: Draft \+ Assigned \+ Pending\r?\n\s*WHEN p_lifecycle = 'Draft' AND p_assignment = 'assigned'\s*\r?\n\s*AND p_outcome = 'pending' AND p_bidding = 'not_on_bidding' AND p_trading = 'NoTrade'\s*\r?\n\s*THEN 'S2'"
s2_replacement = """-- S2: Draft + Assigned + Pending (outcome is null or 'pending' in draft)
    WHEN p_lifecycle = 'Draft' AND p_assignment = 'assigned' 
         AND (p_outcome IS NULL OR p_outcome = 'pending') AND p_bidding = 'not_on_bidding' AND p_trading = 'NoTrade' 
         THEN 'S2'"""

content = re.sub(s2_pattern, s2_replacement, content)

s3_pattern = r"-- S3: Published \+ Assigned \+ Offered\r?\n\s*WHEN p_lifecycle = 'Published' AND p_assignment = 'assigned'\s*\r?\n\s*AND p_outcome = 'offered' AND p_bidding = 'not_on_bidding' AND p_trading = 'NoTrade'\s*\r?\n\s*THEN 'S3'"
s3_replacement = """-- S3: Published + Assigned + Offered
    WHEN p_lifecycle = 'Published' AND p_assignment = 'assigned' 
         AND (p_outcome IS NULL OR p_outcome = 'offered') AND p_bidding = 'not_on_bidding' AND p_trading = 'NoTrade' 
         THEN 'S3'"""

content = re.sub(s3_pattern, s3_replacement, content)

# Also ensure "AS $$" exists for get_shift_state_id
# In the original file, it was:
# CREATE OR REPLACE FUNCTION "public"."get_shift_state_id"("p_lifecycle" "public"."shift_lifecycle", "p_assignment" "public"."shift_assignment_status", "p_outcome" "public"."shift_assignment_outcome", "p_bidding" "public"."shift_bidding_status", "p_trading" "public"."shift_trading") RETURNS "text"
#     LANGUAGE "plpgsql" IMMUTABLE
#     SET "search_path" TO 'pg_catalog', 'public'
#     AS $$
# BEGIN
#   RETURN CASE
# But currently AS $$ was missing. Let's make sure it matches either with or without AS $$.
func_header_pattern = r'(CREATE OR REPLACE FUNCTION "public"\."get_shift_state_id"\("p_lifecycle" "public"\."shift_lifecycle", "p_assignment" "public"\."shift_assignment_status", "p_outcome" "public"\."shift_assignment_outcome", "p_bidding" "public"\."shift_bidding_status", "p_trading" "public"\."shift_trading"\) RETURNS "text"\r?\n\s*LANGUAGE "plpgsql" IMMUTABLE\r?\n\s*SET "search_path" TO \'pg_catalog\', \'public\'\r?\n)(?:\s*AS \$\$\r?\n)?(\s*BEGIN)'
func_header_replacement = r'\1    AS $$\n\2'

content = re.sub(func_header_pattern, func_header_replacement, content)

with open(file_path, "w", encoding="utf-8") as f:
    f.write(content)

print("Replacement complete.")
