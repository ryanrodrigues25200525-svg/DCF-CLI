from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from hashlib import sha256
from pathlib import Path
from zipfile import ZipFile

from app.core.errors import AppError

EXPECTED_TEMPLATE_SHA256 = "ee0c4e63dad9b5dc79387cd3da1dc0bcbf2bb943f102c533e3c487c17ace9868"


@dataclass(frozen=True)
class TemplateArtifact:
    workbook_bytes: bytes
    styles_xml: bytes


_TEMPLATE_PATH = (
    Path(__file__).resolve().parents[2]
    / "assets"
    / "templates"
    / "dcf-export-template.xlsx"
)


def _read_template_bytes() -> bytes:
    if not _TEMPLATE_PATH.exists():
        raise AppError(
            message=f"Excel template not found: {_TEMPLATE_PATH}",
            status_code=500,
            code="TEMPLATE_NOT_FOUND",
        )
    return _TEMPLATE_PATH.read_bytes()


def _validate_template_hash(raw: bytes) -> None:
    digest = sha256(raw).hexdigest()
    if digest != EXPECTED_TEMPLATE_SHA256:
        raise AppError(
            message="template integrity check failed",
            status_code=500,
            code="TEMPLATE_HASH_MISMATCH",
            payload={"expected": EXPECTED_TEMPLATE_SHA256, "actual": digest},
        )


@lru_cache(maxsize=1)
def load_template_artifact() -> TemplateArtifact:
    raw = _read_template_bytes()
    _validate_template_hash(raw)

    with ZipFile(Path(_TEMPLATE_PATH)) as archive:
        try:
            styles_xml = archive.read("xl/styles.xml")
        except KeyError as exc:
            raise AppError(
                message="Template is missing xl/styles.xml",
                status_code=500,
                code="TEMPLATE_STYLES_MISSING",
            ) from exc

    return TemplateArtifact(workbook_bytes=raw, styles_xml=styles_xml)
