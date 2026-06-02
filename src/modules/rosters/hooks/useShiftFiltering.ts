
import { useState, useMemo, useEffect } from 'react';
import { parse } from 'date-fns';
type BidWithEmployee = any;
type GroupedBids = any;
import { DateRange } from 'react-day-picker';

export const useShiftFiltering = (bids: BidWithEmployee[], initialDateRange?: DateRange) => {
    // State for search and filters
    const [searchQuery, setSearchQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState('all');
    const [departmentFilter, setDepartmentFilter] = useState('All Departments');
    const [subDepartmentFilter, setSubDepartmentFilter] = useState('All Sub-departments');
    const [roleFilter, setRoleFilter] = useState('All Roles');
    const [sortOption, setSortOption] = useState('date-desc');
    const [dateRange, setDateRange] = useState<DateRange | undefined>(initialDateRange);
    const [showDrafts, setShowDrafts] = useState(true);
    const [showUnassigned, setShowUnassigned] = useState(false);
    const [hoursRange, setHoursRange] = useState<[number, number]>([1, 12]);
    const [remunerationLevelFilter, setRemunerationLevelFilter] = useState('All');

    // Save filter state to localStorage
    useEffect(() => {
        const filterState = {
            searchQuery,
            statusFilter,
            departmentFilter,
            subDepartmentFilter,
            roleFilter,
            sortOption,
            showDrafts,
            showUnassigned,
            hoursRange,
            remunerationLevelFilter
        };
        localStorage.setItem('bidFilterState', JSON.stringify(filterState));
    }, [
        searchQuery,
        statusFilter,
        departmentFilter,
        subDepartmentFilter,
        roleFilter,
        sortOption,
        showDrafts,
        showUnassigned,
        hoursRange,
        remunerationLevelFilter
    ]);

    // Load filter state from localStorage on initial render
    useEffect(() => {
        const savedState = localStorage.getItem('bidFilterState');
        if (savedState) {
            try {
                const parsedState = JSON.parse(savedState);
                setSearchQuery(parsedState.searchQuery || '');
                setStatusFilter(parsedState.statusFilter || 'all');
                setDepartmentFilter(parsedState.departmentFilter || 'All Departments');
                setSubDepartmentFilter(parsedState.subDepartmentFilter || 'All Sub-departments');
                setRoleFilter(parsedState.roleFilter || 'All Roles');
                setSortOption(parsedState.sortOption || 'date-desc');
                setShowDrafts(parsedState.showDrafts !== undefined ? parsedState.showDrafts : true);
                setShowUnassigned(parsedState.showUnassigned || false);
                setHoursRange(parsedState.hoursRange || [1, 12]);
                setRemunerationLevelFilter(parsedState.remunerationLevelFilter || 'All');
            } catch (e) {
                console.error('Error parsing saved filter state:', e);
            }
        }
    }, []);

    // Apply filters and search to bids
    const filteredBids = useMemo(() => {
        return bids.filter(bid => {
            const shiftDetails = bid.shiftDetails;
            if (!shiftDetails) return false;

            // Date range filter
            if (dateRange?.from && dateRange?.to) {
                // Construct strict local midnight Date to compare with DateRange picking
                const bidDate = new Date(`${shiftDetails.date}T00:00:00`);
                if (bidDate < dateRange.from || bidDate > dateRange.to) {
                    return false;
                }
            }

            // Status filter
            if (statusFilter !== 'all' && shiftDetails.status !== statusFilter) {
                return false;
            }

            // Department filter
            if (departmentFilter !== 'All Departments' &&
                shiftDetails.department !== departmentFilter) {
                return false;
            }

            // Sub-department filter
            if (subDepartmentFilter !== 'All Sub-departments' &&
                shiftDetails.subDepartment !== subDepartmentFilter) {
                return false;
            }

            // Role filter
            if (roleFilter !== 'All Roles' &&
                shiftDetails.role !== roleFilter) {
                return false;
            }

            // Draft/Published filter
            if (!showDrafts && shiftDetails.isDraft) {
                return false;
            }

            // Assigned/Unassigned filter
            if (showUnassigned && shiftDetails.assignedEmployee) {
                return false;
            }

            // Hours range filter
            const netHours = parseFloat(shiftDetails.netLength);
            if (netHours < hoursRange[0] || netHours > hoursRange[1]) {
                return false;
            }

            // Remuneration level filter
            if (remunerationLevelFilter !== 'All' &&
                shiftDetails.remunerationLevel.toString() !== remunerationLevelFilter) {
                return false;
            }

            // Search query
            if (searchQuery) {
                const searchLower = searchQuery.toLowerCase();
                return (
                    (shiftDetails.id.toLowerCase().includes(searchLower)) ||
                    (shiftDetails.department.toLowerCase().includes(searchLower)) ||
                    (shiftDetails.subDepartment?.toLowerCase().includes(searchLower) || false) ||
                    (shiftDetails.role.toLowerCase().includes(searchLower)) ||
                    (shiftDetails.assignedEmployee?.toLowerCase().includes(searchLower) || false) ||
                    (bid.employee?.name?.toLowerCase().includes(searchLower) || false)
                );
            }

            return true;
        });
    }, [
        bids,
        dateRange,
        statusFilter,
        departmentFilter,
        subDepartmentFilter,
        roleFilter,
        showDrafts,
        showUnassigned,
        hoursRange,
        remunerationLevelFilter,
        searchQuery
    ]);

    // Sort the filtered bids
    const sortedBids = useMemo(() => {
        return [...filteredBids].sort((a, b) => {
            const detailsA = a.shiftDetails;
            const detailsB = b.shiftDetails;

            if (!detailsA || !detailsB) return 0;

            switch (sortOption) {
                case 'date-asc':
                    return detailsA.date.localeCompare(detailsB.date);
                case 'date-desc':
                    return detailsB.date.localeCompare(detailsA.date);
                case 'time-asc': {
                    const timeA = detailsA.startTime;
                    const timeB = detailsB.startTime;
                    return timeA.localeCompare(timeB);
                }
                case 'time-desc': {
                    const timeA = detailsA.startTime;
                    const timeB = detailsB.startTime;
                    return timeB.localeCompare(timeA);
                }
                case 'hours-asc':
                    return parseFloat(detailsA.netLength) - parseFloat(detailsB.netLength);
                case 'hours-desc':
                    return parseFloat(detailsB.netLength) - parseFloat(detailsA.netLength);
                case 'status':
                    return detailsA.status.localeCompare(detailsB.status);
                case 'role':
                    return detailsA.role.localeCompare(detailsB.role);
                case 'department':
                    return detailsA.department.localeCompare(detailsB.department);
                default:
                    return 0;
            }
        });
    }, [filteredBids, sortOption]);

    // Group bids by date
    const groupedBids: GroupedBids = useMemo(() => {
        return sortedBids.reduce((groups, bid) => {
            if (!bid.shiftDetails) return groups;
            const date = bid.shiftDetails.date;
            if (!groups[date]) {
                groups[date] = [];
            }
            groups[date].push(bid);
            return groups;
        }, {} as GroupedBids);
    }, [sortedBids]);

    // Get sorted dates from grouped bids
    const sortedDates = useMemo(() => {
        return Object.keys(groupedBids).sort((a, b) => {
            if (sortOption.startsWith('date-desc')) {
                return b.localeCompare(a);
            }
            return a.localeCompare(b);
        });
    }, [groupedBids, sortOption]);

    return {
        searchQuery,
        setSearchQuery,
        statusFilter,
        setStatusFilter,
        departmentFilter,
        setDepartmentFilter,
        subDepartmentFilter,
        setSubDepartmentFilter,
        roleFilter,
        setRoleFilter,
        sortOption,
        setSortOption,
        dateRange,
        setDateRange,
        showDrafts,
        setShowDrafts,
        showUnassigned,
        setShowUnassigned,
        hoursRange,
        setHoursRange,
        remunerationLevelFilter,
        setRemunerationLevelFilter,
        filteredBids,
        sortedBids,
        groupedBids,
        sortedDates,
    };
};
