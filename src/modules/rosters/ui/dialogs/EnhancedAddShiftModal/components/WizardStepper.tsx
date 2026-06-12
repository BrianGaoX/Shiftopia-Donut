/**
 * WizardStepper — 3-step progress rail for the shift drawer.
 *
 *   1 · Schedule & Details   2 · Assignment   3 · Compliance & Notes
 *
 * A completed or past step is clickable (jump back); future steps are locked
 * until the current one is valid (gating handled by the parent). The filled
 * rail + the active node animate on step change.
 */

import React from 'react';
import { cn } from '@/modules/core/lib/utils';
import { Check, CalendarClock, UserCircle, ShieldCheck } from 'lucide-react';

export interface WizardStep {
    id: number;
    name: string;
    icon: React.ReactNode;
}

export const DRAWER_STEPS: WizardStep[] = [
    { id: 1, name: 'Schedule', icon: <CalendarClock className="h-3.5 w-3.5" aria-hidden /> },
    { id: 2, name: 'Assignment', icon: <UserCircle className="h-3.5 w-3.5" aria-hidden /> },
    { id: 3, name: 'Compliance', icon: <ShieldCheck className="h-3.5 w-3.5" aria-hidden /> },
];

interface WizardStepperProps {
    currentStep: number;
    completedSteps: Set<number>;
    onStepClick?: (step: number) => void;
    disabled?: boolean;
}

export const WizardStepper: React.FC<WizardStepperProps> = ({
    currentStep,
    completedSteps,
    onStepClick,
    disabled = false,
}) => {
    const total = DRAWER_STEPS.length;

    return (
        <nav aria-label="Shift form steps" className="w-full px-5 py-3.5">
            <ol className="flex items-center justify-between relative list-none p-0 m-0">
                {/* Background rail */}
                <div className="absolute top-[14px] left-3 right-3 h-0.5 bg-border" aria-hidden />
                {/* Filled rail */}
                <div
                    className="absolute top-[14px] left-3 h-0.5 bg-gradient-to-r from-indigo-500 to-emerald-500 transition-[width] duration-500 ease-out"
                    style={{ width: `calc(${((currentStep - 1) / (total - 1)) * 100}% - ${((currentStep - 1) / (total - 1)) * 24}px)` }}
                    aria-hidden
                />

                {DRAWER_STEPS.map(step => {
                    const isCompleted = completedSteps.has(step.id);
                    const isCurrent = currentStep === step.id;
                    const isPast = step.id < currentStep;
                    const canClick = !disabled && (isPast || isCompleted) && !isCurrent;

                    return (
                        <li key={step.id} className="flex flex-col items-center relative z-10 gap-1.5">
                            <button
                                type="button"
                                onClick={() => canClick && onStepClick?.(step.id)}
                                disabled={!canClick}
                                aria-current={isCurrent ? 'step' : undefined}
                                aria-label={`Step ${step.id}: ${step.name}`}
                                className={cn(
                                    'h-7 w-7 rounded-full flex items-center justify-center border-2 transition-all duration-300',
                                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                                    isCurrent &&
                                        'bg-indigo-500 border-indigo-500 text-white scale-110 shadow-[0_0_18px_-2px_rgba(99,102,241,0.6)]',
                                    isCompleted && !isCurrent &&
                                        'bg-emerald-500/15 border-emerald-500 text-emerald-500',
                                    !isCurrent && !isCompleted &&
                                        'bg-muted border-border text-muted-foreground/40',
                                    canClick && 'hover:border-indigo-400 hover:text-indigo-400 cursor-pointer',
                                    !canClick && !isCurrent && 'cursor-default',
                                )}
                            >
                                {isCompleted && !isCurrent ? (
                                    <Check className="h-3.5 w-3.5 animate-in zoom-in duration-200" aria-hidden />
                                ) : (
                                    <span aria-hidden className="[&>svg]:h-3.5 [&>svg]:w-3.5">{step.icon}</span>
                                )}
                            </button>
                            <span
                                aria-hidden
                                className={cn(
                                    'text-[8px] font-black uppercase tracking-[0.16em] transition-colors duration-300',
                                    isCurrent && 'text-indigo-500 dark:text-indigo-400',
                                    isCompleted && !isCurrent && 'text-emerald-600/70 dark:text-emerald-400/70',
                                    !isCurrent && !isCompleted && 'text-muted-foreground/40',
                                )}
                            >
                                {step.name}
                            </span>
                        </li>
                    );
                })}
            </ol>
        </nav>
    );
};

export default WizardStepper;
