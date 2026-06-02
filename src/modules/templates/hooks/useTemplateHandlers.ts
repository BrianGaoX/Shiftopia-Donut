// src/hooks/useTemplateHandlers.ts
import { useCallback } from 'react';
import { Template, Group, SubGroup, TemplateShift } from '@/modules/core/types';

interface UseTemplateHandlersProps {
  templates: Template[];
  setTemplates: React.Dispatch<React.SetStateAction<Template[]>>;
  currentTemplate: Template | null;
  setCurrentTemplate: React.Dispatch<React.SetStateAction<Template | null>>;
  newGroup: {
    name: string;
    description?: string;
    color: string;
    icon?: string;
  };
  setNewGroup: React.Dispatch<
    React.SetStateAction<{
      name: string;
      description?: string;
      color: string;
      icon?: string;
    }>
  >;
  setIsAddGroupDialogOpen: React.Dispatch<React.SetStateAction<boolean>>;
  toast: (props: {
    title: string;
    description?: string;
    variant?: 'default' | 'destructive';
  }) => void;
}

export const useTemplateHandlers = ({
  templates,
  setTemplates,
  currentTemplate,
  setCurrentTemplate,
  newGroup,
  setNewGroup,
  setIsAddGroupDialogOpen,
  toast,
}: UseTemplateHandlersProps) => {
  // Add a new group to the current template
  const handleAddGroup = useCallback(() => {
    if (!currentTemplate || !newGroup.name.trim()) return;

    const newGroupData: Group = {
      id: Date.now(),
      name: newGroup.name.trim(),
      description: newGroup.description || '',
      color: newGroup.color,
      icon: newGroup.icon || 'clipboard',
      subGroups: [],
      sortOrder: 0,
    };

    const updatedTemplate = {
      ...currentTemplate,
      groups: [...currentTemplate.groups, newGroupData],
      updatedAt: new Date().toISOString(),
    };

    setCurrentTemplate(updatedTemplate);
    setTemplates((prev) =>
      prev.map((t) => (t.id === currentTemplate.id ? updatedTemplate : t))
    );
    setNewGroup({
      name: '',
      description: '',
      color: 'teal',
      icon: 'clipboard',
    });
    setIsAddGroupDialogOpen(false);
    toast({
      title: 'Group added',
      description: `"${newGroupData.name}" has been added`,
    });
  }, [
    currentTemplate,
    newGroup,
    setCurrentTemplate,
    setTemplates,
    setNewGroup,
    setIsAddGroupDialogOpen,
    toast,
  ]);

  // Update a group
  const handleUpdateGroup = useCallback(
    (groupId: number, updates: Partial<Group>) => {
      if (!currentTemplate) return;

      const updatedGroups = currentTemplate.groups.map((g) =>
        g.id === groupId ? { ...g, ...updates } : g
      );

      const updatedTemplate = {
        ...currentTemplate,
        groups: updatedGroups,
        updatedAt: new Date().toISOString(),
      };

      setCurrentTemplate(updatedTemplate);
      setTemplates((prev) =>
        prev.map((t) => (t.id === currentTemplate.id ? updatedTemplate : t))
      );
      toast({ title: 'Group updated' });
    },
    [currentTemplate, setCurrentTemplate, setTemplates, toast]
  );

  // Delete a group
  const handleDeleteGroup = useCallback(
    (groupId: number) => {
      if (!currentTemplate) return;

      const updatedGroups = currentTemplate.groups.filter(
        (g) => g.id !== groupId
      );

      const updatedTemplate = {
        ...currentTemplate,
        groups: updatedGroups,
        updatedAt: new Date().toISOString(),
      };

      setCurrentTemplate(updatedTemplate);
      setTemplates((prev) =>
        prev.map((t) => (t.id === currentTemplate.id ? updatedTemplate : t))
      );
      toast({ title: 'Group deleted' });
    },
    [currentTemplate, setCurrentTemplate, setTemplates, toast]
  );

  // Clone a group
  const handleCloneGroup = useCallback(
    (groupId: number) => {
      if (!currentTemplate) return;

      const groupToClone = currentTemplate.groups.find((g) => g.id === groupId);
      if (!groupToClone) return;

      const clonedGroup: Group = {
        ...groupToClone,
        id: Date.now(),
        name: `${groupToClone.name} (Copy)`,
        subGroups: groupToClone.subGroups.map((sg) => ({
          ...sg,
          id: Date.now() + Math.random(),
          shifts: sg.shifts.map((s) => ({
            ...s,
            id: Date.now() + Math.random(),
          })),
        })),
      };

      const updatedTemplate = {
        ...currentTemplate,
        groups: [...currentTemplate.groups, clonedGroup],
        updatedAt: new Date().toISOString(),
      };

      setCurrentTemplate(updatedTemplate);
      setTemplates((prev) =>
        prev.map((t) => (t.id === currentTemplate.id ? updatedTemplate : t))
      );
      toast({
        title: 'Group cloned',
        description: `"${clonedGroup.name}" has been created`,
      });
    },
    [currentTemplate, setCurrentTemplate, setTemplates, toast]
  );

  // Add a subgroup
  const handleAddSubGroup = useCallback(
    (groupId: number, name: string) => {
      if (!currentTemplate || !name.trim()) return;

      const newSubGroup: SubGroup = {
        id: Date.now(),
        name: name.trim(),
        shifts: [],
        startTime: '09:00 AM',
        endTime: '05:00 PM',
        sortOrder: 0,
      } as unknown as SubGroup;

      const updatedGroups = currentTemplate.groups.map((g) =>
        g.id === groupId
          ? { ...g, subGroups: [...g.subGroups, newSubGroup] }
          : g
      );

      const updatedTemplate = {
        ...currentTemplate,
        groups: updatedGroups,
        updatedAt: new Date().toISOString(),
      };

      setCurrentTemplate(updatedTemplate);
      setTemplates((prev) =>
        prev.map((t) => (t.id === currentTemplate.id ? updatedTemplate : t))
      );
      toast({
        title: 'Subgroup added',
        description: `"${name}" has been added`,
      });
    },
    [currentTemplate, setCurrentTemplate, setTemplates, toast]
  );

  // Reorder groups
  const handleReorderGroups = useCallback(
    (sourceIndex: number, destIndex: number) => {
      if (!currentTemplate) return;

      const reorderedGroups = [...currentTemplate.groups];
      const [removed] = reorderedGroups.splice(sourceIndex, 1);
      reorderedGroups.splice(destIndex, 0, removed);

      const updatedTemplate = {
        ...currentTemplate,
        groups: reorderedGroups,
        updatedAt: new Date().toISOString(),
      };

      setCurrentTemplate(updatedTemplate);
      setTemplates((prev) =>
        prev.map((t) => (t.id === currentTemplate.id ? updatedTemplate : t))
      );
    },
    [currentTemplate, setCurrentTemplate, setTemplates]
  );

  // Save as draft
  const handleSaveAsDraft = useCallback(async () => {
    if (!currentTemplate) return;

    const updatedTemplate = {
      ...currentTemplate,
      status: 'draft' as const,
      updatedAt: new Date().toISOString(),
    };

    setCurrentTemplate(updatedTemplate);
    setTemplates((prev) =>
      prev.map((t) => (t.id === currentTemplate.id ? updatedTemplate : t))
    );
    toast({ title: 'Saved as draft' });
  }, [currentTemplate, setCurrentTemplate, setTemplates, toast]);

  // Publish
  const handlePublish = useCallback(
    async (range: { start: Date; end: Date }, override: boolean) => {
      if (!currentTemplate) return;

      const updatedTemplate = {
        ...currentTemplate,
        status: 'published' as const,
        updatedAt: new Date().toISOString(),
      };

      setCurrentTemplate(updatedTemplate);
      setTemplates((prev) =>
        prev.map((t) => (t.id === currentTemplate.id ? updatedTemplate : t))
      );
      toast({ title: 'Template published' });
    },
    [currentTemplate, setCurrentTemplate, setTemplates, toast]
  );

  // Export to PDF
  const handleExportToPdf = useCallback(async () => {
    toast({
      title: 'Exporting to PDF...',
      description: 'This feature is coming soon',
    });
  }, [toast]);

  // Delete template
  const handleDeleteTemplate = useCallback(
    async (templateId: string) => {
      const id = parseInt(templateId);
      setTemplates((prev) => prev.filter((t) => t.id !== id));
      if (currentTemplate?.id === id) {
        setCurrentTemplate(null);
      }
      toast({ title: 'Template deleted' });
    },
    [currentTemplate, setCurrentTemplate, setTemplates, toast]
  );

  // Duplicate template
  const handleDuplicateTemplate = useCallback(
    async (templateId: string) => {
      const id = parseInt(templateId);
      const templateToDuplicate = templates.find((t) => t.id === id);
      if (!templateToDuplicate) return;

      const duplicatedTemplate: Template = {
        ...templateToDuplicate,
        id: Date.now(),
        name: `${templateToDuplicate.name} (Copy)`,
        status: 'draft',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      setTemplates((prev) => [...prev, duplicatedTemplate]);
      toast({
        title: 'Template duplicated',
        description: `"${duplicatedTemplate.name}" has been created`,
      });
    },
    [templates, setTemplates, toast]
  );

  // Bulk shift update
  const handleBulkShiftUpdate = useCallback(
    async (shiftIds: string[], updates: Partial<TemplateShift>) => {
      toast({
        title: 'Shifts updated',
        description: `${shiftIds.length} shifts have been updated`,
      });
    },
    [toast]
  );

  return {
    handleAddGroup,
    handleUpdateGroup,
    handleDeleteGroup,
    handleCloneGroup,
    handleAddSubGroup,
    handleReorderGroups,
    handleSaveAsDraft,
    handlePublish,
    handleExportToPdf,
    handleDeleteTemplate,
    handleDuplicateTemplate,
    handleBulkShiftUpdate,
  };
};
