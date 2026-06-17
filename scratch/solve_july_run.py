import os, sys, json, re, time
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '../optimizer-service')))
from model_builder import (ScheduleModelBuilder, OptimizerInput, ShiftInput, EmployeeInput,
                           OptimizerConstraints, StrategyInput, SolverParameters)

f = "/Users/vinayakkuanr/.gemini/antigravity-ide/brain/4955e92e-0321-47e8-bb01-986f251b3610/.system_generated/steps/685/output.txt"
raw = open(f).read()
result_str = json.loads(raw)['result']
# Robust: grab the JSON array of row objects directly (the preamble also mentions the tag name).
m = re.search(r'(\[\s*\{.*\}\s*\])', result_str, re.DOTALL)
rows = json.loads(m.group(1))
db = rows[0]['data']
shifts_raw, contracts_raw, profiles_raw, avail_raw = db['shifts'], db['contracts'], db['profiles'], db['availability_rules']
print(f"shifts={len(shifts_raw)} contracts={len(contracts_raw)} profiles={len(profiles_raw)} avail={len(avail_raw)}")

emp_contracts = {}
for c in contracts_raw:
    uid = c['user_id']
    d = emp_contracts.setdefault(uid, {'role_ids': [], 'contract_type': c.get('employment_status', 'Casual'),
                                       'contracted_weekly_hours': float(c.get('contracted_weekly_hours') or 0)})
    d['role_ids'].append(c['role_id'])

active = []
for p in profiles_raw:
    uid = p['id']
    if uid not in emp_contracts:
        continue
    ci = emp_contracts[uid]
    has_avail = any(ar['profile_id'] == uid for ar in avail_raw)
    active.append({'id': uid, 'name': p['full_name'], 'contracted_role_ids': ci['role_ids'],
                   'contract_type': ci['contract_type'], 'contracted_weekly_hours': ci['contracted_weekly_hours'],
                   'has_availability_data': has_avail})
print(f"active staff={len(active)}")

opt_shifts = []
for s in shifts_raw:
    h1, m1 = map(int, s['start_time'].split(':')[:2]); h2, m2 = map(int, s['end_time'].split(':')[:2])
    dur = (h2*60+m2) - (h1*60+m1)
    if dur < 0: dur += 1440
    opt_shifts.append(ShiftInput(id=s['id'], shift_date=s['shift_date'], start_time=s['start_time'][:5],
                                 end_time=s['end_time'][:5], duration_minutes=dur, role_id=s['role_id'],
                                 required_skill_ids=[], required_license_ids=[], priority=1,
                                 unpaid_break_minutes=s.get('unpaid_break_minutes') or 0, shift_type='NORMAL'))

dates = sorted(s.shift_date for s in opt_shifts)
from datetime import datetime
diff_days = (datetime.strptime(dates[-1], '%Y-%m-%d') - datetime.strptime(dates[0], '%Y-%m-%d')).days + 1
week_scale = diff_days / 7.0
print(f"date span: {dates[0]} .. {dates[-1]} ({diff_days} days, week_scale={week_scale:.2f})")
total_demand = sum(s.duration_minutes for s in opt_shifts)

opt_emps = []
for e in active:
    ct = e['contract_type'].lower()
    isFT = 'full' in ct or e['contract_type'] == 'FT'; isPT = 'part' in ct or e['contract_type'] == 'PT'
    baseMax = 2280 if isFT else (1200 if isPT else 2400); baseMin = 2280 if isFT else (1200 if isPT else 0)
    cappedMin = min(baseMin*week_scale, (total_demand/len(active))*1.2)
    opt_emps.append(EmployeeInput(id=e['id'], name=e['name'], contracted_role_ids=e['contracted_role_ids'],
                                  employment_type='Casual' if 'casual' in ct else ('Part-Time' if isPT else 'Full-Time'),
                                  hourly_rate=32.06 if 'casual' in ct else 25.65, min_contract_minutes=round(cappedMin),
                                  max_weekly_minutes=round(baseMax*week_scale),
                                  contract_weekly_minutes=int((e['contracted_weekly_hours'] or 38)*60),
                                  has_availability_data=e['has_availability_data'], availability_slots=[]))

budget = float(sys.argv[1]) if len(sys.argv) > 1 else 90.0
decompose = len(sys.argv) > 2 and sys.argv[2].lower() in ('decompose', 'week', 'weekly', '1', 'true')
opt_input = OptimizerInput(shifts=opt_shifts, employees=opt_emps,
    constraints=OptimizerConstraints(min_rest_minutes=600, enforce_role_match=True, enforce_skill_match=True,
                                      allow_partial=True, relax_constraints=False),
    strategy=StrategyInput(),
    solver_params=SolverParameters(max_time_seconds=budget, num_workers=8, enable_greedy_hint=True,
                                   log_search=False, decompose_by_week=decompose))

print(f"\nBuilding + solving (budget={budget}s, num_workers=8, decompose_by_week={decompose}) ...")
t0 = time.perf_counter()
out = ScheduleModelBuilder(opt_input).build_and_solve()
elapsed = time.perf_counter() - t0
print("\n--- RESULTS ---")
print(f"Status            : {out.status}")
print(f"Wall elapsed      : {elapsed:.1f}s   (solve_time_ms={getattr(out,'solve_time_ms',None)})")
print(f"num_variables     : {getattr(out,'num_variables',None)}")
print(f"num_constraints   : {getattr(out,'num_constraints',None)}")
print(f"Assignments       : {len(out.assignments)} / {len(opt_shifts)}  ({100*len(out.assignments)/len(opt_shifts):.1f}% coverage)")
print(f"Unassigned        : {len(out.unassigned_shift_ids)}")
if getattr(out, 'pillars', None):
    pf = out.pillars.get('fatigue', {}); pc = out.pillars.get('coverage', {}); pfa = out.pillars.get('fairness', {})
    print(f"Pillar coverage   : {pc}")
    print(f"Pillar fairness   : {pfa}")
    print(f"Pillar fatigue    : {pf}   <-- wellbeing score")
