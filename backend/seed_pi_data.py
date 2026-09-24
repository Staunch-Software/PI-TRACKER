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

MARKDOWN_DATA = """| Supplier | Name                                | Reference        | Document Type | Profit Center | Document Date | Document Currency | Amount in Doc. Curr. | Amount in Local Currency | Text                                              | Days   | Aging     | Category          | DPR No     | Remarks        | AMNS Remarks                                                 |
| -------- | ----------------------------------- | ---------------- | ------------- | ------------- | ------------- | ----------------- | -------------------- | ------------------------ | ------------------------------------------------- | ------ | --------- | ----------------- | ---------- | -------------- | ------------------------------------------------------------ |
| 700164   | ERMA FIRST ESK ENGINEERING SOLUTION | 3425000350,30250 | KZ            | 7002          | 26-02-2026    | EUR               | 3,000.00             | 3,21,750.00              | AMNSI MAXIMUS BWTS SERVICE ATTENDANCE             |  204   | 05. < 365 | Ozellar - Vendors | 3425000350 | Vendor Advance | Not found in PI Tracker                                      |
| 4006746  | SAACKE GMBH                         | 3425000385,30250 | KZ            | 7001          | 06-03-2026    | USD               | 9,450.00             | 8,66,635.88              | BOILER SERVICE ATTENDANCE OF AMNSI STALLION       |  196   | 05. < 365 | Ozellar - Vendors | 3425000385 | Vendor Advance | Not found in PI Tracker                                      |
| 700097   | Wärtsilä Services Switzerland Ltd.  | 3425000411       | KZ            | 7005          | 11-03-2026    | EUR               | 44,346.20            | 47,34,843.77             | AUX ENGINE SPARE PARTS FOR AMNS POLAR             |  191   | 05. < 365 | Ozellar - Vendors | 3425000411 | Vendor Advance | Pending - Internal Check                                     |
| 700097   | Wärtsilä Services Switzerland Ltd.  | 3425000432       | KZ            | 7002          | 20-03-2026    | EUR               | 3,38,191.79          | 3,65,58,532.50           | SPARE PARTS SUPPLY TO AMNSI MAXIMUS               |  182   | 05. < 365 | Ozellar - Vendors | 3425000432 | Vendor Advance | Invoice is there in DMS                                      |
| 700235   | CONSILIUM SAFETY INDIA PRIVATE LIMI | 3425000162       | KA            | 7006          | 08-01-2026    | INR               | 2,828.08             | 2,828.08                 | BAL - AMNS TUFMAX OWS REPAIR                      |  253   | 05. < 365 | Ozellar - Vendors | 3425000162 | Vendor Advance | Not found in PI Tracker                                      |
| 700097   | Wärtsilä Services Switzerland Ltd.  | 3425000179 & 195 | KA            | 7002          | 12-01-2026    | EUR               | 8,214.87             | 8,62,614.75              | BAL - ADDITIONAL SPARES FOR MAIN ENGINE DECARBON  |  249   | 05. < 365 | Ozellar - Vendors | 3425000179 | Vendor Advance | Not found in PI Tracker                                      |
| 700288   | Shinpo Navigation India Pvt. Ltd.   | 3426000054       | KZ            | 7001          | 27-04-2026    | INR               | 11,09,073.00         | 11,09,073.00             | AUTO TELEPHONE UPGRADE ON AMNSI MAXIMUS           |  144   | 04. < 180 | Ozellar - Vendors | 3426000054 | Vendor Advance | Pending - Reminder Sent                                      |
| 700291   | Saacke Singapore Pte Ltd            | 3426000058       | KZ            | 7002          | 30-04-2026    | USD               | 50,000.00            | 47,46,500.00             | AUX BOILER/BURNER AUTOMATION SYSTEM SERVICE       |  141   | 04. < 180 | Ozellar - Vendors | 3426000058 | Vendor Advance | Invoice received today                                       |
| 700088   | J.K.SONS AND COMPANY                | 3426000088       | KZ            | 7002          | 07-05-2026    | INR               | 5,77,315.00          | 5,77,315.00              | SERVICE CHARGES FOR AMNSI MAXIMUS                 |  134   | 04. < 180 | Ozellar - Vendors | 3426000088 | Vendor Advance | Invoice is there in DMS                                      |
| 700297   | Sun Ocean Service co.,ltd           | 3426000075       | KZ            | 7002          | 08-05-2026    | USD               | 5,777.15             | 5,44,178.63              | BALLAST PUMP SPARE PARTS SUPPLY                   |  133   | 04. < 180 | Ozellar - Vendors | 3426000075 | Vendor Advance | Pending - Reminder Sent                                      |
| 700297   | Sun Ocean Service co.,ltd           | 3426000075       | KZ            | 7002          | 08-05-2026    | USD               | 1,438.00             | 1,35,452.41              | MCSW PUMP SPARE PARTS SUPPLY                      |  133   | 04. < 180 | Ozellar - Vendors | 3426000075 | Vendor Advance | Pending - Reminder Sent                                      |
| 700297   | Sun Ocean Service co.,ltd           | 3426000075       | KZ            | 7002          | 08-05-2026    | USD               | 561.00               | 52,843.40                | EMERGENCY FIRE PUMP SPARE PARTS SUPPLY            |  133   | 04. < 180 | Ozellar - Vendors | 3426000075 | Vendor Advance | Pending - Reminder Sent                                      |
| 700297   | Sun Ocean Service co.,ltd           | 3426000075       | KZ            | 7002          | 08-05-2026    | USD               | 6,678.00             | 6,29,034.21              | FIRE & GS PUMP SPARE PARTS SUPPLY                 |  133   | 04. < 180 | Ozellar - Vendors | 3426000075 | Vendor Advance | Pending - Reminder Sent                                      |
| 700297   | Sun Ocean Service co.,ltd           | 3426000075       | KZ            | 7002          | 08-05-2026    | USD               | 331.00               | 31,178.55                | SEA WATER PUMP SPARE PARTS SUPPLY                 |  133   | 04. < 180 | Ozellar - Vendors | 3426000075 | Vendor Advance | Pending - Reminder Sent                                      |
| 700235   | CONSILIUM SAFETY INDIA PRIVATE LIMI | 3426000118       | KZ            | 7001          | 02-06-2026    | INR               | 10,13,412.93         | 10,13,412.93             | HYPERMIST SERVICE ON AMNSI STALLION               |  108   | 04. < 180 | Ozellar - Vendors | 3426000118 | Vendor Advance | Invoice not found (As per PI tracked invoice received)       |
| 4006746  | SAACKE GMBH                         | 3425000385       | KA            | 7001          | 27-02-2026    | USD               | -2,063.88            | -1,88,225.86             | TDS - BOILER SERVICE ATTENDANCE OF AMNSI STALLION |  192   | 05. < 365 | Ozellar - Vendors | 3425000385 | Vendor Advance | Not found in PI Tracker                                      |
| 100319   | INDIAN REGISTER OF SHIPPING         | 3426000135       | KZ            | 7002          | 11-06-2026    | INR               | 1,71,100.00          | 1,71,100.00              | PLAN APPROVAL FOR AMNSI MAXIMUS                   |    99  | 04. < 180 | Ozellar - Vendors | 3426000135 | Vendor Advance | Pending - Internal Check                                     |
| 700038   | CHIDAMBARAM SHIPCARE PRIVATE LIMITE | 3426000141       | KZ            | 7006          | 12-06-2026    | INR               | 35,44,968.00         | 35,44,968.00             | HATCH COVER SPARES AND SERVICE FOR AMNS TUFMAX    |    98  | 04. < 180 | Ozellar - Vendors | 3426000141 | Vendor Advance | Not Fully Approved                                           |
| 100319   | INDIAN REGISTER OF SHIPPING         | 3426000153       | KZ            | 7002          | 20-06-2026    | INR               | 53,100.00            | 53,100.00                | SSP APPROVAL/REVIEW OF VESSEL AMNSI MAXIMUS       |    90  | 04. < 180 | Ozellar - Vendors | 3426000153 | Vendor Advance | Invoice not found (As per PI tracked invoice received)       |
| 700164   | ERMA FIRST ESK ENGINEERING SOLUTION | 3426000019       | KZ            | 7001          | 22-06-2026    | USD               | 544.40               | 51,546.51                | SPARE SUPPLY ON AMNSI STALLION                    |    88  | 03. < 90  | Ozellar - Vendors | 3426000019 | Vendor Advance | Invoice received today                                       |
| 700164   | ERMA FIRST ESK ENGINEERING SOLUTION | 3426000028       | KZ            | 7002          | 23-06-2026    | EUR               | 3,814.54             | 4,12,256.41              | ANNUAL MAINTENANCE KIT FOR AMNSI MAXIMUS          |    87  | 03. < 90  | Ozellar - Vendors | 3426000028 | Vendor Advance | Invoice not found (As per PI tracked invoice received)       |
| 700164   | ERMA FIRST ESK ENGINEERING SOLUTION | 3426000030       | KZ            | 7002          | 23-06-2026    | EUR               | 5,000.00             | 5,40,375.00              | CALIBRATION & MAINTENANCE SERVICES                |    87  | 03. < 90  | Ozellar - Vendors | 3426000028 | Vendor Advance | Invoice received today                                       |
| 166507   | GAINWELL COMMOSALES PVT LTD         | 3426000161       | KZ            | 7006          | 26-06-2026    | INR               | 26,92,532.15         | 26,92,532.15             | SPARES SUPPLY ON AMNSI TUFMAX                     |    84  | 03. < 90  | Ozellar - Vendors | 3426000161 | Vendor Advance | Invoice not found (As per PI tracked invoice received)       |
| 166507   | GAINWELL COMMOSALES PVT LTD         | 3426000160       | KZ            | 7006          | 26-06-2026    | INR               | 60,77,586.67         | 60,77,586.67             | SPARES SUPPLY ON AMNSI TUFMAX                     |    84  | 03. < 90  | Ozellar - Vendors | 3426000160 | Vendor Advance | Pending - Internal Check                                     |
| 700288   | Shinpo Navigation India Pvt. Ltd.   | 3426000181       | KZ            | 7001          | 21-07-2026    | INR               | 8,11,713.00          | 8,11,713.00              | RIDING REPAIR SQUAD FOR AMNSI STALLION            |    59  | 03. < 90  | Ozellar - Vendors | 3426000181 | Vendor Advance | Invoice not found (As per PI tracked invoice received)       |
| 700010   | SEA MAX MARINE SERVICES PRIVATE LIM | 3426000183,30260 | KZ            | 7002          | 22-07-2026    | USD               | 43,737.00            | 42,22,260.64             | PORT DUES CHARGES                                 |    58  | 03. < 90  | Ozellar - Vendors | 3426000183 | Vendor Advance | Invoice is rejected                                          |
| 700316   | Seatrust Marine Solutions           | 3426000176       | KZ            | 7006          | 23-07-2026    | INR               | 2,91,460.00          | 2,91,460.00              | FABRICATION  Y PIECE WITH MS PIPE FOR AMNS TUFMAX |    57  | 03. < 90  | Ozellar - Vendors | 3426000176 | Vendor Advance | Not Fully Approved                                           |
| 700325   | NAVICOSERV MARINE REPAIRS PRIVATE   | 3426000184       | KZ            | 7002          | 23-07-2026    | INR               | 16,12,800.00         | 16,12,800.00             | MAIN ENGINE ATTENDANCE AT HAMBANTOTA SRI LANKA    |    57  | 03. < 90  | Ozellar - Vendors | 3426000184 | Vendor Advance | Not Fully Approved                                           |
| 700004   | SPARES PAZARI LLP                   | 3425000194       | KA            | 7002          | 16-01-2026    | INR               | 99,917.39            | 99,917.39                |                                                   |  245   | 05. < 365 | Ozellar - Vendors | 3425000194 | #N/A           | Not found in PI Tracker                                      |
| 700006   | DAIKAI ENGINEERING PTE. LTD.        | 3426000212       | KZ            | 7002          | 31-08-2026    | JPY               | 1,85,287.00          | 1,10,690.45              | ENGINE SPARE PARTS SUPPLY                         |    18  | 02. < 30  | Ozellar - Vendors | 3426000212 | #N/A           | Not found in PI Tracker                                      |
| 700006   | DAIKAI ENGINEERING PTE. LTD.        | 3426000212       | KZ            | 7002          | 31-08-2026    | JPY               | 19,62,282.00         | 11,72,267.27             | ENGINE SPARE PARTS SUPPLY                         |    18  | 02. < 30  | Ozellar - Vendors | 3426000212 | #N/A           | Not found in PI Tracker                                      |
| 700006   | DAIKAI ENGINEERING PTE. LTD.        | 3426000212       | KZ            | 7002          | 31-08-2026    | JPY               | 2,19,81,582.00       | 1,31,31,797.09           | ENGINE SPARE PARTS SUPPLY                         |    18  | 02. < 30  | Ozellar - Vendors | 3426000212 | #N/A           | Not found in PI Tracker                                      |
| 700009   | D STROKE ENGINEERING SERVICES       | 3426000235       | KZ            | 7005          | 31-08-2026    | INR               | 2,18,300.00          | 2,18,300.00              | CRANKSHAFT INSTALLATION ON AMNS POLAR             |    18  | 02. < 30  | Ozellar - Vendors | 3426000235 | #N/A           | Not found in PI Tracker                                      |
| 170257   | MERCHANT SHIPPING SERVICES PRIVATE  | 3426000086       | KA            | 7001          | 05-05-2026    | INR               | 11800                | 11800                    | CASH TO MASTER AMNSI STALLION                     |  136   | 04. < 180 | Ozellar - Vendors | 3426000086 | #N/A           | Invoice not found (As per PI tracked invoice Not applicable) |
| 170257   | MERCHANT SHIPPING SERVICES PRIVATE  | 3726000501       | KA            | 7002          | 21-08-2026    | INR               | 16520                | 16520                    | BAL ADVANCE -CTM                                  |    28  | 02. < 30  | Ozellar - Vendors | #N/A       | #N/A           | Not found in PI Tracker                                      |
| 700021   | ROYAL TECH MARINE ENGINEERS PVT LTD | 3425000380       | KA            | 7005          | 26-02-2026    | INR               | 476260               | 476260                   | SPARE AND SERVICE FOR AMNS POLAR                  |  204   | 05. < 365 | Ozellar - Vendors | 3425000380 | #N/A           | Not found in PI Tracker                                      |
| 700203   | Merchant Shipping Services Pvt.Ltd  | 3425000435       | KA            | 7001          | 24-03-2026    | INR               | 11800                | 11800                    | BAL ADVANCE -CTM                                  |  178   | 04. < 180 | Ozellar - Vendors | 3425000435 | #N/A           | Not found in PI Tracker                                      |
| 700203   | Merchant Shipping Services Pvt.Ltd  | 3426000115       | KA            | 7005          | 02-06-2026    | INR               | 11800                | 11800                    | BAL ADVANCE -CTM                                  |  108   | 04. < 180 | Ozellar - Vendors | 3426000115 | #N/A           | Invoice not found (As per PI tracked invoice Not applicable) |
| 700203   | Merchant Shipping Services Pvt.Ltd  | 3726000546       | KA            | 7006          | 03-09-2026    | INR               | 11800                | 11800                    | CASH TO MASTER AMNS TUFMAX                        |    15  | 02. < 30  | Ozellar - Vendors | #N/A       | #N/A           | Not found in PI Tracker                                      |
| 700203   | Merchant Shipping Services Pvt.Ltd  | 3426000245       | KA            | 7001          | 17-09-2026    | INR               | 16520                | 16520                    | BAL ADVANCE -CTM                                  |      1 | 02. < 30  | Ozellar - Vendors | 3426000245 | #N/A           | Not found in PI Tracker                                      |
| 700291   | Saacke Singapore Pte Ltd            | 3026000020       | AB            | 7002          | 07-04-2026    | USD               | 5000                 | 474000                   | TDS AUX BOILER/BURNER AUTOMATION SYSTEM SERVICE   |  164   | 04. < 180 | Ozellar - Vendors | 3426000058 | Vendor Advance | Invoice received today                                       |"""

def parse_currency(amount_str):
    if not amount_str:
        return 0.0
    # Remove commas and spaces
    clean = amount_str.replace(',', '').strip()
    try:
        return float(clean)
    except ValueError:
        return 0.0

def main():
    print("Reading embedded markdown data...")
    lines = MARKDOWN_DATA.strip().split('\n')
        
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
    main()
