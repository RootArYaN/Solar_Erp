from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.api.deps import CurrentSession, require_any_permissions, require_super_admin
from app.db.session import get_db
from app.schemas.operations import (
    CreateInventoryMovementBatchRequest,
    CreateInventoryItemRequest,
    CreateInventoryLocationRequest,
    CreateInventoryMovementRequest,
    CreatePosterRequest,
    DocumentTemplateSummary,
    GeneratedDocumentPackSummary,
    InventoryItemSummary,
    InventoryLocationSummary,
    InventoryMovementCorrectionRequest,
    InventoryMovementList,
    InventoryMovementReversalRequest,
    InventoryMovementSummary,
    UpdateInventoryItemRequest,
    UpdateInventoryLocationRequest,
    UpdatePosterRequest,
    InventorySummary,
    PosterStatusRequest,
    PosterSummary,
    PricingBookSummary,
    SaveDocumentTemplateRequest,
    SaveGeneratedDocumentPackRequest,
    SavePricingBookRequest,
)
from app.services import operations_service
from app.services.audit_service import write_event
from app.services.operations_service import OperationsServiceError

router = APIRouter(tags=['operations'])


def _raise(exc: OperationsServiceError) -> None:
    raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


@router.get('/inventory/summary', response_model=InventorySummary)
def get_inventory(
    item_page: int = Query(default=1, ge=1),
    item_page_size: int = Query(default=50, ge=1, le=100),
    item_q: str | None = Query(default=None, max_length=120),
    item_category: str | None = Query(default=None, max_length=80),
    movement_limit: int = Query(default=30, ge=0, le=100),
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(require_any_permissions('inventory.view', 'inventory.manage')),
):
    return operations_service.inventory_summary(
        db,
        session,
        item_page=item_page,
        item_page_size=item_page_size,
        item_query=item_q,
        item_category=item_category,
        movement_limit=movement_limit,
    )


@router.post('/inventory/locations', response_model=InventoryLocationSummary, status_code=201)
def post_location(payload: CreateInventoryLocationRequest, db: Session = Depends(get_db), session: CurrentSession = Depends(require_any_permissions('inventory.create', 'inventory.manage'))):
    try: return operations_service.create_location(db, session, payload)
    except OperationsServiceError as exc: _raise(exc)


@router.post('/inventory/items', response_model=InventoryItemSummary, status_code=201)
def post_item(payload: CreateInventoryItemRequest, db: Session = Depends(get_db), session: CurrentSession = Depends(require_any_permissions('inventory.create', 'inventory.manage'))):
    try: return operations_service.create_item(db, session, payload)
    except OperationsServiceError as exc: _raise(exc)




@router.patch('/inventory/items/{item_id}', response_model=InventoryItemSummary)
def patch_item(item_id: str, payload: UpdateInventoryItemRequest, db: Session = Depends(get_db), session: CurrentSession = Depends(require_any_permissions('inventory.edit', 'inventory.manage'))):
    try: return operations_service.update_inventory_item(db, session, item_id, payload)
    except OperationsServiceError as exc: _raise(exc)


@router.patch('/inventory/locations/{location_id}', response_model=InventoryLocationSummary)
def patch_location(location_id: str, payload: UpdateInventoryLocationRequest, db: Session = Depends(get_db), session: CurrentSession = Depends(require_any_permissions('inventory.edit', 'inventory.manage'))):
    try: return operations_service.update_inventory_location(db, session, location_id, payload)
    except OperationsServiceError as exc: _raise(exc)


@router.post('/inventory/movements', response_model=InventoryMovementSummary, status_code=201)
def post_movement(payload: CreateInventoryMovementRequest, db: Session = Depends(get_db), session: CurrentSession = Depends(require_any_permissions('inventory.edit', 'inventory.manage'))):
    try: return operations_service.post_movement(db, session, payload)
    except OperationsServiceError as exc: _raise(exc)


@router.post('/inventory/movement-batches', response_model=list[InventoryMovementSummary], status_code=201)
def post_movement_batch(payload: CreateInventoryMovementBatchRequest, db: Session = Depends(get_db), session: CurrentSession = Depends(require_any_permissions('inventory.edit', 'inventory.manage'))):
    try: return operations_service.post_movement_batch(db, session, payload)
    except OperationsServiceError as exc: _raise(exc)


@router.get('/inventory/movements', response_model=InventoryMovementList)
def get_inventory_movements(
    item_id: str | None = Query(default=None, max_length=36),
    customer_id: str | None = Query(default=None, max_length=36),
    movement_type: str | None = Query(default=None, max_length=32),
    status: str | None = Query(default=None, max_length=24),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=100),
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(require_any_permissions('inventory.view', 'inventory.manage')),
):
    return operations_service.list_inventory_movements(
        db,
        session,
        item_id=item_id,
        customer_id=customer_id,
        movement_type=movement_type,
        status=status,
        page=page,
        page_size=page_size,
    )


@router.post('/inventory/movements/{movement_id}/reverse', response_model=InventoryMovementSummary, status_code=201)
def reverse_inventory_movement(
    movement_id: str,
    payload: InventoryMovementReversalRequest,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(require_super_admin),
):
    try:
        return operations_service.reverse_inventory_movement(db, session, movement_id, payload)
    except OperationsServiceError as exc:
        _raise(exc)


@router.post('/inventory/movements/{movement_id}/correct', response_model=InventoryMovementSummary, status_code=201)
def correct_inventory_movement(
    movement_id: str,
    payload: InventoryMovementCorrectionRequest,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(require_super_admin),
):
    try:
        return operations_service.correct_inventory_movement(db, session, movement_id, payload)
    except OperationsServiceError as exc:
        _raise(exc)


@router.get('/pricing', response_model=PricingBookSummary)
def get_pricing(db: Session = Depends(get_db), session: CurrentSession = Depends(require_any_permissions('pricing.view', 'pricing.edit'))):
    return operations_service.get_pricing(db, session)


@router.put('/pricing', response_model=PricingBookSummary)
def put_pricing(payload: SavePricingBookRequest, db: Session = Depends(get_db), session: CurrentSession = Depends(require_any_permissions('pricing.edit', 'pricing.approve'))):
    try: return operations_service.save_pricing(db, session, payload)
    except OperationsServiceError as exc: _raise(exc)


@router.get('/posters', response_model=list[PosterSummary])
def get_posters(status: str | None = Query(default=None, pattern=r'^(draft|active)$'), db: Session = Depends(get_db), session: CurrentSession = Depends(require_any_permissions('posters.view', 'posters.edit'))):
    return operations_service.list_posters(db, session, status)


@router.post('/posters', response_model=PosterSummary, status_code=201)
def post_poster(payload: CreatePosterRequest, db: Session = Depends(get_db), session: CurrentSession = Depends(require_any_permissions('posters.create'))):
    try: return operations_service.create_poster(db, session, payload)
    except OperationsServiceError as exc: _raise(exc)




@router.patch('/posters/{poster_id}', response_model=PosterSummary)
def patch_poster(poster_id: str, payload: UpdatePosterRequest, db: Session = Depends(get_db), session: CurrentSession = Depends(require_any_permissions('posters.edit'))):
    try: return operations_service.update_poster(db, session, poster_id, payload)
    except OperationsServiceError as exc: _raise(exc)


@router.patch('/posters/{poster_id}/status', response_model=PosterSummary)
def patch_poster_status(poster_id: str, payload: PosterStatusRequest, db: Session = Depends(get_db), session: CurrentSession = Depends(require_any_permissions('posters.edit'))):
    try: return operations_service.set_poster_status(db, session, poster_id, payload.status)
    except OperationsServiceError as exc: _raise(exc)


@router.get('/document-templates/{template_type}', response_model=DocumentTemplateSummary)
def get_template(template_type: str, db: Session = Depends(get_db), session: CurrentSession = Depends(require_any_permissions('documents.view', 'documents.manage'))):
    return operations_service.get_template(db, session, template_type)


@router.put('/document-templates/{template_type}', response_model=DocumentTemplateSummary)
def put_template(template_type: str, payload: SaveDocumentTemplateRequest, db: Session = Depends(get_db), session: CurrentSession = Depends(require_any_permissions('documents.manage'))):
    try: return operations_service.save_template(db, session, template_type, payload)
    except OperationsServiceError as exc: _raise(exc)


@router.get('/document-packs/customer/{customer_id}', response_model=list[GeneratedDocumentPackSummary])
def get_document_packs(customer_id: str, db: Session = Depends(get_db), session: CurrentSession = Depends(require_any_permissions('documents.view', 'documents.manage'))):
    try: return operations_service.list_document_packs(db, session, customer_id)
    except OperationsServiceError as exc: _raise(exc)


@router.put('/document-packs/customer/{customer_id}', response_model=GeneratedDocumentPackSummary)
def put_document_pack(customer_id: str, payload: SaveGeneratedDocumentPackRequest, db: Session = Depends(get_db), session: CurrentSession = Depends(require_any_permissions('documents.create', 'documents.edit', 'documents.manage'))):
    try: return operations_service.save_document_pack(db, session, customer_id, payload)
    except OperationsServiceError as exc: _raise(exc)


@router.post('/document-packs/{pack_id}/finalize', response_model=GeneratedDocumentPackSummary)
def post_finalize_document_pack(pack_id: str, db: Session = Depends(get_db), session: CurrentSession = Depends(require_any_permissions('documents.approve', 'documents.manage'))):
    try: return operations_service.finalize_document_pack(db, session, pack_id)
    except OperationsServiceError as exc: _raise(exc)


@router.get('/document-packs/{pack_id}/merged-download')
def get_merged_document_pack(
    pack_id: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(require_any_permissions('documents.view', 'documents.manage')),
):
    try:
        path, name, row, attachment_count = operations_service.merged_document_pack(db, session, pack_id)
    except OperationsServiceError as exc:
        _raise(exc)
    write_event(
        db,
        company_id=row.company_id,
        event='document_pack.merged_downloaded',
        entity='generated_document_pack',
        entity_id=row.id,
        actor=session,
        project_id=row.project_id,
        customer_id=row.customer_id,
        changes={'version': row.version, 'attachment_count': attachment_count},
    )
    db.commit()
    background_tasks.add_task(path.unlink, missing_ok=True)
    return FileResponse(path=path, media_type='application/pdf', filename=name, background=background_tasks)
