import { Currency, FollowUpStatus, type PiEntry } from '../shared';

export interface PiEntryFormState {
  dprNo: string;
  dprDate: string;
  vesselId: string;
  vendorId: string;
  serviceDetails: string;
  amountInr: string;
  fcAmount: string;
  currency: Currency;
  paymentDate: string;
  paymentReference: string;
  followupStatus: FollowUpStatus;
  lastKnownRemark: string;
  reminder1SentDate: string;
  reminder2SentDate: string;
  finalInvoiceReceived: boolean;
  poNumber: string;
  invoiceNo: string;
  invoiceDate: string;
  notes: string;
}

export function blankPiEntryForm(): PiEntryFormState {
  return toPiEntryFormState(null);
}

export function toPiEntryFormState(entry: PiEntry | null): PiEntryFormState {
  return {
    dprNo: entry?.dprNo ?? '',
    dprDate: entry?.dprDate ?? '',
    vesselId: entry?.vesselId ?? '',
    vendorId: entry?.vendorId ?? '',
    serviceDetails: entry?.serviceDetails ?? '',
    amountInr: entry?.amountInr != null ? String(entry.amountInr) : '',
    fcAmount: entry?.fcAmount != null ? String(entry.fcAmount) : '',
    currency: entry?.currency ?? Currency.INR,
    paymentDate: entry?.paymentDate ?? '',
    paymentReference: entry?.paymentReference ?? '',
    followupStatus: entry?.followupStatus ?? FollowUpStatus.PENDING_NOT_YET_FOLLOWED_UP,
    lastKnownRemark: entry?.lastKnownRemark ?? '',
    reminder1SentDate: entry?.reminder1SentDate ?? '',
    reminder2SentDate: entry?.reminder2SentDate ?? '',
    finalInvoiceReceived: entry?.finalInvoiceReceived ?? false,
    poNumber: entry?.poNumber ?? '',
    invoiceNo: entry?.invoiceNo ?? '',
    invoiceDate: entry?.invoiceDate ?? '',
    notes: entry?.notes ?? '',
  };
}

export function toPiEntryPayload(form: PiEntryFormState) {
  return {
    dprNo: form.dprNo.trim(),
    dprDate: form.dprDate || null,
    vesselId: form.vesselId,
    vendorId: form.vendorId,
    serviceDetails: form.serviceDetails || null,
    amountInr: form.amountInr ? Number(form.amountInr) : null,
    fcAmount: form.fcAmount ? Number(form.fcAmount) : null,
    currency: form.currency,
    paymentDate: form.paymentDate || null,
    paymentReference: form.paymentReference || null,
    followupStatus: form.followupStatus,
    lastKnownRemark: form.lastKnownRemark || null,
    reminder1SentDate: form.reminder1SentDate || null,
    reminder2SentDate: form.reminder2SentDate || null,
    finalInvoiceReceived: form.finalInvoiceReceived,
    poNumber: form.poNumber || null,
    invoiceNo: form.invoiceNo || null,
    invoiceDate: form.invoiceDate || null,
    notes: form.notes || null,
  };
}
