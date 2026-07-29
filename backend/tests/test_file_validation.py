import zipfile
from pathlib import Path

import pytest
from PIL import Image

from app.services.file_validation import FileValidationError, clean_name, validate_saved_content


def _office_file(path: Path, entries: list[str]) -> None:
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for entry in entries:
            archive.writestr(entry, "content")


def test_ooxml_subtype_must_match_extension(tmp_path: Path):
    path = tmp_path / "document.docx"
    _office_file(path, ["[Content_Types].xml", "xl/workbook.xml"])
    with pytest.raises(FileValidationError, match="subtype"):
        validate_saved_content(path, ".docx")


def test_unsafe_embedded_extension_is_rejected():
    with pytest.raises(FileValidationError, match="blocked extension"):
        clean_name("invoice.exe.pdf")


def test_image_must_parse_and_match_extension(tmp_path: Path):
    path = tmp_path / "image.png"
    Image.new("RGB", (8, 8)).save(path, format="PNG")
    assert validate_saved_content(path, ".png") == "image/png"

    broken = tmp_path / "broken.png"
    broken.write_bytes(b"\x89PNG\r\n\x1a\nnot-a-real-image")
    with pytest.raises(FileValidationError, match="invalid or unsafe"):
        validate_saved_content(broken, ".png")
