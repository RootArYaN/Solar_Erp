from datetime import date
from decimal import Decimal
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.db.session import SessionLocal
from app.main import app
from app.models.agent import AgentCustomer, AgentProfile
from app.models.auth import Membership
from app.models.finance import Bill, FinanceTransaction, FinancialAccount
from app.models.operations import InventoryBalance, InventoryItem, InventoryLocation
from app.models.workflow import CustomerProject, CustomerQuotation, ProjectTimeline, QuotationRequest


def _admin_headers(client: TestClient) -> dict[str, str]:
    response = client.post(
        '/api/v1/auth/login',
        json={'username': 'admin', 'password': 'ChangeMe123!'},
    )
    assert response.status_code == 200, response.text
    return {'Authorization': f"Bearer {response.json()['access_token']}"}


def test_dashboard_kpis_use_connected_module_data() -> None:
    with TestClient(app) as client:
        headers = _admin_headers(client)
        before_response = client.get('/api/v1/dashboard/summary', headers=headers)
        assert before_response.status_code == 200, before_response.text
        before = before_response.json()

        with SessionLocal() as db:
            membership = db.scalar(select(Membership).limit(1))
            assert membership is not None
            profile = db.scalar(select(AgentProfile).where(
                AgentProfile.company_id == membership.company_id,
            ).limit(1))
            assert profile is not None
            company_id = membership.company_id
            token = uuid4().hex[:8]

            pending_customer = AgentCustomer(
                company_id=company_id,
                agent_profile_id=profile.id,
                customer_name=f'Dashboard pending {token}',
                status='quotation_requested',
            )
            active_customer = AgentCustomer(
                company_id=company_id,
                agent_profile_id=profile.id,
                customer_name=f'Dashboard active {token}',
                status='active',
            )
            completed_customer = AgentCustomer(
                company_id=company_id,
                agent_profile_id=profile.id,
                customer_name=f'Dashboard completed {token}',
                status='completed',
            )
            db.add_all([pending_customer, active_customer, completed_customer])
            db.flush()

            pending_request = QuotationRequest(
                company_id=company_id,
                customer_id=pending_customer.id,
                requested_by_membership_id=membership.id,
                requirement_summary='Pending dashboard quotation',
                proposed_capacity_kw=Decimal('5.00'),
                status='pending',
            )
            active_request = QuotationRequest(
                company_id=company_id,
                customer_id=active_customer.id,
                requested_by_membership_id=membership.id,
                requirement_summary='Active dashboard project',
                proposed_capacity_kw=Decimal('8.00'),
                status='approved',
            )
            completed_request = QuotationRequest(
                company_id=company_id,
                customer_id=completed_customer.id,
                requested_by_membership_id=membership.id,
                requirement_summary='Completed dashboard project',
                proposed_capacity_kw=Decimal('10.00'),
                status='approved',
            )
            db.add_all([pending_request, active_request, completed_request])
            db.flush()

            active_quote = CustomerQuotation(
                company_id=company_id,
                request_id=active_request.id,
                customer_id=active_customer.id,
                quotation_number=f'QUO-ACT-{token}',
                title='Active project quote',
                grand_total=Decimal('5000.00'),
                status='approved',
                created_by_membership_id=membership.id,
            )
            completed_quote = CustomerQuotation(
                company_id=company_id,
                request_id=completed_request.id,
                customer_id=completed_customer.id,
                quotation_number=f'QUO-DONE-{token}',
                title='Completed project quote',
                grand_total=Decimal('2500.00'),
                status='approved',
                created_by_membership_id=membership.id,
            )
            db.add_all([active_quote, completed_quote])
            db.flush()

            active_project = CustomerProject(
                company_id=company_id,
                customer_id=active_customer.id,
                quotation_id=active_quote.id,
                project_number=f'PRJ-ACT-{token}',
                name='Connected active project',
                status='in_progress',
                approved_value=Decimal('5000.00'),
                payment_mode='loan',
                loan_status='draft',
                documentation_status='pending',
                material_status='scheduled',
                installation_status='in_progress',
                dcr_status='pending',
                subsidy_status='applied',
            )
            completed_project = CustomerProject(
                company_id=company_id,
                customer_id=completed_customer.id,
                quotation_id=completed_quote.id,
                project_number=f'PRJ-DONE-{token}',
                name='Connected completed project',
                status='completed',
                approved_value=Decimal('2500.00'),
                documentation_status='approved',
                material_status='arrived',
                installation_status='completed',
                dcr_status='completed',
                subsidy_status='completed',
            )
            db.add_all([active_project, completed_project])
            db.flush()
            db.add(ProjectTimeline(
                company_id=company_id,
                project_id=active_project.id,
                current_step='installation',
            ))

            account = FinancialAccount(
                company_id=company_id,
                name=f'Dashboard cash {token}',
                account_type='cash',
                opening_balance=Decimal('0.00'),
            )
            db.add(account)
            db.flush()
            db.add_all([
                FinanceTransaction(
                    company_id=company_id,
                    transaction_number=f'TXN-IN-{token}',
                    transaction_date=date.today(),
                    direction='credit',
                    amount=Decimal('1250.00'),
                    account_id=account.id,
                    source_type='customer_payment',
                    status='posted',
                    created_by=membership.id,
                ),
                FinanceTransaction(
                    company_id=company_id,
                    transaction_number=f'TXN-EXP-{token}',
                    transaction_date=date.today(),
                    direction='debit',
                    amount=Decimal('300.00'),
                    account_id=account.id,
                    source_type='expense',
                    status='posted',
                    created_by=membership.id,
                ),
                Bill(
                    company_id=company_id,
                    bill_type='sales',
                    bill_number=f'BILL-S-{token}',
                    bill_date=date.today(),
                    customer_id=active_customer.id,
                    subtotal=Decimal('5000.00'),
                    total_amount=Decimal('5000.00'),
                    balance_amount=Decimal('5000.00'),
                    status='issued',
                    created_by=membership.id,
                ),
                Bill(
                    company_id=company_id,
                    bill_type='purchase',
                    bill_number=f'BILL-P-{token}',
                    bill_date=date.today(),
                    supplier_name='Dashboard supplier',
                    subtotal=Decimal('2500.00'),
                    total_amount=Decimal('2500.00'),
                    balance_amount=Decimal('2500.00'),
                    status='issued',
                    created_by=membership.id,
                ),
            ])

            location = InventoryLocation(
                company_id=company_id,
                name=f'Dashboard warehouse {token}',
                location_type='warehouse',
            )
            item = InventoryItem(
                company_id=company_id,
                sku=f'DASH-{token}',
                name='Dashboard low-stock item',
                reorder_level=Decimal('2.00'),
                is_active=True,
            )
            db.add_all([location, item])
            db.flush()
            db.add(InventoryBalance(
                company_id=company_id,
                item_id=item.id,
                location_id=location.id,
                quantity_on_hand=Decimal('1.00'),
                reserved_quantity=Decimal('0.00'),
            ))
            db.commit()

        after_response = client.get('/api/v1/dashboard/summary', headers=headers)
        assert after_response.status_code == 200, after_response.text
        after = after_response.json()

        expected_deltas = {
            'total_customers': 3,
            'new_customers_month': 3,
            'active_projects': 1,
            'pending_quotations': 1,
            'pending_documents': 1,
            'loan_approvals_pending': 1,
            'material_arrivals_pending': 1,
            'installations_in_progress': 1,
            'dcr_pending': 1,
            'subsidy_pending': 1,
            'completed_projects': 1,
            'low_stock_items': 1,
            'money_received_month': 1250,
            'money_paid_month': 300,
            'expenses_month': 300,
            'customer_receivables': 5000,
            'supplier_payables': 2500,
        }
        for field, delta in expected_deltas.items():
            assert after[field] == before[field] + delta, field
