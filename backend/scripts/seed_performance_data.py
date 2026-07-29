from __future__ import annotations

import argparse
import json
import os
import random
import sys
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from uuid import uuid4

from sqlalchemy import func, insert, select
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import hash_password
from app.db.migrate import run_migrations
from app.db.seed import seed_demo_data
from app.db.session import SessionLocal, engine
from app.models import (
    AgentCustomer,
    AgentProfile,
    AgentTransaction,
    AuditEvent,
    Bill,
    Company,
    CustomerProject,
    CustomerQuotation,
    FinanceCategory,
    FinanceTransaction,
    FinancialAccount,
    InventoryBalance,
    InventoryItem,
    InventoryLocation,
    InventoryMovement,
    Membership,
    ProjectTimeline,
    QuotationRequest,
    Role,
    StoredFile,
    TransactionApproval,
    User,
)

PERF_PREFIX = "PERF"


def _id() -> str:
    return str(uuid4())


def _guard_database() -> None:
    name = (make_url(settings.database_url).database or "").lower()
    if settings.is_production:
        raise RuntimeError("Performance seeding is disabled in production")
    if not any(token in name for token in ("test", "perf")):
        raise RuntimeError("Performance seeding requires a database name containing 'test' or 'perf'")


def _chunks(rows: list[dict], size: int):
    for start in range(0, len(rows), size):
        yield rows[start : start + size]


def _bulk(db: Session, model, rows: list[dict], batch_size: int) -> None:
    if not rows:
        return
    for chunk in _chunks(rows, batch_size):
        db.execute(insert(model), chunk)
        db.commit()


def _timeline_json(payment_mode: str, completed_extra: int, completed_at: datetime) -> tuple[str, str, int]:
    base = [
        ("customer_registration", "Customer registered", True),
        ("quotation_created", "Quotation created", True),
        ("quotation_approved", "Quotation approved", True),
        ("project_created", "Project created", True),
        ("documents_uploaded", "Documents uploaded", False),
        ("documents_approved", "Documents approved", False),
        ("final_registration", "Final registration", False),
        ("payment_mode", "Payment mode selected", False),
    ]
    branch = (
        [("cash_payment", "Cash payment received", False)]
        if payment_mode == "cash"
        else [
            ("loan_application", "Loan application submitted", False),
            ("bank_approval", "Bank approval completed", False),
        ]
    )
    final = [
        ("material_arrival", "Material arrived at site", False),
        ("installation", "Installation completed", False),
        ("dcr_upload", "DCR uploaded", False),
        ("second_payment", "Second EMI received" if payment_mode == "loan" else "Second payment received", False),
        ("subsidy", "Subsidy completed", False),
        ("project_completed", "Project completed", False),
    ]
    definition = [*base, *branch, *final]
    completed_count = min(4 + completed_extra, len(definition))
    steps: list[dict[str, object]] = []
    for index, (key, name, locked) in enumerate(definition):
        status = "completed" if index < completed_count else "current" if index == completed_count else "pending"
        steps.append(
            {
                "key": key,
                "name": name,
                "status": status,
                "completed_at": completed_at.isoformat() if status == "completed" else None,
                "completed_by": "Performance Seeder" if status == "completed" else "",
                "note": "Generated performance fixture" if status == "completed" else "",
                "event_date": completed_at.date().isoformat() if status == "completed" else None,
                "locked": locked,
            }
        )
    current = next((step["key"] for step in steps if step["status"] == "current"), "project_completed")
    progress = round((sum(1 for step in steps if step["status"] == "completed") / len(steps)) * 100)
    return json.dumps(steps, separators=(",", ":")), str(current), progress


def _existing_fixture_count(db: Session, company_id: str) -> int:
    return int(
        db.scalar(
            select(func.count(AgentCustomer.id)).where(
                AgentCustomer.company_id == company_id,
                AgentCustomer.email.like("perf.customer.%@example.com"),
            )
        )
        or 0
    )


def seed(args: argparse.Namespace) -> None:
    _guard_database()
    run_migrations()
    rng = random.Random(args.seed)

    with SessionLocal() as db:
        seed_demo_data(db)
        company = db.scalar(select(Company).where(Company.code == settings.seed_company_code.upper()))
        if not company:
            raise RuntimeError("Seed company was not created")
        existing = _existing_fixture_count(db, company.id)
        if existing and not args.allow_existing:
            raise RuntimeError(
                f"Found {existing} existing performance customers. Reset the test database or pass --allow-existing."
            )
        admin_membership = db.scalar(
            select(Membership)
            .join(User, User.id == Membership.user_id)
            .where(Membership.company_id == company.id, User.username == settings.seed_admin_username)
        )
        agent_role = db.scalar(select(Role).where(Role.company_id == company.id, Role.code == "agent"))
        if not admin_membership or not agent_role:
            raise RuntimeError("Demo admin/agent role is incomplete")

        profile_ids = list(db.scalars(select(AgentProfile.id).where(AgentProfile.company_id == company.id)).all())
        shared_hash = hash_password("PerfAgent123!")
        users: list[dict] = []
        memberships: list[dict] = []
        profiles: list[dict] = []
        for index in range(args.agents):
            suffix = f"{args.seed % 10000:04d}{index:04d}"
            user_id, membership_id, profile_id = _id(), _id(), _id()
            users.append(
                {
                    "id": user_id,
                    "username": f"perf.agent.{suffix}",
                    "email": f"perf.agent.{suffix}@example.com",
                    "full_name": f"Performance Agent {index + 1}",
                    "hashed_password": shared_hash,
                    "is_active": True,
                    "is_super_admin": False,
                }
            )
            memberships.append(
                {
                    "id": membership_id,
                    "user_id": user_id,
                    "company_id": company.id,
                    "role_id": agent_role.id,
                    "is_active": True,
                }
            )
            profiles.append(
                {
                    "id": profile_id,
                    "company_id": company.id,
                    "membership_id": membership_id,
                    "phone": f"+91 90000{index:05d}"[-15:],
                    "alternate_phone": "",
                    "address_line_1": f"Performance Block {index + 1}",
                    "address_line_2": "Surat",
                    "city": "Surat",
                    "state": "Gujarat",
                    "postal_code": "395007",
                    "opening_balance": Decimal("0.00"),
                }
            )
            profile_ids.append(profile_id)
        _bulk(db, User, users, args.batch_size)
        _bulk(db, Membership, memberships, args.batch_size)
        _bulk(db, AgentProfile, profiles, args.batch_size)

        customer_ids: list[str] = []
        customers: list[dict] = []
        statuses = ["active", "active", "active", "proposal", "on_hold"]
        providers = ["DGVCL", "PGVCL", "MGVCL", "UGVCL"]
        for index in range(args.customers):
            customer_id = _id()
            customer_ids.append(customer_id)
            capacity = Decimal(str(rng.choice([3.0, 3.24, 3.6, 5.0, 6.0, 10.0])))
            customers.append(
                {
                    "id": customer_id,
                    "company_id": company.id,
                    "agent_profile_id": profile_ids[index % len(profile_ids)],
                    "customer_membership_id": None,
                    "customer_name": f"Performance Customer {index + 1}",
                    "company_name": "",
                    "email": f"perf.customer.{args.seed}.{index}@example.com",
                    "phone": f"+91 8{index % 1000000000:09d}",
                    "alternate_phone": "",
                    "address": f"Site {index + 1}, Surat, Gujarat",
                    "billing_address": f"Billing {index + 1}, Surat, Gujarat",
                    "site_address": f"Site {index + 1}, Surat, Gujarat",
                    "district": "Surat",
                    "state": "Gujarat",
                    "postal_code": "395007",
                    "consumer_number": f"{providers[index % len(providers)]}-{args.seed}-{index:07d}",
                    "electricity_provider": providers[index % len(providers)],
                    "customer_type": rng.choice(["residential", "residential", "commercial", "society"]),
                    "lead_source": rng.choice(["Referral", "Website", "Walk-in", "Agent"]),
                    "project_name": f"{capacity} kW Rooftop Solar",
                    "status": statuses[index % len(statuses)],
                    "outstanding_balance": Decimal(str(rng.randrange(0, 750000))),
                }
            )
        _bulk(db, AgentCustomer, customers, args.batch_size)

        now = datetime.now(UTC)
        request_rows: list[dict] = []
        quotation_rows: list[dict] = []
        project_rows: list[dict] = []
        timeline_rows: list[dict] = []
        project_ids: list[str] = []
        quotation_ids: list[str] = []
        project_count = min(args.projects, len(customer_ids))
        for index in range(project_count):
            request_id, quotation_id, project_id, timeline_id = _id(), _id(), _id(), _id()
            customer_id = customer_ids[index]
            quotation_ids.append(quotation_id)
            project_ids.append(project_id)
            capacity = Decimal(str(rng.choice([3.0, 3.24, 3.6, 5.0, 6.0, 10.0])))
            subtotal = (capacity * Decimal(str(rng.randrange(42000, 62000)))).quantize(Decimal("0.01"))
            tax = (subtotal * Decimal("0.05")).quantize(Decimal("0.01"))
            total = subtotal + tax
            created = now - timedelta(days=rng.randrange(0, 365))
            payment_mode = rng.choice(["cash", "loan"])
            completed_extra = rng.randrange(0, 8)
            steps_json, current_step, progress = _timeline_json(payment_mode, completed_extra, created)
            request_rows.append(
                {
                    "id": request_id,
                    "company_id": company.id,
                    "customer_id": customer_id,
                    "requested_by_membership_id": admin_membership.id,
                    "requirement_summary": f"{capacity} kW rooftop solar system",
                    "proposed_capacity_kw": capacity,
                    "site_address": f"Performance Site {index + 1}, Surat",
                    "notes": "Generated performance fixture",
                    "status": "approved",
                    "reviewed_by_membership_id": admin_membership.id,
                    "reviewed_at": created,
                    "review_comment": "Approved performance fixture",
                    "created_at": created,
                    "updated_at": created,
                }
            )
            quotation_rows.append(
                {
                    "id": quotation_id,
                    "company_id": company.id,
                    "request_id": request_id,
                    "customer_id": customer_id,
                    "quotation_number": f"PERF-QUO-{args.seed}-{index:07d}",
                    "title": f"{capacity} kW Solar EPC",
                    "line_items_json": json.dumps(
                        [
                            {
                                "description": "Solar EPC System",
                                "quantity": float(capacity),
                                "unit": "kW",
                                "unit_price": float((subtotal / capacity).quantize(Decimal("0.01"))),
                                "tax_rate": 5.0,
                                "line_total": float(total),
                            }
                        ],
                        separators=(",", ":"),
                    ),
                    "subtotal": subtotal,
                    "tax_total": tax,
                    "grand_total": total,
                    "valid_until": created + timedelta(days=30),
                    "status": "approved",
                    "created_by_membership_id": admin_membership.id,
                    "decided_by_membership_id": admin_membership.id,
                    "decided_at": created,
                    "decision_comment": "Approved performance fixture",
                    "created_at": created,
                    "updated_at": created,
                }
            )
            completed = progress == 100
            project_rows.append(
                {
                    "id": project_id,
                    "company_id": company.id,
                    "customer_id": customer_id,
                    "quotation_id": quotation_id,
                    "project_number": f"PERF-PRJ-{args.seed}-{index:07d}",
                    "name": f"{capacity} kW Solar EPC",
                    "status": "completed" if completed else "in_progress",
                    "capacity_kw": capacity,
                    "approved_value": total,
                    "site_address": f"Performance Site {index + 1}, Surat",
                    "payment_mode": payment_mode,
                    "loan_status": "approved" if payment_mode == "loan" and progress > 50 else "draft" if payment_mode == "loan" else "not_required",
                    "documentation_status": "approved" if progress > 35 else "in_progress",
                    "registration_status": "completed" if progress > 45 else "pending",
                    "material_status": "arrived" if progress > 60 else "pending",
                    "installation_status": "completed" if progress > 70 else "pending",
                    "dcr_status": "completed" if progress > 75 else "pending",
                    "subsidy_status": "completed" if progress > 90 else "pending",
                    "subsidiary_payment_status": "completed" if completed else "pending",
                    "created_at": created,
                    "updated_at": created,
                }
            )
            timeline_rows.append(
                {
                    "id": timeline_id,
                    "company_id": company.id,
                    "project_id": project_id,
                    "payment_mode": payment_mode,
                    "current_step": current_step,
                    "progress": progress,
                    "steps_json": steps_json,
                    "updated_by_membership_id": admin_membership.id,
                    "created_at": created,
                    "updated_at": created,
                }
            )
        _bulk(db, QuotationRequest, request_rows, args.batch_size)
        _bulk(db, CustomerQuotation, quotation_rows, args.batch_size)
        _bulk(db, CustomerProject, project_rows, args.batch_size)
        _bulk(db, ProjectTimeline, timeline_rows, args.batch_size)


        location_ids = list(
            db.scalars(select(InventoryLocation.id).where(InventoryLocation.company_id == company.id)).all()
        )
        location_rows: list[dict] = []
        for index in range(args.inventory_locations):
            location_id = _id()
            location_ids.append(location_id)
            location_rows.append(
                {
                    "id": location_id,
                    "company_id": company.id,
                    "name": f"Performance Warehouse {args.seed}-{index + 1}",
                    "location_type": "warehouse" if index % 2 == 0 else "site_store",
                    "address": f"Performance inventory location {index + 1}, Surat",
                    "is_active": True,
                }
            )
        _bulk(db, InventoryLocation, location_rows, args.batch_size)

        item_ids: list[str] = []
        item_rows: list[dict] = []
        categories = ["Solar Panel", "Inverter", "Structure", "Cable", "Electrical", "Safety"]
        units = ["Nos", "Meter", "Set"]
        for index in range(args.inventory_items):
            item_id = _id()
            item_ids.append(item_id)
            item_rows.append(
                {
                    "id": item_id,
                    "company_id": company.id,
                    "sku": f"PERF-SKU-{args.seed}-{index:06d}",
                    "name": f"Performance Inventory Item {index + 1}",
                    "category": categories[index % len(categories)],
                    "unit": units[index % len(units)],
                    "supplier_name": f"Performance Supplier {index % 40}",
                    "unit_cost": Decimal(str(rng.randrange(100, 30000))),
                    "reorder_level": Decimal(str(rng.randrange(1, 25))),
                    "is_active": True,
                }
            )
        _bulk(db, InventoryItem, item_rows, args.batch_size)

        balance_rows: list[dict] = []
        if location_ids:
            for index, item_id in enumerate(item_ids):
                location_id = location_ids[index % len(location_ids)]
                quantity = Decimal(str(rng.randrange(0, 500)))
                balance_rows.append(
                    {
                        "id": _id(),
                        "company_id": company.id,
                        "item_id": item_id,
                        "location_id": location_id,
                        "quantity_on_hand": quantity,
                        "reserved_quantity": Decimal(str(rng.randrange(0, min(50, int(quantity) + 1)))),
                    }
                )
        _bulk(db, InventoryBalance, balance_rows, args.batch_size)

        movement_rows: list[dict] = []
        if item_ids and location_ids:
            for index in range(args.inventory_movements):
                movement_type = rng.choice(["inward", "outward", "transfer", "project_dispatch"])
                source_id = location_ids[index % len(location_ids)] if movement_type in {"outward", "transfer", "project_dispatch"} else None
                destination_id = location_ids[(index + 1) % len(location_ids)] if movement_type in {"inward", "transfer"} else None
                if movement_type == "transfer" and source_id == destination_id:
                    destination_id = None
                    movement_type = "outward"
                project_id = project_ids[index % len(project_ids)] if project_ids and movement_type == "project_dispatch" else None
                customer_id = customer_ids[index % len(customer_ids)] if customer_ids and project_id else None
                movement_rows.append(
                    {
                        "id": _id(),
                        "company_id": company.id,
                        "item_id": item_ids[index % len(item_ids)],
                        "movement_type": movement_type,
                        "quantity": Decimal(str(rng.randrange(1, 25))),
                        "source_location_id": source_id,
                        "destination_location_id": destination_id,
                        "source_location_manual": "",
                        "destination_location_manual": "",
                        "project_id": project_id,
                        "customer_id": customer_id,
                        "challan_id": None,
                        "movement_group_id": None,
                        "reference_number": f"PERF-MOV-{args.seed}-{index:08d}",
                        "challan_date": date.today() - timedelta(days=rng.randrange(0, 365)),
                        "supplier_name": "Performance Supplier" if movement_type == "inward" else "",
                        "transporter_name": "Performance Transport",
                        "vehicle_number": f"GJ05PF{index % 10000:04d}",
                        "driver_name": "Performance Driver",
                        "driver_phone": "+91 9000000000",
                        "eway_bill_number": f"PERF-EWAY-{index:08d}",
                        "note": "Generated performance inventory movement",
                        "status": "completed",
                        "created_by": admin_membership.id,
                    }
                )
        _bulk(db, InventoryMovement, movement_rows, args.batch_size)

        account_ids = list(db.scalars(select(FinancialAccount.id).where(FinancialAccount.company_id == company.id)).all())
        category_ids = list(db.scalars(select(FinanceCategory.id).where(FinanceCategory.company_id == company.id)).all())
        if not account_ids:
            raise RuntimeError("No financial account was seeded")

        finance_rows: list[dict] = []
        for index in range(args.finance_transactions):
            direction = "credit" if index % 3 == 0 else "debit"
            customer_id = customer_ids[index % len(customer_ids)] if customer_ids and index % 2 == 0 else None
            project_id = project_ids[index % len(project_ids)] if project_ids and index % 3 == 0 else None
            finance_rows.append(
                {
                    "id": _id(),
                    "company_id": company.id,
                    "transaction_number": f"PERF-FIN-{args.seed}-{index:08d}",
                    "transaction_date": date.today() - timedelta(days=rng.randrange(0, 730)),
                    "direction": direction,
                    "category_id": category_ids[index % len(category_ids)] if category_ids else None,
                    "amount": Decimal(str(rng.randrange(100, 300000))),
                    "account_id": account_ids[index % len(account_ids)],
                    "payment_method": rng.choice(["bank", "cash", "upi"]),
                    "party_type": "customer" if customer_id else "other",
                    "party_name": f"Performance Party {index % 1000}",
                    "customer_id": customer_id,
                    "project_id": project_id,
                    "agent_id": None,
                    "supplier_id": None,
                    "source_type": "performance_seed",
                    "source_id": None,
                    "transfer_group_id": None,
                    "reference_number": f"PERFREF-{index:08d}",
                    "description": "Generated performance finance transaction",
                    "status": "posted",
                    "receipt_file_id": None,
                    "reversed_transaction_id": None,
                    "created_by": admin_membership.id,
                }
            )
        _bulk(db, FinanceTransaction, finance_rows, args.batch_size)

        bill_rows: list[dict] = []
        for index in range(args.bills):
            total = Decimal(str(rng.randrange(1000, 500000)))
            paid = total if index % 4 == 0 else Decimal("0.00") if index % 4 == 1 else (total / 2).quantize(Decimal("0.01"))
            bill_rows.append(
                {
                    "id": _id(),
                    "company_id": company.id,
                    "bill_type": "sale" if index % 2 == 0 else "purchase",
                    "bill_number": f"PERF-BILL-{args.seed}-{index:07d}",
                    "bill_date": date.today() - timedelta(days=rng.randrange(0, 365)),
                    "customer_id": customer_ids[index % len(customer_ids)] if customer_ids and index % 2 == 0 else None,
                    "project_id": project_ids[index % len(project_ids)] if project_ids and index % 2 == 0 else None,
                    "supplier_name": "" if index % 2 == 0 else f"Performance Supplier {index % 100}",
                    "subtotal": total,
                    "tax_amount": Decimal("0.00"),
                    "total_amount": total,
                    "due_date": date.today() + timedelta(days=(index % 45) - 15),
                    "paid_amount": paid,
                    "balance_amount": total - paid,
                    "payment_status": "paid" if paid == total else "unpaid" if paid == 0 else "partial",
                    "status": "posted",
                    "file_id": None,
                    "note": "Generated performance bill",
                    "created_by": admin_membership.id,
                }
            )
        _bulk(db, Bill, bill_rows, args.batch_size)

        agent_tx_rows: list[dict] = []
        approval_rows: list[dict] = []
        for index in range(args.agent_transactions):
            tx_id = _id()
            profile_id = profile_ids[index % len(profile_ids)]
            is_credit = index % 4 == 0
            agent_tx_rows.append(
                {
                    "id": tx_id,
                    "company_id": company.id,
                    "agent_profile_id": profile_id,
                    "created_by_membership_id": admin_membership.id,
                    "transaction_date": now - timedelta(days=rng.randrange(0, 365)),
                    "reference": f"PERF-ATX-{args.seed}-{index:07d}",
                    "transaction_type": "commission" if is_credit else "expense",
                    "description": "Generated performance agent transaction",
                    "debit": Decimal("0.00") if is_credit else Decimal(str(rng.randrange(100, 10000))),
                    "credit": Decimal(str(rng.randrange(100, 15000))) if is_credit else Decimal("0.00"),
                    "project_id": project_ids[index % len(project_ids)] if project_ids and index % 2 == 0 else None,
                }
            )
            approval_rows.append(
                {
                    "id": _id(),
                    "company_id": company.id,
                    "transaction_id": tx_id,
                    "submitted_by_membership_id": admin_membership.id,
                    "status": "pending" if index % 5 == 0 else "approved",
                    "decided_by_membership_id": None if index % 5 == 0 else admin_membership.id,
                    "decided_at": None if index % 5 == 0 else now,
                    "decision_comment": "" if index % 5 == 0 else "Approved performance fixture",
                }
            )
        _bulk(db, AgentTransaction, agent_tx_rows, args.batch_size)
        _bulk(db, TransactionApproval, approval_rows, args.batch_size)

        file_rows: list[dict] = []
        for index in range(args.files):
            project_id = project_ids[index % len(project_ids)] if project_ids else None
            customer_id = customer_ids[index % len(customer_ids)] if customer_ids else None
            file_rows.append(
                {
                    "id": _id(),
                    "company_id": company.id,
                    "owner_type": "project" if project_id else "customer",
                    "owner_id": project_id or customer_id or "performance",
                    "project_id": project_id,
                    "customer_id": customer_id,
                    "name": f"performance-document-{index:07d}.pdf",
                    "storage_path": f"performance/{args.seed}/document-{index:07d}.pdf",
                    "mime_type": "application/pdf",
                    "size_bytes": rng.randrange(50_000, 4_000_000),
                    "checksum": f"{index:064x}"[-64:],
                    "uploaded_by": admin_membership.id,
                }
            )
        _bulk(db, StoredFile, file_rows, args.batch_size)

        audit_rows: list[dict] = []
        events = ["customer.created", "quotation.approved", "project.timeline_changed", "finance.transaction.created"]
        for index in range(args.audit_events):
            project_id = project_ids[index % len(project_ids)] if project_ids and index % 2 == 0 else None
            customer_id = customer_ids[index % len(customer_ids)] if customer_ids else None
            audit_rows.append(
                {
                    "id": _id(),
                    "company_id": company.id,
                    "event": events[index % len(events)],
                    "entity": "performance_fixture",
                    "entity_id": f"PERF-{args.seed}-{index:08d}",
                    "project_id": project_id,
                    "customer_id": customer_id,
                    "user_id": None,
                    "user_role": "performance_seed",
                    "changes_json": '{"source":"performance_seed"}',
                    "request_id": f"perf-{args.seed}-{index:08d}",
                    "created_at": now - timedelta(seconds=index % 2_000_000),
                    "updated_at": now - timedelta(seconds=index % 2_000_000),
                }
            )
        _bulk(db, AuditEvent, audit_rows, args.batch_size)

    print(
        json.dumps(
            {
                "agents": args.agents,
                "customers": args.customers,
                "projects": project_count,
                "inventory_locations": args.inventory_locations,
                "inventory_items": args.inventory_items,
                "inventory_movements": args.inventory_movements,
                "finance_transactions": args.finance_transactions,
                "bills": args.bills,
                "agent_transactions": args.agent_transactions,
                "files": args.files,
                "audit_events": args.audit_events,
                "database": make_url(settings.database_url).database,
            },
            indent=2,
        )
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate deterministic PostgreSQL performance fixtures")
    parser.add_argument("--agents", type=int, default=int(os.getenv("PERF_AGENTS", "20")))
    parser.add_argument("--customers", type=int, default=int(os.getenv("PERF_CUSTOMERS", "10000")))
    parser.add_argument("--projects", type=int, default=int(os.getenv("PERF_PROJECTS", "5000")))
    parser.add_argument("--inventory-locations", type=int, default=int(os.getenv("PERF_INVENTORY_LOCATIONS", "4")))
    parser.add_argument("--inventory-items", type=int, default=int(os.getenv("PERF_INVENTORY_ITEMS", "300")))
    parser.add_argument("--inventory-movements", type=int, default=int(os.getenv("PERF_INVENTORY_MOVEMENTS", "5000")))
    parser.add_argument("--finance-transactions", type=int, default=int(os.getenv("PERF_FINANCE_TRANSACTIONS", "20000")))
    parser.add_argument("--bills", type=int, default=int(os.getenv("PERF_BILLS", "5000")))
    parser.add_argument("--agent-transactions", type=int, default=int(os.getenv("PERF_AGENT_TRANSACTIONS", "10000")))
    parser.add_argument("--files", type=int, default=int(os.getenv("PERF_FILES", "10000")))
    parser.add_argument("--audit-events", type=int, default=int(os.getenv("PERF_AUDIT_EVENTS", "25000")))
    parser.add_argument("--batch-size", type=int, default=int(os.getenv("PERF_BATCH_SIZE", "1000")))
    parser.add_argument("--seed", type=int, default=int(os.getenv("PERF_SEED", "20260729")))
    parser.add_argument("--allow-existing", action="store_true")
    args = parser.parse_args()
    for field in (
        "agents",
        "customers",
        "projects",
        "inventory_locations",
        "inventory_items",
        "inventory_movements",
        "finance_transactions",
        "bills",
        "agent_transactions",
        "files",
        "audit_events",
        "batch_size",
    ):
        if getattr(args, field) < 0:
            parser.error(f"--{field.replace('_', '-')} cannot be negative")
    if args.batch_size < 100 or args.batch_size > 5000:
        parser.error("--batch-size must be between 100 and 5000")
    return args


if __name__ == "__main__":
    try:
        seed(parse_args())
    except Exception as exc:
        print(f"Performance seed failed: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc
    finally:
        engine.dispose()
