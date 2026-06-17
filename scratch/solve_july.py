import os
import sys
import json
import re
from datetime import datetime

# Add optimizer-service to path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '../optimizer-service')))

from model_builder import ScheduleModelBuilder, OptimizerInput, ShiftInput, EmployeeInput, OptimizerConstraints, StrategyInput, SolverParameters

# Path to the exported JSON output
data_file_path = "/Users/vinayakkuanr/.gemini/antigravity-ide/brain/4955e92e-0321-47e8-bb01-986f251b3610/.system_generated/steps/685/output.txt"
with open(data_file_path, 'r') as f:
    raw_content = f.read()

wrapped_json = json.loads(raw_content)
result_str = wrapped_json['result']

# Find the JSON array inside the result string
match = re.search(r'<untrusted-data-[a-f0-9-]+>\s*(.*?)\s*</untrusted-data-[a-f0-9-]+>', result_str, re.DOTALL)
if not match:
    raise ValueError("Could not find untrusted data block in result string")

untrusted_data_str = match.group(1)
# Untrusted data string is a JSON array: [{"data": {...}}]
rows = json.loads(untrusted_data_str)
db_data = rows[0]['data']

shifts_raw = db_data['shifts']
contracts_raw = db_data['contracts']
profiles_raw = db_data['profiles']
availability_rules_raw = db_data['availability_rules']

print(f"Loaded {len(shifts_raw)} shifts.")
print(f"Loaded {len(contracts_raw)} active contracts.")
print(f"Loaded {len(profiles_raw)} active profiles.")
print(f"Loaded {len(availability_rules_raw)} availability rules.")

# Map contracts to user_ids
employee_contracts = {}
for c in contracts_raw:
    uid = c['user_id']
    role_id = c['role_id']
    role_name = 'Unknown'
    if role_id == 'dfc559a8-4211-4ae8-8a0f-651d45f8ffe5': role_name = 'TM3'
    elif role_id == '5f6fa34c-b979-447e-b608-db01839b69f2': role_name = 'Team Leader'
    elif role_id == '2309d285-116e-4478-904d-44f627bdf82a': role_name = 'Team Member'
    elif role_id == '9806f863-5379-4c4d-bce8-2eaf13999daa': role_name = 'Security Team Member Level 3'
    elif role_id == '3202795c-8a4e-47df-a00e-b4506cd16ca6': role_name = 'Usher'
    
    if uid not in employee_contracts:
        employee_contracts[uid] = {
            'role_ids': [],
            'role_names': [],
            'contract_type': c.get('employment_status', 'Casual'),
            'contracted_weekly_hours': float(c.get('contracted_weekly_hours') or 0),
        }
    employee_contracts[uid]['role_ids'].append(role_id)
    employee_contracts[uid]['role_names'].append(role_name)

# Find active profiles with active contracts
active_employees = []
for p in profiles_raw:
    uid = p['id']
    if uid not in employee_contracts:
        continue
    c_info = employee_contracts[uid]
    
    # Check if they have availability rules
    ar_count = sum(1 for ar in availability_rules_raw if ar['profile_id'] == uid)
    has_avail_data = ar_count > 0

    active_employees.append({
        'id': uid,
        'name': p['full_name'],
        'contracted_role_ids': c_info['role_ids'],
        'role_names': c_info['role_names'],
        'contract_type': c_info['contract_type'],
        'contracted_weekly_hours': c_info['contracted_weekly_hours'],
        'has_availability_data': has_avail_data,
        'is_student': False,
        'is_flexible': False,
    })

print(f"Total active staff with contracts: {len(active_employees)}")

# Construct Optimizer inputs
optimizer_shifts = []
for s in shifts_raw:
    h1, m1, s1_t = map(int, s['start_time'].split(':'))
    h2, m2, s2_t = map(int, s['end_time'].split(':'))
    dur = (h2 * 60 + m2) - (h1 * 60 + m1)
    if dur < 0: dur += 1440
    optimizer_shifts.append(ShiftInput(
        id=s['id'],
        shift_date=s['shift_date'],
        start_time=s['start_time'][:5],
        end_time=s['end_time'][:5],
        duration_minutes=dur,
        role_id=s['role_id'],
        required_skill_ids=[],
        required_license_ids=[],
        priority=1,
        unpaid_break_minutes=s.get('unpaid_break_minutes') or 0,
        shift_type='NORMAL'
    ))

dates = sorted([s.shift_date for s in optimizer_shifts])
d1 = datetime.strptime(dates[0], '%Y-%m-%d')
d2 = datetime.strptime(dates[-1], '%Y-%m-%d')
diff_days = (d2 - d1).days + 1
week_scale = diff_days / 7.0

optimizer_employees = []
for emp in active_employees:
    isFT = emp['contract_type'] == 'FT' or 'full' in emp['contract_type'].lower()
    isPT = emp['contract_type'] == 'PT' or 'part' in emp['contract_type'].lower()
    baseMax = 2280 if isFT else (1200 if isPT else 2400)
    baseMin = 2280 if isFT else (1200 if isPT else 0)
    
    # Scale limits
    total_demand = sum(s.duration_minutes for s in optimizer_shifts)
    fair_share_cap = (total_demand / len(active_employees)) * 1.2
    scaledMin = baseMin * week_scale
    cappedMin = min(scaledMin, fair_share_cap)

    optimizer_employees.append(EmployeeInput(
        id=emp['id'],
        name=emp['name'],
        contracted_role_ids=emp['contracted_role_ids'],
        employment_type='Casual' if ('casual' in emp['contract_type'].lower()) else ('Part-Time' if isPT else 'Full-Time'),
        hourly_rate=32.06 if 'casual' in emp['contract_type'].lower() else 25.65,
        min_contract_minutes=round(cappedMin),
        max_weekly_minutes=round(baseMax * week_scale),
        contract_weekly_minutes=int((emp['contracted_weekly_hours'] or 38) * 60),
        has_availability_data=emp['has_availability_data'],
        availability_slots=[]
    ))

opt_input = OptimizerInput(
    shifts=optimizer_shifts,
    employees=optimizer_employees,
    constraints=OptimizerConstraints(
        min_rest_minutes=600,
        enforce_role_match=True,
        enforce_skill_match=True,
        allow_partial=True,
        relax_constraints=False
    ),
    strategy=StrategyInput(),
    solver_params=SolverParameters(
        max_time_seconds=30.0,
        num_workers=8,
        enable_greedy_hint=True,
        log_search=True
    )
)

print("Building and solving locally...")
builder = ScheduleModelBuilder(opt_input)
out = builder.build_and_solve()

print("\n--- SOLVER RESULTS ---")
print(f"Status: {out.status}")
print(f"Assignments: {len(out.assignments)}")
print(f"Unassigned: {len(out.unassigned_shift_ids)}")
total_shifts = len(optimizer_shifts)
coverage_pct = (len(out.assignments) / total_shifts) * 100
print(f"Coverage: {coverage_pct:.1f}%")

role_ids_names = {
    'dfc559a8-4211-4ae8-8a0f-651d45f8ffe5': 'TM3',
    '5f6fa34c-b979-447e-b608-db01839b69f2': 'Team Leader',
    '2309d285-116e-4478-904d-44f627bdf82a': 'Team Member',
    '9806f863-5379-4c4d-bce8-2eaf13999daa': 'Security Team Member Level 3',
    '3202795c-8a4e-47df-a00e-b4506cd16ca6': 'Usher'
}
role_name_demands = {}
role_name_assigned = {}

for s in optimizer_shifts:
    rname = role_ids_names.get(s.role_id, 'Unknown')
    role_name_demands[rname] = role_name_demands.get(rname, 0) + 1

assigned_shift_ids = {a.shift_id: a.employee_id for a in out.assignments}
for s in optimizer_shifts:
    rname = role_ids_names.get(s.role_id, 'Unknown')
    if s.id in assigned_shift_ids:
        role_name_assigned[rname] = role_name_assigned.get(rname, 0) + 1

print("\n--- COVERAGE BY ROLE ---")
for rname, demand in role_name_demands.items():
    assigned = role_name_assigned.get(rname, 0)
    pct = (assigned / demand) * 100 if demand > 0 else 0
    print(f"Role: {rname:20} | Demand: {demand:3} | Assigned: {assigned:3} | Unassigned: {demand - assigned:3} | Coverage: {pct:.1f}%")

# Check employee workloads
emp_workloads = {emp.id: 0 for emp in optimizer_employees}
emp_assigned_counts = {emp.id: 0 for emp in optimizer_employees}
for a in out.assignments:
    s = next(x for x in optimizer_shifts if x.id == a.shift_id)
    emp_workloads[a.employee_id] += s.duration_minutes
    emp_assigned_counts[a.employee_id] += 1

print("\n--- EMPLOYEE WORKLOAD DISTRIBUTION (Top 15) ---")
emp_list = sorted(optimizer_employees, key=lambda e: emp_workloads[e.id], reverse=True)
for emp in emp_list[:15]:
    hours = emp_workloads[emp.id] / 60.0
    max_h = emp.max_weekly_minutes / 60.0
    print(f"Employee: {emp.name:25} | Contract: {emp.employment_type:10} | Assigned Shifts: {emp_assigned_counts[emp.id]:3} | Workload: {hours:5.1f} / {max_h:.1f} hours | Availability data: {emp.has_availability_data}")

# Analyze Team Member unassigned shifts
print("\n--- UNASSIGNED TEAM MEMBER SHIFTS ---")
unassigned_shifts = [s for s in optimizer_shifts if s.id not in assigned_shift_ids]
tm_role_id = '2309d285-116e-4478-904d-44f627bdf82a'
tm_unassigned = [s for s in unassigned_shifts if s.role_id == tm_role_id]
print(f"Total unassigned Team Member shifts: {len(tm_unassigned)}")

from ortools_runner import _explain_eligibility
if tm_unassigned:
    sample_s = tm_unassigned[0]
    print(f"Sample Shift ID: {sample_s.id} on {sample_s.shift_date} {sample_s.start_time}-{sample_s.end_time} ({sample_s.duration_minutes}m)")
    reasons_count = {}
    for emp in optimizer_employees:
        reasons = _explain_eligibility(emp, sample_s, opt_input.constraints)
        if not reasons:
            reasons_count['ELIGIBLE'] = reasons_count.get('ELIGIBLE', 0) + 1
        else:
            for r in reasons:
                reasons_count[r] = reasons_count.get(r, 0) + 1
    print("Eligibility stats for this shift:", reasons_count)
