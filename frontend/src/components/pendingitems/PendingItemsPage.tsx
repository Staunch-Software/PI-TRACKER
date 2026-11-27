import { useState, useRef, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api, ApiError } from '../../lib/api';
import type {
  PaginatedResult,
  PendingItem,
  PendingItemsCountEntry,
  PendingItemsFilterOptions,
  PendingStageBreakdown,
} from '../../shared';
import { SearchIcon } from '../common/SearchIcon';
import { PendingDashboardPage } from './PendingDashboardPage';
import { PendingItemsMailModal } from '../modals/PendingItemsMailModal';
import { VesselPrMailModal } from '../modals/VesselPrMailModal';
import { InvoiceDisputeMailModal } from '../modals/InvoiceDisputeMailModal';

import '../../pages/Tracker.css';
import './PendingItems.css';

/* ── Vector SVG Icons (Zero Emojis) ── */
function MailIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    </svg>
  );
}

function ShipIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 21c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.5 0 2.5 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1" />
      <path d="M19.38 20A11.6 11.6 0 0 0 21 14l-9-4-9 4c0 2.9.94 5.34 2.81 7.76" />
      <path d="M19 13V7a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v6" />
      <path d="M12 2v3" />
    </svg>
  );
}

function FlameIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function ListIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" />
      <line x1="3" y1="12" x2="3.01" y2="12" />
      <line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

const VESSEL_OWNER_MAP: Record<string, { tsi: string; ta: string }> = {
  'AMNSI MAXIMUS': { tsi: 'Murtuza', ta: 'Sunil' },
  'AMNSI STALLION': { tsi: 'Murtuza', ta: 'Sunil' },
  'GCL GANGA': { tsi: 'Gaurav', ta: 'Jayasri' },
  'GCL TAPI': { tsi: 'Murtuza', ta: 'Bharath' },
  'AM UMANG': { tsi: 'Abhisek', ta: 'Gayathri' },
  'AMNS TUFMAX': { tsi: 'Abhinav', ta: 'Viswa' },
  'AMNS POLAR': { tsi: 'Abhinav', ta: 'Viswa' },
  'GCL SARASWATI': { tsi: 'Abhinav', ta: 'Bharath' },
  'GCL FOS': { tsi: 'Gaurav', ta: 'Bharath' },
  'GCL SABARMATI': { tsi: 'Pavan', ta: 'Bharath' },
  'GCL YAMUNA': { tsi: 'Gaurav', ta: 'Jayasri' },
  'GCL NARMADA': { tsi: 'Pavan', ta: 'Viswa' },
  'AM KIRTI': { tsi: 'Pavan', ta: 'Gayathri' },
  'AM TARANG': { tsi: 'Pavan', ta: 'Sunil' },
};

function isCriticalPr(item: PendingItem): boolean {
  return item.critical === true;
}

function isAgeing90Pr(item: PendingItem): boolean {
  return (item.ageingDays ?? 0) > 90;
}

type SortColumn = 'referenceNo' | 'title' | 'vesselName' | 'vendor' | 'status' | 'ownerName' | 'ageingDays' | 'referenceDate';

const STAGES = ['Requisition', 'Purchase Order', 'Invoice'] as const;
type Stage = (typeof STAGES)[number];

type OwnerRoleFilter = 'ALL' | 'TSI' | 'TA' | 'Disputed' | 'Open PO';

interface PendingItemFilters {
  search: string;
  vesselName: string[];
  ownerName: string[];
  ageingBracket: string;
}

const DEFAULT_FILTERS: PendingItemFilters = {
  search: '',
  vesselName: [],
  ownerName: [],
  ageingBracket: '',
};

const PAGE_SIZE_OPTIONS = [25, 50, 75, 100, 150, 200];

const AGEING_OPTIONS = [
  { label: '90+ Days', value: '90+ Days' },
  { label: '30 to 90 Days', value: '30 to 90 Days' },
  { label: 'Below 30 Days', value: 'Below 30 Days' },
];

function buildQueryParams(
  stage: Stage,
  ownerRoleFilter: OwnerRoleFilter,
  filters: PendingItemFilters,
  sortBy: SortColumn | null,
  sortDir: 'asc' | 'desc',
  page: number,
  pageSize: number,
  critical?: boolean | null
): URLSearchParams {
  const params = new URLSearchParams();
  params.append('stage', stage);
  if (ownerRoleFilter !== 'ALL') {
    params.append('owner_role', ownerRoleFilter);
  }
  if (filters.search) params.set('search', filters.search);
  filters.vesselName.forEach((v) => params.append('vessel_name', v));
  filters.ownerName.forEach((o) => params.append('owner_name', o));
  if (filters.ageingBracket) {
    params.set('ageing_bracket', filters.ageingBracket);
  }
  if (critical !== undefined && critical !== null) {
    params.set('critical', String(critical));
  }
  if (sortBy) {
    params.set('sort_by', sortBy);
    params.set('sort_dir', sortDir);
  }
  params.set('page', String(page));
  params.set('page_size', String(pageSize));
  return params;
}

function getInitials(name: string | null): string {
  if (!name) return '??';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

function formatDisplayDate(dateStr: string | null): string {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'];
    return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
  } catch {
    return dateStr;
  }
}

function getAgeingClass(days: number | null): string {
  if (days === null) return '';
  if (days > 90) return 'ageing-red';
  if (days >= 30) return 'ageing-yellow';
  return 'ageing-green';
}

function renderStatusPill(
  stage: Stage,
  status: string | null,
  ownerRole: string,
  dispute?: { disputedBy?: string | null; disputedAt?: string | null; disputedRemarks?: string | null }
) {
  const s = status || '—';
  const lower = s.toLowerCase();
  const isPending = lower.includes('pending');
  const isApproved = lower.includes('approved');
  const isDisputed = lower === 'disputed';
  const isOpenPo = ownerRole === 'Open PO';

  let label = s;
  if (stage === 'Requisition') {
    if (s === 'Pending') label = 'Pending (TSI)';
    else if (s === 'Approved') label = 'Pending (TA)';
  } else if (stage === 'Purchase Order') {
    if (isOpenPo) label = s; // show SmartPAL's own status (usually "Finally Approved") as-is
    else if (s === 'Pending') label = 'Pending (TA)';
    else if (s === 'Approved') label = 'Approved (TSI)';
  } else if (stage === 'Invoice') {
    if (isPending) label = `Pending (${ownerRole})`;
    else if (isApproved) label = `Approved (${ownerRole})`;
  }

  const pillClass = isDisputed ? 'status-disputed' : isOpenPo ? 'status-open-po' : isPending ? 'status-pending' : isApproved ? 'status-approved' : 'status-neutral';

  let title: string | undefined;
  if (isDisputed && dispute && (dispute.disputedBy || dispute.disputedRemarks)) {
    const when = dispute.disputedAt ? formatDisplayDate(dispute.disputedAt) : null;
    title = [
      dispute.disputedBy ? `Disputed by: ${dispute.disputedBy}` : null,
      when ? `Date: ${when}` : null,
      dispute.disputedRemarks ? `Remarks: ${dispute.disputedRemarks}` : null,
    ]
      .filter(Boolean)
      .join('\n');
  }

  return (
    <span className={`pending-status-pill ${pillClass}`} title={title}>
      <span className="status-dot" />
      {label}
    </span>
  );
}

interface DropdownProps {
  label: string;
  value: string;
  options: { label: string; value: string }[];
  onChange: (val: string) => void;
}

function Dropdown({ label, value, options, onChange }: DropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [open]);

  const displayLabel = value || label;
  const hasValue = Boolean(value && value !== label);

  return (
    <div className="toolbar-dropdown" ref={ref}>
      <button
        type="button"
        className={`toolbar-dropdown-btn ${hasValue ? 'has-value' : ''}`}
        onClick={() => setOpen(!open)}
      >
        <span>{displayLabel}</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <div className="toolbar-dropdown-menu">
          <button
            type="button"
            className={`toolbar-dropdown-item ${!value ? 'selected' : ''}`}
            onClick={() => {
              onChange('');
              setOpen(false);
            }}
          >
            {label}
          </button>
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`toolbar-dropdown-item ${value === opt.value ? 'selected' : ''}`}
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
              }}
            >
              <span>{opt.label}</span>
              {value === opt.value && (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function PendingItemsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeView = searchParams.get('view') === 'items' ? 'items' : 'dashboard';

  function setActiveView(view: 'dashboard' | 'items') {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (view === 'items') {
        next.set('view', 'items');
      } else {
        next.delete('view');
      }
      return next;
    });
  }

  const [stage, setStage] = useState<Stage>('Requisition');
  const [ownerRoleFilter, setOwnerRoleFilter] = useState<OwnerRoleFilter>('ALL');
  const [showBreakdown, setShowBreakdown] = useState(true);
  const [filters, setFilters] = useState<PendingItemFilters>(DEFAULT_FILTERS);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [sortBy, setSortBy] = useState<SortColumn | null>('ageingDays');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [isMailModalOpen, setIsMailModalOpen] = useState(false);
  const [mailSuccessMessage, setMailSuccessMessage] = useState<string | null>(null);
  const [disputeMailInvoiceNo, setDisputeMailInvoiceNo] = useState<string | null>(null);

  const [prTab, setPrTab] = useState<'all' | 'critical' | 'ageing_90'>('all');
  const [selectedVesselMail, setSelectedVesselMail] = useState<{
    vesselName: string;
    prType: 'critical' | 'ageing_90';
  } | null>(null);
  const [collapsedVessels, setCollapsedVessels] = useState<Record<string, boolean>>({});

  const allRequisitionsQuery = useQuery({
    queryKey: ['all-requisitions-dataset'],
    queryFn: () =>
      api.get<PaginatedResult<PendingItem>>('/pending-items?stage=Requisition&page=1&page_size=1000'),
    enabled: stage === 'Requisition',
    staleTime: 60_000,
  });

  const reqAllItems = allRequisitionsQuery.data?.items ?? [];
  const reqCriticalItems = useMemo(() => reqAllItems.filter(isCriticalPr), [reqAllItems]);
  const reqAgeing90Items = useMemo(() => reqAllItems.filter(isAgeing90Pr), [reqAllItems]);

  const isCriticalTab = stage === 'Requisition' && prTab === 'critical';
  const activePrList = reqAgeing90Items;

  const filteredReviewPrs = useMemo(() => {
    return activePrList.filter((item) => {
      if (ownerRoleFilter !== 'ALL' && item.ownerRole !== ownerRoleFilter) {
        return false;
      }
      if (filters.vesselName.length > 0 && item.vesselName && !filters.vesselName.includes(item.vesselName)) {
        return false;
      }
      if (filters.ownerName.length > 0 && item.ownerName && !filters.ownerName.includes(item.ownerName)) {
        return false;
      }
      if (filters.search) {
        const q = filters.search.trim().toLowerCase();
        const matchRef = (item.referenceNo || '').toLowerCase().includes(q);
        const matchTitle = (item.title || '').toLowerCase().includes(q);
        const matchVessel = (item.vesselName || '').toLowerCase().includes(q);
        const matchOwner = (item.ownerName || '').toLowerCase().includes(q);
        const matchDept = (item.department || item.reqCategory || '').toLowerCase().includes(q);
        if (!matchRef && !matchTitle && !matchVessel && !matchOwner && !matchDept) {
          return false;
        }
      }
      return true;
    });
  }, [activePrList, ownerRoleFilter, filters]);

  const vesselGroups = useMemo(() => {
    const map: Record<string, PendingItem[]> = {};
    for (const item of filteredReviewPrs) {
      const vName = (item.vesselName || 'UNKNOWN VESSEL').trim().toUpperCase();
      if (!map[vName]) map[vName] = [];
      map[vName].push(item);
    }
    return Object.entries(map).sort((a, b) => {
      const maxA = Math.max(...a[1].map((x) => x.ageingDays ?? 0), 0);
      const maxB = Math.max(...b[1].map((x) => x.ageingDays ?? 0), 0);
      if (maxB !== maxA) return maxB - maxA;
      return b[1].length - a[1].length;
    });
  }, [filteredReviewPrs]);

  const allOverdueFleetPrs = reqAgeing90Items;

  const fleetVesselStats = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const item of allOverdueFleetPrs) {
      const v = (item.vesselName || 'UNKNOWN').trim().toUpperCase();
      counts[v] = (counts[v] || 0) + 1;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [allOverdueFleetPrs]);

  const maxFleetAgeing = useMemo(() => {
    return Math.max(...filteredReviewPrs.map((x) => x.ageingDays ?? 0), 0);
  }, [filteredReviewPrs]);

  const criticalOverdueCount = useMemo(() => {
    return filteredReviewPrs.filter((x) => x.critical).length;
  }, [filteredReviewPrs]);

  function handleDrillDown(
    targetStage: Stage | null,
    targetRole: 'TSI' | 'TA',
    targetOwner?: string,
    targetVessel?: string
  ) {
    if (targetStage) {
      setStage(targetStage);
    }
    setOwnerRoleFilter(targetRole);
    setFilters({
      search: '',
      vesselName: targetVessel ? [targetVessel] : [],
      ownerName: targetOwner ? [targetOwner] : [],
      ageingBracket: '',
    });
    setPage(1);
    setActiveView('items');
  }

  function selectStage(next: Stage) {
    setStage(next);
    setPage(1);
    if (next !== 'Requisition') {
      setPrTab('all');
    }
    // Disputed only exists on Invoice, Open PO only on Purchase Order — reset away from either so
    // a stale selection doesn't silently carry over to a stage where its pill isn't even shown.
    if ((ownerRoleFilter === 'Disputed' && next !== 'Invoice') || (ownerRoleFilter === 'Open PO' && next !== 'Purchase Order')) {
      setOwnerRoleFilter('ALL');
    }
  }

  function selectRoleFilter(next: OwnerRoleFilter) {
    setOwnerRoleFilter(next);
    setPage(1);
  }

  function updateFilters(patch: Partial<PendingItemFilters>) {
    setPage(1);
    setFilters((prev) => ({ ...prev, ...patch }));
  }

  function clearAllFilters() {
    setPage(1);
    setFilters(DEFAULT_FILTERS);
  }

  function handleSort(column: SortColumn) {
    if (sortBy === column) {
      if (sortDir === 'asc') {
        setSortDir('desc');
      } else {
        setSortBy(null);
        setSortDir('desc');
      }
    } else {
      setSortBy(column);
      setSortDir('asc');
    }
    setPage(1);
  }

  const filterOptionsQuery = useQuery({
    queryKey: ['pending-items-filter-options'],
    queryFn: () => api.get<PendingItemsFilterOptions>('/pending-items/filter-options'),
  });

  const breakdownQuery = useQuery({
    queryKey: ['pending-items-breakdown', stage, isCriticalTab],
    queryFn: () =>
      api.get<PendingStageBreakdown>(
        `/pending-items/breakdown?stage=${stage}${isCriticalTab ? '&critical=true' : ''}`
      ),
    placeholderData: keepPreviousData,
  });

  const countsQuery = useQuery({
    queryKey: ['pending-items-counts', filters, isCriticalTab],
    queryFn: () => {
      const params = new URLSearchParams();
      if (filters.search) params.set('search', filters.search);
      filters.vesselName.forEach((v) => params.append('vessel_name', v));
      filters.ownerName.forEach((v) => params.append('owner_name', v));
      if (filters.ageingBracket) params.set('ageing_bracket', filters.ageingBracket);
      if (isCriticalTab) params.set('critical', 'true');
      return api.get<PendingItemsCountEntry[]>(`/pending-items/counts?${params.toString()}`);
    },
    placeholderData: keepPreviousData,
  });

  function countFor(s: Stage, role: 'TSI' | 'TA' | 'Disputed' | 'Open PO'): number {
    return countsQuery.data?.find((c) => c.stage === s && c.ownerRole === role)?.count ?? 0;
  }

  function stageTotal(s: Stage): number {
    return countFor(s, 'TSI') + countFor(s, 'TA');
  }

  const itemsQuery = useQuery({
    queryKey: ['pending-items', stage, ownerRoleFilter, filters, sortBy, sortDir, page, pageSize, isCriticalTab],
    queryFn: () =>
      api.get<PaginatedResult<PendingItem>>(
        `/pending-items?${buildQueryParams(stage, ownerRoleFilter, filters, sortBy, sortDir, page, pageSize, isCriticalTab ? true : null).toString()}`
      ),
    placeholderData: keepPreviousData,
  });

  const totalPages = itemsQuery.data ? Math.max(1, Math.ceil(itemsQuery.data.total / pageSize)) : 1;

  async function handleExport() {
    setExportError(null);
    setIsExporting(true);
    try {
      const params = buildQueryParams(stage, ownerRoleFilter, filters, sortBy, sortDir, page, pageSize, isCriticalTab ? true : null);
      params.delete('page');
      params.delete('page_size');
      const { blob, filename } = await api.getBlob(`/pending-items/export?${params.toString()}`);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const rolePrefix = ownerRoleFilter !== 'ALL' ? `${ownerRoleFilter}_` : 'All_';
      const critPrefix = isCriticalTab ? 'Critical_' : '';
      link.download = filename ?? `${critPrefix}${stage.replace(/\s+/g, '_')}_${rolePrefix}Pending_Ageing.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setExportError(err instanceof ApiError ? err.message : 'Failed to export.');
    } finally {
      setIsExporting(false);
    }
  }

  const vesselOptions = (filterOptionsQuery.data?.vesselName ?? []).map((v) => ({ value: v, label: v }));
  const ownerNameOptions = (filterOptionsQuery.data?.ownerName ?? []).map((v) => ({ value: v, label: v }));

  const hasAnyActiveFilter =
    filters.search !== '' ||
    filters.vesselName.length > 0 ||
    filters.ownerName.length > 0 ||
    filters.ageingBracket !== '';

  function sortIndicator(column: SortColumn) {
    if (sortBy !== column) return null;
    return <span className="sort-indicator">{sortDir === 'asc' ? '▲' : '▼'}</span>;
  }

  const breakdownData = breakdownQuery.data;
  const filteredOwners = (breakdownData?.owners ?? []).filter((o) => {
    if (ownerRoleFilter === 'ALL') return true;
    return o.ownerRole === ownerRoleFilter;
  });

  const totalForCurrentStage = stageTotal(stage);
  const tsiForCurrentStage = countFor(stage, 'TSI');
  const taForCurrentStage = countFor(stage, 'TA');
  const disputedForCurrentStage = countFor(stage, 'Disputed');
  const openPoForCurrentStage = countFor(stage, 'Open PO');

  const activeRoleLabel =
    ownerRoleFilter === 'ALL'
      ? 'All Roles'
      : ownerRoleFilter === 'TSI'
        ? 'TSI Pending'
        : ownerRoleFilter === 'TA'
          ? 'TA Pending'
          : ownerRoleFilter === 'Open PO'
            ? 'Open POs'
            : 'Disputed';

  return (
    <div className="tracker-page pending-items-page">
      <div className="tracker-page-header">
        <div className="tracker-page-header-left">
          <h1 className="tracker-page-title">
            {activeView === 'dashboard' ? 'TSI / TA Pending Dashboard' : 'TSI / TA Pending Items'}
          </h1>
          <div className="tracker-view-tabs">
            <button
              type="button"
              className={`tracker-view-tab ${activeView === 'dashboard' ? 'active' : ''}`}
              onClick={() => setActiveView('dashboard')}
            >
              Dashboard
            </button>
            <button
              type="button"
              className={`tracker-view-tab ${activeView === 'items' ? 'active' : ''}`}
              onClick={() => setActiveView('items')}
            >
              Detailed Items
            </button>
          </div>
        </div>

        {activeView === 'items' && (
          <div className="tracker-page-count">
            <span className="count-number">
              {stage === 'Requisition' && prTab !== 'all'
                ? filteredReviewPrs.length
                : itemsQuery.data?.total ?? 0}
            </span>
            <span className="count-label">
              {stage === 'Requisition' && prTab === 'critical'
                ? `Critical PRs · ${activeRoleLabel}`
                : stage === 'Requisition' && prTab === 'ageing_90'
                  ? `90+ Days PRs · ${activeRoleLabel}`
                  : `${stage} · ${activeRoleLabel}`}
            </span>
          </div>
        )}
      </div>

      {activeView === 'dashboard' ? (
        <PendingDashboardPage onDrillDown={handleDrillDown} />
      ) : (
        <>
          {/* Top stage tabs */}
          <div className="pending-stage-tabs">
        {STAGES.map((s) => (
          <button
            key={s}
            type="button"
            className={`pending-stage-tab ${stage === s ? 'active' : ''}`}
            onClick={() => selectStage(s)}
          >
            {s}
            <span className="pending-tab-count">{stageTotal(s)}</span>
          </button>
        ))}
      </div>

      {/* Requisition Specific 3-Tabs */}
      {stage === 'Requisition' && (
        <div className="pending-pr-tabs-bar">
          <button
            type="button"
            className={`pending-pr-tab-btn ${prTab === 'all' ? 'active' : ''}`}
            onClick={() => setPrTab('all')}
          >
            <ListIcon />
            <span>All Pending PRs</span>
            <span className="pending-pr-tab-count">{reqAllItems.length}</span>
          </button>
          <button
            type="button"
            className={`pending-pr-tab-btn ${prTab === 'critical' ? 'active' : ''}`}
            onClick={() => setPrTab('critical')}
          >
            <FlameIcon />
            <span>Critical PRs</span>
            <span className="pending-pr-tab-count badge-critical">{reqCriticalItems.length}</span>
          </button>
          <button
            type="button"
            className={`pending-pr-tab-btn ${prTab === 'ageing_90' ? 'active' : ''}`}
            onClick={() => setPrTab('ageing_90')}
          >
            <ClockIcon />
            <span>90+ Days Ageing PRs</span>
            <span className="pending-pr-tab-count badge-ageing">{reqAgeing90Items.length}</span>
          </button>
        </div>
      )}

      {/* Success Notification Banner */}
      {mailSuccessMessage && (
        <div className="pending-mail-success-toast">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
            <span>{mailSuccessMessage}</span>
          </div>
          <button
            type="button"
            className="pending-mail-toast-close"
            onClick={() => setMailSuccessMessage(null)}
            aria-label="Close notification"
          >
            ×
          </button>
        </div>
      )}

      {/* Sub-tabs row: All Pending / TSI Pending / TA Pending */}
      <div className="pending-subnav-row">
        <div className="pending-role-pills">
          <button
            type="button"
            className={`pending-role-pill pending-role-pill-all ${ownerRoleFilter === 'ALL' ? 'active' : ''}`}
            onClick={() => selectRoleFilter('ALL')}
          >
            All Pending
            <span className="pending-role-pill-count">
              {stage === 'Requisition' && prTab === 'ageing_90'
                ? activePrList.length
                : totalForCurrentStage}
            </span>
          </button>
          <button
            type="button"
            className={`pending-role-pill pending-role-pill-tsi ${ownerRoleFilter === 'TSI' ? 'active' : ''}`}
            onClick={() => selectRoleFilter('TSI')}
          >
            TSI Pending
            <span className="pending-role-pill-count">
              {stage === 'Requisition' && prTab === 'ageing_90'
                ? activePrList.filter((x) => x.ownerRole === 'TSI').length
                : tsiForCurrentStage}
            </span>
          </button>
          <button
            type="button"
            className={`pending-role-pill pending-role-pill-ta ${ownerRoleFilter === 'TA' ? 'active' : ''}`}
            onClick={() => selectRoleFilter('TA')}
          >
            TA Pending
            <span className="pending-role-pill-count">
              {stage === 'Requisition' && prTab === 'ageing_90'
                ? activePrList.filter((x) => x.ownerRole === 'TA').length
                : taForCurrentStage}
            </span>
          </button>
          {stage === 'Invoice' && (
            <button
              type="button"
              className={`pending-role-pill pending-role-pill-disputed ${ownerRoleFilter === 'Disputed' ? 'active' : ''}`}
              onClick={() => selectRoleFilter('Disputed')}
            >
              Disputed
              <span className="pending-role-pill-count">{disputedForCurrentStage}</span>
            </button>
          )}
          {stage === 'Purchase Order' && (
            <button
              type="button"
              className={`pending-role-pill pending-role-pill-openpo ${ownerRoleFilter === 'Open PO' ? 'active' : ''}`}
              onClick={() => selectRoleFilter('Open PO')}
            >
              Open PO
              <span className="pending-role-pill-count">{openPoForCurrentStage}</span>
            </button>
          )}
        </div>

        {(stage !== 'Requisition' || prTab !== 'ageing_90') && (
          <div className="pending-breakdown-meta">
            <span className="pending-breakdown-hint">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
              Click any owner or vessel to filter
            </span>
            <button
              type="button"
              className="pending-breakdown-toggle-btn"
              onClick={() => setShowBreakdown((prev) => !prev)}
            >
              <span>{showBreakdown ? '▲ Hide Breakdown' : '▼ Show Breakdown'}</span>
            </button>
          </div>
        )}
      </div>

      {/* Dashboard style breakdown cards */}
      {showBreakdown && (stage !== 'Requisition' || prTab !== 'ageing_90') && (
        <div className="pending-breakdown-wrapper">
          <div className="pending-cards-grid">
            {filteredOwners.map((owner) => {
              const isOwnerActive = filters.ownerName.includes(owner.ownerName);
              const isTsi = owner.ownerRole === 'TSI';

              return (
                <div
                  key={`${owner.ownerName}-${owner.ownerRole}`}
                  className={`pending-owner-card ${isOwnerActive ? 'active' : ''}`}
                  onClick={() => {
                    if (isOwnerActive) {
                      updateFilters({ ownerName: [] });
                    } else {
                      updateFilters({ ownerName: [owner.ownerName] });
                    }
                  }}
                >
                  <div className="pending-card-header">
                    <div className="pending-card-header-left">
                      <div className={`pending-card-avatar ${isTsi ? 'pending-card-avatar-tsi' : 'pending-card-avatar-ta'}`}>
                        {getInitials(owner.ownerName)}
                      </div>
                      <span className="pending-card-owner-name">{owner.ownerName}</span>
                      <span className={`pending-card-role-chip ${isTsi ? 'pending-card-role-chip-tsi' : 'pending-card-role-chip-ta'}`}>
                        {owner.ownerRole}
                      </span>
                    </div>

                    <div className="pending-card-header-right">
                      {isOwnerActive ? (
                        <span className="pending-card-active-pill">
                          Active <span className="pending-card-active-count">{owner.totalCount}</span>
                        </span>
                      ) : (
                        <span className="pending-card-count">{owner.totalCount}</span>
                      )}
                    </div>
                  </div>

                  <div className="pending-card-vessels">
                    {owner.vessels.map((v) => {
                      const isVesselActive = filters.vesselName.includes(v.vesselName);
                      return (
                        <button
                          key={v.vesselName}
                          type="button"
                          className={`pending-vessel-chip ${isVesselActive ? 'active' : ''}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (isVesselActive) {
                              updateFilters({ vesselName: [] });
                            } else {
                              updateFilters({ vesselName: [v.vesselName] });
                            }
                          }}
                        >
                          <span>{v.vesselName}</span>
                          <span className="pending-vessel-chip-count">{v.count}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {stage === 'Requisition' && prTab === 'ageing_90' ? (
        <>
          {/* Executive Summary & KPI Header for 90+ Days PRs */}
          <div className="overdue-fleet-summary-card">
            <div className="overdue-fleet-summary-header">
              <div className="overdue-fleet-header-icon">
                <ClockIcon />
              </div>
              <div className="overdue-fleet-header-text">
                <h3 className="overdue-fleet-header-title">90+ Days Overdue Requisitions Review</h3>
                <p className="overdue-fleet-header-desc">
                  Fleet-wide review for purchase requisitions pending over 90 days. Dispatch technical review emails to superintendents and Masters to advise cancellation of requisitions no longer required on board.
                </p>
              </div>
            </div>

            <div className="overdue-fleet-kpis-grid">
              <div className="overdue-kpi-card kpi-total">
                <div className="overdue-kpi-icon-wrap icon-amber">
                  <ClockIcon />
                </div>
                <div className="overdue-kpi-info">
                  <span className="overdue-kpi-value">{filteredReviewPrs.length}</span>
                  <span className="overdue-kpi-title">Overdue PRs</span>
                </div>
                <span className="overdue-kpi-badge badge-amber">Scope</span>
              </div>

              <div className="overdue-kpi-card kpi-vessels">
                <div className="overdue-kpi-icon-wrap icon-blue">
                  <ShipIcon />
                </div>
                <div className="overdue-kpi-info">
                  <span className="overdue-kpi-value">{vesselGroups.length}</span>
                  <span className="overdue-kpi-title">Vessels Affected</span>
                </div>
                <span className="overdue-kpi-badge badge-blue">Fleet</span>
              </div>

              <div className="overdue-kpi-card kpi-critical">
                <div className="overdue-kpi-icon-wrap icon-red">
                  <FlameIcon />
                </div>
                <div className="overdue-kpi-info">
                  <span className="overdue-kpi-value">{criticalOverdueCount}</span>
                  <span className="overdue-kpi-title">Critical Priority</span>
                </div>
                <span className={`overdue-kpi-badge ${criticalOverdueCount > 0 ? 'badge-red' : 'badge-slate'}`}>
                  {criticalOverdueCount > 0 ? 'Urgent' : 'Normal'}
                </span>
              </div>

              <div className="overdue-kpi-card kpi-max-age">
                <div className="overdue-kpi-icon-wrap icon-indigo">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 14 14" />
                    <path d="M12 2v2" />
                  </svg>
                </div>
                <div className="overdue-kpi-info">
                  <span className="overdue-kpi-value">{maxFleetAgeing}d</span>
                  <span className="overdue-kpi-title">Max Ageing</span>
                </div>
                <span className="overdue-kpi-badge badge-indigo">Peak</span>
              </div>
            </div>
          </div>

          {/* Quick Vessel Filter Navigation */}
          {fleetVesselStats.length > 1 && (
            <div className="overdue-vessel-quick-bar">
              <span className="overdue-vessel-quick-label">Fleet Vessels:</span>
              <button
                type="button"
                className={`overdue-vessel-pill ${filters.vesselName.length === 0 ? 'active' : ''}`}
                onClick={() => updateFilters({ vesselName: [] })}
              >
                <span>All Vessels</span>
                <span className="overdue-vessel-pill-badge">{allOverdueFleetPrs.length}</span>
              </button>
              {fleetVesselStats.map(([vName, count]) => {
                const isActive = filters.vesselName.includes(vName);
                return (
                  <button
                    key={vName}
                    type="button"
                    className={`overdue-vessel-pill ${isActive ? 'active' : ''}`}
                    onClick={() => updateFilters({ vesselName: isActive ? [] : [vName] })}
                  >
                    <ShipIcon />
                    <span>{vName}</span>
                    <span className="overdue-vessel-pill-badge">{count}</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Toolbar for 90+ Days Review */}
          <div className="tracker-toolbar">
            <div className="tracker-search-wrap">
              <SearchIcon />
              <input
                type="search"
                placeholder="Search PR no., vessel, equipment, owner…"
                value={filters.search}
                onChange={(e) => updateFilters({ search: e.target.value })}
              />
            </div>

            <Dropdown
              label="All vessels"
              value={filters.vesselName[0] || ''}
              options={vesselOptions}
              onChange={(val) => updateFilters({ vesselName: val ? [val] : [] })}
            />

            <Dropdown
              label="All owners"
              value={filters.ownerName[0] || ''}
              options={ownerNameOptions}
              onChange={(val) => updateFilters({ ownerName: val ? [val] : [] })}
            />

            <div className="tracker-toolbar-spacer" />
          </div>

          {/* Active filters bar */}
          {hasAnyActiveFilter && (
            <div className="pending-active-filters-bar">
              <span className="pending-active-filters-label">Active Filters:</span>

              {filters.search && (
                <span className="pending-filter-chip">
                  Search: &quot;{filters.search}&quot;
                  <button
                    type="button"
                    className="pending-filter-chip-remove"
                    onClick={() => updateFilters({ search: '' })}
                    aria-label="Remove search filter"
                  >
                    ×
                  </button>
                </span>
              )}

              {filters.vesselName.map((v) => (
                <span key={v} className="pending-filter-chip">
                  Vessel: {v}
                  <button
                    type="button"
                    className="pending-filter-chip-remove"
                    onClick={() => updateFilters({ vesselName: filters.vesselName.filter((x) => x !== v) })}
                    aria-label={`Remove ${v} filter`}
                  >
                    ×
                  </button>
                </span>
              ))}

              {filters.ownerName.map((o) => (
                <span key={o} className="pending-filter-chip">
                  Owner: {o}
                  <button
                    type="button"
                    className="pending-filter-chip-remove"
                    onClick={() => updateFilters({ ownerName: filters.ownerName.filter((x) => x !== o) })}
                    aria-label={`Remove ${o} filter`}
                  >
                    ×
                  </button>
                </span>
              ))}

              <button type="button" className="pending-reset-all-btn" onClick={clearAllFilters}>
                Reset all
              </button>
            </div>
          )}

          {/* Unified Spanned Vessel Table */}
          {allRequisitionsQuery.isLoading ? (
            <div className="tracker-table-card">
              <div className="tracker-loading">
                <div className="tracker-loading-spinner" />
                <div>Loading 90+ days overdue requisitions…</div>
              </div>
            </div>
          ) : vesselGroups.length === 0 ? (
            <div className="pending-vessel-empty-state">
              <div className="pending-vessel-empty-icon">
                <ShipIcon />
              </div>
              <div className="pending-vessel-empty-title">No Overdue Requisitions Found</div>
              <div className="pending-vessel-empty-desc">
                No requisitions exceeding 90 days ageing match the current filters.
              </div>
            </div>
          ) : (
            <div className="tracker-table-shell" style={{ margin: '0 28px 24px' }}>
              <div className="pending-items-scroll">
                <table className="data-table pending-items-table pending-spanned-vessel-table">
                  <colgroup>
                    <col style={{ width: 230 }} />
                    <col style={{ width: 170 }} />
                    <col style={{ width: 105 }} />
                    <col style={{ width: 85 }} />
                    <col style={{ minWidth: 240 }} />
                    <col style={{ width: 95 }} />
                    <col style={{ width: 110 }} />
                    <col style={{ width: 80 }} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th>Vessel &amp; Technical Action</th>
                      <th>PR Reference No.</th>
                      <th>Created</th>
                      <th>Department</th>
                      <th>Description / Equipment</th>
                      <th style={{ textAlign: 'center' }}>Priority</th>
                      <th style={{ textAlign: 'center' }}>Status</th>
                      <th style={{ textAlign: 'center' }}>Ageing</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vesselGroups.map(([vName, items]) => {
                      const owners = VESSEL_OWNER_MAP[vName] || { tsi: 'TSI In-Charge', ta: 'TA In-Charge' };
                      const maxAgeing = Math.max(...items.map((x) => x.ageingDays ?? 0), 0);

                      return items.map((item, idx) => (
                        <tr key={`${vName}-${item.referenceNo}-${idx}`} className={idx === 0 ? 'vessel-group-first-row' : ''}>
                          {idx === 0 && (
                            <td rowSpan={items.length} className="vessel-spanned-cell">
                              <div className="vessel-spanned-content">
                                <div className="vessel-spanned-card">
                                  <div className="vessel-spanned-header">
                                    <div className="vessel-ship-badge-icon">
                                      <ShipIcon />
                                    </div>
                                    <div className="vessel-spanned-title-wrap">
                                      <span className="vessel-spanned-name">{vName}</span>
                                      <span className="vessel-spanned-fleet-tag">Active Fleet</span>
                                    </div>
                                  </div>

                                  <div className="vessel-spanned-owners">
                                    <span className="pending-vessel-owner-chip chip-tsi" title={`TSI: ${owners.tsi}`}>
                                      <span className="chip-prefix">TSI</span>
                                      <span className="chip-name">{owners.tsi}</span>
                                    </span>
                                    <span className="pending-vessel-owner-chip chip-ta" title={`TA: ${owners.ta}`}>
                                      <span className="chip-prefix">TA</span>
                                      <span className="chip-name">{owners.ta}</span>
                                    </span>
                                  </div>

                                  <div className="vessel-spanned-metrics">
                                    <div className="vessel-metric-pill metric-count">
                                      <span className="metric-num">{items.length}</span>
                                      <span className="metric-text">{items.length === 1 ? 'Overdue PR' : 'Overdue PRs'}</span>
                                    </div>
                                    <div className={`vessel-metric-pill ${maxAgeing >= 120 ? 'metric-max-urgent' : 'metric-max-warn'}`}>
                                      <span className="metric-num">{maxAgeing}d</span>
                                      <span className="metric-text">Max Age</span>
                                    </div>
                                  </div>

                                  <button
                                    type="button"
                                    className="btn-vessel-review-mail"
                                    onClick={() => setSelectedVesselMail({ vesselName: vName, prType: 'ageing_90' })}
                                    title={`Send technical review inquiry email for ${vName}`}
                                  >
                                    <MailIcon />
                                    <span>Review Email</span>
                                  </button>
                                </div>
                              </div>
                            </td>
                          )}
                          <td className="pr-reference-no-cell">{item.referenceNo ?? '—'}</td>
                          <td style={{ whiteSpace: 'nowrap' }}>{formatDisplayDate(item.referenceDate)}</td>
                          <td className="vessel-table-dept">{item.department || item.reqCategory || 'Technical'}</td>
                          <td className="vessel-table-title" title={item.title ?? ''}>{item.title ?? '—'}</td>
                          <td style={{ textAlign: 'center' }}>
                            {item.critical ? (
                              <span className="vessel-prio-badge badge-critical">CRITICAL</span>
                            ) : (
                              <span className="vessel-prio-badge badge-normal">{(item.priority || 'NORMAL').toUpperCase()}</span>
                            )}
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            <span className="pending-status-pill status-approved">
                              <span className="status-dot" />
                              {item.status || 'Approved'}
                            </span>
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            <span className={`ageing-chip ${getAgeingClass(item.ageingDays)}`}>
                              {item.ageingDays !== null ? `${item.ageingDays}d` : '—'}
                            </span>
                          </td>
                        </tr>
                      ));
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          {/* Toolbar */}
          <div className="tracker-toolbar">
            <div className="tracker-search-wrap">
              <SearchIcon />
              <input
                type="search"
                placeholder={
                  stage === 'Requisition'
                    ? 'Search PR no., vessel, title, owner…'
                    : stage === 'Purchase Order'
                      ? 'Search PO no., vessel, vendor, title, owner…'
                      : 'Search invoice no., vessel, vendor, owner…'
                }
                value={filters.search}
                onChange={(e) => updateFilters({ search: e.target.value })}
              />
            </div>

            <Dropdown
              label="All vessels"
              value={filters.vesselName[0] || ''}
              options={vesselOptions}
              onChange={(val) => updateFilters({ vesselName: val ? [val] : [] })}
            />

            <Dropdown
              label="All owners"
              value={filters.ownerName[0] || ''}
              options={ownerNameOptions}
              onChange={(val) => updateFilters({ ownerName: val ? [val] : [] })}
            />

            <Dropdown
              label="All Ageing"
              value={filters.ageingBracket}
              options={AGEING_OPTIONS}
              onChange={(val) => updateFilters({ ageingBracket: val })}
            />

            <div className="tracker-toolbar-spacer" />

            {ownerRoleFilter !== 'Disputed' && ownerRoleFilter !== 'Open PO' && (
              <button
                type="button"
                className="btn-tracker-action btn-pending-mail-trigger"
                onClick={() => setIsMailModalOpen(true)}
                title={`Preview and send summary email to ${activeRoleLabel}`}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="4" width="20" height="16" rx="2" />
                  <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                </svg>
                <span>
                  {ownerRoleFilter === 'ALL'
                    ? 'Email All (TSI & TA)'
                    : ownerRoleFilter === 'TSI'
                      ? 'Email TSI Summary'
                      : 'Email TA Summary'}
                </span>
              </button>
            )}

            <button
              className="btn-tracker-action btn-tracker-secondary"
              onClick={handleExport}
              disabled={isExporting}
              title={`Export ${stage} (${activeRoleLabel}) ageing matrix with clickable drill-down detail sheets to Excel`}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              {isExporting ? 'Exporting…' : 'Export to Excel'}
            </button>
          </div>

          {/* Active filters bar */}
          {hasAnyActiveFilter && (
            <div className="pending-active-filters-bar">
              <span className="pending-active-filters-label">Active Filters:</span>

              {filters.search && (
                <span className="pending-filter-chip">
                  Search: &quot;{filters.search}&quot;
                  <button
                    type="button"
                    className="pending-filter-chip-remove"
                    onClick={() => updateFilters({ search: '' })}
                    aria-label="Remove search filter"
                  >
                    ×
                  </button>
                </span>
              )}

              {filters.vesselName.map((v) => (
                <span key={v} className="pending-filter-chip">
                  Vessel: {v}
                  <button
                    type="button"
                    className="pending-filter-chip-remove"
                    onClick={() => updateFilters({ vesselName: filters.vesselName.filter((x) => x !== v) })}
                    aria-label={`Remove ${v} filter`}
                  >
                    ×
                  </button>
                </span>
              ))}

              {filters.ownerName.map((o) => (
                <span key={o} className="pending-filter-chip">
                  Owner: {o}
                  <button
                    type="button"
                    className="pending-filter-chip-remove"
                    onClick={() => updateFilters({ ownerName: filters.ownerName.filter((x) => x !== o) })}
                    aria-label={`Remove ${o} filter`}
                  >
                    ×
                  </button>
                </span>
              ))}

              {filters.ageingBracket && (
                <span className="pending-filter-chip">
                  Ageing: {filters.ageingBracket}
                  <button
                    type="button"
                    className="pending-filter-chip-remove"
                    onClick={() => updateFilters({ ageingBracket: '' })}
                    aria-label="Remove ageing filter"
                  >
                    ×
                  </button>
                </span>
              )}

              <button type="button" className="pending-reset-all-btn" onClick={clearAllFilters}>
                Reset all
              </button>
            </div>
          )}

          {exportError && (
            <div className="tracker-export-error">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              {exportError}
            </div>
          )}

          {itemsQuery.isLoading ? (
            <div className="tracker-table-card">
              <div className="tracker-loading">
                <div className="tracker-loading-spinner" />
                <div>Loading pending items…</div>
              </div>
            </div>
          ) : itemsQuery.isError ? (
            <div className="tracker-table-card">
              <div className="tracker-error">Failed to load pending items.</div>
            </div>
          ) : (
            <>
              <div className="tracker-table-shell">
                <div className="pending-items-scroll">
                  <table className="data-table pending-items-table">
                    {stage === 'Requisition' ? (
                      <>
                        <colgroup>
                          <col style={{ width: 180 }} />
                          <col style={{ width: 250 }} />
                          <col style={{ width: 160 }} />
                          <col style={{ width: 140 }} />
                          <col style={{ width: 130 }} />
                          <col style={{ width: 110 }} />
                          <col style={{ width: 120 }} />
                        </colgroup>
                        <thead>
                          <tr>
                            <th onClick={() => handleSort('referenceNo')}>PR Reference No. {sortIndicator('referenceNo')}</th>
                            <th onClick={() => handleSort('title')}>Title / Description {sortIndicator('title')}</th>
                            <th onClick={() => handleSort('vesselName')}>Vessel {sortIndicator('vesselName')}</th>
                            <th onClick={() => handleSort('status')}>Status {sortIndicator('status')}</th>
                            <th onClick={() => handleSort('ownerName')}>Owner {sortIndicator('ownerName')}</th>
                            <th onClick={() => handleSort('ageingDays')}>Ageing {sortIndicator('ageingDays')}</th>
                            <th onClick={() => handleSort('referenceDate')}>Date {sortIndicator('referenceDate')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(itemsQuery.data?.items ?? []).map((item, idx) => (
                            <tr key={`${item.referenceNo}-${idx}`}>
                              <td className="pr-reference-no-cell">{item.referenceNo ?? '—'}</td>
                              <td className="pr-title-cell" title={item.title ?? ''}>{item.title ?? '—'}</td>
                              <td className="vessel-name-cell">{item.vesselName ?? '—'}</td>
                              <td>{renderStatusPill(stage, item.status, item.ownerRole, { disputedBy: item.disputedBy, disputedAt: item.disputedAt, disputedRemarks: item.disputedRemarks })}</td>
                              <td className="owner-cell">
                                <span className={`owner-role-badge-text ${item.ownerRole === 'TSI' ? 'role-tsi' : item.ownerRole === 'TA' ? 'role-ta' : item.ownerRole === 'Open PO' ? 'role-openpo' : 'role-disputed'}`}>{item.ownerRole}</span>
                                {item.ownerName ?? '—'}
                              </td>
                              <td>
                                <span className={`ageing-chip ${getAgeingClass(item.ageingDays)}`}>
                                  {item.ageingDays !== null ? `${item.ageingDays}d` : '—'}
                                </span>
                              </td>
                              <td className="date-cell">{formatDisplayDate(item.referenceDate)}</td>
                            </tr>
                          ))}
                          {itemsQuery.data && itemsQuery.data.items.length === 0 && (
                            <tr>
                              <td colSpan={7} className="pending-items-empty">
                                No requisition items match the current filters.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </>
                    ) : stage === 'Purchase Order' ? (
                      <>
                        <colgroup>
                          <col style={{ width: 170 }} />
                          <col style={{ width: 220 }} />
                          <col style={{ width: 150 }} />
                          <col style={{ width: 190 }} />
                          <col style={{ width: 130 }} />
                          <col style={{ width: 130 }} />
                          <col style={{ width: 100 }} />
                          <col style={{ width: 110 }} />
                        </colgroup>
                        <thead>
                          <tr>
                            <th onClick={() => handleSort('referenceNo')}>PO Number {sortIndicator('referenceNo')}</th>
                            <th onClick={() => handleSort('title')}>Title / Description {sortIndicator('title')}</th>
                            <th onClick={() => handleSort('vesselName')}>Vessel {sortIndicator('vesselName')}</th>
                            <th onClick={() => handleSort('vendor')}>Vendor {sortIndicator('vendor')}</th>
                            <th onClick={() => handleSort('status')}>Status {sortIndicator('status')}</th>
                            <th onClick={() => handleSort('ownerName')}>Owner {sortIndicator('ownerName')}</th>
                            <th onClick={() => handleSort('ageingDays')}>Ageing {sortIndicator('ageingDays')}</th>
                            <th onClick={() => handleSort('referenceDate')}>Date {sortIndicator('referenceDate')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(itemsQuery.data?.items ?? []).map((item, idx) => (
                            <tr key={`${item.referenceNo}-${idx}`}>
                              <td className="pr-reference-no-cell">{item.referenceNo ?? '—'}</td>
                              <td className="pr-title-cell" title={item.title ?? ''}>{item.title ?? '—'}</td>
                              <td className="vessel-name-cell">{item.vesselName ?? '—'}</td>
                              <td>{item.vendor ?? '—'}</td>
                              <td>{renderStatusPill(stage, item.status, item.ownerRole, { disputedBy: item.disputedBy, disputedAt: item.disputedAt, disputedRemarks: item.disputedRemarks })}</td>
                              <td className="owner-cell">
                                <span className={`owner-role-badge-text ${item.ownerRole === 'TSI' ? 'role-tsi' : item.ownerRole === 'TA' ? 'role-ta' : item.ownerRole === 'Open PO' ? 'role-openpo' : 'role-disputed'}`}>{item.ownerRole}</span>
                                {item.ownerName ?? '—'}
                              </td>
                              <td>
                                <span className={`ageing-chip ${getAgeingClass(item.ageingDays)}`}>
                                  {item.ageingDays !== null ? `${item.ageingDays}d` : '—'}
                                </span>
                              </td>
                              <td className="date-cell">{formatDisplayDate(item.referenceDate)}</td>
                            </tr>
                          ))}
                          {itemsQuery.data && itemsQuery.data.items.length === 0 && (
                            <tr>
                              <td colSpan={8} className="pending-items-empty">
                                No purchase orders match the current filters.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </>
                    ) : (
                      <>
                        <colgroup>
                          <col style={{ width: 180 }} />
                          {ownerRoleFilter === 'Disputed' && <col style={{ width: 160 }} />}
                          <col style={{ width: 160 }} />
                          <col style={{ width: 220 }} />
                          <col style={{ width: 140 }} />
                          <col style={{ width: 130 }} />
                          <col style={{ width: 100 }} />
                          <col style={{ width: 110 }} />
                          {ownerRoleFilter === 'Disputed' && <col style={{ width: 260 }} />}
                          {ownerRoleFilter === 'Disputed' && <col style={{ width: 56 }} />}
                        </colgroup>
                        <thead>
                          <tr>
                            <th onClick={() => handleSort('referenceNo')}>
                              {ownerRoleFilter === 'Disputed' ? 'Vendor Invoice No.' : 'Invoice No.'} {sortIndicator('referenceNo')}
                            </th>
                            {ownerRoleFilter === 'Disputed' && <th title="SmartPAL's own invoice number — internal reference only, never sent to the vendor">SmartPAL Invoice No.</th>}
                            <th onClick={() => handleSort('vesselName')}>Vessel {sortIndicator('vesselName')}</th>
                            <th onClick={() => handleSort('vendor')}>Vendor {sortIndicator('vendor')}</th>
                            <th onClick={() => handleSort('status')}>Status {sortIndicator('status')}</th>
                            <th onClick={() => handleSort('ownerName')}>Owner {sortIndicator('ownerName')}</th>
                            <th onClick={() => handleSort('ageingDays')}>Ageing {sortIndicator('ageingDays')}</th>
                            <th onClick={() => handleSort('referenceDate')}>Date {sortIndicator('referenceDate')}</th>
                            {ownerRoleFilter === 'Disputed' && <th>Dispute Details</th>}
                            {ownerRoleFilter === 'Disputed' && <th style={{ textAlign: 'center' }}>Mail</th>}
                          </tr>
                        </thead>
                        <tbody>
                          {(itemsQuery.data?.items ?? []).map((item, idx) => (
                            <tr key={`${item.referenceNo}-${idx}`}>
                              <td className="pr-reference-no-cell">
                                {ownerRoleFilter === 'Disputed' ? item.vendorInvoiceNo ?? item.referenceNo ?? '—' : item.referenceNo ?? '—'}
                              </td>
                              {ownerRoleFilter === 'Disputed' && (
                                <td className="pr-reference-no-cell smartpal-invoice-no-cell">{item.referenceNo ?? '—'}</td>
                              )}
                              <td className="vessel-name-cell">{item.vesselName ?? '—'}</td>
                              <td>{item.vendor ?? '—'}</td>
                              <td>{renderStatusPill(stage, item.status, item.ownerRole, { disputedBy: item.disputedBy, disputedAt: item.disputedAt, disputedRemarks: item.disputedRemarks })}</td>
                              <td className="owner-cell">
                                <span className={`owner-role-badge-text ${item.ownerRole === 'TSI' ? 'role-tsi' : item.ownerRole === 'TA' ? 'role-ta' : item.ownerRole === 'Open PO' ? 'role-openpo' : 'role-disputed'}`}>{item.ownerRole}</span>
                                {item.ownerName ?? '—'}
                              </td>
                              <td>
                                <span className={`ageing-chip ${getAgeingClass(item.ageingDays)}`}>
                                  {item.ageingDays !== null ? `${item.ageingDays}d` : '—'}
                                </span>
                              </td>
                              <td className="date-cell">{formatDisplayDate(item.referenceDate)}</td>
                              {ownerRoleFilter === 'Disputed' && (
                                <td className="dispute-details-cell">
                                  {item.disputedBy || item.disputedRemarks ? (
                                    <>
                                      {item.disputedBy && (
                                        <div className="dispute-detail-by">
                                          {item.disputedBy}
                                          {item.disputedAt ? ` · ${formatDisplayDate(item.disputedAt)}` : ''}
                                        </div>
                                      )}
                                      {item.disputedRemarks && <div className="dispute-detail-remarks">{item.disputedRemarks}</div>}
                                    </>
                                  ) : (
                                    '—'
                                  )}
                                </td>
                              )}
                              {ownerRoleFilter === 'Disputed' && (
                                <td style={{ textAlign: 'center' }}>
                                  <button
                                    type="button"
                                    className="dispute-mail-icon-btn"
                                    title={`Email vendor about ${item.referenceNo ?? 'this invoice'}'s dispute`}
                                    onClick={() => item.referenceNo && setDisputeMailInvoiceNo(item.referenceNo)}
                                    disabled={!item.referenceNo}
                                  >
                                    <MailIcon />
                                  </button>
                                </td>
                              )}
                            </tr>
                          ))}
                          {itemsQuery.data && itemsQuery.data.items.length === 0 && (
                            <tr>
                              <td colSpan={ownerRoleFilter === 'Disputed' ? 10 : 7} className="pending-items-empty">
                                No invoices match the current filters.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </>
                    )}
                  </table>
                </div>
              </div>

              <div className="tracker-pagination">
                <div className="pagination-left">
                  <span className="pagination-label">Rows per page:</span>
                  <div className="pagination-size-pill">
                    <select
                      className="pagination-select"
                      value={PAGE_SIZE_OPTIONS.includes(pageSize) ? pageSize : ''}
                      onChange={(e) => {
                        if (e.target.value) {
                          setPageSize(Number(e.target.value));
                          setPage(1);
                        }
                      }}
                    >
                      {PAGE_SIZE_OPTIONS.map((n) => (
                        <option key={n} value={n}>{n}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="pagination-center">
                  <button className="pagination-nav-btn" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} title="Previous Page">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
                  </button>
                  <div className="pagination-current">
                    Page <strong>{page}</strong> of {totalPages}
                  </div>
                  <button className="pagination-nav-btn" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} title="Next Page">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
                  </button>
                </div>

                <div className="pagination-right">
                  <span className="pagination-total">
                    {itemsQuery.data ? (
                      <><strong>{itemsQuery.data.total.toLocaleString()}</strong> items found</>
                    ) : (
                      '...'
                    )}
                  </span>
                </div>
              </div>
            </>
          )}
        </>
      )}
        </>
      )}

      {isMailModalOpen && (
        <PendingItemsMailModal
          role={ownerRoleFilter}
          stage={stage}
          onClose={() => setIsMailModalOpen(false)}
          onSuccess={(msg) => {
            setMailSuccessMessage(msg);
            setTimeout(() => setMailSuccessMessage(null), 8000);
          }}
        />
      )}

      {disputeMailInvoiceNo && (
        <InvoiceDisputeMailModal
          invoiceNo={disputeMailInvoiceNo}
          onClose={() => setDisputeMailInvoiceNo(null)}
          onSuccess={(msg) => {
            setMailSuccessMessage(msg);
            setTimeout(() => setMailSuccessMessage(null), 8000);
          }}
        />
      )}

      {selectedVesselMail && (
        <VesselPrMailModal
          vesselName={selectedVesselMail.vesselName}
          prType={selectedVesselMail.prType}
          role={ownerRoleFilter === 'TSI' || ownerRoleFilter === 'TA' ? ownerRoleFilter : 'ALL'}
          onClose={() => setSelectedVesselMail(null)}
          onSuccess={(msg) => {
            setMailSuccessMessage(msg);
            setSelectedVesselMail(null);
            setTimeout(() => setMailSuccessMessage(null), 8000);
          }}
        />
      )}
    </div>
  );
}
