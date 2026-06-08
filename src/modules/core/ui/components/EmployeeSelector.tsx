import React, { useState, useEffect } from 'react';
import { toast } from '@/modules/core/hooks/use-toast';
import { Input } from '@/modules/core/ui/primitives/input';
import { Button } from '@/modules/core/ui/primitives/button';
import { Checkbox } from '@/modules/core/ui/primitives/checkbox';
import { ScrollArea } from '@/modules/core/ui/primitives/scroll-area';
import { Skeleton } from '@/modules/core/ui/primitives/skeleton';
import { supabase } from '@/platform/supabase/client';
import { Employee } from '@/modules/broadcasts/model/broadcast.types';

interface EmployeeSelectorProps {
    onSelect: (employeeId: string, isAdmin?: boolean) => void;
    departmentId?: string;
    subDepartmentId?: string;
}

export const EmployeeSelector: React.FC<EmployeeSelectorProps> = ({
    onSelect,
    departmentId,
    subDepartmentId
}) => {
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [filteredEmployees, setFilteredEmployees] = useState<Employee[]>([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedEmployee, setSelectedEmployee] = useState<string | null>(null);
    const [isAdmin, setIsAdmin] = useState(false);
    const [isLoading, setIsLoading] = useState(true);

    // Fetch employees
    useEffect(() => {
        const fetchEmployees = async () => {
            try {
                setIsLoading(true);
                let contractsQuery = supabase
                    .from('user_contracts')
                    .select('user_id')
                    .ilike('status', 'active');

                if (departmentId) {
                    contractsQuery = contractsQuery.eq('department_id', departmentId);
                }
                if (subDepartmentId) {
                    contractsQuery = contractsQuery.eq('sub_department_id', subDepartmentId);
                }

                const { data: contractRows, error: contractError } = await contractsQuery;
                if (contractError) throw contractError;

                const userIds = [...new Set((contractRows || []).map((c: { user_id: string }) => c.user_id))];

                let profileRows: Employee[] = [];
                if (userIds.length > 0) {
                    let profilesQuery = supabase
                        .from('profiles')
                        .select('id, first_name, last_name, email')
                        .in('id', userIds)
                        .order('first_name');

                    const { data: profiles, error: profileError } = await profilesQuery;
                    if (profileError) throw profileError;

                    profileRows = (profiles || []).map((p: { id: string; first_name: string | null; last_name: string | null; email: string | null }) => ({
                        id: p.id,
                        name: `${p.first_name || ''} ${p.last_name || ''}`.trim() || 'Unknown',
                        email: p.email || '',
                        role: 'member',
                    }));
                }

                setEmployees(profileRows);
                setFilteredEmployees(profileRows);
            } catch (error: any) {
                toast({
                    title: "Error",
                    description: `Failed to load employees: ${error.message}`,
                    variant: "destructive"
                });
            } finally {
                setIsLoading(false);
            }
        };

        fetchEmployees();
    }, [departmentId, subDepartmentId]);

    // Filter employees based on search term
    useEffect(() => {
        const filtered = employees.filter(
            (employee) =>
                employee.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                employee.email.toLowerCase().includes(searchTerm.toLowerCase())
        );
        setFilteredEmployees(filtered);
    }, [searchTerm, employees]);

    // Handle employee selection
    const handleSelect = () => {
        if (!selectedEmployee) {
            toast({
                title: "Error",
                description: "Please select an employee",
                variant: "destructive"
            });
            return;
        }

        onSelect(selectedEmployee, isAdmin);
    };

    return (
        <div className="space-y-4">
            <div>
                <label htmlFor="search" className="text-sm font-medium">
                    Search Employees
                </label>
                <Input
                    id="search"
                    placeholder="Search by name or email"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="mt-1"
                />
            </div>

            <div>
                <label className="text-sm font-medium">Select Employee</label>
                {isLoading ? (
                    <div className="space-y-2 mt-2">
                        <Skeleton className="h-12 w-full" />
                        <Skeleton className="h-12 w-full" />
                        <Skeleton className="h-12 w-full" />
                    </div>
                ) : (
                    <ScrollArea className="h-52 mt-1 border rounded-md">
                        <div className="p-2 space-y-1">
                            {filteredEmployees.length === 0 ? (
                                <div className="text-center py-4 text-muted-foreground">
                                    No employees found
                                </div>
                            ) : (
                                filteredEmployees.map((employee) => (
                                    <div
                                        key={employee.id}
                                        className={`flex items-center p-2 rounded-md cursor-pointer hover:bg-muted transition-colors ${selectedEmployee === employee.id ? 'bg-muted' : ''
                                            }`}
                                        onClick={() => setSelectedEmployee(employee.id)}
                                    >
                                        <div className="flex-1">
                                            <div className="font-medium">{employee.name}</div>
                                            <div className="text-sm text-muted-foreground">
                                                {employee.email} • {employee.role}
                                            </div>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </ScrollArea>
                )}
            </div>

            <div className="flex items-center space-x-2">
                <Checkbox
                    id="admin"
                    checked={isAdmin}
                    onCheckedChange={(checked) => setIsAdmin(checked === true)}
                />
                <label
                    htmlFor="admin"
                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                >
                    Add as group admin
                </label>
            </div>

            <div className="flex justify-end space-x-2">
                <Button variant="outline" onClick={() => onSelect('', false)}>
                    Cancel
                </Button>
                <Button onClick={handleSelect} disabled={!selectedEmployee}>
                    Add to Group
                </Button>
            </div>
        </div>
    );
};
