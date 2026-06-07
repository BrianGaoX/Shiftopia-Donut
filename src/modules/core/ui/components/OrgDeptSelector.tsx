import { useEffect, useState } from 'react';
import { supabase } from '@/platform/supabase/client';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/modules/core/lib/utils'; // Assuming standard utils

interface OrgDeptSelectorProps {
    selectedOrganizationId: string | null;
    selectedDepartmentId: string | null;
    selectedSubDepartmentId?: string | null;
    onOrganizationChange: (id: string | null) => void;
    onDepartmentChange: (id: string | null) => void;
    onSubDepartmentChange?: (id: string | null) => void;
    className?: string;
    hideSubDepartment?: boolean;
}

export function OrgDeptSelector({
    selectedOrganizationId,
    selectedDepartmentId,
    selectedSubDepartmentId,
    onOrganizationChange,
    onDepartmentChange,
    onSubDepartmentChange,
    className,
    hideSubDepartment = false,
}: OrgDeptSelectorProps) {
    const [organizations, setOrganizations] = useState<any[]>([]);
    const [departments, setDepartments] = useState<any[]>([]);
    const [subDepartments, setSubDepartments] = useState<any[]>([]);

    // Load organizations
    useEffect(() => {
        const loadOrganizations = async () => {
            const { data } = await supabase.from('organizations').select('id, name').order('name');
            setOrganizations(data || []);
            // Auto-select first org if none selected and data exists
            if (data && data.length > 0 && !selectedOrganizationId) {
                onOrganizationChange(data[0].id);
            }
        };
        loadOrganizations();
    }, []);

    // Load departments when org changes
    useEffect(() => {
        if (!selectedOrganizationId) {
            setDepartments([]);
            return;
        }
        const loadDepartments = async () => {
            const { data } = await supabase
                .from('departments')
                .select('id, name')
                .eq('organization_id', selectedOrganizationId)
                .order('name');
            setDepartments(data || []);

            // If current department is not in new list, reset it
            if (selectedDepartmentId && data && !data.find(d => d.id === selectedDepartmentId)) {
                onDepartmentChange(null);
            }
        };
        loadDepartments();
    }, [selectedOrganizationId, selectedDepartmentId]);

    // Load sub-departments when dept changes
    useEffect(() => {
        if (hideSubDepartment || !selectedDepartmentId) {
            setSubDepartments([]);
            return;
        }
        const loadSubDepartments = async () => {
            const { data } = await supabase
                .from('sub_departments')
                .select('id, name')
                .eq('department_id', selectedDepartmentId)
                .order('name');
            setSubDepartments(data || []);

            // If current sub-dept is not in new list, reset it
            if (selectedSubDepartmentId && data && !data.find(d => d.id === selectedSubDepartmentId)) {
                if (onSubDepartmentChange) onSubDepartmentChange(null);
            }
        };
        loadSubDepartments();
    }, [selectedDepartmentId, hideSubDepartment, selectedSubDepartmentId]);

    return (
        <div className={cn("flex items-center gap-3", className)}>
            {/* Organization Dropdown */}
            <div className="relative">
                <select
                    value={selectedOrganizationId || ''}
                    onChange={(e) => onOrganizationChange(e.target.value || null)}
                    className="appearance-none bg-background border border-input rounded-md pl-3 pr-10 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring min-w-[200px]"
                >
                    <option value="">Select Organization</option>
                    {organizations.map((org) => (
                        <option key={org.id} value={org.id}>
                            {org.name}
                        </option>
                    ))}
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            </div>

            {/* Department Dropdown */}
            <div className="relative">
                <select
                    value={selectedDepartmentId || ''}
                    onChange={(e) => onDepartmentChange(e.target.value || null)}
                    className="appearance-none bg-background border border-input rounded-md pl-3 pr-10 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring min-w-[200px]"
                    disabled={!selectedOrganizationId}
                >
                    <option value="">Select Department</option>
                    {departments.map((dept) => (
                        <option key={dept.id} value={dept.id}>
                            {dept.name}
                        </option>
                    ))}
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            </div>

            {/* Sub-Department Dropdown */}
            {!hideSubDepartment && onSubDepartmentChange && (
                <div className="relative">
                    <select
                        value={selectedSubDepartmentId || ''}
                        onChange={(e) => onSubDepartmentChange(e.target.value || null)}
                        className="appearance-none bg-background border border-input rounded-md pl-3 pr-10 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring min-w-[200px]"
                        disabled={!selectedDepartmentId}
                    >
                        <option value="">Select Sub-Department</option>
                        {subDepartments.map((subDept) => (
                            <option key={subDept.id} value={subDept.id}>
                                {subDept.name}
                            </option>
                        ))}
                    </select>
                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                </div>
            )}
        </div>
    );
}
