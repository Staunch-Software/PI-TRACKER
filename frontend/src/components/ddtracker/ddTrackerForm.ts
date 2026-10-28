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
  leadDays: string;
  readinessDate: string;
  exStock: string;
  supplyConfirmation: string;
  remarks1: string;
  remarks2: string;
  invoiceNumber: string;
  invoiceType: string;
  invoiceAmount: string;
  invoiceCurrency: string;
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
    leadDays: '',
    readinessDate: '',
    exStock: '',
    supplyConfirmation: '',
    remarks1: '',
    remarks2: '',
    invoiceNumber: '',
    invoiceType: '',
    invoiceAmount: '',
    invoiceCurrency: '',
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
    leadDays: entry.leadDays?.toString() ?? '',
    readinessDate: entry.readinessDate ?? '',
    exStock: entry.exStock ?? '',
    supplyConfirmation: entry.supplyConfirmation ?? '',
    remarks1: entry.remarks1 ?? '',
    remarks2: entry.remarks2 ?? '',
    invoiceNumber: entry.invoiceNumber ?? '',
    invoiceType: entry.invoiceType ?? '',
    invoiceAmount: entry.invoiceAmount?.toString() ?? '',
    invoiceCurrency: entry.invoiceCurrency ?? '',
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
    leadDays: form.leadDays.trim() ? Number(form.leadDays) : null,
    readinessDate: form.readinessDate || null,
    exStock: form.exStock.trim() || null,
    supplyConfirmation: form.supplyConfirmation.trim() || null,
    remarks1: form.remarks1.trim() || null,
    remarks2: form.remarks2.trim() || null,
    invoiceNumber: form.invoiceNumber.trim() || null,
    invoiceType: form.invoiceType.trim() || null,
    invoiceAmount: form.invoiceAmount.trim() ? Number(form.invoiceAmount) : null,
    invoiceCurrency: form.invoiceCurrency.trim() || null,
    paymentStatus: form.paymentStatus.trim() || null,
  };
}
