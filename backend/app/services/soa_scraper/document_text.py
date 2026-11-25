# ===========================================================================
# backend/app/services/soa_scraper/document_text.py
#
# Flattened-text helpers for the two things in the SOA pipeline that need the email body as plain
# text rather than structure: detecting a quoted-original-sender "From:" line (internal-forwarder
# handling, see extract_original_external_sender below) and — historically — feeding the old LLM
# extraction prompt. The latter is gone (see line_item_extractor.py / table_extraction.py, which
# work on structured tables instead), so this module now only keeps what's still used.
# ===========================================================================
import re

from bs4 import BeautifulSoup

# Matches Outlook's embedded quoted-header line "From: Name <email@domain>" (also appears as
# "From: Name <email@domain> On Behalf Of ..." — confirmed live in real ABS/Shell samples) that
# gets baked into the HTML body on every reply/forward. Deliberately regex, not LLM-guessed — see
# extract_original_external_sender's docstring for why.
_QUOTED_FROM_RE = re.compile(r"From:\s*[|\s]*([^<\n|]+?)\s*<([^<>\s]+@[^<>\s]+)>", re.IGNORECASE)


def html_body_to_text(html: str) -> str:
    if not html:
        return ""
    soup = BeautifulSoup(html, "html.parser")
    return soup.get_text(separator=" | ", strip=True)


def extract_original_external_sender(body_html: str, internal_domains: set[str]) -> tuple[str, str] | None:
    """Finds the real vendor identity when the polled mailbox's immediate sender is one of OUR
    OWN staff forwarding/replying on an existing vendor thread, rather than the vendor
    themselves — confirmed live: an internal Ozellar Accounts person replied on a Navarino SOA
    thread from her own address, and since ingest.py otherwise always trusts the immediate
    sender as vendor identity (deliberately — see SoaDocument docstring on why vendor identity
    must come from the sender, never guessed from body content), that created a bogus separate
    "vendor" for a purely internal forward.

    Outlook bakes the original message's headers into the HTML body on every reply/forward
    ("From: Andreas Tanios <andreas.tanios@navarino.gr>" — confirmed live in real Shell/ABS/
    Navarino samples), so this is deterministically regex-extractable. Returns (name, email) of
    the FIRST quoted "From:" whose domain is external, scanning top-to-bottom (the internal
    person's own forward marker is followed immediately by the original vendor email's header in
    a typical reply chain), or None if no external "From:" is found at all (falls back to
    treating the internal sender as-is — see caller)."""
    text = html_body_to_text(body_html)
    for name, email in _QUOTED_FROM_RE.findall(text):
        domain = email.rsplit("@", 1)[-1].lower()
        if domain not in internal_domains:
            return name.strip(" |\t"), email.strip().lower()
    return None
