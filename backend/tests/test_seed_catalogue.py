from app.db.migrate import MIGRATED_PERMISSIONS, REMOVED_PERMISSIONS, ROLE_MIGRATED_PERMISSIONS
from app.db.seed import PERMISSIONS, ROLE_BLUEPRINTS


def test_migration_and_bootstrap_permission_catalogues_do_not_clash():
    assert MIGRATED_PERMISSIONS.items() <= PERMISSIONS.items()
    assert not (set(REMOVED_PERMISSIONS) & set(PERMISSIONS))


def test_migration_role_links_are_compatible_with_builtin_roles():
    for role_code, permission_codes in ROLE_MIGRATED_PERMISSIONS.items():
        assert role_code in ROLE_BLUEPRINTS
        assert permission_codes <= set(ROLE_BLUEPRINTS[role_code]["permissions"])


def test_builtin_role_permission_references_exist():
    for blueprint in ROLE_BLUEPRINTS.values():
        assert set(blueprint["permissions"]) <= set(PERMISSIONS)
