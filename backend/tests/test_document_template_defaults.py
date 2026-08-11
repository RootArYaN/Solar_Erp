from types import SimpleNamespace

from app.services import operations_service


def actor(company_name='Legacy Solar Company'):
    return SimpleNamespace(
        membership=SimpleNamespace(company=SimpleNamespace(name=company_name)),
    )


def test_new_document_templates_default_to_shree_enterprise():
    settings = operations_service._default_document_template_settings(actor(), 'customer_pack')

    assert settings['company_name'] == 'Shree Enterprise'
    assert settings['brand_name'] == 'Shree Enterprise'


def test_legacy_tenant_defaults_are_upgraded_but_custom_branding_is_preserved():
    current_actor = actor()

    upgraded = operations_service._normalize_document_template_identity({
        'company_name': 'Legacy Solar Company',
        'brand_name': 'Legacy Solar Company',
    }, current_actor)
    custom = operations_service._normalize_document_template_identity({
        'company_name': 'Custom EPC',
        'brand_name': 'Custom Brand',
    }, current_actor)

    assert upgraded['company_name'] == 'Shree Enterprise'
    assert upgraded['brand_name'] == 'Shree Enterprise'
    assert custom['company_name'] == 'Custom EPC'
    assert custom['brand_name'] == 'Custom Brand'
