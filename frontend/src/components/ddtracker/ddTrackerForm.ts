import type { DdTrackerEntry, DdTrackerEntryInput } from '../../shared';

// All-string form state, same convention as PiEntryFormState — number/date inputs are kept as
// strings while being typed and only parsed into the real payload shape on submit (see
// toDdTrackerPayload), so a half-typed number never gets silently coerced to NaN mid-edit.
export interface DdTrackerFormState {
  entryType: string;
  requisitionNo: string;
  poNo: string;
  vesselName: string;
  title: string;
  prStatus: string;
  orderStatus: string;
  readinessDate: string;
  exStock: string;
  supplyConfirmation: string;
  remarks: string;
  invoiceType: string;
  paymentStatus: string;
}

export function blankDdTrackerForm(): DdTrackerFormState {
  return {
    entryType: 'DD',
    requisitionNo: '',
    poNo: '',
    vesselName: '',
    title: '',
    prStatus: '',
    orderStatus: '',
    readinessDate: '',
    exStock: '',
    supplyConfirmation: '',
    remarks: '',
    invoiceType: '',
    paymentStatus: '',
  };
}

export function ddTrackerFormFromEntry(entry: DdTrackerEntry): DdTrackerFormState {
  return {
    entryType: entry.entryType ?? '',
    requisitionNo: entry.requisitionNo ?? '',
    poNo: entry.poNo ?? '',
    vesselName: entry.vesselName ?? '',
    title: entry.title ?? '',
    prStatus: entry.prStatus ?? '',
    orderStatus: entry.orderStatus ?? '',
    readinessDate: entry.readinessDate ?? '',
    exStock: entry.exStock ?? '',
    supplyConfirmation: entry.supplyConfirmation ?? '',
    remarks: entry.remarks ?? '',
    invoiceType: entry.invoiceType ?? '',
    paymentStatus: entry.paymentStatus ?? '',
  };
}

export function toDdTrackerPayload(form: DdTrackerFormState): DdTrackerEntryInput {
  return {
    entryType: form.entryType.trim() || null,
    requisitionNo: form.requisitionNo.trim() || null,
    poNo: form.poNo.trim() || null,
    vesselName: form.vesselName.trim() || null,
    title: form.title.trim() || null,
    prStatus: form.prStatus.trim() || null,
    orderStatus: form.orderStatus.trim() || null,
    readinessDate: form.readinessDate || null,
    exStock: form.exStock.trim() || null,
    supplyConfirmation: form.supplyConfirmation.trim() || null,
    remarks: form.remarks.trim() || null,
    invoiceType: form.invoiceType.trim() || null,
    paymentStatus: form.paymentStatus.trim() || null,
  };
}
