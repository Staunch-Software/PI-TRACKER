import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../../lib/api';
import type {
  InvoiceRegistrationDailyEntry,
  InvoiceRegistrationSummaryEntry,
  PirRejectionDailyEntry,
  PirRejectionSummaryEntry,
} from '../../shared';

type Mode = 'REGISTERED' | 'REJECTED';

// Validated categorical palette (dataviz skill) — fixed hue order, never cycled/reassigned.
const SERIES_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7'];
const OTHER_COLOR = '#898781'; // muted ink, reserved for the folded "Other" bucket
const OTHER_KEY = 'Other';
// 7 named + 1 "Other" keeps the chart within the palette's validated 8-slot order.
const MAX_NAMED_SERIES = SERIES_COLORS.length;

interface DailyPoint {
  date: string;
  [person: string]: string | number;
}

// Color follows the entity, never its rank (dataviz non-negotiable): each person's slot/color is
// fixed by their alphabetical position in the ALL-TIME (unfiltered) roster for this mode, so
// switching date ranges never repaints a survivor — only who's folded into "Other" can change,
// and only once the all-time roster itself grows past the palette's 7 named slots.
function buildNamedRoster(allTimePeople: string[]) {
  const canonical = [...new Set(allTimePeople)].sort((a, b) => a.localeCompare(b));
  const named = canonical.slice(0, MAX_NAMED_SERIES);
  const colorByPerson = new Map<string, string>(named.map((p, i) => [p, SERIES_COLORS[i]]));
  const colorOf = (person: string) => colorByPerson.get(person) ?? OTHER_COLOR;
  const bucketOf = (person: string) => (colorByPerson.has(person) ? person : OTHER_KEY);
  const hasOther = canonical.length > named.length;
  const series = hasOther ? [...named, OTHER_KEY] : named;
  return { series, colorOf, bucketOf };
}

function buildChartData(daily: { date: string; person: string; count: number }[], series: string[], bucketOf: (p: string) => string) {
  const byDate = new Map<string, DailyPoint>();
  for (const row of daily) {
    const key = bucketOf(row.person);
    let point = byDate.get(row.date);
    if (!point) {
      point = { date: row.date };
      byDate.set(row.date, point);
    }
    point[key] = ((point[key] as number) ?? 0) + row.count;
  }

  const dates = [...byDate.keys()].sort();
  return dates.map((date) => {
    const point = byDate.get(date)!;
    const filled: DailyPoint = { date };
    for (const person of series) filled[person] = (point[person] as number) ?? 0;
    return filled;
  });
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function defaultDateFrom(): string {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return isoDate(d);
}

function defaultDateTo(): string {
  return isoDate(new Date());
}

function UserActivityTooltip({ active, payload, label }: { active?: boolean; payload?: any[]; label?: string }) {
  if (!active || !payload || payload.length === 0) return null;
  const rows = payload.filter((p) => p.value > 0).sort((a, b) => b.value - a.value);
  if (rows.length === 0) return null;
  return (
    <div className="user-activity-tooltip">
      <div className="user-activity-tooltip-date">{label}</div>
      {rows.map((p) => (
        <div key={p.dataKey} className="user-activity-tooltip-row">
          <span className="user-activity-legend-swatch" style={{ background: p.stroke }} />
          <span className="user-activity-tooltip-name">{p.name}</span>
          <span className="user-activity-tooltip-count">{p.value}</span>
        </div>
      ))}
    </div>
  );
}

export function UserActivityModal({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState<Mode>('REGISTERED');
  const [dateFrom, setDateFrom] = useState(defaultDateFrom);
  const [dateTo, setDateTo] = useState(defaultDateTo);

  const basePath = mode === 'REGISTERED' ? '/invoice-registrations' : '/pir-rejections';
  const personKey = mode === 'REGISTERED' ? 'registeredBy' : 'rejectedBy';

  const summaryQuery = useQuery({
    queryKey: ['user-activity-summary', mode, dateFrom, dateTo],
    queryFn: () => {
      const params = new URLSearchParams();
      if (dateFrom) params.set('date_from', dateFrom);
      if (dateTo) params.set('date_to', dateTo);
      const qs = params.toString();
      return api.get<(InvoiceRegistrationSummaryEntry | PirRejectionSummaryEntry)[]>(`${basePath}/summary${qs ? `?${qs}` : ''}`);
    },
  });

  // Unfiltered, mode-only roster — used purely to assign each person a STABLE color slot (see
  // buildNamedRoster), independent of whatever date range is currently applied above.
  const allTimeSummaryQuery = useQuery({
    queryKey: ['user-activity-summary-all-time', mode],
    queryFn: () => api.get<(InvoiceRegistrationSummaryEntry | PirRejectionSummaryEntry)[]>(`${basePath}/summary`),
  });

  const dailyQuery = useQuery({
    queryKey: ['user-activity-daily', mode, dateFrom, dateTo],
    queryFn: () => {
      const params = new URLSearchParams();
      if (dateFrom) params.set('date_from', dateFrom);
      if (dateTo) params.set('date_to', dateTo);
      const qs = params.toString();
      return api.get<(InvoiceRegistrationDailyEntry | PirRejectionDailyEntry)[]>(`${basePath}/daily${qs ? `?${qs}` : ''}`);
    },
  });

  const summary = useMemo(
    () => (summaryQuery.data ?? []).map((e) => ({ person: (e as unknown as Record<string, string>)[personKey], count: e.count })),
    [summaryQuery.data, personKey]
  );
  const daily = useMemo(
    () => (dailyQuery.data ?? []).map((e) => ({ date: e.date, person: (e as unknown as Record<string, string>)[personKey], count: e.count })),
    [dailyQuery.data, personKey]
  );

  const allTimePeople = useMemo(
    () => (allTimeSummaryQuery.data ?? []).map((e) => (e as unknown as Record<string, string>)[personKey]),
    [allTimeSummaryQuery.data, personKey]
  );
  const { series, colorOf, bucketOf } = useMemo(() => buildNamedRoster(allTimePeople), [allTimePeople]);
  const chartData = useMemo(() => buildChartData(daily, series, bucketOf), [daily, series, bucketOf]);
  const total = summary.reduce((sum, e) => sum + e.count, 0);
  const maxCount = Math.max(1, ...summary.map((e) => e.count));
  const sortedSummary = useMemo(() => [...summary].sort((a, b) => b.count - a.count), [summary]);
  const isLoading = summaryQuery.isLoading || dailyQuery.isLoading || allTimeSummaryQuery.isLoading;

  // Fixed last-7-days range, independent of the modal's own date filter above — this is meant to
  // be a quick weekly snapshot email, not a re-send of whatever's currently on screen (see
  // backend/app/api/routes/user_activity.py).
  const sendReportMutation = useMutation({
    mutationFn: () => api.post<{ sent: boolean; dateFrom: string; dateTo: string }>('/user-activity/report'),
  });

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel user-activity-modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>User Activity</h2>
          <div className="user-activity-header-actions">
            <button
              type="button"
              className="user-activity-email-btn"
              onClick={() => sendReportMutation.mutate()}
              disabled={sendReportMutation.isPending}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="4" width="20" height="16" rx="2" />
                <path d="m22 6-10 7L2 6" />
              </svg>
              {sendReportMutation.isPending ? 'Sending…' : 'Email Report (last 7 days)'}
            </button>
            <button className="modal-close" onClick={onClose} aria-label="Close">
              ×
            </button>
          </div>
        </div>
        {sendReportMutation.isSuccess && (
          <p className="user-activity-report-status user-activity-report-status-ok">
            Report sent for {sendReportMutation.data.dateFrom} to {sendReportMutation.data.dateTo}.
          </p>
        )}
        {sendReportMutation.isError && (
          <p className="user-activity-report-status user-activity-report-status-error">
            Failed to send report: {(sendReportMutation.error as Error).message}
          </p>
        )}
        <div className="modal-body">
          <div className="user-activity-toolbar">
            <div className="pir-tabs-premium user-activity-toggle">
              <button className={`pir-tab-premium${mode === 'REGISTERED' ? ' active' : ''}`} onClick={() => setMode('REGISTERED')}>
                Registered by
              </button>
              <button className={`pir-tab-premium${mode === 'REJECTED' ? ' active' : ''}`} onClick={() => setMode('REJECTED')}>
                Rejected by
              </button>
            </div>
            <div className="pir-filters pir-date-filters">
              <div className="pir-date-filter">
                <label>From</label>
                <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
              </div>
              <div className="pir-date-filter">
                <label>To</label>
                <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
              </div>
            </div>
          </div>

          <div className="user-activity-chart-card">
            <h3>Daily Trend</h3>
            {!isLoading && chartData.length === 0 ? (
              <p className="pir-registered-by-empty">No data for this range.</p>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="#e1e0d9" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#898781' }} axisLine={{ stroke: '#c3c2b7' }} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#898781' }} axisLine={false} tickLine={false} width={28} />
                  <Tooltip content={<UserActivityTooltip />} />
                  {series.map((person) => (
                    <Line
                      key={person}
                      type="monotone"
                      dataKey={person}
                      name={person}
                      stroke={colorOf(person)}
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 4 }}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            )}
            {series.length > 0 && (
              <div className="user-activity-legend">
                {series.map((person) => (
                  <span key={person} className="user-activity-legend-item">
                    <span className="user-activity-legend-swatch" style={{ background: colorOf(person) }} />
                    {person}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="card pir-registered-by-panel user-activity-table-card">
            <div className="pir-registered-by-header">
              <h3>{mode === 'REGISTERED' ? 'Registered By' : 'Rejected By'}</h3>
            </div>
            {summaryQuery.isLoading && <p className="pir-registered-by-empty">Loading…</p>}
            {!summaryQuery.isLoading && sortedSummary.length === 0 && (
              <p className="pir-registered-by-empty">No data for this range.</p>
            )}
            {sortedSummary.length > 0 && (
              <div className="pir-registered-by-list">
                {sortedSummary.map((e) => (
                  <div key={e.person} className="pir-registered-by-row">
                    <span className="pir-registered-by-name">
                      <span className="user-activity-legend-swatch" style={{ background: colorOf(e.person) }} />
                      {e.person}
                    </span>
                    <div className="pir-registered-by-bar-track">
                      <div className="pir-registered-by-bar" style={{ width: `${(e.count / maxCount) * 100}%`, background: colorOf(e.person) }} />
                    </div>
                    <span className="pir-registered-by-count">{e.count}</span>
                  </div>
                ))}
                <div className="pir-registered-by-total">Total: {total}</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
