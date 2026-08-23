import { formatMult, formatPct, formatMoney } from './utils';
import { PrecedentTransaction } from '@/core/types';
import { PrecedentStats } from './types';
import { GlassCard } from '@/components/ui/primitives/GlassCard';

interface PrecedentSummaryProps {
    stats: PrecedentStats;
    baseTransactions: PrecedentTransaction[];
}

export const PrecedentSummary = ({
    stats,
    baseTransactions,
}: PrecedentSummaryProps) => {
    return (
        <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <GlassCard 
                variant="regular" 
                hoverEffect 
                className="group relative border border-(--border-subtle) bg-linear-to-br from-(--bg-glass) to-transparent"
            >
                <div className="absolute top-0 right-0 p-4 opacity-10 transition-opacity group-hover:opacity-20">
                    <div className="h-12 w-12 rounded-full bg-blue-500 blur-2xl" />
                </div>
                <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-(--text-tertiary)">Median EV/Revenue</p>
                <p className="mt-3 text-[40px] font-black tracking-tighter tabular-nums text-(--text-primary)">
                    {formatMult(stats.medianEvRevenue)}
                </p>
                <div className="mt-4 h-1 w-8 rounded-full bg-blue-600/40" />
            </GlassCard>

            <GlassCard 
                variant="regular" 
                hoverEffect 
                className="group relative border border-(--border-subtle) bg-linear-to-br from-(--bg-glass) to-transparent"
            >
                <div className="absolute top-0 right-0 p-4 opacity-10 transition-opacity group-hover:opacity-20">
                    <div className="h-12 w-12 rounded-full bg-purple-500 blur-2xl" />
                </div>
                <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-(--text-tertiary)">Median EV/EBITDA</p>
                <p className="mt-3 text-[40px] font-black tracking-tighter tabular-nums text-(--text-primary)">
                    {formatMult(stats.medianEvEbitda)}
                </p>
                <div className="mt-4 h-1 w-8 rounded-full bg-purple-600/40" />
            </GlassCard>

            <GlassCard 
                variant="regular" 
                hoverEffect 
                className="group relative border border-(--border-subtle) bg-linear-to-br from-(--bg-glass) to-transparent"
            >
                <div className="absolute top-0 right-0 p-4 opacity-10 transition-opacity group-hover:opacity-20">
                    <div className="h-12 w-12 rounded-full bg-teal-500 blur-2xl" />
                </div>
                <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-(--text-tertiary)">Median Premium</p>
                <p className="mt-3 text-[40px] font-black tracking-tighter tabular-nums text-(--text-primary)">
                    {formatPct(stats.medianPremium)}
                </p>
                <div className="mt-4 h-1 w-8 rounded-full bg-teal-500/40" />
            </GlassCard>

            <GlassCard 
                variant="regular" 
                hoverEffect 
                className="group relative border border-(--border-subtle) bg-linear-to-br from-(--bg-glass) to-transparent"
            >
                <div className="absolute top-0 right-0 p-4 opacity-10 transition-opacity group-hover:opacity-20">
                    <div className="h-12 w-12 rounded-full bg-orange-500 blur-2xl" />
                </div>
                <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-(--text-tertiary)">Avg Deal Size</p>
                <p className="mt-3 text-[40px] font-black tracking-tighter tabular-nums text-(--text-primary)">
                    {stats.count > 0 ? formatMoney(baseTransactions.reduce((sum, t) => sum + t.transactionValue, 0) / stats.count) : 'N/A'}
                </p>
                <div className="mt-4 h-1 w-8 rounded-full bg-orange-500/40" />
            </GlassCard>
        </div>
    );
};
