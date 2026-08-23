"use client";

import { memo, useCallback, type ReactNode } from 'react';
import { cn } from '@/core/utils/cn';

interface EmptyStateProps {
    title: string;
    message: string;
    icon?: ReactNode;
    ctaLabel?: string;
    onCtaClick?: () => void;
    isDarkMode: boolean;
    /** Optional secondary info line beneath the message */
    secondaryMessage?: string;
}

export const EmptyState = memo(function EmptyState({
    title,
    message,
    icon,
    ctaLabel,
    onCtaClick,
    isDarkMode,
    secondaryMessage,
}: EmptyStateProps) {
    const handleCta = useCallback(() => {
        onCtaClick?.();
    }, [onCtaClick]);

    return (
        <div className="flex flex-col items-center justify-center py-16 px-8 text-center">
            {/* Illustration circle */}
            <div
                className={cn(
                    'relative mb-6 flex h-20 w-20 items-center justify-center rounded-full',
                    isDarkMode
                        ? 'bg-gradient-to-br from-white/[0.06] to-white/[0.02] ring-1 ring-white/[0.08]'
                        : 'bg-gradient-to-br from-slate-50 to-slate-100 ring-1 ring-slate-200/60',
                )}
            >
                {/* Decorative concentric rings */}
                <div
                    className={cn(
                        'absolute inset-[-12px] rounded-full',
                        isDarkMode
                            ? 'ring-1 ring-white/[0.04]'
                            : 'ring-1 ring-slate-200/30',
                    )}
                />
                <div
                    className={cn(
                        'absolute inset-[-24px] rounded-full',
                        isDarkMode
                            ? 'ring-1 ring-white/[0.02]'
                            : 'ring-1 ring-slate-200/15',
                    )}
                />
                {/* Icon */}
                <div className={cn(
                    'transition-colors duration-200',
                    isDarkMode ? 'text-white/30' : 'text-slate-400',
                )}>
                    {icon}
                </div>
            </div>

            {/* Title */}
            <h3
                className={cn(
                    'mb-2 text-[15px] font-bold tracking-tight',
                    isDarkMode ? 'text-white/88' : 'text-slate-800',
                )}
            >
                {title}
            </h3>

            {/* Message */}
            <p
                className={cn(
                    'max-w-sm text-[13px] leading-relaxed',
                    isDarkMode ? 'text-white/42' : 'text-slate-500',
                )}
            >
                {message}
            </p>

            {/* Secondary message */}
            {secondaryMessage && (
                <p
                    className={cn(
                        'mt-1.5 max-w-sm text-[11px] leading-relaxed',
                        isDarkMode ? 'text-white/28' : 'text-slate-400',
                    )}
                >
                    {secondaryMessage}
                </p>
            )}

            {/* CTA Button */}
            {ctaLabel && onCtaClick && (
                <button
                    onClick={handleCta}
                    className={cn(
                        'mt-6 inline-flex items-center gap-2 rounded-xl px-5 py-2.5',
                        'text-[13px] font-semibold tracking-tight',
                        'transition-all duration-200',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
                        isDarkMode
                            ? 'bg-white/8 text-white/85 ring-1 ring-white/10 hover:bg-white/12 hover:text-white focus-visible:ring-white/20 focus-visible:ring-offset-[rgba(7,8,12,0.78)]'
                            : 'bg-slate-900/5 text-slate-700 ring-1 ring-slate-200/60 hover:bg-slate-900/8 hover:text-slate-900 focus-visible:ring-slate-400 focus-visible:ring-offset-white',
                    )}
                >
                    {ctaLabel}
                </button>
            )}
        </div>
    );
});
