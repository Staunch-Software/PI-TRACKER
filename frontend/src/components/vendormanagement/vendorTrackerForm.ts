import type { VendorTrackerEntry, VendorTrackerEntryBankUpdateInput } from '../../shared';

// All-string form state for the 6 manually-keyed bank override fields, same convention as
// ddTrackerForm.ts — trims and blank-to-null on submit.
export interface VendorBankFormState {
  bankBeneficiaryName: string;
  bankName: string;
  bankBranchName: string;
  bankAccountNumber: string;
  bankIban: string;
  bankSwiftCode: string;
}

export function blankBankForm(): VendorBankFormState {
  return {
    bankBeneficiaryName: '',
    bankName: '',
    bankBranchName: '',
    bankAccountNumber: '',
    bankIban: '',
    bankSwiftCode: '',
  };
}

export function bankFormFromEntry(entry: VendorTrackerEntry): VendorBankFormState {
  return {
    bankBeneficiaryName: entry.bankBeneficiaryName ?? '',
    bankName: entry.bankName ?? '',
    bankBranchName: entry.bankBranchName ?? '',
    bankAccountNumber: entry.bankAccountNumber ?? '',
    bankIban: entry.bankIban ?? '',
    bankSwiftCode: entry.bankSwiftCode ?? '',
  };
}

export function toBankUpdatePayload(form: VendorBankFormState): VendorTrackerEntryBankUpdateInput {
  return {
    bankBeneficiaryName: form.bankBeneficiaryName.trim() || null,
    bankName: form.bankName.trim() || null,
    bankBranchName: form.bankBranchName.trim() || null,
    bankAccountNumber: form.bankAccountNumber.trim() || null,
    bankIban: form.bankIban.trim() || null,
    bankSwiftCode: form.bankSwiftCode.trim() || null,
  };
}
