"""File-backed JSON store for `FullDesign` snapshots and revision history.

Layout under ``DESIGN_STORAGE_DIR`` (default ``/data/designs``)::

    <root>/
        index.json                    # rolling index of {design_id: summary}
        <design_id>.json              # canonical FullDesign snapshot
        revisions/
            <design_id>/
                <revision_id>.json    # individual revision (snapshot before+after)

All writes are atomic (``tempfile + os.replace``). Reads tolerate a missing
``index.json`` by rebuilding from the on-disk snapshots.
"""

from __future__ import annotations

import json
import logging
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from models.design_models import DesignRevision, FullDesign

logger = logging.getLogger(__name__)

_DEFAULT_DIR = "/data/designs"


def _root_dir() -> Path:
    return Path(os.environ.get("DESIGN_STORAGE_DIR", _DEFAULT_DIR))


def _ensure_dirs() -> Path:
    root = _root_dir()
    root.mkdir(parents=True, exist_ok=True)
    (root / "revisions").mkdir(parents=True, exist_ok=True)
    return root


def _atomic_write(path: Path, payload: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(
        prefix=f".{path.name}.", suffix=".tmp", dir=str(path.parent)
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(payload)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp_path, path)
    except Exception:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise


def _design_path(design_id: str) -> Path:
    return _root_dir() / f"{design_id}.json"


def _revisions_dir(design_id: str) -> Path:
    return _root_dir() / "revisions" / design_id


def _index_path() -> Path:
    return _root_dir() / "index.json"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _summary_of(design: FullDesign) -> dict[str, Any]:
    tables = design.parsed_schema.tables if design.parsed_schema else []
    return {
        "design_id": design.design_id,
        "created_at": design.created_at,
        "table_count": len(tables),
        "domain_guess": (
            design.domain_analysis.domain_guess if design.domain_analysis else ""
        ),
        "filename": getattr(design, "uploaded_filename", "") or "",
    }


def _load_index() -> dict[str, dict[str, Any]]:
    path = _index_path()
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text("utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        logger.warning("design_store: corrupt index.json (%s); rebuilding", exc)
        return _rebuild_index()


def _rebuild_index() -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for child in _root_dir().glob("*.json"):
        if child.name == "index.json":
            continue
        try:
            data = json.loads(child.read_text("utf-8"))
            design = FullDesign(**data)
            out[design.design_id] = _summary_of(design)
        except Exception as exc:  # noqa: BLE001
            logger.warning("design_store: skipping %s (%s)", child, exc)
    _atomic_write(_index_path(), json.dumps(out, indent=2))
    return out


def _write_index(index: dict[str, dict[str, Any]]) -> None:
    _atomic_write(_index_path(), json.dumps(index, indent=2))


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def save_design(design: FullDesign) -> Path:
    """Persist the canonical design snapshot and refresh the index entry."""
    _ensure_dirs()
    if not design.created_at:
        design.created_at = _now_iso()
    path = _design_path(design.design_id)
    _atomic_write(path, design.model_dump_json(indent=2))

    index = _load_index()
    index[design.design_id] = _summary_of(design)
    _write_index(index)
    return path


def load_design(design_id: str) -> Optional[FullDesign]:
    path = _design_path(design_id)
    if not path.exists():
        return None
    data = json.loads(path.read_text("utf-8"))
    return FullDesign(**data)


def list_designs() -> list[dict[str, Any]]:
    _ensure_dirs()
    index = _load_index()
    return sorted(
        index.values(),
        key=lambda s: s.get("created_at", ""),
        reverse=True,
    )


def delete_design(design_id: str) -> bool:
    deleted = False
    path = _design_path(design_id)
    if path.exists():
        path.unlink()
        deleted = True

    rev_dir = _revisions_dir(design_id)
    if rev_dir.exists():
        for rev_file in rev_dir.glob("*.json"):
            try:
                rev_file.unlink()
            except OSError:
                pass
        try:
            rev_dir.rmdir()
        except OSError:
            pass

    index = _load_index()
    if design_id in index:
        index.pop(design_id, None)
        _write_index(index)
        deleted = True
    return deleted


def append_revision(design_id: str, revision: DesignRevision) -> None:
    """Write a revision (pending or applied) into the per-design revisions dir.

    Does NOT mutate the canonical design snapshot. Call :func:`save_design`
    separately when applying a revision's ``after`` snapshot.
    """
    _ensure_dirs()
    if not revision.created_at:
        revision.created_at = _now_iso()
    rev_dir = _revisions_dir(design_id)
    rev_dir.mkdir(parents=True, exist_ok=True)
    rev_path = rev_dir / f"{revision.revision_id}.json"
    _atomic_write(rev_path, revision.model_dump_json(indent=2))


def list_revisions(design_id: str) -> list[DesignRevision]:
    rev_dir = _revisions_dir(design_id)
    if not rev_dir.exists():
        return []
    revisions: list[DesignRevision] = []
    for rev_file in sorted(rev_dir.glob("*.json")):
        try:
            data = json.loads(rev_file.read_text("utf-8"))
            revisions.append(DesignRevision(**data))
        except Exception as exc:  # noqa: BLE001
            logger.warning("design_store: skip revision %s (%s)", rev_file, exc)
    revisions.sort(key=lambda r: r.created_at)
    return revisions


def load_revision(design_id: str, revision_id: str) -> Optional[DesignRevision]:
    rev_path = _revisions_dir(design_id) / f"{revision_id}.json"
    if not rev_path.exists():
        return None
    data = json.loads(rev_path.read_text("utf-8"))
    return DesignRevision(**data)


def apply_revision(design_id: str, revision_id: str) -> Optional[FullDesign]:
    """Mark a revision as applied and swap the canonical snapshot to its
    ``after`` design. Returns the new canonical design or ``None`` if the
    revision or its ``after`` snapshot is missing.
    """
    revision = load_revision(design_id, revision_id)
    if revision is None or revision.after is None:
        return None
    revision.applied = True
    if not revision.created_at:
        revision.created_at = _now_iso()
    append_revision(design_id, revision)

    new_design = revision.after
    new_design.design_id = design_id
    if not new_design.created_at:
        new_design.created_at = _now_iso()
    save_design(new_design)
    return new_design


def drop_revision(design_id: str, revision_id: str) -> bool:
    rev_path = _revisions_dir(design_id) / f"{revision_id}.json"
    if not rev_path.exists():
        return False
    rev_path.unlink()
    return True


def restore_revision(design_id: str, revision_id: str) -> Optional[FullDesign]:
    """Restore an earlier applied revision's ``after`` snapshot as the new
    canonical design. Records the restore as a fresh revision pointing at the
    same ``after`` snapshot.
    """
    revision = load_revision(design_id, revision_id)
    if revision is None or revision.after is None:
        return None

    restore_rev = DesignRevision(
        revision_id=f"restore-{revision_id}-{int(datetime.now().timestamp())}",
        parent_revision_id=revision_id,
        actor="user",
        request=f"restore revision {revision_id}",
        change_summary=f"Restore design state from revision {revision_id}",
        before=load_design(design_id),
        after=revision.after,
        reasoning="User restored a prior revision.",
        applied=True,
        created_at=_now_iso(),
    )
    append_revision(design_id, restore_rev)
    new_design = revision.after
    new_design.design_id = design_id
    if not new_design.created_at:
        new_design.created_at = _now_iso()
    save_design(new_design)
    return new_design
