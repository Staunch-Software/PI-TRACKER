import React, { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../lib/api';
import type { AccountCodeAnalysisResponse, PoItemDetail, PoSpendForAccountCode, SyncPoItemsResponse } from '../../shared';
import { SpinnerIcon } from '../common/SpinnerIcon';
import { Toast } from '../common/Toast';

interface DdAccountCodeTableProps {
  canEdit: boolean;
  selectedVessel: string | null;
  search: string;
}

interface VesselGroupUnderAccount {
  vesselName: string | null;
  poNos: string[];
  vendors: string[];
  totalSpendInr: number;
  totalSpendUsd: number;
  itemCount: number;
  items: PoItemDetail[];
}

interface PoItemModalData {
  poNos: string[];
  vesselName: string | null;
  vendors: string[];
  accountCode: string;
  accountCodeDesc: string | null;
  totalSpendInr: number;
  totalSpendUsd: number;
  itemCount: number;
  items: PoItemDetail[];
}

const KNOWN_VESSEL_COLORS: Record<string, number> = {
  'GCL NARMADA': 0,    // Marine Sapphire Blue
  'GCL SABARMATI': 1,  // Emerald Sea Green
  'GCL SARASWATI': 2,  // Royal Indigo
  'GCL GANGA': 3,      // Tangerine Sunset Orange
  'GCL TAPI': 4,       // Warm Amber / Honey Gold
  'GCL YAMUNA': 5,     // Royal Violet / Amethyst
  'AMNS POLAR': 6,     // Electric Cyan / Turquoise
  'AMNSI STALLION': 7, // Royal Orchid / Deep Plum
  'AMNS TUFMAX': 8,    // Warm Bronze / Sienna
  'AM TARANG': 9,      // Ocean Sky Cerulean
  'AMNSI MAXIMUS': 10, // Slate Steel / Graphite
  'GCL FOS': 11,       // Olive / Lime Moss
  'AM UMANG': 12,      // Rich Cobalt / Midnight Blue
  'AM KIRTI': 13,      // Antique Ochre / Dijon
};

// 10 Distinct, contrasting palettes for POs
export const PO_PALETTES = [
  { bg: '#eff6ff', text: '#1d4ed8', border: '#93c5fd' }, // Blue
  { bg: '#ecfdf5', text: '#047857', border: '#6ee7b7' }, // Emerald
  { bg: '#f5f3ff', text: '#6d28d9', border: '#c4b5fd' }, // Violet
  { bg: '#fffbeb', text: '#b45309', border: '#fcd34d' }, // Amber
  { bg: '#f0fdfa', text: '#0f766e', border: '#5eead4' }, // Teal
  { bg: '#fff1f2', text: '#be123c', border: '#fda4af' }, // Rose
  { bg: '#eef2ff', text: '#4338ca', border: '#a5b4fc' }, // Indigo
  { bg: '#fff7ed', text: '#c2410c', border: '#fdba74' }, // Orange
  { bg: '#fdf4ff', text: '#a21caf', border: '#f0abfc' }, // Fuchsia
  { bg: '#f0fdf4', text: '#15803d', border: '#86efac' }, // Forest Green
];

// Helper to safely convert numbers (including Pydantic Decimal strings) to numbers
export const toNum = (val: unknown): number => {
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  if (typeof val === 'string') {
    const clean = val.replace(/[^0-9.-]/g, '');
    const n = parseFloat(clean);
    return isNaN(n) ? 0 : n;
  }
  return 0;
};

export function getPoColor(poNo: string, poNos?: string[]): { bg: string; text: string; border: string } {
  if (poNos && poNos.length > 0) {
    const idx = poNos.indexOf(poNo);
    if (idx >= 0) return PO_PALETTES[idx % PO_PALETTES.length];
  }
  let hash = 0;
  for (let i = 0; i < poNo.length; i++) {
    hash = (hash * 31 + poNo.charCodeAt(i)) % PO_PALETTES.length;
  }
  return PO_PALETTES[hash];
}

function getVesselColorClass(vesselName: string | null | undefined): string {
  if (!vesselName) return '';
  const key = vesselName.trim().toUpperCase();
  const idx = KNOWN_VESSEL_COLORS[key];
  if (idx !== undefined) return `vessel-color-${idx}`;
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) % 20;
  }
  return `vessel-color-${hash}`;
}

function formatUSD(amount: number | string | null | undefined): string {
  const num = toNum(amount);
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
}

function formatINR(amount: number | string | null | undefined): string {
  const num = toNum(amount);
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
}

function parseAccountCode(codeStr: string, descStr?: string | null): { code: string; desc: string } {
  if (!codeStr) return { code: '—', desc: '' };
  const parts = codeStr.split(' - ');
  if (parts.length > 1) {
    const code = parts[0].trim();
    let desc = parts.slice(1).join(' - ').trim();
    if (desc.startsWith('DD - ')) desc = desc.replace(/^DD\s*-\s*/, '');
    return { code, desc: desc || descStr || '' };
  }
  return { code: codeStr, desc: descStr || '' };
}

function groupPosByVessel(pos: PoSpendForAccountCode[]): VesselGroupUnderAccount[] {
  const map = new Map<string, VesselGroupUnderAccount>();
  for (const po of pos) {
    const vKey = po.vesselName || 'Unknown';
    let group = map.get(vKey);
    if (!group) {
      group = {
        vesselName: po.vesselName,
        poNos: [],
        vendors: [],
        totalSpendInr: 0,
        totalSpendUsd: 0,
        itemCount: 0,
        items: [],
      };
      map.set(vKey, group);
    }
    if (!group.poNos.includes(po.poNo)) {
      group.poNos.push(po.poNo);
    }
    if (po.vendor && !group.vendors.includes(po.vendor)) {
      group.vendors.push(po.vendor);
    }

    // Accumulate numbers safely with toNum to prevent string concatenation
    group.totalSpendInr += toNum(po.totalSpendInr);
    group.totalSpendUsd += toNum(po.totalSpendUsd);
    group.itemCount += toNum(po.itemCount) || (po.items ? po.items.length : 0);

    if (po.items && po.items.length > 0) {
      group.items.push(...po.items);
    }
  }
  return Array.from(map.values()).sort((a, b) => b.totalSpendUsd - a.totalSpendUsd);
}

// ── Intelligent Item Description Formatter ────────────────────────────────────
interface ParsedItemDesc {
  title: string;
  subtitle: string | null;
}

function parseItemDescription(raw: string | null | undefined): ParsedItemDesc {
  if (!raw || !raw.trim()) {
    return { title: '—', subtitle: null };
  }

  // 1. Clean broken character encodings like ' ? ' -> ' — '
  let s = raw.trim().replace(/\s*\?\s*/g, ' — ');

  // 2. Remove embedded drawing noise if present (as requested by user)
  s = s.replace(/,?\s*Add\.?\s*Dwg\s*(?:No\.?)?\s*:[^,;]+/gi, '');
  s = s.replace(/,?\s*Dwg\s*(?:No\.?)?\s*:[^,;]+/gi, '');
  s = s.replace(/,?\s*Drawing\s*(?:No\.?)?\s*:[^,;]+/gi, '');
  s = s.replace(/,?\s*Add\.?\s*Remarks\s*:/gi, ' — ');

  let title = s;
  let subtitle: string | null = null;

  // 3. Intelligent splitting strategies:
  // Strategy A: 'TITLE / SUBTITLE'
  if (s.includes(' / ')) {
    const parts = s.split(' / ');
    title = parts[0].trim();
    subtitle = parts.slice(1).join(' / ').trim();
  }
  // Strategy B: 'TITLE — SUBTITLE' when title is concise (<= 45 chars)
  else if (s.includes(' — ') && s.split(' — ')[0].trim().length <= 45) {
    const parts = s.split(' — ');
    title = parts[0].trim();
    subtitle = parts.slice(1).join(' — ').trim();
  }
  // Strategy C: Double-space separator common in SmartPAL exports
  else if (/\s{2,}/.test(s)) {
    const parts = s.split(/\s{2,}/);
    if (parts[0].trim().length <= 45 && parts.length > 1) {
      title = parts[0].trim();
      subtitle = parts.slice(1).join(' ').trim();
    }
  }

  // Clean trailing punctuation from title
  title = title.replace(/^[—/,]\s*|[—/,]\s*$/g, '').trim();

  if (subtitle) {
    subtitle = subtitle.replace(/^[—/,]\s*|[—/,]\s*$/g, '').trim();
    if (!subtitle || subtitle.toLowerCase() === title.toLowerCase()) {
      subtitle = null;
    }
  }

  return { title: title || '—', subtitle };
}

// ── Clean & Professional PO Item Details Modal ────────────────────────────────
function PoItemDetailsModal({
  detail,
  onClose,
}: {
  detail: PoItemModalData;
  onClose: () => void;
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [activePoFilter, setActivePoFilter] = useState<string | null>(null);
  const [isPoDropdownOpen, setIsPoDropdownOpen] = useState(false);
  const poDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (isPoDropdownOpen) {
          setIsPoDropdownOpen(false);
        } else {
          onClose();
        }
      }
    }
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose, isPoDropdownOpen]);

  // Click outside to close modern card dropdown popover
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (poDropdownRef.current && !poDropdownRef.current.contains(event.target as Node)) {
        setIsPoDropdownOpen(false);
      }
    }
    if (isPoDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isPoDropdownOpen]);

  // Pre-calculate per-PO stats for high performance & rich card display
  const poStatsMap = React.useMemo(() => {
    const map = new Map<string, { count: number; spendUsd: number; spendInr: number }>();
    for (const po of detail.poNos) {
      const itemsForPo = detail.items.filter((it) => it.poNo === po);
      const count = itemsForPo.length;
      const spendUsd = itemsForPo.reduce((acc, it) => acc + toNum(it.totalAmountUsd), 0);
      const spendInr = itemsForPo.reduce((acc, it) => acc + toNum(it.totalAmountInr), 0);
      map.set(po, { count, spendUsd, spendInr });
    }
    return map;
  }, [detail.poNos, detail.items]);

  const parsed = parseAccountCode(detail.accountCode, detail.accountCodeDesc);

  // Filter items based on user search and active PO filter
  const filteredItems = detail.items.filter((item) => {
    if (activePoFilter && item.poNo !== activePoFilter) return false;

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      const matchDesc = item.itemDescription?.toLowerCase().includes(q);
      const matchPart = item.partNumber?.toLowerCase().includes(q);
      const matchPo = item.poNo?.toLowerCase().includes(q);
      if (!matchDesc && !matchPart && !matchPo) return false;
    }
    return true;
  });

  // Calculate totals strictly as numeric sum using toNum
  const totalModalSpendUsd = detail.items.reduce((sum, it) => sum + toNum(it.totalAmountUsd), 0);
  const totalModalSpendInr = detail.items.reduce((sum, it) => sum + toNum(it.totalAmountInr), 0);

  const filteredSpendUsd = filteredItems.reduce((sum, it) => sum + toNum(it.totalAmountUsd), 0);
  const filteredSpendInr = filteredItems.reduce((sum, it) => sum + toNum(it.totalAmountInr), 0);

  const isFiltering = activePoFilter !== null || searchQuery.trim().length > 0;
  const activeSpendUsd = isFiltering ? filteredSpendUsd : totalModalSpendUsd;
  const activeSpendInr = isFiltering ? filteredSpendInr : totalModalSpendInr;

  return (
    <div className="modal-overlay clean-modal-overlay" onClick={onClose}>
      <div
        className="modal-panel po-items-modal-panel clean-modal modal-fullscreen-fit"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Header Row */}
        <div className="clean-modal-header">
          <div className="clean-modal-header-top">
            <div className="clean-modal-header-left">
              <span className="clean-modal-code-pill">{parsed.code}</span>
              <span className="clean-modal-title">{parsed.desc || detail.accountCode}</span>
              {detail.vesselName && (
                <span className={`vessel-table-badge ${getVesselColorClass(detail.vesselName)}`}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M2 20a6 6 0 0 0 12 0 6 6 0 0 0 10 0"/><path d="m4 16 1.5-6h13l1.5 6"/><path d="M10 10V4h4v6"/>
                  </svg>
                  {detail.vesselName}
                </span>
              )}
              <span className="clean-modal-meta-pill">
                {detail.items.length} {detail.items.length === 1 ? 'item' : 'items'}
                {detail.poNos.length > 1 && ` across ${detail.poNos.length} POs`}
              </span>
            </div>

            <div className="clean-modal-header-right">
              <div className="clean-modal-spend-wrap">
                <div className="modal-spend-label">{isFiltering ? 'Filtered Spend' : 'Total Spend'}</div>
                <div className="modal-spend-values">
                  <span className="clean-modal-spend-usd">{formatUSD(activeSpendUsd)}</span>
                  <span className="clean-modal-spend-inr">({formatINR(activeSpendInr)})</span>
                </div>
              </div>
              <button className="clean-modal-close" onClick={onClose} aria-label="Close" title="Close (Esc)">
                ×
              </button>
            </div>
          </div>
        </div>

        {/* Clean, Single-Row Executive Toolbar: Instant Search, Sleek PO Dropdown, Vendor Note */}
        <div className="modal-toolbar-strip">
          <div className="modal-toolbar-left">
            {/* Quick Search Input */}
            <div className="modal-search-box">
              <svg className="search-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
              </svg>
              <input
                type="text"
                className="modal-search-input"
                placeholder={`Search in ${detail.items.length} items (description, part #, PO)...`}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button
                  type="button"
                  className="modal-search-clear"
                  onClick={() => setSearchQuery('')}
                  title="Clear search"
                >
                  ×
                </button>
              )}
            </div>

            {/* Modern Card-Style PO Selector Dropdown */}
            {detail.poNos.length > 1 && (
              <div className="modal-po-card-dropdown-wrap" ref={poDropdownRef}>
                {/* Modern Card Trigger */}
                <button
                  type="button"
                  className={`po-card-trigger ${activePoFilter ? 'is-filtered' : ''} ${isPoDropdownOpen ? 'is-open' : ''}`}
                  onClick={() => setIsPoDropdownOpen((prev) => !prev)}
                  aria-expanded={isPoDropdownOpen}
                  title="Filter by Purchase Order"
                >
                  {activePoFilter ? (
                    // Filtered PO Card Trigger State
                    (() => {
                      const stats = poStatsMap.get(activePoFilter) || { count: 0, spendUsd: 0, spendInr: 0 };
                      const col = getPoColor(activePoFilter, detail.poNos);
                      return (
                        <div className="po-card-trigger-content">
                          <span
                            className="po-table-pill po-trigger-badge"
                            style={{
                              backgroundColor: col.bg,
                              color: col.text,
                              borderColor: col.border,
                            }}
                          >
                            {activePoFilter}
                          </span>
                          <div className="po-trigger-meta">
                            <span className="po-trigger-count">{stats.count} {stats.count === 1 ? 'item' : 'items'}</span>
                            <span className="po-trigger-sep">&bull;</span>
                            <span className="po-trigger-spend">{formatUSD(stats.spendUsd)}</span>
                          </div>
                          <span
                            className="po-trigger-clear-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              setActivePoFilter(null);
                              setIsPoDropdownOpen(false);
                            }}
                            title="Clear PO filter (show all)"
                          >
                            &times;
                          </span>
                          <svg
                            className={`po-trigger-chevron ${isPoDropdownOpen ? 'chevron-rotated' : ''}`}
                            width="13"
                            height="13"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <polyline points="6 9 12 15 18 9" />
                          </svg>
                        </div>
                      );
                    })()
                  ) : (
                    // Default All POs Card Trigger State
                    <div className="po-card-trigger-content">
                      <div className="po-trigger-icon-wrap">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                          <rect width="18" height="18" x="3" y="3" rx="2" /><path d="M3 9h18" /><path d="M9 21V9" />
                        </svg>
                      </div>
                      <div className="po-trigger-info">
                        <span className="po-trigger-title">All Purchase Orders</span>
                        <div className="po-trigger-meta">
                          <span>{detail.poNos.length} POs</span>
                          <span className="po-trigger-sep">&bull;</span>
                          <span>{detail.items.length} items</span>
                          <span className="po-trigger-sep">&bull;</span>
                          <span className="po-trigger-spend">{formatUSD(totalModalSpendUsd)}</span>
                        </div>
                      </div>
                      <svg
                        className={`po-trigger-chevron ${isPoDropdownOpen ? 'chevron-rotated' : ''}`}
                        width="13"
                        height="13"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                    </div>
                  )}
                </button>

                {/* Modern Card Dropdown Popover */}
                {isPoDropdownOpen && (
                  <div className="po-card-dropdown-popover">
                    {/* Popover Header */}
                    <div className="po-card-popover-header">
                      <div className="po-card-popover-title">
                        <span>Filter by Purchase Order</span>
                        <span className="po-popover-count-pill">{detail.poNos.length} POs &bull; {detail.items.length} Items</span>
                      </div>
                      {activePoFilter && (
                        <button
                          type="button"
                          className="po-popover-reset-btn"
                          onClick={() => {
                            setActivePoFilter(null);
                            setIsPoDropdownOpen(false);
                          }}
                        >
                          Reset to All
                        </button>
                      )}
                    </div>

                    {/* Popover Card Body */}
                    <div className="po-card-popover-body">
                      {/* Master "All Purchase Orders" Card */}
                      <div
                        className={`po-choice-card po-choice-all-card ${activePoFilter === null ? 'is-selected' : ''}`}
                        onClick={() => {
                          setActivePoFilter(null);
                          setIsPoDropdownOpen(false);
                        }}
                      >
                        <div className="po-choice-left">
                          <div className="po-choice-radio-circle">
                            {activePoFilter === null && <span className="po-choice-radio-dot" />}
                          </div>
                          <div>
                            <div className="po-choice-name">All Purchase Orders</div>
                            <div className="po-choice-sub">Displaying combined items across all {detail.poNos.length} POs</div>
                          </div>
                        </div>
                        <div className="po-choice-right">
                          <div className="po-choice-spend-usd">{formatUSD(totalModalSpendUsd)}</div>
                          <div className="po-choice-spend-inr">{formatINR(totalModalSpendInr)}</div>
                        </div>
                      </div>

                      <div className="po-card-popover-divider">
                        <span>Individual Purchase Orders ({detail.poNos.length})</span>
                      </div>

                      {/* Grid of Individual PO Modern Cards */}
                      <div className="po-cards-grid">
                        {detail.poNos.map((pNo) => {
                          const stats = poStatsMap.get(pNo) || { count: 0, spendUsd: 0, spendInr: 0 };
                          const col = getPoColor(pNo, detail.poNos);
                          const isSelected = activePoFilter === pNo;

                          return (
                            <div
                              key={pNo}
                              className={`po-choice-card po-choice-grid-card ${isSelected ? 'is-selected' : ''}`}
                              style={{
                                borderLeftColor: col.border,
                                borderLeftWidth: '3px',
                              }}
                              onClick={() => {
                                setActivePoFilter(pNo);
                                setIsPoDropdownOpen(false);
                              }}
                            >
                              <div className="po-grid-card-top">
                                <span
                                  className="po-table-pill"
                                  style={{
                                    backgroundColor: col.bg,
                                    color: col.text,
                                    borderColor: col.border,
                                  }}
                                >
                                  {pNo}
                                </span>
                                {isSelected ? (
                                  <span className="po-card-check-pill">
                                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                      <polyline points="20 6 9 17 4 12" />
                                    </svg>
                                    Active
                                  </span>
                                ) : (
                                  <span className="po-card-item-count">{stats.count} {stats.count === 1 ? 'item' : 'items'}</span>
                                )}
                              </div>

                              <div className="po-grid-card-bottom">
                                <div className="po-grid-card-spend-usd">{formatUSD(stats.spendUsd)}</div>
                                <div className="po-grid-card-spend-inr">{formatINR(stats.spendInr)}</div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="modal-toolbar-right">
            {detail.vendors.length > 0 && (
              <span className="modal-vendor-pill" title={detail.vendors.join(', ')}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"/><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/><path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"/><path d="M10 6h4"/><path d="M10 10h4"/><path d="M10 14h4"/><path d="M10 18h4"/>
                </svg>
                <span>Vendor: <strong>{detail.vendors.length === 1 ? detail.vendors[0] : `${detail.vendors.length} Vendors`}</strong></span>
              </span>
            )}
          </div>
        </div>

        {/* Body Table — High density fit to display fully without scroll */}
        <div className="modal-body po-modal-body modal-body-expanded">
          <div className="po-modal-table-scroll modal-table-scroll-full">
            <table className="po-items-subtable clean-subtable subtable-compact">
              <thead>
                <tr>
                  <th style={{ width: '40px', minWidth: '35px', textAlign: 'center' }}>#</th>
                  <th style={{ width: '150px', minWidth: '140px' }}>PO Number</th>
                  <th style={{ width: '80px', minWidth: '70px' }}>Type</th>
                  <th style={{ width: '120px', minWidth: '100px' }}>Part No.</th>
                  <th style={{ minWidth: '320px' }}>Item Description</th>
                  <th style={{ width: '65px', minWidth: '55px', textAlign: 'right' }}>Qty</th>
                  <th style={{ width: '95px', minWidth: '85px', textAlign: 'right' }}>Unit Price</th>
                  <th style={{ width: '120px', minWidth: '110px', textAlign: 'right' }}>Amount (INR)</th>
                  <th style={{ width: '120px', minWidth: '110px', textAlign: 'right' }}>Amount (USD)</th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.length === 0 ? (
                  <tr>
                    <td colSpan={9} style={{ textAlign: 'center', padding: '48px 20px', color: '#64748b' }}>
                      <div style={{ fontSize: '14px', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
                        No line items matched your search.
                      </div>
                      <div style={{ fontSize: '12px' }}>
                        {isFiltering ? (
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            style={{ marginTop: '8px' }}
                            onClick={() => {
                              setSearchQuery('');
                              setActivePoFilter(null);
                            }}
                          >
                            Clear Filters
                          </button>
                        ) : (
                          'No line items recorded for this PO.'
                        )}
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredItems.map((item, idx) => {
                    const col = getPoColor(item.poNo, detail.poNos);
                    const isAdd = item.itemType === 'ADDITIONAL';

                    // Clean part number: omit literal "NULL" or blank
                    const hasPartNo = item.partNumber && item.partNumber.trim() !== '' && item.partNumber.trim().toUpperCase() !== 'NULL';

                    return (
                      <tr
                        key={item.id}
                        className={isAdd ? 'item-additional-row' : ''}
                        style={{ borderLeft: `3px solid ${col.border}` }}
                      >
                        <td className="cell-sno">{idx + 1}</td>
                        <td className="cell-item-po">
                          <span
                            className="po-table-pill"
                            style={{
                              backgroundColor: col.bg,
                              color: col.text,
                              borderColor: col.border,
                            }}
                          >
                            {item.poNo}
                          </span>
                        </td>
                        <td className="cell-type">
                          {isAdd ? (
                            <span className="clean-type-badge type-add">Additional</span>
                          ) : (
                            <span className="type-item-text">Item</span>
                          )}
                        </td>
                        <td className="cell-part-no">
                          {hasPartNo ? (
                            <span className="clean-part-no">{item.partNumber!.trim()}</span>
                          ) : (
                            <span className="cell-muted">—</span>
                          )}
                        </td>
                        <td className="cell-desc">
                          {(() => {
                            const parsedDesc = parseItemDescription(item.itemDescription);
                            return (
                              <div className="item-desc-cell">
                                <div className="item-desc-title">{parsedDesc.title}</div>
                                {parsedDesc.subtitle && (
                                  <div className="item-desc-sub" title={parsedDesc.subtitle}>
                                    {parsedDesc.subtitle}
                                  </div>
                                )}
                              </div>
                            );
                          })()}
                        </td>
                        <td className="cell-num font-semibold">
                          {item.quantity !== null && item.quantity !== undefined ? toNum(item.quantity).toLocaleString() : '—'}
                        </td>
                        <td className="cell-num">
                          {item.unitPrice !== null && item.unitPrice !== undefined ? toNum(item.unitPrice).toLocaleString() : '—'}
                        </td>
                        <td className="cell-amount inr">{formatINR(item.totalAmountInr)}</td>
                        <td className="cell-amount usd font-bold">{formatUSD(item.totalAmountUsd)}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Clean Compact Footer */}
        <div className="clean-modal-footer">
          <div className="clean-modal-footer-info">
            Account Code: <strong>{parsed.code}</strong>
            {detail.vesselName && <span> &bull; Vessel: <strong>{detail.vesselName}</strong></span>}
            <span> &bull; Showing <strong>{filteredItems.length}</strong> of <strong>{detail.items.length}</strong> items</span>
            {detail.poNos.length > 1 ? (
              <span> across <strong>{detail.poNos.length}</strong> POs</span>
            ) : detail.poNos.length === 1 ? (
              <span> &bull; PO: <strong>{detail.poNos[0]}</strong></span>
            ) : null}
            <span> &bull; Total Spend: <strong>{formatUSD(activeSpendUsd)}</strong> ({formatINR(activeSpendInr)})</span>
          </div>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>
            Close (Esc)
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Account Code Table Component ─────────────────────────────────────────
export function DdAccountCodeTable({
  canEdit,
  selectedVessel,
  search,
}: DdAccountCodeTableProps) {
  const queryClient = useQueryClient();
  const [selectedDetail, setSelectedDetail] = useState<PoItemModalData | null>(null);
  const [syncToast, setSyncToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // Fetch PO items analysis data using parent selectedVessel and search
  const { data, isLoading, isError, error, isFetching } = useQuery({
    queryKey: ['dd-account-code-analysis', selectedVessel, search],
    queryFn: () => {
      const params = new URLSearchParams();
      if (selectedVessel) params.set('vessel_name', selectedVessel);
      if (search && search.trim()) params.set('search', search.trim());
      const qs = params.toString();
      return api.get<AccountCodeAnalysisResponse>(`/dd-tracker/account-code-analysis${qs ? `?${qs}` : ''}`);
    },
  });

  // Sync PO items mutation (runs only for newly added POs)
  const syncMutation = useMutation({
    mutationFn: () =>
      api.post<SyncPoItemsResponse>('/dd-tracker/sync-items', {}),
    onSuccess: (res) => {
      const msg = res.scrapedPos === 0
        ? (res.message || 'All DD PO items are already up to date. No new POs found.')
        : `Successfully synced ${res.scrapedPos} newly added PO(s) (${res.items} items, ${res.addAmounts} additional charges).`;
      setSyncToast({ message: msg, type: 'success' });
      queryClient.invalidateQueries({ queryKey: ['dd-account-code-analysis'] });
    },
    onError: (err) => {
      const errMsg = err instanceof ApiError ? err.message : 'Failed to sync items from SmartPAL.';
      setSyncToast({ message: errMsg, type: 'error' });
    },
  });

  const accountCodes = data?.accountCodes ?? [];

  return (
    <div className="dd-account-code-section">
      {/* Top Action Bar */}
      <div className="dd-account-actions-bar">
        <div className="dd-account-actions-left">
          <span className="dd-account-view-title">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/>
            </svg>
            By Account Code
          </span>
          <div className="dd-account-stats-group">
            <span className="stat-pill-pos">
              <strong>{data?.totalAccountCodes ?? 0}</strong> Account Codes
            </span>
            <span className="stat-pill-items">
              <strong>{data?.totalPos ?? 0}</strong> POs
            </span>
            <span className="stat-pill-spend">
              <span className="spend-usd-tag">{formatUSD(data?.grandTotalSpendUsd)}</span>
              <span className="spend-inr-tag">{formatINR(data?.grandTotalSpendInr)}</span>
            </span>
          </div>
          {selectedVessel && (
            <span className={`dd-account-vessel-badge ${getVesselColorClass(selectedVessel)}`}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M2 20a6 6 0 0 0 12 0 6 6 0 0 0 10 0"/><path d="m4 16 1.5-6h13l1.5 6"/><path d="M10 10V4h4v6"/></svg>
              {selectedVessel}
            </span>
          )}
        </div>

        <div className="dd-account-actions-right">
          {canEdit && (
            <button
              type="button"
              className="btn btn-primary btn-sm dd-sync-btn"
              onClick={() => syncMutation.mutate()}
              disabled={syncMutation.isPending || isFetching}
              title="Fetch line items and charges for newly added POs"
            >
              {syncMutation.isPending ? (
                <>
                  <SpinnerIcon size={14} />
                  <span>Syncing PO Items...</span>
                </>
              ) : (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
                  </svg>
                  <span>Sync New POs</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {syncToast && (
        <Toast
          message={syncToast.message}
          type={syncToast.type}
          onClose={() => setSyncToast(null)}
          duration={4500}
        />
      )}

      {/* Main Table Content */}
      {isLoading ? (
        <div className="dd-account-loading">
          <SpinnerIcon size={36} />
          <p>Loading Account Code breakdown...</p>
        </div>
      ) : isError ? (
        <div className="dd-account-error">
          <p>Failed to load Account Code analysis.</p>
          <small>{error instanceof Error ? error.message : 'Unknown error'}</small>
        </div>
      ) : accountCodes.length === 0 ? (
        <div className="dd-account-empty">
          <div className="dd-account-empty-icon">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 8 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
            </svg>
          </div>
          <div className="dd-account-empty-title">No Account Codes Found</div>
          <p className="dd-account-empty-desc">
            {search || selectedVessel
              ? 'No PO items matched the current vessel or search filter.'
              : 'Click "Sync New POs" above to fetch PO line items and charges.'}
          </p>
        </div>
      ) : (
        <div className="dd-account-table-wrapper">
          <table className={`dd-po-acct-table ${selectedVessel ? 'table-single-vessel' : ''}`}>
            <thead>
              <tr>
                <th style={{ width: '28%', minWidth: '220px' }}>Account Code</th>
                <th style={{ width: '16%', minWidth: '130px' }}>Vessel</th>
                <th style={{ width: '24%', minWidth: '180px' }}>PO Number</th>
                <th style={{ width: '10%', minWidth: '70px', textAlign: 'center' }}>Items</th>
                <th style={{ width: '11%', minWidth: '100px', textAlign: 'right' }}>Spend (INR)</th>
                <th style={{ width: '11%', minWidth: '100px', textAlign: 'right' }}>Spend (USD)</th>
              </tr>
            </thead>
            <tbody>
              {accountCodes.map((ac) => {
                const acPos = ac.pos && ac.pos.length > 0 ? ac.pos : [];
                if (acPos.length === 0) return null;

                const vesselGroups = groupPosByVessel(acPos);
                if (vesselGroups.length === 0) return null;

                const parsed = parseAccountCode(ac.accountCode, ac.accountCodeDesc);
                const acRowSpan = vesselGroups.length;

                return vesselGroups.map((vg, idx) => {
                  const key = `${ac.accountCode}__${vg.vesselName || 'no_vessel'}__${idx}`;
                  const isFirstRowOfAc = idx === 0;

                  const handleRowClick = () => {
                    setSelectedDetail({
                      poNos: vg.poNos,
                      vesselName: vg.vesselName,
                      vendors: vg.vendors,
                      accountCode: ac.accountCode,
                      accountCodeDesc: ac.accountCodeDesc,
                      totalSpendInr: vg.totalSpendInr,
                      totalSpendUsd: vg.totalSpendUsd,
                      itemCount: vg.itemCount,
                      items: vg.items,
                    });
                  };

                  return (
                    <tr
                      key={key}
                      className={`po-acct-row ${isFirstRowOfAc ? 'po-boundary-top' : 'po-sub-row'} row-clickable ${selectedVessel ? 'po-single-vessel-row' : ''}`}
                      onClick={handleRowClick}
                      title={`Click row to view all items for ${vg.vesselName || 'vessel'} under ${parsed.code}`}
                    >
                      {/* FIRST COLUMN: Account Code (Spans all vessels under this Account Code) */}
                      {isFirstRowOfAc && (
                        <td rowSpan={acRowSpan} className={`cell-acct-spanned ${selectedVessel ? 'cell-single-vessel' : ''}`}>
                          <div className="acct-code-display">
                            <div className="acct-code-top-row">
                              <span className="acct-code-badge">{parsed.code}</span>
                              <span className="acct-po-count-tag">
                                {ac.totalPos} {ac.totalPos === 1 ? 'PO' : 'POs'}
                              </span>
                            </div>

                            {parsed.desc && (
                              <div className="acct-desc-title">{parsed.desc}</div>
                            )}

                            {/* Mini Executive Summary Card for this Account Code (only in All Vessels when spanning multiple vessel groups) */}
                            {!selectedVessel && acRowSpan > 1 && (
                              <div className="acct-spend-summary-card">
                                <div className="acct-card-spend-usd">{formatUSD(ac.totalSpendUsd)}</div>
                                <div className="acct-card-spend-inr">{formatINR(ac.totalSpendInr)}</div>
                                <div className="acct-card-items-count">
                                  <span>{ac.totalItems} items across {ac.totalPos} PO{ac.totalPos === 1 ? '' : 's'}</span>
                                </div>
                              </div>
                            )}
                          </div>
                        </td>
                      )}

                      {/* SECOND COLUMN: Vessel */}
                      <td className="cell-vessel">
                        {vg.vesselName ? (
                          <span className={`vessel-table-badge ${getVesselColorClass(vg.vesselName)}`}>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M2 20a6 6 0 0 0 12 0 6 6 0 0 0 10 0"/><path d="m4 16 1.5-6h13l1.5 6"/><path d="M10 10V4h4v6"/>
                            </svg>
                            {vg.vesselName}
                          </span>
                        ) : (
                          <span className="cell-muted">—</span>
                        )}
                      </td>

                      {/* THIRD COLUMN: PO Number(s) (Single Shell with signature colors) */}
                      <td className="cell-po-no">
                        <div className="po-badges-wrap">
                          {vg.poNos.map((poNo) => {
                            const col = getPoColor(poNo, vg.poNos);
                            return (
                              <span
                                key={poNo}
                                className="po-no-badge po-no-badge-colored"
                                style={{
                                  backgroundColor: col.bg,
                                  color: col.text,
                                  borderColor: col.border,
                                }}
                              >
                                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
                                </svg>
                                {poNo}
                              </span>
                            );
                          })}
                        </div>
                      </td>

                      {/* FOURTH COLUMN: Items Count */}
                      <td className="cell-items-count">
                        <span className="acct-items-badge">
                          {vg.itemCount} {vg.itemCount === 1 ? 'item' : 'items'}
                        </span>
                      </td>

                      {/* FIFTH COLUMN: Spend (INR) */}
                      <td className="cell-spend inr">
                        {formatINR(vg.totalSpendInr)}
                      </td>

                      {/* SIXTH COLUMN: Spend (USD) + View Pill */}
                      <td className="cell-spend usd">
                        <div className="spend-usd-cell-content">
                          <span className="spend-usd-value">{formatUSD(vg.totalSpendUsd)}</span>
                          <span className="view-items-pill">
                            <span>View</span>
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="9 18 15 12 9 6" />
                            </svg>
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                });
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Details in Clean & Professional Modal */}
      {selectedDetail && (
        <PoItemDetailsModal
          detail={selectedDetail}
          onClose={() => setSelectedDetail(null)}
        />
      )}
    </div>
  );
}
