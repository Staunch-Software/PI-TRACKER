import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../lib/api';
import { FOLLOW_UP_STATUS_LABELS, type ImportCommitResponse, type ImportDecision, type ImportParseResponse } from '../../shared';
import { FolderUploadIcon } from '../common/FolderUploadIcon';
import { DocumentCheckIcon } from '../common/DocumentCheckIcon';
import { DownloadTemplateIcon } from '../common/DownloadTemplateIcon';
import { SpinnerIcon } from '../common/SpinnerIcon';

interface Props {
  onClose: () => void;
}

type Step = 'upload' | 'preview' | 'result';

export function ImportWizardModal({ onClose }: Props) {
  const [step, setStep] = useState<Step>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parseResult, setParseResult] = useState<ImportParseResponse | null>(null);
  const [decisions, setDecisions] = useState<Record<number, ImportDecision>>({});
  const [commitResult, setCommitResult] = useState<ImportCommitResponse | null>(null);
  const queryClient = useQueryClient();

  const willCommitCount = useMemo(() => {
    if (!parseResult) return 0;
    return parseResult.rows.filter((r) => !r.errors.length && decisions[r.rowNumber] !== 'skip').length;
  }, [parseResult, decisions]);

  async function handleDownloadTemplate() {
    setIsDownloading(true);
    try {
      const { blob, filename } = await api.getBlob('/import/template');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename ?? 'PI_Import_Template.xlsx';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      setError('Could not download the template. Please try again.');
    } finally {
      setIsDownloading(false);
    }
  }

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
              {/* Download template banner */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 14,
                padding: '14px 18px',
                marginBottom: 20,
                background: 'linear-gradient(135deg, var(--color-primary, #1E3A5F) 0%, #2d5b9e 100%)',
                borderRadius: 10,
                boxShadow: '0 2px 12px rgba(30,58,95,0.18)',
              }}>
                <div style={{ flex: 1 }}>
                  <p style={{ margin: 0, fontWeight: 700, color: '#fff', fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <DownloadTemplateIcon size={18} /> Download the Import Template
                  </p>
                  <p style={{ margin: '3px 0 0', color: 'rgba(255,255,255,0.75)', fontSize: 12 }}>
                    Fill in the template and upload it below. It includes dropdown lists for Status &amp; Currency.
                  </p>
                </div>
                <button
                  className="btn"
                  disabled={isDownloading}
                  onClick={handleDownloadTemplate}
                  style={{
                    background: '#fff',
                    color: 'var(--color-primary, #1E3A5F)',
                    fontWeight: 700,
                    fontSize: 13,
                    padding: '8px 18px',
                    borderRadius: 7,
                    border: 'none',
                    cursor: isDownloading ? 'not-allowed' : 'pointer',
                    whiteSpace: 'nowrap',
                    boxShadow: '0 1px 4px rgba(0,0,0,0.12)',
                    transition: 'opacity 0.15s',
                    opacity: isDownloading ? 0.7 : 1,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center' }}>
                    {isDownloading ? <><SpinnerIcon size={16} /> Downloading…</> : <><DownloadTemplateIcon size={16} /> Download Template</>}
                  </div>
                </button>
              </div>

              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={(e) => {
                  e.preventDefault();
                  setIsDragging(false);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDragging(false);
                  const droppedFile = e.dataTransfer.files[0];
                  if (droppedFile) setFile(droppedFile);
                }}
                style={{
                  border: `2px dashed ${isDragging ? 'var(--color-primary)' : 'var(--color-border)'}`,
                  borderRadius: 12,
                  padding: '40px 20px',
                  textAlign: 'center',
                  background: isDragging ? 'var(--color-bg-hover)' : 'var(--color-bg-subtle)',
                  transition: 'all 0.2s ease',
                  cursor: 'pointer',
                  position: 'relative',
                  marginTop: 20,
                }}
              >
                <input
                  type="file"
                  accept=".xlsx,.xlsm"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  style={{
                    position: 'absolute',
                    inset: 0,
                    opacity: 0,
                    cursor: 'pointer',
                    width: '100%',
                  }}
                />
                <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'center', color: file ? 'var(--color-success)' : 'var(--color-text-muted)' }}>
                  {file ? <DocumentCheckIcon size={40} /> : <FolderUploadIcon size={40} />}
                </div>
                <h3 style={{ margin: '0 0 8px', fontSize: 16, color: 'var(--color-text)' }}>
                  {file ? file.name : 'Click or drag your Excel file here'}
                </h3>
                <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)' }}>
                  {file ? (
                    <span style={{ color: 'var(--color-success)' }}>Ready to parse</span>
                  ) : (
                    'Supports .xlsx and .xlsm files'
                  )}
                </p>
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
