import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../lib/api';
import { SearchableSelect } from '../common/SearchableSelect';
import { OilType, type LandingReport, type LandingReportInput, type Vessel } from '../../shared';

interface Props {
  report: LandingReport | null;
  onClose: () => void;
}

export function LandingReportModal({ report, onClose }: Props) {
  const isEdit = report !== null;
  const [vesselId, setVesselId] = useState(report?.vesselId ?? '');
  const [port, setPort] = useState(report?.port ?? '');
  const [oilType, setOilType] = useState<OilType | ''>(report?.oilType ?? '');
  const [offlandedDate, setOfflandedDate] = useState(report?.offlandedDate ?? '');
  const [shipmentStatus, setShipmentStatus] = useState(report?.shipmentStatus ?? '');
  const [reportStatus, setReportStatus] = useState(report?.reportStatus ?? '');
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  // All vessels, not just the ones flagged "Show in PI dropdown" (is_active) — Landing Reports
  // isn't limited to the PI vessel list.
  const vesselsQuery = useQuery({
    queryKey: ['vessels', 'all'],
    queryFn: () => api.get<Vessel[]>('/vessels?include_inactive=true'),
  });

  const saveMutation = useMutation({
    mutationFn: () => {
      const body: LandingReportInput = {
        vesselId,
        port: port.trim() || null,
        oilType: oilType as OilType,
        offlandedDate: offlandedDate || null,
        shipmentStatus: shipmentStatus.trim() || null,
        reportStatus: reportStatus.trim() || null,
      };
      return isEdit
        ? api.patch<LandingReport>(`/landing-reports/${report.id}`, body)
        : api.post<LandingReport>('/landing-reports', body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['landing-reports'] });
      onClose();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Failed to save landing report.'),
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!vesselId || !oilType) {
      setError('Please select a vessel and an oil type.');
      return;
    }
    setError(null);
    saveMutation.mutate();
  }

  // An edited report may point at a vessel that has since been deactivated — keep it selectable
  // so the form doesn't silently blank the field.
  const vessels = vesselsQuery.data ?? [];
  const vesselOptions = vessels.map((v) => ({ value: v.id, label: v.name }));
  if (isEdit && vesselId && !vessels.some((v) => v.id === vesselId)) {
    vesselOptions.unshift({ value: vesselId, label: report.vesselName });
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{isEdit ? `Edit Landing Report — S.No ${report.seqNo}` : 'Add Landing Report'}</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="form-grid landing-reports-form-grid">
              <div className="field">
                <label>Vessel Name</label>
                <SearchableSelect
                  options={vesselOptions}
                  value={vesselId}
                  onChange={setVesselId}
                  placeholder="Select vessel…"
                />
              </div>
              <div className="field">
                <label>Port</label>
                <input value={port} onChange={(e) => setPort(e.target.value)} maxLength={255} />
              </div>
              <div className="field">
                <label>Oil Type</label>
                <SearchableSelect
                  options={Object.values(OilType).map((o) => ({ value: o, label: o }))}
                  value={oilType}
                  onChange={(v) => setOilType(v as OilType)}
                  placeholder="Select oil type…"
                />
              </div>
              <div className="field">
                <label>Offlanded Date</label>
                <input type="date" value={offlandedDate} onChange={(e) => setOfflandedDate(e.target.value)} />
              </div>
              <div className="field">
                <label>Shipment Status</label>
                <input value={shipmentStatus} onChange={(e) => setShipmentStatus(e.target.value)} maxLength={255} />
              </div>
              <div className="field">
                <label>Report Status</label>
                <input value={reportStatus} onChange={(e) => setReportStatus(e.target.value)} maxLength={255} />
              </div>
            </div>
            {error && <p className="form-error landing-reports-form-error">{error}</p>}
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={saveMutation.isPending}>
              {saveMutation.isPending ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Report'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
