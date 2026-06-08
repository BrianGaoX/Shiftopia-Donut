import re

with open('/Users/vinayakkuanr/.gemini/antigravity/brain/5ee66ea7-8ac3-44c1-a6aa-11e7359bbabb/scratch/fix_functions.sql', 'r') as f:
    sql = f.read()

# Fix sm_bulk_assign
sql = re.sub(r',\s*audit_inserts\s+AS\s*\(\s*-- shift_audit_events insert removed;', ';', sql)

# Fix sm_bulk_publish_shifts
sql = re.sub(r',\s*audit_inserts\s+AS\s*\(\s*-- shift_audit_events insert removed;', ';', sql)

# Fix sm_bulk_delete_shifts
sql = re.sub(r',\s*audit_logs\s+AS\s*\(\s*-- shift_audit_events insert removed;', ';', sql)

with open('/Users/vinayakkuanr/.gemini/antigravity/brain/5ee66ea7-8ac3-44c1-a6aa-11e7359bbabb/scratch/fix_functions.sql', 'w') as f:
    f.write(sql)
