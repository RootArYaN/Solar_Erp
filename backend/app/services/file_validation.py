from __future__ import annotations

import json
import mimetypes
import warnings
import zipfile
from pathlib import Path


EXTENSION_MIME = {
    ".pdf": "application/pdf",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".csv": "text/csv",
    ".json": "application/json",
    ".txt": "text/plain",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}
ALLOWED_EXTENSIONS = frozenset(EXTENSION_MIME)
MIME_ALIASES = {
    ".docx": {"application/zip"},
    ".xlsx": {"application/zip"},
    ".csv": {"text/plain", "application/vnd.ms-excel"},
    ".json": {"text/plain"},
}
DANGEROUS_EMBEDDED_EXTENSIONS = {
    "app", "asp", "aspx", "bat", "cgi", "cmd", "com", "dll", "dmg", "exe", "hta", "jar", "js", "jse",
    "lnk", "msi", "php", "phtml", "ps1", "py", "rb", "scr", "sh", "vbs", "vbe",
}
BIDI_CONTROLS = {chr(value) for value in range(0x202A, 0x202F)} | {chr(value) for value in range(0x2066, 0x206A)}
MAX_OOXML_UNCOMPRESSED_BYTES = 200 * 1024 * 1024
MAX_IMAGE_PIXELS = 50_000_000
CUSTOMER_DOCUMENT_FILE_SUFFIXES = {
    "aadhaar": "Aadhaar_Card",
    "pan": "PAN_Card",
    "photo": "Passport_Size_Photo",
    "electricity_bill": "Electricity_Bill",
    "cancelled_cheque": "Cancelled_Cheque",
    "bank_passbook": "Bank_Passbook",
    "ownership_proof": "Property_Ownership_Proof",
    "site_photo": "Site_Photographs",
    "customer_signature": "Customer_Signature",
    "loan_document": "Loan_Documents",
    "discom_document": "DISCOM_Documents",
    "installation_photo": "Installation_Photographs",
    "dcr_document": "DCR_Documents",
    "subsidy_document": "Subsidy_Documents",
    "sales_bill": "Sales_Bill",
    "completion_document": "Completion_Document",
}


class FileValidationError(ValueError):
    pass


def clean_name(value: str) -> str:
    raw = (value or "document").strip()
    if (
        not raw
        or len(raw) > 240
        or raw.startswith(".")
        or raw.endswith((".", " "))
        or any(character in raw for character in ("/", "\\", "\x00"))
        or any(ord(character) < 32 or character in BIDI_CONTROLS for character in raw)
    ):
        raise FileValidationError("The uploaded file name is unsafe")
    parts = raw.lower().split(".")
    if any(part in DANGEROUS_EMBEDDED_EXTENSIONS for part in parts[1:-1]):
        raise FileValidationError("The uploaded file name contains a blocked extension")
    return raw


def typed_customer_document_name(name: str, owner_type: str) -> str:
    if not owner_type.startswith("customer_document:"):
        return name
    suffix = CUSTOMER_DOCUMENT_FILE_SUFFIXES.get(owner_type.partition(":")[2])
    if not suffix:
        return name
    path = Path(name)
    extension = path.suffix
    stem = path.stem or "document"
    normalized_stem = stem.lower().replace(" ", "_").replace("-", "_")
    if normalized_stem.endswith(f"_{suffix.lower()}"):
        return name
    max_stem_length = max(1, 240 - len(extension) - len(suffix) - 1)
    return f"{stem[:max_stem_length]}_{suffix}{extension}"


def accepted_mime_types(extension: str) -> set[str]:
    return {EXTENSION_MIME[extension], "application/octet-stream", *MIME_ALIASES.get(extension, set())}


def declared_mime_type(filename: str, content_type: str | None) -> str:
    return (content_type or mimetypes.guess_type(filename)[0] or "").lower()


def _validate_ooxml(path: Path, extension: str) -> None:
    required = "word/document.xml" if extension == ".docx" else "xl/workbook.xml"
    try:
        with zipfile.ZipFile(path) as archive:
            entries = archive.infolist()
            names = {entry.filename for entry in entries}
            if "[Content_Types].xml" not in names or required not in names:
                raise FileValidationError("The Office document subtype does not match its extension")
            total_uncompressed = 0
            for entry in entries:
                normalized = entry.filename.replace("\\", "/")
                if normalized.startswith("/") or ".." in normalized.split("/"):
                    raise FileValidationError("The Office document contains an unsafe archive path")
                total_uncompressed += entry.file_size
                if total_uncompressed > MAX_OOXML_UNCOMPRESSED_BYTES:
                    raise FileValidationError("The Office document expands beyond the safe limit")
                if entry.compress_size and entry.file_size / entry.compress_size > 200:
                    raise FileValidationError("The Office document has an unsafe compression ratio")
    except zipfile.BadZipFile as exc:
        raise FileValidationError("The Office document is not a valid ZIP container") from exc


def _validate_image(path: Path, extension: str) -> None:
    from PIL import Image, UnidentifiedImageError

    expected = "JPEG" if extension in {".jpg", ".jpeg"} else extension[1:].upper()
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(path) as image:
                width, height = image.size
                if width <= 0 or height <= 0 or width * height > MAX_IMAGE_PIXELS:
                    raise FileValidationError("The image dimensions exceed the safe limit")
                if (image.format or "").upper() != expected:
                    raise FileValidationError("The image content does not match its extension")
                image.verify()
    except FileValidationError:
        raise
    except (Image.DecompressionBombError, Image.DecompressionBombWarning, UnidentifiedImageError, OSError) as exc:
        raise FileValidationError("The uploaded image is invalid or unsafe") from exc


def validate_saved_content(path: Path, extension: str) -> str:
    with path.open("rb") as handle:
        header = handle.read(1024)

    expected_mime = EXTENSION_MIME[extension]
    if extension == ".pdf" and b"%PDF-" not in header:
        raise FileValidationError("The file content does not match a PDF")
    if extension in {".jpg", ".jpeg"} and not header.startswith(b"\xff\xd8\xff"):
        raise FileValidationError("The file content does not match a JPEG image")
    if extension == ".png" and not header.startswith(b"\x89PNG\r\n\x1a\n"):
        raise FileValidationError("The file content does not match a PNG image")
    if extension == ".webp" and not (header.startswith(b"RIFF") and header[8:12] == b"WEBP"):
        raise FileValidationError("The file content does not match a WebP image")
    if extension in {".jpg", ".jpeg", ".png", ".webp"}:
        _validate_image(path, extension)
    if extension in {".docx", ".xlsx"}:
        _validate_ooxml(path, extension)
    if extension in {".csv", ".json", ".txt"}:
        try:
            text = path.read_text(encoding="utf-8-sig")
        except UnicodeDecodeError as exc:
            raise FileValidationError("Text uploads must use UTF-8 encoding") from exc
        if "\x00" in text:
            raise FileValidationError("The text upload contains binary content")
        if extension == ".json":
            try:
                json.loads(text)
            except json.JSONDecodeError as exc:
                raise FileValidationError("The JSON upload is invalid") from exc
    return expected_mime
