from __future__ import annotations

import json
import textwrap
from decimal import Decimal
from pathlib import Path
from typing import Iterable

from app.models.agent import AgentCustomer
from app.models.workflow import CustomerProject, CustomerQuotation


def _ascii(value: object) -> str:
    return str(value or "").replace("₹", "INR ").encode("ascii", "ignore").decode("ascii")


def _escape(value: str) -> str:
    return value.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def _money(value: Decimal | float | int | str | None) -> str:
    try:
        return f"INR {float(value or 0):,.2f}"
    except (TypeError, ValueError):
        return "INR 0.00"


def write_text_pdf(path: Path, title: str, lines: Iterable[str]) -> None:
    wrapped: list[str] = []
    for raw in lines:
        text = _ascii(raw).strip()
        if not text:
            wrapped.append("")
            continue
        wrapped.extend(textwrap.wrap(text, width=92) or [""])

    pages = [wrapped[index:index + 46] for index in range(0, max(1, len(wrapped)), 46)] or [[]]
    streams: list[str] = []
    for page_index, page in enumerate(pages, start=1):
        commands = ["BT /F2 17 Tf 42 800 Td (%s) Tj ET" % _escape(_ascii(title)[:80])]
        y = 774
        for line in page:
            commands.append(f"BT /F1 9 Tf 42 {y} Td ({_escape(line)}) Tj ET")
            y -= 15
        commands.append(f"BT /F1 7 Tf 510 24 Td ({page_index}/{len(pages)}) Tj ET")
        streams.append("\n".join(commands))

    objects: dict[int, str] = {
        1: "<< /Type /Catalog /Pages 2 0 R >>",
        3: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        4: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
    }
    page_ids: list[int] = []
    next_id = 5
    for stream in streams:
        content_id = next_id
        page_id = next_id + 1
        next_id += 2
        objects[content_id] = f"<< /Length {len(stream.encode('latin-1'))} >>\nstream\n{stream}\nendstream"
        objects[page_id] = (
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] "
            f"/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents {content_id} 0 R >>"
        )
        page_ids.append(page_id)
    objects[2] = f"<< /Type /Pages /Kids [{' '.join(f'{value} 0 R' for value in page_ids)}] /Count {len(page_ids)} >>"

    size = max(objects) + 1
    pdf = "%PDF-1.4\n%SolarERP\n"
    offsets = [0] * size
    for object_id in range(1, size):
        offsets[object_id] = len(pdf.encode("latin-1"))
        pdf += f"{object_id} 0 obj\n{objects[object_id]}\nendobj\n"
    xref = len(pdf.encode("latin-1"))
    pdf += f"xref\n0 {size}\n0000000000 65535 f \n"
    for object_id in range(1, size):
        pdf += f"{offsets[object_id]:010d} 00000 n \n"
    pdf += f"trailer\n<< /Size {size} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(pdf.encode("latin-1"))


def write_quotation_pdf(path: Path, quotation: CustomerQuotation, customer: AgentCustomer | None) -> None:
    try:
        raw_lines = json.loads(quotation.line_items_json or "[]")
    except (TypeError, ValueError, json.JSONDecodeError):
        raw_lines = []
    lines = [
        f"Quotation: {quotation.quotation_number}",
        f"Status: {quotation.status}",
        f"Customer: {customer.customer_name if customer else quotation.customer_id}",
        f"Address: {customer.address if customer else ''}",
        "",
        "Items",
    ]
    for index, item in enumerate(raw_lines if isinstance(raw_lines, list) else [], start=1):
        if not isinstance(item, dict):
            continue
        lines.append(
            f"{index}. {item.get('description', 'Item')} | Qty {item.get('quantity', 0)} {item.get('unit', '')} "
            f"| Rate {_money(item.get('unit_price'))} | Tax {item.get('tax_rate', 0)}% | Total {_money(item.get('line_total'))}"
        )
    lines.extend([
        "",
        f"Subtotal: {_money(quotation.subtotal)}",
        f"Tax: {_money(quotation.tax_total)}",
        f"Grand total: {_money(quotation.grand_total)}",
        f"Decision note: {quotation.decision_comment}",
    ])
    write_text_pdf(path, quotation.title or "Solar quotation", lines)


def write_project_summary_pdf(path: Path, project: CustomerProject, customer: AgentCustomer | None) -> None:
    write_text_pdf(path, "Project summary", [
        f"Project number: {project.project_number}",
        f"Project name: {project.name}",
        f"Customer: {customer.customer_name if customer else project.customer_id}",
        f"Status: {project.status}",
        f"Capacity: {project.capacity_kw} kW",
        f"Approved value: {_money(project.approved_value)}",
        f"Created: {project.created_at.isoformat()}",
        "This report was generated from verified ERP data.",
    ])
