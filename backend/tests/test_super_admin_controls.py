from types import SimpleNamespace

import pytest

from app.services import customer_lifecycle_service


def actor(*, super_admin: bool, permissions: list[str] | None = None):
    return SimpleNamespace(
        user=SimpleNamespace(is_super_admin=super_admin),
        membership=SimpleNamespace(company_id="company-1", id="membership-1"),
        permissions=permissions or [],
    )


def test_super_admin_guard_rejects_normal_user():
    with pytest.raises(customer_lifecycle_service.CustomerLifecycleForbiddenError):
        customer_lifecycle_service._assert_super_admin(actor(super_admin=False))


def test_super_admin_guard_accepts_super_admin():
    customer_lifecycle_service._assert_super_admin(actor(super_admin=True))


def test_customer_manager_guard_accepts_customer_editor():
    customer_lifecycle_service._assert_customer_manager(
        actor(super_admin=False, permissions=["customers.edit"])
    )


def test_customer_manager_guard_rejects_read_only_user():
    with pytest.raises(customer_lifecycle_service.CustomerLifecycleForbiddenError):
        customer_lifecycle_service._assert_customer_manager(
            actor(super_admin=False, permissions=["customers.view"])
        )
