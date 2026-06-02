import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/platform/realtime/client';
import { useAuth } from '@/platform/auth/useAuth';
import { toast } from '@/modules/core/ui/primitives/use-toast';

export const SUPPORTED_LOCALES = [
    { code: 'en-GB', label: 'English (UK)', flag: '🇬🇧' },
    { code: 'en-US', label: 'English (US)', flag: '🇺🇸' },
    { code: 'fr-FR', label: 'French (FR)', flag: '🇫🇷' },
] as const;

export type SupportedLocaleCode = typeof SUPPORTED_LOCALES[number]['code'];

export interface UseSettingsProps {
    onSuccess?: () => void;
}

export const useSettings = (props?: UseSettingsProps) => {
    const { user, accessScope, permissionObject } = useAuth();
    const queryClient = useQueryClient();

    // Derived organization ID with fallback
    const organizationId = accessScope?.organizationId || permissionObject?.allowed_scope_tree?.organizations?.[0]?.id;

    // Fetch organization branding
    const { data: orgBranding, isLoading: isOrgLoading } = useQuery({
        queryKey: ['organization-branding', organizationId],
        queryFn: async () => {
            if (!organizationId) return null;
            const { data, error } = await supabase
                .from('organizations')
                .select('branding')
                .eq('id', organizationId)
                .single();
            if (error) throw error;
            return data.branding;
        },
        enabled: !!organizationId,
        staleTime: 1000 * 60 * 5, // 5 minutes
    });

    // Update Profile Mutation (first_name, last_name, email, phone)
    const updateProfile = useMutation({
        mutationFn: async (payload: {
            firstName?: string;
            lastName?: string;
            fullName?: string;
            phone?: string;
            avatarUrl?: string;
        }) => {
            if (!user?.id) throw new Error('Not authenticated');

            const { error } = await supabase
                .from('profiles')
                .update({
                    first_name: payload.firstName,
                    last_name: payload.lastName,
                    full_name: payload.fullName,
                    phone: payload.phone,
                    avatar_url: payload.avatarUrl,
                })
                .eq('id', user.id);

            if (error) throw error;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['user-profile', user?.id] });
            toast({ title: 'Profile updated successfully' });
            props?.onSuccess?.();
        },
        onError: (err: any) => {
            toast({ title: 'Failed to update profile', description: err.message, variant: 'destructive' });
        }
    });

    // Update User Preferences Mutation (JSONB partial update)
    const updatePreferences = useMutation({
        mutationFn: async (preferences: any) => {
            if (!user?.id) throw new Error('Not authenticated');

            // Fetch current prefs first to do a partial merge if necessary, 
            // though usually we just overwrite the whole block for simplicity in the UI state.
            const { error } = await supabase
                .from('profiles')
                .update({ preferences })
                .eq('id', user.id);

            if (error) throw error;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['user-profile', user?.id] });
            toast({ title: 'Preferences saved' });
            props?.onSuccess?.();
        },
        onError: (err: any) => {
            toast({ title: 'Failed to save preferences', description: err.message, variant: 'destructive' });
        }
    });

    // Update Organization Branding Mutation
    const updateBranding = useMutation({
        mutationFn: async (newBranding: any) => {
            if (!organizationId) throw new Error('No active organization');

            // Merge with existing branding to prevent data loss
            const currentBranding = (orgBranding as Record<string, any>) || {};
            const merged = { ...currentBranding, ...newBranding };

            const { data, error } = await supabase
                .from('organizations')
                .update({ branding: merged })
                .eq('id', organizationId)
                .select('branding')
                .single();

            if (error) throw error;

            return data.branding;
        },
        onSuccess: (updatedBranding) => {
            queryClient.setQueryData(['organization-branding', organizationId], updatedBranding);
            toast({ title: 'Organization settings updated' });
            props?.onSuccess?.();

            // Broadcast event for real-time theme sync
            window.dispatchEvent(new CustomEvent('branding-updated', { detail: updatedBranding }));
        },
        onError: (err: any) => {
            toast({
              title: 'Failed to update settings',
              description: err.message || 'Unknown error',
              variant: 'destructive'
            });
        }
    });

    // Update Language Mutation (silent auto-save, optimistic in UI)
    const updateLanguage = useMutation({
        mutationFn: async ({ language }: { language: string }) => {
            if (!SUPPORTED_LOCALES.some(l => l.code === language)) throw new Error('Unsupported locale');
            if (!organizationId) throw new Error('No active organization');

            const currentBranding = (orgBranding as Record<string, any>) || {};
            const merged = {
                ...currentBranding,
                language,
                language_updated_at: new Date().toISOString(),
            };

            const { data, error } = await supabase
                .from('organizations')
                .update({ branding: merged })
                .eq('id', organizationId)
                .select('branding')
                .single();

            if (error) throw error;

            return data.branding;
        },
        onSuccess: (updatedBranding) => {
            queryClient.setQueryData(['organization-branding', organizationId], updatedBranding);
            window.dispatchEvent(new CustomEvent('branding-updated', { detail: updatedBranding }));
        },
        onError: (err: any) => {
            toast({
                title: 'Failed to save language',
                description: err.message,
                variant: 'destructive',
            });
        },
    });

    return {
        user,
        orgBranding,
        isOrgLoading,
        updateProfile,
        updatePreferences,
        updateBranding,
        updateLanguage,
    };
};
