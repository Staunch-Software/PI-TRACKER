import os
import sys
from datetime import datetime
from sqlalchemy.orm import Session
from sqlalchemy import func
import uuid

# Add current directory to path so we can import app modules
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from app.db.session import SessionLocal
from app.models.pi_entry import PiEntry, Currency, FollowUpStatus
from app.models.vessel import Vessel
from app.models.vendor import Vendor
from app.models.user import User

def parse_currency(amount_str):
    if not amount_str:
        return 0.0
    # Remove commas and spaces
    clean = amount_str.replace(',', '').strip()
    try:
        return float(clean)
    except ValueError:
        return 0.0

def main(filepath):
    print(f"Reading markdown file: {filepath}")
    with open(filepath, 'r', encoding='utf-8') as f:
        lines = f.readlines()
        
    db: Session = SessionLocal()
    
    # Get Admin User for created_by
    admin_id_tuple = db.query(User.id).filter(User.role == "ADMIN").first()
    if not admin_id_tuple:
        print("Error: No ADMIN user found in the database. Please run seed.py first.")
        return
        
    admin_id = admin_id_tuple[0]

    # Vessel Profit Center mapping based on the data
    vessel_mapping = {
        '7001': 'AMNSI STALLION',
        '7002': 'AMNSI MAXIMUS',
        '7005': 'AMNS POLAR',
        '7006': 'AMNS TUFMAX'
    }

    vessels_db = {name: v_id for v_id, name in db.query(Vessel.id, Vessel.name).all()}
    vendors_db = {name.lower(): v_id for v_id, name in db.query(Vendor.id, Vendor.name).all()}

    success_count = 0
    error_count = 0
    seen_dpr_nos = set()

    for i, line in enumerate(lines):
        line = line.strip()
        if not line.startswith('|') or 'Supplier' in line or '---' in line:
            continue
            
        parts = [p.strip() for p in line.split('|')]
        # Parts will have an empty string at index 0 and at the end because of the leading/trailing |
        if len(parts) < 17:
            continue
            
        # Extract fields
        vendor_name = parts[2]
        reference = parts[3]
        profit_center = parts[5]
        doc_date_str = parts[6]
        currency_str = parts[7]
        fc_amount_str = parts[8]
        amount_inr_str = parts[9]
        text = parts[10]
        dpr_no = parts[14]
        if dpr_no == '#N/A':
            dpr_no = None
            
        # Skip requested DPR Nos
        if dpr_no in ['3425000162', '3425000350']:
            continue
        if dpr_no == '3425000385' and text == 'BOILER SERVICE ATTENDANCE OF AMNSI STALLION':
            continue
            
        amns_remarks = parts[16]
        
        # Filter for only "Not found in PI Tracker"
        if amns_remarks.strip().lower() != "not found in pi tracker":
            continue
        
        # Determine Vessel
        vessel_name = vessel_mapping.get(profit_center)
        if not vessel_name:
            # Try to guess from text
            for v_name in vessels_db.keys():
                if v_name in text:
                    vessel_name = v_name
                    break
                    
        if not vessel_name:
            print(f"Line {i}: Could not determine vessel for profit center {profit_center} and text {text}")
            error_count += 1
            continue
            
        vessel_id = vessels_db.get(vessel_name)
        if not vessel_id:
            print(f"Line {i}: Vessel {vessel_name} not found in DB.")
            error_count += 1
            continue

        # Get or Create Vendor
        vendor_id = vendors_db.get(vendor_name.lower())
        if not vendor_id:
            new_vendor = Vendor(name=vendor_name, created_by=admin_id)
            db.add(new_vendor)
            db.commit()
            db.refresh(new_vendor)
            vendor_id = new_vendor.id
            vendors_db[vendor_name.lower()] = vendor_id
            print(f"Created new vendor: {vendor_name}")

        # Parse Date
        dpr_date = None
        if doc_date_str:
            try:
                dpr_date = datetime.strptime(doc_date_str, '%d-%m-%Y').date()
            except ValueError:
                pass

        # Check if DPR No already exists in DB or in this batch
        original_dpr_no = dpr_no
        if dpr_no:
            suffix = 1
            while True:
                existing = db.query(PiEntry.id).filter(PiEntry.dpr_no == dpr_no).first()
                if not existing and dpr_no not in seen_dpr_nos:
                    break
                dpr_no = f"{original_dpr_no}-{suffix}"
                suffix += 1
            seen_dpr_nos.add(dpr_no)

        # Extract Remarks instead of AMNS Remarks for last_known_remark
        remarks = parts[15]
        
        # Create PiEntry
        pi_entry = PiEntry(
            dpr_no=dpr_no,
            dpr_date=dpr_date,
            vessel_id=vessel_id,
            vendor_id=vendor_id,
            service_details=text,
            amount_inr=parse_currency(amount_inr_str),
            fc_amount=parse_currency(fc_amount_str),
            currency=Currency[currency_str] if currency_str in ["INR", "USD", "EUR"] else Currency.INR,
            po_number=None,
            last_known_remark=remarks,
            created_by=admin_id,
            followup_status=FollowUpStatus.PENDING_OTHER
        )
        
        db.add(pi_entry)
        success_count += 1
        
    try:
        db.commit()
        print(f"Successfully imported {success_count} PI Entries.")
        if error_count > 0:
            print(f"Skipped {error_count} entries due to errors.")
    except Exception as e:
        db.rollback()
        print(f"Error saving to DB: {e}")

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage: python import_md.py <path_to_markdown_file>")
        sys.exit(1)
        
    filepath = sys.argv[1]
    main(filepath)
