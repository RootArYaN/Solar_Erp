import inspect

from app.models.finance import FinanceTransaction
from app.services.access_service import (
    operational_reference_filter,
    visible_customer_ids,
    visible_project_ids,
    visible_quotation_ids,
    visible_quotation_request_ids,
)
from app.services.agent_service import (
    _operational_customers_for_profile,
    _paged_transaction_summaries,
    get_agent_overview,
    list_agents,
    update_agent_transaction,
    delete_agent_transaction,
)
from app.services.tasks_service import _operational_task_filter
from app.services.finance_service import _visible_bill_filter, update_bill, record_bill_payment, reverse_bill_payment, void_bill
from app.services.operations_service import _post_movement_row
from app.services.workflow_service import decide_quotation, decide_transaction, generate_quotation, list_project_timelines, _get_project_context, _quotation_request_summary


def normalized_sql(statement) -> str:
    return " ".join(str(statement).lower().split())


def test_visible_customer_query_excludes_all_soft_delete_markers():
    sql = normalized_sql(visible_customer_ids("company-1"))
    assert "agent_customers.status !=" in sql
    assert "agent_customers.deleted_at is null" in sql
    assert "agent_customers.company_id =" in sql


def test_customer_snapshot_allows_explicit_super_admin_deleted_customer_access():
    from app.services.customer_flow_service import get_snapshot

    source = inspect.getsource(get_snapshot)
    assert "_load_customer(db, actor, customer_id, include_deleted=True)" in source


def test_visible_project_query_inherits_customer_visibility():
    sql = normalized_sql(visible_project_ids("company-1"))
    assert "customer_projects.customer_id in" in sql
    assert "agent_customers.status !=" in sql
    assert "agent_customers.deleted_at is null" in sql
    assert "customer_projects.company_id =" in sql


def test_visible_quotation_queries_inherit_customer_visibility():
    request_sql = normalized_sql(visible_quotation_request_ids("company-1"))
    quotation_sql = normalized_sql(visible_quotation_ids("company-1"))
    for sql in (request_sql, quotation_sql):
        assert "agent_customers.status !=" in sql
        assert "agent_customers.deleted_at is null" in sql
        assert "customer_id in" in sql


def test_customer_linked_finance_and_task_filters_use_visible_references():
    finance_sql = normalized_sql(
        operational_reference_filter(
            "company-1",
            customer_column=FinanceTransaction.customer_id,
            project_column=FinanceTransaction.project_id,
        )
    )
    task_sql = normalized_sql(_operational_task_filter("company-1"))

    assert "finance_transactions.customer_id is null" in finance_sql
    assert "finance_transactions.project_id is null" in finance_sql
    assert finance_sql.count("agent_customers.status !=") >= 2
    assert finance_sql.count("agent_customers.deleted_at is null") >= 2

    assert "tasks.context_type !=" in task_sql
    assert "tasks.context_id is null" in task_sql
    assert task_sql.count("agent_customers.status !=") >= 2
    assert task_sql.count("agent_customers.deleted_at is null") >= 2


def test_project_and_quotation_workflows_use_visibility_guards():
    project_source = inspect.getsource(list_project_timelines)
    generate_source = inspect.getsource(generate_quotation)
    decide_source = inspect.getsource(decide_quotation)
    assert "operational_customer_filter" in project_source
    assert "visible_quotation_request_ids" in generate_source
    assert "visible_quotation_ids" in decide_source


def test_agent_views_exclude_deleted_customers_from_rows_counts_and_project_balance():
    list_source = inspect.getsource(list_agents)
    overview_source = inspect.getsource(get_agent_overview)
    customer_query_source = inspect.getsource(_operational_customers_for_profile)
    transaction_query_source = inspect.getsource(_paged_transaction_summaries)
    assert "operational_customer_filter" in list_source
    assert "visible_project_ids" in list_source
    assert "_operational_customers_for_profile" in overview_source
    assert "_paged_transaction_summaries" in overview_source
    assert "operational_customer_filter" in customer_query_source
    assert "_transaction_window" in transaction_query_source
    assert ".offset((page - 1) * page_size)" in transaction_query_source
    assert ".limit(page_size)" in transaction_query_source
    assert "profile.customers" not in overview_source
    assert "profile.transactions" not in overview_source


def test_agent_customer_overview_is_server_paginated_and_searchable():
    source = inspect.getsource(_operational_customers_for_profile)
    assert "func.count(AgentCustomer.id)" in source
    assert ".offset((page - 1) * page_size)" in source
    assert ".limit(page_size)" in source
    assert "customer_name" in source
    assert "consumer_number" in source


def test_direct_workflow_contexts_cannot_bypass_soft_delete_visibility():
    for function in (decide_quotation, _get_project_context, _quotation_request_summary):
        source = inspect.getsource(function)
        assert "operational_customer_filter" in source
        assert "db.get(AgentCustomer" not in source


def test_direct_bill_mutations_use_operational_visibility_guard():
    sql = normalized_sql(_visible_bill_filter("company-1"))
    assert "agent_customers.status !=" in sql
    assert "agent_customers.deleted_at is null" in sql
    for function in (update_bill, record_bill_payment, reverse_bill_payment, void_bill):
        assert "_load_visible_bill" in inspect.getsource(function)


def test_inventory_location_validation_is_batched():
    source = inspect.getsource(_post_movement_row)
    assert "InventoryLocation.id.in_(location_ids)" in source
    assert "valid_location_ids" in source


def test_direct_agent_transaction_mutations_hide_deleted_customer_projects():
    for function in (update_agent_transaction, delete_agent_transaction):
        source = inspect.getsource(function)
        assert "visible_project_ids" in source
        assert "AgentTransaction.project_id.is_(None)" in source


def test_direct_transaction_approval_is_visibility_guarded_before_mutation():
    source = inspect.getsource(decide_transaction)
    assert "visible_project_ids" in source
    assert "select(TransactionApproval, AgentTransaction)" in source
    assert source.index("visible_project_ids") < source.index("approval.status = payload.decision")


def test_direct_finance_transaction_mutations_use_operational_visibility_guard():
    from app.services.finance_service import (
        _load_visible_transaction,
        delete_transaction,
        reverse_transaction,
        update_transaction,
    )

    loader_source = inspect.getsource(_load_visible_transaction)
    assert "_visible_transaction_filter" in loader_source
    for function in (update_transaction, reverse_transaction, delete_transaction):
        assert "_load_visible_transaction" in inspect.getsource(function)


def test_direct_inventory_corrections_cannot_touch_deleted_customer_history():
    from app.services.operations_service import _load_movement_for_update

    source = inspect.getsource(_load_movement_for_update)
    assert "operational_reference_filter" in source
    assert "InventoryMovement.customer_id" in source
    assert "InventoryMovement.project_id" in source


def test_finalized_agent_transaction_facts_are_not_rewritten_or_deleted():
    update_source = inspect.getsource(update_agent_transaction)
    delete_source = inspect.getsource(delete_agent_transaction)
    assert "Finalized agent transaction amounts, type, date, and project cannot be rewritten" in update_source
    assert 'editable_fields = ("reference", "description") if finalized' in update_source
    assert 'approval is None or approval.status != "pending"' in delete_source
    assert "Finalized agent transactions cannot be deleted" in delete_source


def test_data_health_detects_missing_agent_transaction_project_links():
    from app.services.data_health_service import inspect_data_health

    source = inspect.getsource(inspect_data_health)
    assert 'key="orphaned_agent_transaction_project"' in source
    assert "AgentTransaction.project_id.is_not(None)" in source
    assert "~exists" in source


def test_model_metadata_contains_indexes_already_created_by_migration_012():
    from app.models.agent import AgentCustomer
    from app.models.operations import InventoryMovement
    from app.models.system import AuditEvent

    index_names = {
        index.name
        for table in (AgentCustomer.__table__, InventoryMovement.__table__, AuditEvent.__table__)
        for index in table.indexes
    }
    assert "ix_agent_customers_company_archived" in index_names
    assert "ix_inventory_movement_company_status_created" in index_names
    assert "ix_audit_events_company_event_created" in index_names
    assert "ix_audit_events_company_user_created" in index_names


def test_inventory_item_list_is_server_filtered_and_paginated():
    from app.services.operations_service import _inventory_item_filters, inventory_summary

    filter_source = inspect.getsource(_inventory_item_filters)
    summary_source = inspect.getsource(inventory_summary)
    assert "InventoryItem.sku" in filter_source
    assert "InventoryItem.name" in filter_source
    assert "InventoryLocation.name" in filter_source
    assert "item_total" in summary_source
    assert "item_offset" in summary_source
    assert "item_page_size" in summary_source
