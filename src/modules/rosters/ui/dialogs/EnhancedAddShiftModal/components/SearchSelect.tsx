import React, { useState, useEffect, useMemo } from 'react';
import { Popover, PopoverTrigger, PopoverContent } from '@/modules/core/ui/primitives/popover';
import {
    Command,
    CommandInput,
    CommandList,
    CommandEmpty,
    CommandGroup,
    CommandItem,
    CommandShortcut,
} from '@/modules/core/ui/primitives/command';
import { cn } from '@/modules/core/lib/utils';
import { ChevronDown, Lock, Check } from 'lucide-react';

interface SearchSelectProps {
    label: string;
    icon?: React.ReactNode;
    options: { id: string; name: string }[];
    selected: string | undefined | null;
    onChange: (id: string) => void;
    locked?: boolean;
    disabled?: boolean;
    placeholder?: string;
    className?: string;
}

export const SearchSelect: React.FC<SearchSelectProps> = ({
    label,
    icon,
    options,
    selected,
    onChange,
    locked = false,
    disabled = false,
    placeholder = 'Select...',
    className,
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const isDisabled = locked || disabled;

    const selectedItem = useMemo(() => {
        return options.find(opt => opt.id === selected);
    }, [options, selected]);

    const displayText = selectedItem ? selectedItem.name : placeholder;

    // Close on Escape key
    useEffect(() => {
        if (!isOpen) return;
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                setIsOpen(false);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen]);

    return (
        <Popover open={isOpen} onOpenChange={setIsOpen} modal={false}>
            <PopoverTrigger asChild>
                <button
                    className={cn(
                        "flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-300",
                        "border justify-between w-full h-14 border-border",
                        "hover:scale-[1.01] active:scale-[0.99] relative z-20",
                        isOpen ? "ring-2 ring-indigo-500 bg-indigo-500/5 shadow-indigo-500/20 border-indigo-400/80" : "",
                        isDisabled
                            ? "bg-indigo-50/20 dark:bg-white/[0.02] text-slate-400 dark:text-white/40 cursor-not-allowed opacity-50"
                            : "bg-white dark:bg-[#1c2333] text-slate-700 dark:text-white/80 hover:bg-indigo-50/50 dark:hover:bg-[#252d40] cursor-pointer shadow-lg shadow-black/5"
                    )}
                    disabled={isDisabled}
                    type="button"
                >
                    <div className="flex flex-col items-start gap-0.5">
                        <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400 dark:text-white/30 leading-none">
                            {label}
                        </span>
                        <span className="truncate text-xs sm:text-sm font-semibold">
                            {displayText}
                        </span>
                    </div>
                    {locked ? (
                        <Lock className="w-3.5 h-3.5 text-amber-500 dark:text-amber-400/60 flex-shrink-0" />
                    ) : (
                        <ChevronDown className={cn(
                            "w-3.5 h-3.5 text-slate-400 dark:text-white/40 flex-shrink-0 transition-transform duration-200",
                            isOpen && "rotate-180"
                        )} />
                    )}
                </button>
            </PopoverTrigger>

            <PopoverContent 
                className="w-[var(--radix-popover-trigger-width)] border-none shadow-none p-0 bg-transparent overflow-visible z-50 pointer-events-auto outline-none"
                sideOffset={10}
                align="center"
            >
                <Command 
                    className="bg-transparent overflow-visible w-full outline-none"
                    onKeyDown={(e) => {
                        if (e.key === 'Escape') {
                            setIsOpen(false);
                            e.preventDefault();
                        }
                    }}
                >
                    <div className="flex flex-col gap-1.5 w-full">
                        {/* Search Bar Container */}
                        <div className="bg-white dark:bg-[#1a2333] rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.15)] border border-slate-200 dark:border-white/10 overflow-hidden [&_[cmdk-input-wrapper]]:border-b-0">
                            <CommandInput 
                                placeholder={`Search ${label}...`} 
                                className="h-14 text-base border-none ring-0 focus:ring-0 focus-visible:ring-0 outline-none focus:outline-none focus-visible:outline-none shadow-none w-full bg-transparent"
                                autoFocus
                            />
                        </div>

                        {/* Results Container */}
                        <div className="bg-white dark:bg-[#1a2333] rounded-2xl shadow-[0_30px_60px_-15px_rgba(0,0,0,0.3)] border border-slate-200 dark:border-white/10 overflow-hidden animate-in fade-in zoom-in-95 slide-in-from-top-2 duration-300">
                            <CommandList className="max-h-[300px] p-1.5 scrollbar-none overflow-x-hidden">
                                <CommandEmpty className="py-8 text-center text-muted-foreground font-medium text-sm">
                                    No {label.toLowerCase()} found.
                                </CommandEmpty>
                                
                                <CommandGroup heading={label} className="px-1">
                                    {options.map((opt) => {
                                        const isSelected = selected === opt.id;
                                        return (
                                            <CommandItem
                                                key={opt.id}
                                                value={opt.name}
                                                onSelect={() => {
                                                    onChange(opt.id);
                                                    setIsOpen(false);
                                                }}
                                                onPointerDown={(e) => {
                                                    e.preventDefault();
                                                    onChange(opt.id);
                                                    setIsOpen(false);
                                                }}
                                                className={cn(
                                                    "flex items-center justify-between gap-3 px-4 py-3 rounded-xl mb-1 cursor-pointer transition-all",
                                                    "aria-selected:bg-indigo-600 aria-selected:text-white group"
                                                )}
                                            >
                                                <div className="flex items-center gap-3">
                                                    {/* Circular selection indicator */}
                                                    <div className={cn(
                                                        "w-5 h-5 rounded-full border flex items-center justify-center transition-all",
                                                        isSelected 
                                                            ? "bg-white border-white text-indigo-600 dark:text-indigo-600" 
                                                            : "border-muted-foreground/30 group-aria-selected:border-white/40"
                                                    )}>
                                                        {isSelected && <Check className="w-3.5 h-3.5" strokeWidth={3} />}
                                                    </div>
                                                    <span className="font-semibold text-sm sm:text-base capitalize">
                                                        {opt.name}
                                                    </span>
                                                </div>
                                                <CommandShortcut className="group-aria-selected:text-white/60">↵</CommandShortcut>
                                            </CommandItem>
                                        );
                                    })}
                                </CommandGroup>
                            </CommandList>
                            
                            {/* Navigation Guides Footer */}
                            <div className="p-3 bg-indigo-50/50 dark:bg-muted/20 border-t border-indigo-500/5 dark:border-white/5 flex items-center justify-between text-[9px] font-black uppercase tracking-[0.2em] text-indigo-500/50 dark:text-muted-foreground/50">
                                <div className="flex items-center gap-4">
                                    <span className="flex items-center gap-1">
                                        <kbd className="px-1 py-0.5 rounded border border-indigo-500/10 dark:border-border/40 bg-white/80 dark:bg-background/50 text-indigo-500/70 dark:text-inherit font-sans">↑↓</kbd> NAV
                                    </span>
                                    <span className="flex items-center gap-1">
                                        <kbd className="px-1 py-0.5 rounded border border-indigo-500/10 dark:border-border/40 bg-white/80 dark:bg-background/50 text-indigo-500/70 dark:text-inherit font-sans">↵</kbd> SELECT
                                    </span>
                                </div>
                                <span className="flex items-center gap-1">
                                    <kbd className="px-1 py-0.5 rounded border border-indigo-500/10 dark:border-border/40 bg-white/80 dark:bg-background/50 text-indigo-500/70 dark:text-inherit font-sans">ESC</kbd> CLOSE
                                </span>
                            </div>
                        </div>
                    </div>
                </Command>
            </PopoverContent>
        </Popover>
    );
};
