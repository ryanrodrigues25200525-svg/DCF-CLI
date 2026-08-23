"use client";

import { Fragment, memo, useMemo } from 'react';
import { cn } from '@/core/utils/cn';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import type { NativeStatementRow } from '@/core/types';

interface Props {
    rows: NativeStatementRow[];
    years: number[];
    foreYears?: number[];
    isDarkMode: boolean;
}

/* ------------------------------------------------------------------ */
/*  Bank-specific row concept matchers                                */
/* ------------------------------------------------------------------ */

interface BankRow {
    id: string;
    label: string;
    matchers: string[];
    section: 'net_interest' | 'provision' | 'non_interest' | 'other' | 'tax';
}

const BANK_ROW_DEFS: BankRow[] = [
    // Net Interest Income
    { id: 'interest_income', label: 'Interest Income', matchers: ['interestincome', 'interestearned', 'interestonloans', 'interestoninvestmentsecurities'], section: 'net_interest' },
    { id: 'interest_expense', label: 'Interest Expense', matchers: ['interestexpense', 'interestondeposits', 'interestonborrowings'], section: 'net_interest' },
    { id: 'net_interest_income', label: 'Net Interest Income', matchers: ['netinterestincome', 'netinterestrevenue', 'netinterestmargin'], section: 'net_interest' },
    // Provision for credit losses
    { id: 'provision_credit_losses', label: 'Provision for Credit Losses', matchers: ['provisionforcreditlosses', 'provisionforloanlosses', 'provisionforloanandlease', 'provisionforlosses'], section: 'provision' },
    // Non-interest income
    { id: 'non_interest_income', label: 'Non-Interest Income', matchers: ['noninterestincome', 'otheroperatingincome', 'feesandcommissionrevenue', 'trustfees', 'servicechargeondepositaccounts', 'wealthmanagement'], section: 'non_interest' },
    { id: 'net_interest_income_after_provision', label: 'Net Interest Income After Provision', matchers: ['netinterestincomeafterprovision', 'netrevenue'], section: 'non_interest' },
    // Non-interest expense
    { id: 'non_interest_expense', label: 'Non-Interest Expense', matchers: ['noninterestexpense', 'otheroperatingexpense', 'compensationexpense', 'personnelexpense', 'benefitsandequivalentexpensetocurrent'], section: 'non_interest' },
    // Operating income
    { id: 'operating_income', label: 'Operating Income', matchers: ['operatingincome', 'operatingincomeloss'], section: 'other' },
    // Gain/loss on securities
    { id: 'gain_on_securities', label: 'Gain on Sale of Securities', matchers: ['gainonlossofinvestments', 'gainslossesoninvestmentsecurities', 'realizedgainsoninvestmentsecurities'], section: 'other' },
    // Pre-tax & tax
    { id: 'pretax_income', label: 'Pre-Tax Income', matchers: ['pretaxincome', 'incomebeforetax', 'incomefromcontinuingoperationsbeforeincometaxes'], section: 'tax' },
    { id: 'tax_expense', label: 'Tax Expense', matchers: ['incometaxexpense', 'taxexpense', 'incometaxexpensebenefit'], section: 'tax' },
    // Net income
    { id: 'net_income', label: 'Net Income', matchers: ['netincome', 'profitloss', 'netincomeloss', 'netincomeattributabletoparent'], section: 'tax' },
];

const SECTION_ORDER: Array<{ id: string; title: string; ids: string[] }> = [
    { id: 'net_interest', title: 'Net Interest', ids: ['interest_income', 'interest_expense', 'net_interest_income'] },
    { id: 'provision', title: 'Provision for Credit Losses', ids: ['provision_credit_losses'] },
    { id: 'non_interest', title: 'Non-Interest Income & Expense', ids: ['non_interest_income', 'net_interest_income_after_provision', 'non_interest_expense'] },
    { id: 'other', title: 'Other Items', ids: ['operating_income', 'gain_on_securities'] },
    { id: 'tax', title: 'Net Income', ids: ['pretax_income', 'tax_expense', 'net_income'] },
];

const SUBTOTAL_IDS = new Set(['net_interest_income', 'net_interest_income_after_provision', 'operating_income', 'pretax_income', 'net_income']);

const YEAR_IN_KEY_RE = /(?:19|20)\d{2}/;

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function normalizeToken(value?: string | null): string {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function getRowSearchText(row: NativeStatementRow): string {
    return [row.standard_concept, row.concept, row.label]
        .map((v) => normalizeToken(v))
        .join(' ');
}

function matchBankRow(row: NativeStatementRow, definition: BankRow): boolean {
    const search = getRowSearchText(row);
    return definition.matchers.some(
        (m) => normalizeToken(row.standard_concept) === m || search.includes(m),
    );
}

function getNativeRowValue(row: NativeStatementRow, year: number): number | null {
    let selected: number | null = null;
    let selectedKey = '';
    for (const key of Object.keys(row)) {
        const match = key.match(YEAR_IN_KEY_RE);
        if (!match || Number(match[0]) !== year) continue;
        if (key > selectedKey) {
            const parsed = Number(row[key]);
            selected = Number.isFinite(parsed) ? parsed : null;
            selectedKey = key;
        }
    }
    return selected;
}

function getNativeLabel(row: NativeStatementRow, fallback = 'Line Item'): string {
    return String(row.label || row.standard_concept || row.concept || fallback).replace(/\s+/g, ' ').trim();
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                    */
/* ------------------------------------------------------------------ */

function BankCell({
    value,
    isDarkMode,
    isSubtotal,
    isForecast,
}: {
    value: number | null;
    isDarkMode: boolean;
    isSubtotal: boolean;
    isForecast: boolean;
}) {
    if (value === null) {
        return (
            <td className={cn(
                'px-4 py-3 text-right font-mono text-[13px]',
                isDarkMode ? 'text-white/20' : 'text-slate-300',
            )}>
                —
            </td>
        );
    }

    const num = value / 1_000_000;
    const formatted = Math.abs(num).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    const text = num < 0 ? `(${formatted})` : formatted;

    return (
        <td className={cn(
            'px-4 py-3 text-right font-mono text-[13px]',
            isSubtotal && (isDarkMode ? 'text-white/95 font-bold' : 'text-slate-900 font-bold'),
            !isSubtotal && (isDarkMode ? 'text-white/70' : 'text-slate-600'),
            isForecast && (isDarkMode ? 'bg-white/[0.02]' : 'bg-slate-50/50'),
        )}>
            {text}
        </td>
    );
}

/* ------------------------------------------------------------------ */
/*  Main component                                                    */
/* ------------------------------------------------------------------ */

export const BankStatementView = memo(function BankStatementView({
    rows,
    years,
    foreYears = [],
    isDarkMode,
}: Props) {
    const matchedRows = useMemo(() => {
        const result: Array<{ definition: BankRow; row: NativeStatementRow }> = [];
        const usedRows = new Set<number>();

        for (const definition of BANK_ROW_DEFS) {
            let bestRow: NativeStatementRow | null = null;
            let bestIdx = -1;
            let bestScore = -1;

            rows.forEach((row, idx) => {
                if (usedRows.has(idx)) return;
                if (!matchBankRow(row, definition)) return;

                // Score by total non-null values across all years
                let score = 0;
                for (const y of years) {
                    if (getNativeRowValue(row, y) !== null) score += 10;
                }
                if (normalizeToken(row.standard_concept) === definition.matchers[0]) score += 100;
                if (score > bestScore) {
                    bestRow = row;
                    bestIdx = idx;
                    bestScore = score;
                }
            });

            if (bestRow) {
                usedRows.add(bestIdx);
                result.push({ definition, row: bestRow });
            }
        }

        return result;
    }, [rows, years]);

    const rowMap = useMemo(() => {
        const map = new Map<string, NativeStatementRow>();
        for (const { definition, row } of matchedRows) {
            map.set(definition.id, row);
        }
        return map;
    }, [matchedRows]);

    const colCount = years.length + 1; // label col + year cols
    const matchedIds = new Set(matchedRows.map((m) => m.definition.id));

    if (matchedRows.length === 0) {
        return null; // fall back to standard view
    }

    return (
        <>
            {SECTION_ORDER.map((section) => {
                const visibleIds = section.ids.filter((id) => matchedIds.has(id));
                if (visibleIds.length === 0) return null;

                return (
                    <Fragment key={section.id}>
                        <tr>
                            <td
                                colSpan={colCount}
                                className={cn(
                                    'px-6 py-2.5 text-[10px] font-black uppercase tracking-[0.18em]',
                                    isDarkMode ? 'text-white/35' : 'text-slate-400',
                                )}
                            >
                                {section.title}
                            </td>
                        </tr>
                        {visibleIds.map((id) => {
                            const row = rowMap.get(id)!;
                            const def = BANK_ROW_DEFS.find((d) => d.id === id)!;
                            const isSubtotal = SUBTOTAL_IDS.has(id);

                            return (
                                <tr
                                    key={id}
                                    className={cn(
                                        isSubtotal && (isDarkMode ? 'border-t border-white/8' : 'border-t border-slate-200/80'),
                                    )}
                                >
                                    <td
                                        className={cn(
                                            'sticky left-0 z-30 px-6 py-3 text-[13px] whitespace-nowrap border-r border-(--border-subtle)',
                                            isDarkMode
                                                ? 'bg-[rgba(7,8,12,0.95)] text-white/72'
                                                : 'bg-white text-slate-600',
                                            isSubtotal && (isDarkMode ? 'font-bold text-white/90' : 'font-bold text-slate-900'),
                                        )}
                                    >
                                        <div className="flex items-center gap-2">
                                            <span>{getNativeLabel(row, def.label)}</span>
                                            {isSubtotal && (
                                                <span className={cn(
                                                    'inline-flex h-4 w-4 items-center justify-center rounded-full',
                                                    isDarkMode ? 'bg-white/5' : 'bg-slate-100',
                                                )}>
                                                    <CheckCircle2 size={10} className={isDarkMode ? 'text-emerald-400/60' : 'text-emerald-500'} />
                                                </span>
                                            )}
                                        </div>
                                    </td>
                                    {years.map((year) => (
                                        <BankCell
                                            key={year}
                                            value={getNativeRowValue(row, year)}
                                            isDarkMode={isDarkMode}
                                            isSubtotal={isSubtotal}
                                            isForecast={foreYears.includes(year)}
                                        />
                                    ))}
                                </tr>
                            );
                        })}
                    </Fragment>
                );
            })}

            {/* Bank-specific notice */}
            <tr>
                <td colSpan={colCount}>
                    <div className={cn(
                        'flex items-center gap-2.5 px-6 py-3 text-[11px] border-t',
                        isDarkMode
                            ? 'text-white/25 border-white/5 bg-white/[0.01]'
                            : 'text-slate-400 border-slate-100 bg-slate-50/30',
                    )}>
                        <AlertTriangle size={12} />
                        <span>
                            Financial institution view — standard COGS / Gross Profit metrics are not applicable.
                        </span>
                    </div>
                </td>
            </tr>
        </>
    );
});
