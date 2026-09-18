# ===========================================================================
# app/services/pir_vessel_matcher.py
#
# Matches a PIR row's raw SmartPAL vessel_name against our own vessels table,
# so PIRPage.tsx can group by the real vessel instead of by whatever string
# variant SmartPAL happened to carry (confirmed live, 2026-09-02: the same
# vessel appears as "AMNSI Stallion", "AMNSI STALLION", "POLAR" for
# "AMNS POLAR", etc. — different vendors clearly use different naming
# conventions when they key in the vessel field).
#
# Not a stored column — computed at query time in pir_entries.py, same
# "computed live" convention as the department classification.
# ===========================================================================
import re

NO_VESSEL_GROUP = "No vessel assigned"
UNMATCHED_VESSEL_GROUP = "Not in Fleet"

# Below this length, a substring-containment match is too likely to be a false positive (e.g. a
# short code that happens to appear inside an unrelated vessel name) — require an exact
# normalized match instead for short raw names.
_MIN_SUBSTRING_LEN = 4


def normalize_vessel_name(name: str) -> str:
    """Uppercase, strip everything but letters/digits — same style as
    vendor_mapping_importer.normalize_vendor_name, so "AMNS Polar", "AMNS  POLAR", and
    "amns-polar" all normalize identically."""
    return re.sub(r"[^A-Z0-9]", "", name.upper())


def match_vessel_group(raw_vessel_name: str | None, db_vessel_names: list[str]) -> str:
    """Returns the canonical DB vessel name this row belongs to, or one of the two catch-all
    group names. db_vessel_names are the raw (non-normalized) names from the vessels table.

    Confirmed live against real PIR data (2026-09-02) — three real cases this must handle:
      1. Exact variant: "AMNSI Stallion" vs DB "AMNSI STALLION" — case/spacing only.
      2. Partial: "POLAR" vs DB "AMNS POLAR" — the raw name is a substring of the real name.
      3. Concatenated garbage: "GCLGANGAGCLNARMADAGCLSABARMATIGCLTAPIGCLYAMUNA" — SEVERAL real
         vessel names smashed together with no separator (a SmartPAL/vendor data-quality issue,
         not a naming variant). Substring matching alone would match multiple DB vessels here;
         rather than silently pick one, this counts distinct matches and falls back to
         UNMATCHED_VESSEL_GROUP whenever a raw name matches more than one vessel — confirmed
         with the user this ambiguous case should NOT be guessed at.
    """
    if not raw_vessel_name or not raw_vessel_name.strip():
        return NO_VESSEL_GROUP

    normalized_raw = normalize_vessel_name(raw_vessel_name)
    if not normalized_raw:
        return NO_VESSEL_GROUP

    normalized_db = {name: normalize_vessel_name(name) for name in db_vessel_names}

    # Pass 1: exact normalized match — covers the vast majority of real rows.
    exact_matches = [name for name, norm in normalized_db.items() if norm == normalized_raw]
    if len(exact_matches) == 1:
        return exact_matches[0]

    # Pass 2: substring containment either direction, guarded by a minimum length so a short
    # raw name can't spuriously match by coincidence.
    if len(normalized_raw) >= _MIN_SUBSTRING_LEN:
        contains_matches = [
            name
            for name, norm in normalized_db.items()
            if len(norm) >= _MIN_SUBSTRING_LEN and (norm in normalized_raw or normalized_raw in norm)
        ]
        if len(contains_matches) == 1:
            return contains_matches[0]
        if len(contains_matches) > 1:
            # Ambiguous (e.g. the concatenated-names case) — don't guess.
            return UNMATCHED_VESSEL_GROUP

    return UNMATCHED_VESSEL_GROUP


def resolve_vessel_group(
    vessel_name: str | None,
    assigned_vessel_id,
    vessel_id_to_name: dict,
    db_vessel_names: list[str],
) -> str:
    """Single entry point used by every PIR endpoint that needs a row's vessel group (list, kpis,
    assign) — a manual "Assign vessel" (assigned_vessel_id, see PirEntry.assigned_vessel_id)
    always takes precedence over the scraped vessel_name matching, since it's a deliberate human
    correction of exactly the case match_vessel_group couldn't resolve on its own."""
    if assigned_vessel_id is not None:
        name = vessel_id_to_name.get(assigned_vessel_id)
        if name:
            return name
    return match_vessel_group(vessel_name, db_vessel_names)
