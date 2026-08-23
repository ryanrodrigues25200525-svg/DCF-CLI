import React from 'react';
import { Plus, Database, Info } from 'lucide-react';
import { cn } from '@/core/utils/cn';
import { AnimatePresence } from 'framer-motion';

import { usePrecedentEngine } from './precedent/usePrecedentEngine';
import { PrecedentSummary } from './precedent/PrecedentSummary';
import { PrecedentForm } from './precedent/PrecedentForm';
import { PrecedentTable } from './precedent/PrecedentTable';
import { PrecedentImpact } from './precedent/PrecedentImpact';
import { PrecedentTransactionsProps } from './precedent/types';

const PrecedentTransactions: React.FC<PrecedentTransactionsProps> = ({
    targetSector = 'Technology',
    targetRevenue,
    targetEbitda,
    transactions,
    onDataChange,
}) => {
    const {
        baseTransactions,
        isAdding,
        setIsAdding,
        normalizedSector,
        stats,
        toggleTransaction,
        deleteTransaction,
        addTransaction,
    } = usePrecedentEngine(transactions, onDataChange, targetSector);

    return (
        <div className={cn(
            "w-full rounded-2xl border border-(--border-subtle) bg-(--bg-card) shadow-2xl overflow-hidden",
            "precedent-theme-scope"
        )}>
            {/* Header */}
            <div className="flex items-center justify-between border-b border-(--border-subtle) px-8 py-6">
                <div className="flex items-center gap-4">
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-500/10 text-blue-500">
                        <Database size={24} />
                    </div>
                    <div>
                        <h2 className="text-xl font-black tracking-tight text-(--text-primary)">Precedent Transactions</h2>
                        <div className="flex items-center gap-2">
                            <span className="text-[11px] font-bold uppercase tracking-wider text-(--text-tertiary)">{normalizedSector}</span>
                            <span className="h-1 w-1 rounded-full bg-(--border-subtle)"></span>
                            <span className="text-[11px] font-bold uppercase tracking-wider text-blue-500">{stats.count} Analyzed Deals</span>
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    <div className="hidden items-center gap-1.5 rounded-lg border border-(--border-subtle) px-3 py-2 text-(--text-tertiary) lg:flex">
                        <Info size={14} />
                        <span className="text-[11px] font-bold uppercase tracking-wider">Median premium analysis</span>
                    </div>
                    <button
                        onClick={() => setIsAdding(!isAdding)}
                        className={cn(
                            "flex items-center gap-2 rounded-lg px-4 py-2 text-[12px] font-bold uppercase tracking-wider transition-all",
                            isAdding
                                ? "bg-rose-500/10 text-rose-500 border border-rose-500/20 hover:bg-rose-500/20"
                                : "bg-blue-600 text-white shadow-[0_8px_20px_-4px_rgba(37,99,235,0.4)] hover:shadow-[0_12px_24px_-4px_rgba(37,99,235,0.5)] hover:-translate-y-0.5 active:translate-y-0"
                        )}
                    >
                        <Plus size={16} strokeWidth={3} className={cn("transition-transform duration-300", isAdding && "rotate-45")} />
                        {isAdding ? 'Cancel Entry' : 'Add Transaction'}
                    </button>
                </div>
            </div>

            <div className="p-8">
                {/* Stats Summary */}
                <PrecedentSummary
                    stats={stats}
                    baseTransactions={baseTransactions}
                />

                {/* Add Transaction Form */}
                <AnimatePresence>
                    {isAdding && (
                        <PrecedentForm
                            onAdd={addTransaction}
                            onCancel={() => setIsAdding(false)}
                            normalizedSector={normalizedSector}
                        />
                    )}
                </AnimatePresence>

                {/* Impact Analysis */}
                <PrecedentImpact
                    targetRevenue={targetRevenue}
                    targetEbitda={targetEbitda}
                    stats={stats}
                />

                {/* Transactions Table */}
                <PrecedentTable
                    transactions={baseTransactions}
                    onToggle={toggleTransaction}
                    onDelete={deleteTransaction}
                />
            </div>
        </div>
    );
};

export { PrecedentTransactions };
export default PrecedentTransactions;
