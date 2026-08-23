import { PrecedentTransaction } from '@/core/types';
import { cn } from '@/core/utils/cn';
import { Trash2, TrendingUp, Info } from 'lucide-react';
import { motion } from 'framer-motion';
import { formatDate, formatMoney, formatMult, formatPct } from './utils';

interface PrecedentTableProps {
    transactions: PrecedentTransaction[];
    onToggle: (id: string) => void;
    onDelete: (id: string) => void;
}

export const PrecedentTable = ({
    transactions,
    onToggle,
    onDelete,
}: PrecedentTableProps) => {
    return (
        <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
                <thead>
                    <tr className="border-b border-(--border-subtle)">
                        <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-wider text-(--text-tertiary)">Selection</th>
                        <th className="px-4 py-4 text-[10px] font-bold uppercase tracking-wider text-(--text-tertiary)">Date</th>
                        <th className="px-4 py-4 text-[10px] font-bold uppercase tracking-wider text-(--text-tertiary)">Target / Acquirer</th>
                        <th className="px-4 py-4 text-right text-[10px] font-bold uppercase tracking-wider text-(--text-tertiary)">Value ($)</th>
                        <th className="px-4 py-4 text-right text-[10px] font-bold uppercase tracking-wider text-(--text-tertiary)">EV/Rev</th>
                        <th className="px-4 py-4 text-right text-[10px] font-bold uppercase tracking-wider text-(--text-tertiary)">EV/EBITDA</th>
                        <th className="px-4 py-4 text-right text-[10px] font-bold uppercase tracking-wider text-(--text-tertiary)">Premium</th>
                        <th className="px-4 py-4 text-right text-[10px] font-bold uppercase tracking-wider text-(--text-tertiary)">Actions</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-(--border-subtle)">
                    {transactions.map((txn, idx) => (
                        <motion.tr
                            key={txn.id}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: idx * 0.05 }}
                            className={cn(
                                "group transition-colors",
                                !txn.isSelected && "opacity-45 grayscale-[0.5]",
                                "hover:bg-(--bg-glass-hover)"
                            )}
                        >
                            <td className="px-6 py-4">
                                <button
                                    onClick={() => onToggle(txn.id)}
                                    className={cn(
                                        "flex h-5 w-5 items-center justify-center rounded-md border transition-all duration-200",
                                        txn.isSelected
                                            ? "border-blue-500 bg-blue-500 text-white shadow-[0_0_12px_rgba(37,99,235,0.4)]"
                                            : "border-(--border-subtle) bg-(--bg-card)"
                                    )}
                                >
                                    {txn.isSelected && <TrendingUp size={12} strokeWidth={3} />}
                                </button>
                            </td>
                            <td className="px-4 py-4">
                                <span className="text-[12px] font-medium text-(--text-secondary)">
                                    {formatDate(txn.announcementDate)}
                                </span>
                            </td>
                            <td className="px-4 py-4">
                                <div>
                                    <p className="text-[13px] font-bold text-(--text-primary)">{txn.targetName}</p>
                                    <p className="text-[11px] font-medium text-(--text-tertiary)">{txn.acquirerName}</p>
                                </div>
                            </td>
                            <td className="px-4 py-4 text-right">
                                <span className="text-[13px] font-bold tabular-nums text-(--text-primary)">
                                    {formatMoney(txn.transactionValue)}
                                </span>
                            </td>
                            <td className="px-4 py-4 text-right">
                                <span className="text-[13px] font-bold tabular-nums text-(--text-primary)">
                                    {formatMult(txn.evRevenue)}
                                </span>
                            </td>
                            <td className="px-4 py-4 text-right">
                                <span className={cn(
                                    "text-[13px] font-bold tabular-nums",
                                    txn.evEbitda > 0 ? "text-(--text-primary)" : "text-(--text-muted)"
                                )}>
                                    {formatMult(txn.evEbitda)}
                                </span>
                            </td>
                            <td className="px-4 py-4 text-right">
                                <span className="text-[13px] font-bold tabular-nums text-blue-600 dark:text-blue-400">
                                    {formatPct(txn.premiumPaid)}
                                </span>
                            </td>
                            <td className="px-4 py-4 text-right">
                                <div className="flex items-center justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                                    <button className="rounded-md p-1.5 text-(--text-tertiary) transition-colors hover:bg-(--bg-glass-hover) hover:text-(--text-secondary)">
                                        <Info size={14} />
                                    </button>
                                    <button
                                        onClick={() => onDelete(txn.id)}
                                        className="rounded-md p-1.5 text-rose-500/60 transition-colors hover:bg-rose-500/10 hover:text-rose-500"
                                    >
                                        <Trash2 size={14} />
                                    </button>
                                </div>
                            </td>
                        </motion.tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
};
