import os

from app.core.security import hash_password
from app.db.session import SessionLocal
from app.models.user import User
from app.models.vessel import Vessel
from app.models.vendor import Vendor

VESSELS = ["AMNSI MAXIMUS", "AMNSI STALLION", "AMNS POLAR", "AMNS TUFMAX"]

VENDORS = [
    "INDIAN REGISTER OF SHIPPING",
    "OMSHIP SUPPLIERS",
    "WARTSILA SERVICES SWITZERLAND",
    "TAIKO ASIA PACIFIC",
    "ERMA FIRST ESK ENGINEERING",
    "JEHOVAH LOGISTICS",
    "SHINPO NAVIGATION INDIA",
    "SAACKE SINGAPORE PTE LTD",
    "SUN OCEAN SERVICE CO., LTD",
    "MERCHANT SHIPPING",
    "CONSILIUM SAFETY INDIA",
    "HIGH LANDER MARINE",
    "CHIDAMBARAM SHIPCARE",
    "JOWA",
    "GAINWELL COMMOSALES",
    "NAVICOSERV MARINE REPAIRS",
    "TRIGEN MARINE ENGINEERING",
]

ADMIN_EMAIL = os.environ.get("SEED_ADMIN_EMAIL", "admin@ozellar.com")
ADMIN_PASSWORD = os.environ.get("SEED_ADMIN_PASSWORD", "ChangeMe123!")
ADMIN_NAME = os.environ.get("SEED_ADMIN_NAME", "Admin")


def seed() -> None:
    db = SessionLocal()
    try:
        admin = db.query(User).filter(User.email == ADMIN_EMAIL).first()
        if admin:
            admin.full_name = ADMIN_NAME
        else:
            admin = User(
                email=ADMIN_EMAIL,
                password_hash=hash_password(ADMIN_PASSWORD),
                full_name=ADMIN_NAME,
                role="ADMIN",
            )
            db.add(admin)
        db.flush()

        for name in VESSELS:
            if not db.query(Vessel).filter(Vessel.name == name).first():
                db.add(Vessel(name=name, created_by=admin.id))

        for name in VENDORS:
            if not db.query(Vendor).filter(Vendor.name == name).first():
                db.add(Vendor(name=name, created_by=admin.id))

        db.commit()
        print(f"Seed complete. Admin login: {ADMIN_EMAIL} / {ADMIN_PASSWORD}")
        print(f"Seeded {len(VESSELS)} vessels and {len(VENDORS)} vendors.")
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    seed()
