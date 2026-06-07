# V8 Compliance Engine — ICC Sydney EBA Rules & Algorithms

This document outlines the production-grade Enterprise Bargaining Agreement (EBA) rules for ICC Sydney, as enforced by the V8 Compliance Engine.

## 1. Ordinary Hours Averaging (EBA 38h/Week)
**Rule ID**: `V8_ORD_HOURS_AVG`  
**Status**: BLOCKING (Non-Casuals)

*   **Rule**: Average ≤ 38h per week over a rolling 28-day cycle.
*   **Enforcement**: Monitored across 7, 14, 21, and 28-day rolling windows to prevent hour-loading.
*   **Algorithm**: Sliding Window Scan ($S_{i} - S_{i-W} \le W/7 \times 38h$).

## 2. Minimum Rest Gap (10h / 8h)
**Rule ID**: `V8_MIN_REST_GAP`  
**Status**: BLOCKING

*   **Rule**: 
    *   Standard: 10 hours minimum rest.
    *   Multi-Hire: 8 hours minimum rest.
*   **Algorithm**: Pairwise chronological scan with shift-type-aware thresholds.

## 3. Workday Limits (20 in 28)
**Rule ID**: `V8_20_IN_28`  
**Status**: BLOCKING

*   **Rule**: Max 20 days worked in any rolling 28-day window.
*   **Algorithm**: Rolling sum of binary workday vectors ($∑ WD_d \le 20$).

## 4. Consecutive Workdays (Streak Limit)
**Rule ID**: `V8_STREAK_LIMIT`  
**Status**: BLOCKING

*   **Rule**: 
    *   Standard: Max 6 consecutive working days.
    *   Flexi-PT: Max 10 consecutive working days.
*   **Algorithm**: Linear scan detecting $Date_{i+1} - Date_i = 1$.

## 5. Minimum Engagement (3h / 4h)
**Rule ID**: `V8_MIN_ENGAGEMENT`  
**Status**: BLOCKING

*   **Rule**:
    *   Standard: Minimum 3 hours per engagement.
    *   Sundays/Public Holidays: Minimum 4 hours per engagement.
*   **Algorithm**: Direct duration check against calendar metadata flags.

## 6. Spread of Hours (12h Max)
**Rule ID**: `V8_SPREAD_OF_HOURS`  
**Status**: BLOCKING

*   **Rule**: The total span from the first start to the last end on any calendar day cannot exceed 12 hours.
*   **Algorithm**: Daily aggregation finding $Max(End) - Min(Start)$.

## 7. Meal Break Requirement
**Rule ID**: `V8_MEAL_BREAK`  
**Status**: BLOCKING

*   **Rule**: A valid meal break (min 30 mins) is required for any shift exceeding 5 hours worked.
*   **Algorithm**: Conditional duration check ($Duration > 5h \Rightarrow Break \ge 30m$).

## 8. Maximum Daily Hours (Aggregated)
**Rule ID**: `V8_MAX_DAILY_HOURS`  
**Status**: BLOCKING

*   **Rule**: Max 12 hours worked per calendar day, including split engagements.
*   **Algorithm**: Daily bucket aggregation ($∑ Duration_i \le 12h$).

## 9. Availability Severity Model
**Rule ID**: `V8_AVAILABILITY`  
**Status**: VARIABLE

*   **HARD_BLOCK (Leave/Certificates)**: Strict blocking ($x_i = 0$).
*   **SOFT_BLOCK (Unavailable)**: Generates warning in UI; adds \$50.00 penalty in Optimizer.
*   **PREFERENCE**: Generates advisory in UI; adds \$10.00 penalty in Optimizer.

## 🚀 OR-Tools Mathematical Model
For the Auto-Scheduler, these rules are translated into CP-SAT constraints:
1.  **Prefix-Sum Tensors**: Used for 28-day hours and 20-in-28 workday counts.
2.  **Boolean Exclusions**: Used for rest gaps and overlaps ($x_A + x_B \le 1$).
3.  **Spread Helpers**: $EndMax_d - StartMin_d \le 720$.
4.  **Soft Penalties**: Objective function incorporates weighted sums for soft/preference availability.

## 🏗️ Infrastructure & Hydration
The V8 Compliance Engine operates on a high-fidelity asynchronous bridge:
*   **Real-time Hydration**: Every check automatically hydrates the `V8Employee` context from the Supabase `profiles` and `user_contracts` tables to ensure accurate FT/PT/Casual logic.
*   **Calendar Awareness**: The bridge automatically detects Sundays and Public Holidays from `shift_date` to enforce the 4h minimum engagement rule.
*   **Batch Optimization**: The `BulkComplianceEngine` utilizes parallel context fetching to evaluate hundreds of shifts across multiple employees without N+1 performance penalties.
*   **Async-First Hook**: The `useCompliance` hook supports full promise-based evaluation, ensuring the UI remains responsive during deep compliance audits.
