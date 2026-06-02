import React, { useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/modules/core/ui/primitives/card';
import { Button } from '@/modules/core/ui/primitives/button';
import {
  GripVertical,
  ChevronDown,
  ChevronRight,
  Edit2,
  Copy,
  Trash2,
  Plus,
  X as XIcon,
} from 'lucide-react';
import { Group } from '@/modules/core/types';
import { cn } from '@/modules/core/lib/utils';

interface Props {
  group: Group;
  templateId: number;

  /* collapse logic */
  collapsed: boolean;
  toggleCollapse: () => void;

  dragHandleProps?: any; // passed from Draggable
  onUpdateGroup: (groupId: number, updates: Partial<Group>) => void;
  onDeleteGroup: (groupId: number) => void;
  onCloneGroup: (groupId: number) => void;
  onAddSubGroup: (groupId: number, name: string) => void;
}

const RosterGroup: React.FC<Props> = ({
  group,
  collapsed,
  toggleCollapse,
  dragHandleProps,
  onUpdateGroup,
  onDeleteGroup,
  onCloneGroup,
  onAddSubGroup,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [name, setName] = useState(group.name);
  const [color, setColor] = useState(group.color);
  const [newSubName, setNewSubName] = useState('');

  const saveEdit = () => {
    onUpdateGroup(group.id as number, { name, color });
    setIsEditing(false);
  };

  return (
    <Card
      className={cn(
        'transition-shadow border-l-4',
        'hover:shadow-md',
        collapsed && 'opacity-80'
      )}
      style={{ borderColor: color }}
    >
      <CardHeader className="flex items-start space-y-0 py-3">
        {/* Drag handle */}
        <div
          {...dragHandleProps}
          className="cursor-move mr-2 p-1 rounded hover:bg-muted/30 text-muted-foreground"
        >
          <GripVertical size={16} />
        </div>

        {/* Collapse / expand chevron */}
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 mr-1"
          onClick={toggleCollapse}
        >
          {collapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
        </Button>

        {/* Title / editing UI */}
        {isEditing ? (
          <div className="flex items-center gap-2 flex-1">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="bg-transparent border-b flex-1 focus:outline-none"
            />
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="w-6 h-6 border-none"
            />
            <Button size="icon" onClick={saveEdit}>
              <Edit2 size={16} />
            </Button>
            <Button size="icon" onClick={() => setIsEditing(false)}>
              <XIcon size={16} />
            </Button>
          </div>
        ) : (
          <>
            <CardTitle className="flex-1 flex items-center gap-2 text-base">
              {group.name}
              <span
                className="w-3 h-3 rounded-full border"
                style={{ backgroundColor: color }}
              />
            </CardTitle>

            <div className="flex gap-1">
              <Button
                size="icon"
                variant="outline"
                onClick={() => setIsEditing(true)}
              >
                <Edit2 size={16} />
              </Button>
              <Button
                size="icon"
                variant="outline"
                onClick={() => onCloneGroup(group.id as number)}
              >
                <Copy size={16} />
              </Button>
              <Button
                size="icon"
                variant="outline"
                onClick={() => onDeleteGroup(group.id as number)}
              >
                <Trash2 size={16} />
              </Button>
            </div>
          </>
        )}
      </CardHeader>

      {/* ▾ Sub‑groups only when expanded ▾ */}
      {!collapsed && (
        <CardContent className="space-y-3 pb-4">
          {group.subGroups.length === 0 ? (
            <div className="border border-dashed rounded-md p-4 text-center text-muted-foreground">
              No sub‑groups yet.
            </div>
          ) : (
            group.subGroups.map((sub) => (
              <div
                key={sub.id}
                className="rounded-md border px-3 py-2 text-sm bg-muted/40 hover:bg-muted/30 transition-colors"
              >
                {sub.name}{' '}
                <span className="text-xs text-muted-foreground">
                  ({sub.shifts.length} shifts)
                </span>
              </div>
            ))
          )}

          {/* Add sub‑group */}
          <div className="flex gap-2 pt-2">
            <input
              className="flex-1 border border-border rounded px-2 h-8 text-sm"
              placeholder="New sub‑group…"
              value={newSubName}
              onChange={(e) => setNewSubName(e.target.value)}
            />
            <Button
              size="icon"
              onClick={() => {
                if (!newSubName.trim()) return;
                onAddSubGroup(group.id as number, newSubName.trim());
                setNewSubName('');
              }}
            >
              <Plus size={16} />
            </Button>
          </div>
        </CardContent>
      )}
    </Card>
  );
};

export default RosterGroup;
