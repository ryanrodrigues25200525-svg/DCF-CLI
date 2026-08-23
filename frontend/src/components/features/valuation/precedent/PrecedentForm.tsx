import { useState, useMemo, useRef, useEffect } from 'react';
import { PrecedentTransaction } from '@/core/types';
import { Briefcase, DollarSign, Building2, Calendar, Activity, ChevronDown, ChevronLeft, ChevronRight, Calculator, Percent } from 'lucide-react';
import { cn } from '@/core/utils/cn';
import { AnimatePresence, motion } from 'framer-motion';
import { formatInputNumberWithCommas, parseIsoDate, toIsoDate } from './utils';

interface PrecedentFormProps {
    onAdd: (txn: PrecedentTransaction) => void;
    onCancel: () => void;
    normalizedSector: string;
}

export const PrecedentForm = ({
    onAdd,
    onCancel,
    normalizedSector,
}: PrecedentFormProps) => {
    const [newTxn, setNewTxn] = useState<Partial<PrecedentTransaction>>({
        targetName: '',
        acquirerName: '',
        announcementDate: new Date().toISOString().split('T')[0],
        transactionValue: 0,
        evRevenue: 0,
        evEbitda: 0,
        premiumPaid: 0,
        dealType: 'Strategic',
        paymentType: 'Cash',
        isSelected: true
    });

    const [openMenu, setOpenMenu] = useState<null | 'dealType' | 'paymentType'>(null);
    const [isDateOpen, setIsDateOpen] = useState(false);
    const [calendarPickerOpen, setCalendarPickerOpen] = useState<null | 'month' | 'year'>(null);
    const [calendarMonth, setCalendarMonth] = useState(() => {
        const now = new Date();
        return new Date(now.getFullYear(), now.getMonth(), 1);
    });
    const formPopoverRef = useRef<HTMLDivElement | null>(null);

    const dropdownMotion = {
        initial: { opacity: 0, y: -8, scale: 0.98 },
        animate: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.2, ease: 'easeOut' as const } },
        exit: { opacity: 0, y: -6, scale: 0.98, transition: { duration: 0.14, ease: 'easeIn' as const } },
    };

    const isTxnInputValid = useMemo(() => {
        const target = (newTxn.targetName || '').trim();
        const acquirer = (newTxn.acquirerName || '').trim();
        const dateOk = Boolean(newTxn.announcementDate);
        const value = Number(newTxn.transactionValue || 0);
        const evRev = Number(newTxn.evRevenue || 0);
        const evEbitda = Number(newTxn.evEbitda || 0);
        const premium = Number(newTxn.premiumPaid || 0);
        const premiumOk = premium >= 0 && premium <= 1;
        const multiplesOk = evRev > 0 || evEbitda > 0;
        return target.length > 0 && acquirer.length > 0 && dateOk && value > 0 && premiumOk && multiplesOk;
    }, [newTxn]);

    const handleCommit = () => {
        if (!isTxnInputValid) return;
        const transaction: PrecedentTransaction = {
            id: `txn-user-${Date.now()}`,
            targetName: (newTxn.targetName || 'New Target').trim(),
            acquirerName: (newTxn.acquirerName || 'New Acquirer').trim(),
            announcementDate: newTxn.announcementDate || new Date().toISOString().split('T')[0],
            closingDate: '',
            transactionValue: Math.max(0, Number(newTxn.transactionValue) || 0),
            equityValue: Math.max(0, Number(newTxn.equityValue) || Number(newTxn.transactionValue) || 0),
            targetRevenue: Number(newTxn.targetRevenue) || 0,
            targetEbitda: Number(newTxn.targetEbitda) || 0,
            evRevenue: Math.max(0, Number(newTxn.evRevenue) || 0),
            evEbitda: Math.max(0, Number(newTxn.evEbitda) || 0),
            premiumPaid: Math.max(0, Math.min(1, Number(newTxn.premiumPaid) || 0)),
            dealType: (newTxn.dealType as PrecedentTransaction['dealType']) || 'Strategic',
            paymentType: (newTxn.paymentType as PrecedentTransaction['paymentType']) || 'Cash',
            isSelected: true,
            sector: normalizedSector
        };
        onAdd(transaction);
    };

    useEffect(() => {
        const handleOutside = (event: MouseEvent) => {
            if (!formPopoverRef.current) return;
            if (!formPopoverRef.current.contains(event.target as Node)) {
                setOpenMenu(null);
                setIsDateOpen(false);
                setCalendarPickerOpen(null);
            }
        };
        document.addEventListener('mousedown', handleOutside);
        return () => document.removeEventListener('mousedown', handleOutside);
    }, []);

    const selectedDate = useMemo(() => parseIsoDate(newTxn.announcementDate), [newTxn.announcementDate]);
    const today = useMemo(() => {
        const now = new Date();
        return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    }, []);

    const calendarDays = useMemo(() => {
        const monthStart = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1);
        const startOffset = (monthStart.getDay() + 6) % 7; 
        const gridStart = new Date(monthStart);
        gridStart.setDate(monthStart.getDate() - startOffset);
        return Array.from({ length: 42 }, (_, idx) => {
            const date = new Date(gridStart);
            date.setDate(gridStart.getDate() + idx);
            return {
                key: toIsoDate(date),
                date,
                inMonth: date.getMonth() === calendarMonth.getMonth(),
            };
        });
    }, [calendarMonth]);

    const formControlClass = cn(
        "w-full rounded-lg border py-2.5 pl-10 pr-3 text-[13px] font-semibold outline-none transition-all focus:border-blue-400/50 focus:ring-1 focus:ring-blue-500/30",
        "border-(--border-subtle) bg-(--bg-card) text-(--text-primary)"
    );

    return (
        <div className="precedent-add-form border-b border-(--border-subtle) bg-blue-500/[0.03] dark:bg-blue-400/[0.03] px-6 py-6">
            <div ref={formPopoverRef} className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                {[
                    { label: 'Target Company', icon: Building2, value: newTxn.targetName, key: 'targetName', placeholder: 'Activision Blizzard' },
                    { label: 'Acquirer', icon: Briefcase, value: newTxn.acquirerName, key: 'acquirerName', placeholder: 'Microsoft' },
                    { label: 'Value ($)', icon: DollarSign, value: newTxn.transactionValue, key: 'transactionValue', type: 'number', placeholder: '68,700,000,000' },
                    { label: 'EV / Revenue', icon: Activity, value: newTxn.evRevenue, key: 'evRevenue', type: 'number', step: '0.1' },
                    { label: 'EV / EBITDA', icon: Calculator, value: newTxn.evEbitda, key: 'evEbitda', type: 'number', step: '0.1' },
                    { label: 'Premium (0-1)', icon: Percent, value: newTxn.premiumPaid, key: 'premiumPaid', type: 'number', step: '0.01' }
                ].map((field) => (
                    <div key={field.key} className="space-y-1.5">
                        <label className="ml-1 text-[10px] font-bold uppercase tracking-wider text-(--text-tertiary)">
                            {field.label}
                        </label>
                        <div className="relative">
                            <field.icon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-(--text-muted)" />
                            <input
                                type={field.key === 'transactionValue' ? 'text' : (field.type || 'text')}
                                step={field.step}
                                value={field.key === 'transactionValue' ? formatInputNumberWithCommas(field.value) : (field.value || '')}
                                onChange={(e) => {
                                    if (field.key === 'transactionValue') {
                                        const sanitized = e.target.value.replace(/,/g, '').replace(/[^\d.]/g, '');
                                        const parsed = sanitized === '' ? 0 : Number(sanitized);
                                        setNewTxn({ ...newTxn, [field.key]: Number.isFinite(parsed) ? parsed : 0 });
                                        return;
                                    }
                                    setNewTxn({ ...newTxn, [field.key]: field.type === 'number' ? Number(e.target.value) : e.target.value });
                                }}
                                min={field.type === 'number' ? 0 : undefined}
                                className={formControlClass}
                                placeholder={field.placeholder}
                            />
                        </div>
                    </div>
                ))}

                <div className="space-y-1.5">
                    <label className="ml-1 text-[10px] font-bold uppercase tracking-wider text-(--text-tertiary)">Date</label>
                    <div className="relative">
                        <button
                            type="button"
                            onClick={() => {
                                const base = selectedDate || today;
                                setCalendarMonth(new Date(base.getFullYear(), base.getMonth(), 1));
                                setIsDateOpen((prev) => !prev);
                                setCalendarPickerOpen(null);
                            }}
                            className={cn(
                                "flex w-full items-center justify-between rounded-lg border border-(--border-subtle) bg-(--bg-card) py-2.5 pl-10 pr-3 text-[13px] font-semibold outline-none transition-all focus-visible:border-blue-400/50 focus-visible:ring-1 focus-visible:ring-blue-500/30 text-(--text-primary)"
                            )}
                        >
                            <Calendar size={16} className="absolute left-3 text-(--text-muted)" />
                            <span>{selectedDate ? selectedDate.toLocaleDateString('en-US') : 'Select date'}</span>
                            <ChevronDown size={14} className={cn("transition-transform duration-300 ease-out text-(--text-muted)", isDateOpen && "rotate-180")} />
                        </button>
                        <AnimatePresence>
                            {isDateOpen && (
                                <motion.div
                                    initial={dropdownMotion.initial}
                                    animate={dropdownMotion.animate}
                                    exit={dropdownMotion.exit}
                                    className="relative z-40 mt-2 w-full min-w-0 rounded-xl border border-(--border-subtle) bg-(--bg-card) p-3 shadow-2xl md:min-w-[300px] md:w-[320px]"
                                >
                                    <div className="mb-3 flex items-center justify-between">
                                        <button type="button" onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1))} className="rounded-md p-1.5 text-(--text-secondary) hover:bg-(--bg-glass-hover)"><ChevronLeft size={16} /></button>
                                        <div className="relative flex items-center gap-2">
                                            <button type="button" onClick={() => setCalendarPickerOpen((prev) => (prev === 'month' ? null : 'month'))} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[13px] font-bold text-(--text-primary) hover:bg-(--bg-glass-hover)">{calendarMonth.toLocaleDateString('en-US', { month: 'long' })} <ChevronDown size={13} /></button>
                                            <button type="button" onClick={() => setCalendarPickerOpen((prev) => (prev === 'year' ? null : 'year'))} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[13px] font-bold text-(--text-primary) hover:bg-(--bg-glass-hover)">{calendarMonth.getFullYear()} <ChevronDown size={13} /></button>
                                            {calendarPickerOpen === 'month' && (
                                                <div className="absolute left-0 top-full z-50 mt-1 grid w-[180px] grid-cols-2 gap-1 rounded-lg border border-(--border-subtle) bg-(--bg-card) p-2 shadow-xl">
                                                    {Array.from({ length: 12 }, (_, monthIdx) => (
                                                        <button key={monthIdx} type="button" onClick={() => { setCalendarMonth(new Date(calendarMonth.getFullYear(), monthIdx, 1)); setCalendarPickerOpen(null); }} className={cn("rounded px-2 py-1 text-left text-[12px] font-medium", monthIdx === calendarMonth.getMonth() ? "bg-blue-600 text-white" : "text-(--text-secondary) hover:bg-(--bg-glass-hover)")}>{new Date(2000, monthIdx, 1).toLocaleDateString('en-US', { month: 'short' })}</button>
                                                    ))}
                                                </div>
                                            )}
                                            {calendarPickerOpen === 'year' && (
                                                <div className="absolute right-0 top-full z-50 mt-1 max-h-52 w-[120px] overflow-auto rounded-lg border border-(--border-subtle) bg-(--bg-card) p-2 shadow-xl custom-scrollbar">
                                                    {Array.from({ length: 41 }, (_, idx) => calendarMonth.getFullYear() - 20 + idx).map((year) => (
                                                        <button key={year} type="button" onClick={() => { setCalendarMonth(new Date(year, calendarMonth.getMonth(), 1)); setCalendarPickerOpen(null); }} className={cn("block w-full rounded px-2 py-1 text-left text-[12px] font-medium", year === calendarMonth.getFullYear() ? "bg-blue-600 text-white" : "text-(--text-secondary) hover:bg-(--bg-glass-hover)")}>{year}</button>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                        <button type="button" onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1))} className="rounded-md p-1.5 text-(--text-secondary) hover:bg-(--bg-glass-hover)"><ChevronRight size={16} /></button>
                                    </div>
                                    <div className="mb-2 grid grid-cols-7 gap-1">
                                        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((day, idx) => (
                                            <div key={idx} className="text-center text-[10px] font-bold text-(--text-muted)">{day}</div>
                                        ))}
                                    </div>
                                    <div className="grid grid-cols-7 gap-1">
                                        {calendarDays.map(({ key, date, inMonth }) => {
                                            const isSelected = selectedDate ? toIsoDate(selectedDate) === key : false;
                                            const isToday = toIsoDate(today) === key;
                                            return (
                                                <button key={key} type="button" onClick={() => { setNewTxn({ ...newTxn, announcementDate: key }); setIsDateOpen(false); }} className={cn("h-8 rounded-md text-[12px] font-semibold transition-colors", isSelected ? "bg-blue-600 text-white" : inMonth ? "text-(--text-primary) hover:bg-(--bg-glass-hover)" : "text-(--text-muted) hover:bg-(--bg-glass-hover)", !isSelected && isToday && "ring-1 ring-blue-500/50")}>{date.getDate()}</button>
                                            );
                                        })}
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                </div>

                <div className="space-y-1.5">
                    <label className="ml-1 text-[10px] font-bold uppercase tracking-wider text-(--text-tertiary)">Deal Type</label>
                    <div className="relative">
                        <button type="button" onClick={() => setOpenMenu((prev) => (prev === 'dealType' ? null : 'dealType'))} className="flex w-full items-center justify-between rounded-lg border border-(--border-subtle) bg-(--bg-card) px-3 py-2.5 text-[13px] font-semibold outline-none transition-all text-(--text-primary)"><span>{newTxn.dealType}</span><ChevronDown size={14} className={cn("text-(--text-muted) transition-transform duration-200", openMenu === 'dealType' && "rotate-180")} /></button>
                        <AnimatePresence>{openMenu === 'dealType' && (<motion.div initial={dropdownMotion.initial} animate={dropdownMotion.animate} exit={dropdownMotion.exit} className="absolute z-30 mt-1 w-full rounded-lg border border-(--border-subtle) bg-(--bg-card) shadow-lg overflow-hidden">{(['Strategic', 'Financial', 'Merger', 'Takeover'] as const).map(option => (<button key={option} type="button" onClick={() => { setNewTxn({ ...newTxn, dealType: option }); setOpenMenu(null); }} className="block w-full px-3 py-2 text-left text-[13px] font-medium text-(--text-primary) hover:bg-(--bg-glass-hover)">{option}</button>))}</motion.div>)}</AnimatePresence>
                    </div>
                </div>

                <div className="space-y-1.5">
                    <label className="ml-1 text-[10px] font-bold uppercase tracking-wider text-(--text-tertiary)">Payment Type</label>
                    <div className="relative">
                        <button type="button" onClick={() => setOpenMenu((prev) => (prev === 'paymentType' ? null : 'paymentType'))} className="flex w-full items-center justify-between rounded-lg border border-(--border-subtle) bg-(--bg-card) px-3 py-2.5 text-[13px] font-semibold outline-none transition-all text-(--text-primary)"><span>{newTxn.paymentType}</span><ChevronDown size={14} className={cn("text-(--text-muted) transition-transform duration-200", openMenu === 'paymentType' && "rotate-180")} /></button>
                        <AnimatePresence>{openMenu === 'paymentType' && (<motion.div initial={dropdownMotion.initial} animate={dropdownMotion.animate} exit={dropdownMotion.exit} className="absolute z-30 mt-1 w-full rounded-lg border border-(--border-subtle) bg-(--bg-card) shadow-lg overflow-hidden">{(['Cash', 'Stock', 'Mixed'] as const).map(option => (<button key={option} type="button" onClick={() => { setNewTxn({ ...newTxn, paymentType: option }); setOpenMenu(null); }} className="block w-full px-3 py-2 text-left text-[13px] font-medium text-(--text-primary) hover:bg-(--bg-glass-hover)">{option}</button>))}</motion.div>)}</AnimatePresence>
                    </div>
                </div>
            </div>

            <div className="mt-6 flex items-center justify-end gap-3 border-t border-(--border-subtle) pt-5">
                <button 
                    onClick={onCancel} 
                    className="rounded-lg border border-(--border-subtle) px-4 py-2 text-[12px] font-bold uppercase tracking-wider text-(--text-secondary) hover:bg-(--bg-glass-hover) transition-all"
                >
                    Cancel
                </button>
                <button 
                    onClick={handleCommit} 
                    disabled={!isTxnInputValid} 
                    className={cn(
                        "rounded-lg px-6 py-2 text-[12px] font-bold uppercase tracking-wider transition-all", 
                        isTxnInputValid 
                            ? "bg-blue-600 text-white shadow-[0_10px_20px_rgba(37,99,235,0.25)] hover:bg-blue-500 hover:shadow-[0_12px_24px_rgba(37,99,235,0.35)] active:scale-95" 
                            : "cursor-not-allowed bg-blue-600/40 text-white/50 border border-blue-500/20"
                    )}
                >
                    Commit Deal
                </button>
            </div>
        </div>

    );
};
