import { describe, it, expect } from 'vitest';
import { getStatusDotInfo } from '../shift-ui';

describe('getStatusDotInfo - Overridden Shifts', () => {
    it('returns Overridden (Early-Out) when billable end time is earlier than scheduled end', () => {
        const result = getStatusDotInfo({
            lifecycle_status: 'Published',
            attendance_note: 'No-Show overridden by manager',
            shift_date: '2026-05-29',
            end_time: '17:00:00',
            adjusted_end: '16:59:00' // 1 minute early
        });
        expect(result).toEqual({ color: '#14B8A6', label: 'Overridden (Early-Out)' });
    });

    it('returns Overridden (OverTime) when billable end time is later than scheduled end', () => {
        const result = getStatusDotInfo({
            lifecycle_status: 'Published',
            attendance_note: 'No-Show overridden by manager',
            shift_date: '2026-05-29',
            end_time: '17:00:00',
            adjusted_end: '17:01:00' // 1 minute late
        });
        expect(result).toEqual({ color: '#6D28D9', label: 'Overridden (OverTime)' });
    });

    it('returns Overridden (OnTime) when billable end time is exactly equal to scheduled end', () => {
        const result = getStatusDotInfo({
            lifecycle_status: 'Published',
            attendance_note: 'No-Show overridden by manager',
            shift_date: '2026-05-29',
            end_time: '17:00:00',
            adjusted_end: '17:00:00' // exactly equal
        });
        expect(result).toEqual({ color: '#8B5CF6', label: 'Overridden (OnTime)' });
    });

    it('falls back to Overridden (OnTime) when adjusted_end is missing/null', () => {
        const result = getStatusDotInfo({
            lifecycle_status: 'Published',
            attendance_note: 'No-Show overridden by manager',
            shift_date: '2026-05-29',
            end_time: '17:00:00',
            adjusted_end: null
        });
        expect(result).toEqual({ color: '#8B5CF6', label: 'Overridden (OnTime)' });
    });
});
