import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../lib/api';
import { FOLLOW_UP_STATUS_LABELS, type ImportCommitResponse, type ImportDecision, type ImportParseResponse } from '../../shared';

interface Props {
  onClose: () => void;
}

type Step = 'upload' | 'preview' | 'result';

export function ImportWizardModal({ onClose }: Props) {
  const [step, setStep] = useState<Step>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parseResult, setParseResult] = useState<ImportParseResponse | null>(null);
  const [decisions, setDecisions] = useState<Record<number, ImportDecision>>({});
  const [commitResult, setCommitResult] = useState<ImportCommitResponse | null>(null);
  const queryClient = useQueryClient();

  const willCommitCount = useMemo(() => {
    if (!parseResult) return 0;
    return parseResult.rows.filter((r) => !r.errors.length && decisions[r.rowNumber] !== 'skip').length;
  }, [parseResult, decisions]);

  async function handleParse() {
    if (!file) return;
    setError(null);
    setIsParsing(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const result = await api.postForm<ImportParseResponse>('/import/parse', formData);
      setParseResult(result);
      const initialDecisions: Record<number, ImportDecision> = {};
      for (const row of result.rows) {
        if (row.errors.length) continue;
        initialDecisions[row.rowNumber] = row.isDuplicate ? 'update' : 'insert';
      }
      setDecisions(initialDecisions);
      setStep('preview');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to parse the file.');
    } finally {
      setIsParsing(false);
    }
  }

  async function handleCommit() {
    if (!parseResult) return;
    setError(null);
    setIsCommitting(true);
    try {
      const rows = parseResult.rows
        .filter((r) => !r.errors.length && decisions[r.rowNumber] !== 'skip')
        .map((r) => ({ ...r, decision: decisions[r.rowNumber] }));
      const result = await api.post<ImportCommitResponse>('/import/commit', { rows });
      setCommitResult(result);
      queryClient.invalidateQueries({ queryKey: ['pi-entries'] });
      queryClient.invalidateQueries({ queryKey: ['audit-log'] });
      setStep('result');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Import failed.');
    } finally {
      setIsCommitting(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel" style={{ maxWidth: 920 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Import from Excel {step === 'preview' ? '— Review' : step === 'result' ? '— Done' : ''}</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="modal-body">
          {step === 'upload' && (
            <div>
              <p style={{ color: 'var(--color-text-muted)', marginTop: 0 }}>
                Upload the PI Follow-up Tracker .xlsx file. Rows are matched to the tracker's columns by header
                name; existing DPR Nos. are detected as duplicates so you can choose to update or skip them.
              </p>
              <div className="field">
                <label>Excel file (.xlsx)</label>
                <input
                  type="file"
                  accept=".xlsx,.xlsm"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
              </div>
              {error && <p className="form-error">{error}</p>}
            </div>
          )}

          {step === 'preview' && parseResult && (
            <div>
              <div className="toolbar" style={{ marginBottom: 10 }}>
                <span><strong>{parseResult.totalRows}</strong> rows found</span>
                <span><strong>{parseResult.validRows}</strong> valid</span>
                <span style={{ color: parseResult.errorRows ? 'var(--color-danger)' : undefined }}>
                  <strong>{parseResult.errorRows}</strong> with errors (skipped)
                </span>
                <span><strong>{parseResult.duplicateRows}</strong> duplicates
                </span>
              </div>
              <div className="table-scroll" style={{ maxHeight: 360, border: '1px solid var(--color-border)', borderRadius: 8 }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Row</th>
                      <th>DPR No.</th>
                      <th>Vessel</th>
                      <th>Vendor</th>
                      <th>Amount (INR)</th>
                      <th>Status</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parseResult.rows.map((row) => (
                      <tr key={row.rowNumber}>
                        <td>{row.rowNumber}</td>
                        <td>{row.dprNo ?? '—'}</td>
                        <td>
                          {row.vesselName ?? '—'}
                          {!row.vesselExists && row.vesselName && <span style={{ color: 'var(--color-info)' }}> (new)</span>}
                        </td>
                        <td>
                          {row.vendorName ?? '—'}
                          {!row.vendorExists && row.vendorName && <span style={{ color: 'var(--color-info)' }}> (new)</span>}
                        </td>
                        <td>{row.amountInr ?? '—'}</td>
                        <td>{FOLLOW_UP_STATUS_LABELS[row.followupStatus]}</td>
                        <td>
                          {row.errors.length ? (
                            <span style={{ color: 'var(--color-danger)', fontSize: 12 }}>{row.errors.join('; ')}</span>
                          ) : row.isDuplicate ? (
                            <select
                              value={decisions[row.rowNumber] ?? 'update'}
                              onChange={(e) =>
                                setDecisions((prev) => ({ ...prev, [row.rowNumber]: e.target.value as ImportDecision }))
                              }
                            >
                              <option value="update">Update existing</option>
                              <option value="skip">Skip</option>
                            </select>
                          ) : (
                            <span style={{ color: 'var(--color-success)' }}>New — will add</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {error && <p className="form-error" style={{ marginTop: 10 }}>{error}</p>}
            </div>
          )}

          {step === 'result' && commitResult && (
            <div>
              <div className="toolbar">
                <span style={{ color: 'var(--color-success)' }}><strong>{commitResult.inserted}</strong> added</span>
                <span style={{ color: 'var(--color-info)' }}><strong>{commitResult.updated}</strong> updated</span>
                <span><strong>{commitResult.skipped}</strong> skipped</span>
                {commitResult.failed > 0 && (
                  <span style={{ color: 'var(--color-danger)' }}><strong>{commitResult.failed}</strong> failed</span>
                )}
              </div>
              {commitResult.errors.length > 0 && (
                <ul style={{ color: 'var(--color-danger)', fontSize: 13 }}>
                  {commitResult.errors.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        <div className="modal-footer">
          {step === 'upload' && (
            <>
              <button className="btn btn-secondary" onClick={onClose}>
                Cancel
              </button>
              <button className="btn btn-primary" disabled={!file || isParsing} onClick={handleParse}>
                {isParsing ? 'Parsing…' : 'Parse File'}
              </button>
            </>
          )}
          {step === 'preview' && (
            <>
              <button className="btn btn-secondary" onClick={() => setStep('upload')}>
                Back
              </button>
              <button className="btn btn-primary" disabled={!willCommitCount || isCommitting} onClick={handleCommit}>
                {isCommitting ? 'Importing…' : `Commit ${willCommitCount} Row${willCommitCount === 1 ? '' : 's'}`}
              </button>
            </>
          )}
          {step === 'result' && (
            <button className="btn btn-primary" onClick={onClose}>
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
