from datetime import date, datetime

from app.schemas.base import CamelModel


class PendingItemOut(CamelModel):
    stage: str  # "Requisition" | "Purchase Order" | "Invoice"
    reference_no: str | None
    title: str | None = None
    vessel_name: str | None
    vendor: str | None
    status: str | None
    owner_role: str  # "TSI" | "TA" | "Disputed"
    owner_name: str | None
    ageing_days: int | None
    reference_date: date | None
    priority: str | None = None
    critical: bool | None = None
    department: str | None = None
    req_category: str | None = None
    # Only populated for Invoice-stage rows whose status is "Disputed" — see
    # smartpal_invoice_scraper.py's _scrape_dispute_details. Null for every other item.
    disputed_by: str | None = None
    disputed_at: datetime | None = None
    disputed_remarks: str | None = None
    # Only populated for Invoice-stage rows whose status is "Disputed" (confirmed with the user
    # 2026-11-27 the Disputed table should show the VENDOR's own invoice number, not SmartPAL's
    # internal one, since that's what the Purchase team actually references when chasing a vendor).
    # reference_no stays SmartPAL's internal invoice_no for every Invoice-stage row regardless —
    # it's still the key the dispute-mail endpoints look the invoice up by.
    vendor_invoice_no: str | None = None


class PendingItemsFilterOptions(CamelModel):
    vessel_name: list[str]
    stage: list[str]
    owner_name: list[str]
    status: list[str]


class PendingItemsCountEntry(CamelModel):
    """One (stage, owner_role) combination's row count — drives the tab/sub-tab badges on the
    frontend, e.g. "Requisition" tab > "TSI Pending" sub-tab shows this count."""

    stage: str
    owner_role: str
    count: int


class PendingVesselCount(CamelModel):
    vessel_name: str
    count: int


class PendingOwnerBreakdown(CamelModel):
    owner_name: str
    owner_role: str  # "TSI" | "TA"
    total_count: int
    vessels: list[PendingVesselCount]


class PendingStageBreakdown(CamelModel):
    stage: str
    total: int
    tsi_total: int
    ta_total: int
    owners: list[PendingOwnerBreakdown]


class PendingDashboardVesselRow(CamelModel):
    vessel_name: str
    requisition_count: int
    po_count: int
    invoice_count: int
    total_count: int
    weekly_trend: list[int | None] = []
    weekly_trend_statuses: list[str] = []
    trend_diff: int = 0
    trend_status: str = "neutral"


class PendingDashboardOwnerGroup(CamelModel):
    owner_name: str
    owner_role: str  # "TSI" | "TA"
    requisition_total: int
    po_total: int
    invoice_total: int
    total_count: int
    vessels: list[PendingDashboardVesselRow]
    weekly_trend: list[int | None] = []
    weekly_trend_statuses: list[str] = []
    trend_diff: int = 0
    trend_status: str = "neutral"


class PendingDashboardTotals(CamelModel):
    requisition_total: int
    po_total: int
    invoice_total: int
    grand_total: int
    weekly_trend: list[int | None] = []
    weekly_trend_statuses: list[str] = []
    trend_diff: int = 0
    trend_status: str = "neutral"


class PendingDashboardSummaryResponse(CamelModel):
    tsi_groups: list[PendingDashboardOwnerGroup]
    ta_groups: list[PendingDashboardOwnerGroup]
    tsi_totals: PendingDashboardTotals
    ta_totals: PendingDashboardTotals
    fleet_totals: PendingDashboardTotals
    week_labels: list[str] = []


class SendPendingSummaryEmailRequest(CamelModel):
    role: str = "ALL"  # "ALL", "TSI", "TA"
    stage: str | None = None
    test_email: str | None = None
    subject: str | None = None
    to_emails: list[str] | None = None
    cc_emails: list[str] | None = None


class SendPendingSummaryEmailResponse(CamelModel):
    sent: bool
    role: str
    stage: str | None
    recipients: list[str]
    cc_recipients: list[str] = []
    subject: str
    from_mailbox: str
    attachment_filename: str
    attachment_filenames: list[str] = []
    items_count: int


class PreviewPendingSummaryEmailResponse(CamelModel):
    role: str
    stage: str | None
    subject: str
    from_mailbox: str
    default_to_emails: list[str]
    default_cc_emails: list[str] = []
    attachment_filename: str
    attachment_filenames: list[str] = []
    items_count: int
    html_body: str


class InvoiceDisputeMailPreviewRequest(CamelModel):
    invoice_no: str


class InvoiceDisputeMailPreviewResponse(CamelModel):
    invoice_no: str
    vessel_name: str | None
    vendor_name: str | None
    subject: str
    body: str
    default_to_emails: list[str]
    vendor_email_found: bool
    from_mailbox: str


class SendInvoiceDisputeMailRequest(CamelModel):
    invoice_no: str
    subject: str
    body: str
    to_emails: list[str]
    cc_emails: list[str] | None = None


class SendInvoiceDisputeMailResponse(CamelModel):
    sent: bool
    recipients: list[str]
    cc_recipients: list[str] = []
    subject: str
    from_mailbox: str


class VesselPrReviewEmailRequest(CamelModel):
    vessel_name: str
    pr_type: str = "ageing_90"  # "all" | "critical" | "ageing_90"
    role: str = "ALL"  # "ALL" | "TSI" | "TA"
    subject: str | None = None
    to_emails: list[str] | None = None
    cc_emails: list[str] | None = None
    test_email: str | None = None


class PreviewVesselPrReviewEmailResponse(CamelModel):
    vessel_name: str
    pr_type: str
    subject: str
    from_mailbox: str
    default_to_emails: list[str]
    default_cc_emails: list[str] = []
    items_count: int
    items: list[PendingItemOut]
    html_body: str
    attachment_filename: str


class SendVesselPrReviewEmailResponse(CamelModel):
    sent: bool
    vessel_name: str
    pr_type: str
    recipients: list[str]
    cc_recipients: list[str] = []
    subject: str
    from_mailbox: str
    attachment_filename: str
    items_count: int



