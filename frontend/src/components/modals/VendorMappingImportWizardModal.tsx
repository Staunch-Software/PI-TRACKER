import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../lib/api';
import {
  DEPARTMENT_LABELS,
  Department,
  type ColumnMappingCandidate,
  type VendorImportCommitResponse,
  type VendorImportParseResponse,
} from '../../shared';
import { FolderUploadIcon } from '../common/FolderUploadIcon';
import { DocumentCheckIcon } from '../common/DocumentCheckIcon';

interface Props {
  onClose: () => void;
}

type Step = 'upload' | 'mapping' | 'preview' | 'result';
type MappingField = 'vendorName' | 'department' | '';

export function VendorMappingImportWizardModal({ onClose }: Props) {
  const [step, setStep] = useState<Step>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [headers, setHeaders] = useState<ColumnMappingCandidate[]>([]);
  const [columnPicks, setColumnPicks] = useState<Record<number, MappingField>>({});
  const [parseResult, setParseResult] = useState<VendorImportParseResponse | null>(null);
  const [commitResult, setCommitResult] = useState<VendorImportCommitResponse | null>(null);
  const queryClient = useQueryClient();

  const validRowCount = useMemo(() => {
    if (!parseResult) return 0;
    return parseResult.rows.filter((r) => !r.errors.length).length;
  }, [parseResult]);

  const pickedVendorCol = Object.entries(columnPicks).find(([, f]) => f === 'vendorName')?.[0];
  const pickedDepartmentCol = Object.entries(columnPicks).find(([, f]) => f === 'department')?.[0];
  const mappingComplete = pickedVendorCol !== undefined && pickedDepartmentCol !== undefined;

  async function runParse(columnMapping?: { vendorName: number; department: number }) {
    if (!file) return;
    setError(null);
    setIsParsing(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      if (columnMapping) formData.append('column_mapping', JSON.stringify(columnMapping));
      const result = await api.postForm<VendorImportParseResponse>('/vendor-mapping/import/parse', formData);
      if (result.needsMapping) {
        setHeaders(result.headers);
        // Pre-select whatever the backend already guessed, so the user only has to fix ambiguity.
        const initialPicks: Record<number, MappingField> = {};
        for (const h of result.headers) {
          if (h.guessedField === 'vendor_name') initialPicks[h.columnIndex] = 'vendorName';
          if (h.guessedField === 'department') initialPicks[h.columnIndex] = 'department';
        }
        setColumnPicks(initialPicks);
        setStep('mapping');
      } else {
        setParseResult(result);
        setStep('preview');
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to parse the file.');
    } finally {
      setIsParsing(false);
    }
  }

  function handleConfirmMapping() {
    if (!pickedVendorCol || !pickedDepartmentCol) return;
    runParse({ vendorName: Number(pickedVendorCol), department: Number(pickedDepartmentCol) });
  }

  async function handleCommit() {
    if (!parseResult) return;
    setError(null);
    setIsCommitting(true);
    try {
      const rows = parseResult.rows
        .filter((r) => !r.errors.length)
        .map((r) => ({ rowNumber: r.rowNumber, vendorName: r.vendorName, department: r.department }));
      const result = await api.post<VendorImportCommitResponse>('/vendor-mapping/import/commit', { rows });
      setCommitResult(result);
      queryClient.invalidateQueries({ queryKey: ['admin-vendor-mapping'] });
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
          <h2>
            Import Vendor Mapping from Excel
            {step === 'mapping' ? ' — Confirm Columns' : step === 'preview' ? ' — Review' : step === 'result' ? ' — Done' : ''}
          </h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="modal-body">
          {step === 'upload' && (
            <div>
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
                }}
              >
                <input
                  type="file"
                  accept=".xlsx,.xlsm"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%' }}
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
                    'Expects a Vendor Name column and a Department column (Technical / Manning)'
                  )}
                </p>
              </div>
              {error && <p className="form-error">{error}</p>}
            </div>
          )}

          {step === 'mapping' && (
            <div>
              <p style={{ marginTop: 0, color: 'var(--color-text-muted)', fontSize: 13 }}>
                We couldn't confidently match your file's columns to Vendor Name and Department. Pick which column is
                which below.
              </p>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Column Header (from file)</th>
                    <th>Maps To</th>
                  </tr>
                </thead>
                <tbody>
                  {headers.map((h) => (
                    <tr key={h.columnIndex}>
                      <td>{h.rawHeader}</td>
                      <td>
                        <select
                          value={columnPicks[h.columnIndex] ?? ''}
                          onChange={(e) =>
                            setColumnPicks((prev) => ({ ...prev, [h.columnIndex]: e.target.value as MappingField }))
                          }
                        >
                          <option value="">— Ignore —</option>
                          <option value="vendorName">Vendor Name</option>
                          <option value="department">Department</option>
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!mappingComplete && (
                <p className="form-error" style={{ marginTop: 10 }}>
                  Select one column for Vendor Name and one for Department to continue.
                </p>
              )}
              {error && <p className="form-error" style={{ marginTop: 10 }}>{error}</p>}
            </div>
          )}

          {step === 'preview' && parseResult && (
            <div>
              <div className="toolbar" style={{ marginBottom: 10 }}>
                <span><strong>{parseResult.totalRows}</strong> rows found</span>
                <span><strong>{parseResult.validRows}</strong> valid</span>
                <span style={{ color: parseResult.errorRows ? 'var(--color-danger)' : undefined }}>
                  <strong>{parseResult.errorRows}</strong> with errors (will be rejected)
                </span>
              </div>
              <div className="table-scroll" style={{ maxHeight: 360, border: '1px solid var(--color-border)', borderRadius: 8 }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Row</th>
                      <th>Vendor Name</th>
                      <th>Department</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parseResult.rows.map((row) => (
                      <tr key={row.rowNumber}>
                        <td>{row.rowNumber}</td>
                        <td>{row.vendorName ?? '—'}</td>
                        <td>{row.department ? DEPARTMENT_LABELS[row.department as Department] : '—'}</td>
                        <td>
                          {row.errors.length ? (
                            <span style={{ color: 'var(--color-danger)', fontSize: 12 }}>{row.errors.join('; ')}</span>
                          ) : row.isUpdate ? (
                            <span style={{ color: 'var(--color-info)' }}>Existing — will update</span>
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
                {commitResult.rejected.length > 0 && (
                  <span style={{ color: 'var(--color-danger)' }}><strong>{commitResult.rejected.length}</strong> rejected</span>
                )}
              </div>
              {commitResult.rejected.length > 0 && (
                <ul style={{ color: 'var(--color-danger)', fontSize: 13 }}>
                  {commitResult.rejected.map((r) => (
                    <li key={r.rowNumber}>
                      row {r.rowNumber}: {r.reason}
                    </li>
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
              <button className="btn btn-primary" disabled={!file || isParsing} onClick={() => runParse()}>
                {isParsing ? 'Parsing…' : 'Parse File'}
              </button>
            </>
          )}
          {step === 'mapping' && (
            <>
              <button className="btn btn-secondary" onClick={() => setStep('upload')}>
                Back
              </button>
              <button className="btn btn-primary" disabled={!mappingComplete || isParsing} onClick={handleConfirmMapping}>
                {isParsing ? 'Parsing…' : 'Continue'}
              </button>
            </>
          )}
          {step === 'preview' && (
            <>
              <button className="btn btn-secondary" onClick={() => setStep('upload')}>
                Back
              </button>
              <button className="btn btn-primary" disabled={!validRowCount || isCommitting} onClick={handleCommit}>
                {isCommitting ? 'Importing…' : `Commit ${validRowCount} Row${validRowCount === 1 ? '' : 's'}`}
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
