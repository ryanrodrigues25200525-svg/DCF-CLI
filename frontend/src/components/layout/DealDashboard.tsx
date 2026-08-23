"use client";

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Activity,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  BarChart3,
  Clock,
  Target,
  Zap,
  Info
} from 'lucide-react';
import { ModelDiagnostic, DCFResults, Assumptions } from '@/core/types';

interface DealDashboardProps {
  diagnostics: ModelDiagnostic[];
  results: DCFResults | null;
  assumptions: Assumptions | null;
}

interface MetricRowProps {
  label: string;
  value: string;
  subvalue?: string;
  trend?: 'up' | 'down' | 'neutral';
  status?: 'good' | 'warning' | 'danger' | 'neutral';
  icon?: React.ReactNode;
}

function MetricRow({ label, value, subvalue, trend, status = 'neutral', icon }: MetricRowProps) {
  const statusColors = {
    good: 'text-[var(--system-green)]',
    warning: 'text-[var(--system-orange)]',
    danger: 'text-[var(--system-red)]',
    neutral: 'text-[var(--text-secondary)]'
  };

  return (
    <div className="flex items-center justify-between py-3.5 border-b border-[var(--border-subtle)] last:border-0">
      <div className="flex items-center gap-2">
        {icon && <span className="text-[var(--text-tertiary)]">{icon}</span>}
        <span className="text-[15px] text-[var(--text-secondary)]">{label}</span>
      </div>
      <div className="text-right">
        <div className={`text-[28px] leading-none font-semibold ${statusColors[status]} tabular-nums`}>
          {value}
          {trend === 'up' && <TrendingUp size={10} className="inline ml-1 text-[var(--system-green)]" />}
          {trend === 'down' && <TrendingDown size={10} className="inline ml-1 text-[var(--system-red)]" />}
        </div>
        {subvalue && (
          <div className="text-[12px] text-[var(--text-tertiary)] tabular-nums">{subvalue}</div>
        )}
      </div>
    </div>
  );
}

function AlertStrip({ type, message }: { type: 'warning' | 'error' | 'info'; message: string }) {
  const borderColors = {
    warning: 'border-l-[var(--system-orange)]',
    error: 'border-l-[var(--system-red)]',
    info: 'border-l-[var(--system-blue)]'
  };

  const icons = {
    warning: <AlertTriangle size={12} className="text-[var(--system-orange)]" />,
    error: <AlertTriangle size={12} className="text-[var(--system-red)]" />,
    info: <Info size={12} className="text-[var(--system-blue)]" />
  };

  return (
    <div className={`pl-3 py-2.5 border-l-[3px] ${borderColors[type]} bg-[var(--bg-glass)] rounded-r-lg`}>
      <div className="flex items-start gap-2">
        {icons[type]}
        <span className="text-[13px] text-[var(--text-secondary)] leading-tight">{message}</span>
      </div>
    </div>
  );
}

export function DealDashboard({ diagnostics, results, assumptions }: DealDashboardProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    overview: true,
    alerts: true,
    checks: false
  });

  const toggle = (key: string) => setExpanded(prev => ({ ...prev, [key]: !prev[key] }));

  const passCount = diagnostics.filter(d => d.status === 'pass').length;
  const warningCount = diagnostics.filter(d => d.status === 'warning').length;
  const failCount = diagnostics.filter(d => d.status === 'fail').length;
  const totalCount = diagnostics.length;
  const healthScore = totalCount > 0
    ? Math.round(((passCount + warningCount * 0.5) / totalCount) * 100)
    : 100;
  const healthLabel = healthScore >= 90 ? 'Excellent' : healthScore >= 75 ? 'Good' : healthScore >= 55 ? 'Watch' : 'Critical';
  const healthColor = healthScore >= 90 ? 'text-[var(--system-green)]' : healthScore >= 75 ? 'text-[var(--system-blue)]' : healthScore >= 55 ? 'text-[var(--system-orange)]' : 'text-[var(--system-red)]';

  const upside = results?.upside ?? 0;
  const upsideTrend = upside > 0 ? 'up' : upside < 0 ? 'down' : 'neutral';
  const upsideStatus = upside > 0.15 ? 'good' : upside < -0.15 ? 'danger' : 'neutral';
  const confidenceRaw = results?.confidenceScore ?? 0;
  const confidenceOutOf100 = confidenceRaw <= 1 ? confidenceRaw * 100 : confidenceRaw;
  const diagnosticAlerts = diagnostics.filter((d) => d.status !== 'pass');
  const systemAlerts = [
    results?.modelWarning ? { type: results.isValuationSupported === false ? 'error' as const : 'warning' as const, message: results.modelWarning } : null,
    results?.sectorWarning ? { type: 'warning' as const, message: results.sectorWarning } : null,
    results?.terminalGrowthWarning ? { type: 'warning' as const, message: results.terminalGrowthWarning } : null,
    results?.negativeCashFlowWarning ? { type: 'error' as const, message: results.negativeCashFlowWarning } : null,
    results?.bsImbalanceWarning ? { type: 'error' as const, message: results.bsImbalanceWarning } : null,
  ].filter((x): x is { type: 'warning' | 'error'; message: string } => x !== null);

  return (
    <aside className="flex flex-col h-full">
      <div className="px-4 py-4 border-b border-[var(--border-subtle)]">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[14px] font-semibold text-[var(--text-tertiary)] uppercase tracking-wider">Model Health</span>
          <span className={`text-[32px] leading-none font-bold ${healthColor}`}>
            {healthScore}%
          </span>
        </div>
        <div className="h-1 bg-[var(--bg-grouped)] rounded-full overflow-hidden">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${healthScore}%` }}
            transition={{ duration: 0.5 }}
            className={`h-full rounded-full ${healthScore >= 90 ? 'bg-[var(--system-green)]' :
                healthScore >= 75 ? 'bg-[var(--system-blue)]' : healthScore >= 55 ? 'bg-[var(--system-orange)]' : 'bg-[var(--system-red)]'
              }`}
          />
        </div>
        <div className="flex items-center justify-between mt-3">
          <span className={`text-[14px] font-semibold ${healthColor}`}>{healthLabel}</span>
          <div className="flex items-center gap-3">
          {failCount > 0 && (
            <span className="text-[12px] text-[var(--system-red)]">{failCount} Errors</span>
          )}
          {warningCount > 0 && (
            <span className="text-[12px] text-[var(--system-orange)]">{warningCount} Warnings</span>
          )}
          {passCount > 0 && (
            <span className="text-[12px] text-[var(--system-green)]">{passCount} Passed</span>
          )}
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0">
        <div className="border-b border-[var(--border-subtle)]">
          <button
            onClick={() => toggle('overview')}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-[var(--bg-glass)] transition-colors"
          >
            <div className="flex items-center gap-2">
              <BarChart3 size={13} className="text-[var(--text-tertiary)]" />
              <span className="text-[14px] font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Key Metrics</span>
            </div>
            <ChevronDown
              size={13}
              className={`text-[var(--text-tertiary)] transition-transform ${expanded.overview ? '' : '-rotate-90'}`}
            />
          </button>

          <AnimatePresence>
            {expanded.overview && results && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div className="px-4 pb-3">
                  <MetricRow
                    label="Upside"
                    value={results.isValuationSupported === false ? 'N/A' : `${(upside * 100).toFixed(1)}%`}
                    trend={upsideTrend}
                    status={upsideStatus}
                    icon={<Target size={12} />}
                  />
                  <MetricRow
                    label="WACC"
                    value={assumptions ? `${(assumptions.wacc * 100).toFixed(2)}%` : 'N/A'}
                    icon={<Clock size={12} />}
                  />
                  <MetricRow
                    label="TV Growth"
                    value={assumptions ? `${(assumptions.terminalGrowthRate * 100).toFixed(2)}%` : 'N/A'}
                    subvalue="Perpetuity"
                    icon={<TrendingUp size={12} />}
                  />
                  <MetricRow
                    label="Confidence"
                    value={results.confidenceScore ? `${confidenceOutOf100.toFixed(0)}/100` : 'N/A'}
                    subvalue={results.confidenceRank}
                    status={results.confidenceRank === 'High' ? 'good' : results.confidenceRank === 'Low' ? 'warning' : 'neutral'}
                    icon={<CheckCircle2 size={12} />}
                  />
                  <MetricRow
                    label="Avg ROIC"
                    value={`${(results.avgROIC * 100).toFixed(1)}%`}
                    status={results.avgROIC > (assumptions?.wacc || 0) ? 'good' : 'warning'}
                    icon={<Zap size={12} />}
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="border-b border-[var(--border-subtle)]">
          <button
            onClick={() => toggle('alerts')}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-[var(--bg-glass)] transition-colors"
          >
            <div className="flex items-center gap-2">
              <AlertTriangle size={13} className="text-[var(--text-tertiary)]" />
              <span className="text-[14px] font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Alerts</span>
            </div>
            <div className="flex items-center gap-2">
              {(failCount + warningCount) > 0 && (
                <span className="px-2 py-0.5 bg-[var(--system-orange)]/10 text-[var(--system-orange)] text-[12px] rounded font-medium">
                  {failCount + warningCount}
                </span>
              )}
              <ChevronDown
                size={13}
                className={`text-[var(--text-tertiary)] transition-transform ${expanded.alerts ? '' : '-rotate-90'}`}
              />
            </div>
          </button>

          <AnimatePresence>
            {expanded.alerts && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div className="px-4 pb-3 space-y-2">
                  {diagnosticAlerts.map((d, i) => (
                    <AlertStrip
                      key={i}
                      type={d.status === 'fail' ? 'error' : d.status === 'warning' ? 'warning' : 'info'}
                      message={d.msg}
                    />
                  ))}

                  {systemAlerts.map((a, i) => (
                    <AlertStrip key={`sys-${i}`} type={a.type} message={a.message} />
                  ))}

                  {diagnosticAlerts.length === 0 && systemAlerts.length === 0 && (
                    <div className="flex items-center gap-2 py-2">
                      <CheckCircle2 size={12} className="text-[var(--system-green)]" />
                      <span className="text-[13px] text-[var(--text-tertiary)]">No active alerts</span>
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div>
          <button
            onClick={() => toggle('checks')}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-[var(--bg-glass)] transition-colors"
          >
            <div className="flex items-center gap-2">
              <Activity size={13} className="text-[var(--text-tertiary)]" />
              <span className="text-[14px] font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Quality Checks</span>
            </div>
            <ChevronDown
              size={13}
              className={`text-[var(--text-tertiary)] transition-transform ${expanded.checks ? '' : '-rotate-90'}`}
            />
          </button>

          <AnimatePresence>
            {expanded.checks && results && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div className="px-4 pt-1 pb-3">
                  {diagnostics.filter(d => d.status === 'pass').map((d, i) => (
                    <div key={`pass-${i}`} className="flex items-center justify-between gap-3 py-2.5 border-b border-[var(--border-subtle)] last:border-0">
                      <span className="min-w-0 text-[14px] text-[var(--text-secondary)]">{d.msg}</span>
                      <span className="text-[14px] font-medium text-[var(--system-green)]">Pass</span>
                    </div>
                  ))}
                  <div className="flex items-center justify-between gap-3 py-2.5 border-b border-[var(--border-subtle)] last:border-0">
                    <span className="min-w-0 text-[14px] text-[var(--text-secondary)]">TV Divergence</span>
                    <span className={`text-[14px] font-medium ${results.tvDivergenceFlag ? 'text-[var(--system-orange)]' : 'text-[var(--system-green)]'}`}>
                      {results.tvDivergenceFlag ? 'Flagged' : 'Normal'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3 py-2.5 border-b border-[var(--border-subtle)] last:border-0">
                    <span className="min-w-0 text-[14px] text-[var(--text-secondary)]">Value Creation</span>
                    <span className={`text-[14px] font-medium ${results.valueCreationFlag ? 'text-[var(--system-green)]' : 'text-[var(--system-orange)]'}`}>
                      {results.valueCreationFlag ? 'Positive' : 'Negative'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3 py-2.5 border-b border-[var(--border-subtle)] last:border-0">
                    <span className="min-w-0 text-[14px] text-[var(--text-secondary)]">Balance Sheet</span>
                    <span className={`text-[14px] font-medium ${results?.bsImbalanceWarning ? 'text-[var(--system-red)]' : 'text-[var(--system-green)]'}`}>
                      {results?.bsImbalanceWarning ? 'Imbalanced' : 'Balanced'}
                    </span>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <div className="shrink-0 px-4 py-3 border-t border-[var(--border-default)] bg-[var(--bg-glass)]">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <div className="flex items-center gap-2">
            <div className={`w-1.5 h-1.5 rounded-full ${healthScore >= 75 ? 'bg-[var(--system-green)]' : 'bg-[var(--system-orange)]'}`} />
            <span className="text-[9px] leading-none text-[var(--text-tertiary)]">
              {healthScore >= 75 ? 'Model Ready' : 'Review Required'}
            </span>
          </div>
          <span className="text-[9px] leading-none text-[var(--text-tertiary)]">DCF v4.2</span>
        </div>
      </div>
    </aside>
  );
}
