import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger, DialogFooter } from '@/modules/core/ui/primitives/dialog';
import { Button } from '@/modules/core/ui/primitives/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/modules/core/ui/primitives/select';
import { Label } from '@/modules/core/ui/primitives/label';
import { Input } from '@/modules/core/ui/primitives/input';
import { Plus, Award, Shield, Loader2, Calendar } from 'lucide-react';
import { supabase } from '@/platform/supabase/client';
import { useToast } from '@/modules/core/ui/primitives/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';

interface AddLicenseDialogProps {
    employeeId: string;
    employeeName: string;
    type: 'Standard' | 'WorkRights';
    existingLicenseIds?: string[];
}

interface MasterLicense {
    id: string;
    name: string;
    category: string;
    requires_expiration: boolean;
}

export const AddLicenseDialog: React.FC<AddLicenseDialogProps> = ({ employeeId, employeeName, type, existingLicenseIds = [] }) => {
    const [open, setOpen] = useState(false);
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isLoadingRefs, setIsLoadingRefs] = useState(false);
    const [licenses, setLicenses] = useState<MasterLicense[]>([]);

    const [formData, setFormData] = useState({
        license_id: '',
        issue_date: '',
        expiration_date: '',
        status: 'Active',
    });

    const isVisa = type === 'WorkRights';

    // Load available licenses
    useEffect(() => {
        if (open) {
            loadLicenses();
        }
    }, [open]);

    const loadLicenses = async () => {
        setIsLoadingRefs(true);
        try {
            let query = supabase
                .from('licenses')
                .select('id, name, category, requires_expiration')
                .order('name');

            if (isVisa) {
                query = query.eq('category', 'Visa');
            } else {
                query = query.neq('category', 'Visa');
            }

            const { data, error } = await query;
            if (error) throw error;

            // Filter out licenses that are already assigned
            const availableLicenses = (data || []).filter(l => !existingLicenseIds.includes(l.id));
            setLicenses(availableLicenses as any);
        } catch (error) {
            console.error('Error loading licenses:', error);
            toast({ title: 'Error', description: 'Failed to load license options', variant: 'destructive' });
        } finally {
            setIsLoadingRefs(false);
        }
    };

    const handleSubmit = async () => {
        if (!formData.license_id) {
            toast({ title: 'Error', description: 'Please select a license', variant: 'destructive' });
            return;
        }

        const selectedLicense = licenses.find(l => l.id === formData.license_id);
        if (selectedLicense?.requires_expiration && !formData.expiration_date) {
            toast({ title: 'Error', description: 'Expiration date is required for this license', variant: 'destructive' });
            return;
        }

        if (formData.issue_date && formData.expiration_date) {
            if (new Date(formData.issue_date) > new Date(formData.expiration_date)) {
                toast({ title: 'Validation Error', description: 'Issue date cannot be after expiration date', variant: 'destructive' });
                return;
            }
        }

        setIsSubmitting(true);
        try {
            const { error } = await supabase.from('employee_licenses').insert({
                employee_id: employeeId,
                license_id: formData.license_id,
                issue_date: formData.issue_date || null,
                expiration_date: formData.expiration_date || null,
                status: formData.status,
                license_type: type,
                verification_status: isVisa ? 'Unverified' : undefined // Default to unverified for new visas
            });

            if (error) {
                // Handle duplicate key error specifically
                if (error.code === '23505') {
                    throw new Error('This license is already assigned to this user.');
                }
                throw error;
            }

            toast({ title: 'Success', description: `${isVisa ? 'Work rights' : 'License'} added successfully` });
            queryClient.invalidateQueries({ queryKey: ['employee_licenses', employeeId] });
            setOpen(false);

            // Reset form
            setFormData({
                license_id: '',
                issue_date: '',
                expiration_date: '',
                status: 'Active',
            });
        } catch (error: any) {
            console.error('Error adding license:', error);
            toast({ title: 'Error', description: error.message || 'Failed to add item', variant: 'destructive' });
        } finally {
            setIsSubmitting(false);
        }
    };

    const selectedLicense = licenses.find(l => l.id === formData.license_id);

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button variant="outline" size="sm" className="ml-auto">
                    <Plus className="w-4 h-4 mr-2" />
                    {isVisa ? 'Add Work Rights' : 'Add License'}
                </Button>
            </DialogTrigger>
            <DialogContent className="w-[calc(100vw-2rem)] max-w-md bg-card border-border text-foreground shadow-xl shadow-black/5 dark:shadow-black/20">
                <DialogHeader>
                    <DialogTitle>{isVisa ? 'Add Work Rights' : 'Add License'}</DialogTitle>
                    <DialogDescription>
                        Select a {isVisa ? 'visa' : 'license'} to add to {employeeName}
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-4">
                    {/* License Selection */}
                    <div className="space-y-2">
                        <Label className="text-muted-foreground flex items-center gap-2">
                            {isVisa ? <Shield className="w-4 h-4" /> : <Award className="w-4 h-4" />}
                            {isVisa ? 'Visa Type' : 'License Name'}
                        </Label>
                        <Select
                            value={formData.license_id}
                            onValueChange={(val) => setFormData({ ...formData, license_id: val })}
                        >
                            <SelectTrigger className="bg-muted/30 border-border">
                                <SelectValue placeholder={`Select ${isVisa ? 'visa' : 'license'}...`} />
                            </SelectTrigger>
                            <SelectContent>
                                {licenses.map(license => (
                                    <SelectItem key={license.id} value={license.id}>
                                        {license.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    {/* Dates Grid */}
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label className="text-muted-foreground">Issue Date</Label>
                            <div className="relative">
                                <Input
                                    type="date"
                                    className="bg-muted/30 border-border"
                                    value={formData.issue_date}
                                    onChange={(e) => setFormData({ ...formData, issue_date: e.target.value })}
                                />
                            </div>
                        </div>
                        <div className="space-y-2">
                            <Label className="text-muted-foreground">
                                Expiry Date
                                {selectedLicense?.requires_expiration && <span className="text-red-400 ml-1">*</span>}
                            </Label>
                            <div className="relative">
                                <Input
                                    type="date"
                                    className="bg-muted/30 border-border"
                                    value={formData.expiration_date}
                                    onChange={(e) => setFormData({ ...formData, expiration_date: e.target.value })}
                                />
                            </div>
                        </div>
                    </div>
                </div>

                <div className="pt-2">
                    <Button onClick={handleSubmit} disabled={isSubmitting || isLoadingRefs} className="w-full">
                        {isSubmitting ? (
                            <>
                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                Adding...
                            </>
                        ) : (
                            isVisa ? 'Add Work Rights' : 'Add License'
                        )}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
};
