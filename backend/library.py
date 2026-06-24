"""
노트북(폴더) + 문서 라이브러리 모델. data/library.json 에 영속화.

구조:
{
  "notebooks": [
    {"id": "...", "name": "내 문서",
     "docs": [{"id": "...", "name": "x.pdf", "path": "...", "chunks": 42, "added": "ISO"}]}
  ]
}
"""

import json
import os
import time
import uuid

from backend.paths import data_dir

_LIB_PATH = lambda: os.path.join(data_dir(), "library.json")


def _new_id() -> str:
    return uuid.uuid4().hex[:12]


def load() -> dict:
    path = _LIB_PATH()
    if not os.path.isfile(path):
        lib = {"notebooks": [{"id": _new_id(), "name": "내 문서", "docs": []}]}
        save(lib)
        return lib
    try:
        with open(path, "r", encoding="utf-8") as f:
            lib = json.load(f)
    except (OSError, json.JSONDecodeError):
        lib = {"notebooks": [{"id": _new_id(), "name": "내 문서", "docs": []}]}
        save(lib)
    if not lib.get("notebooks"):
        lib["notebooks"] = [{"id": _new_id(), "name": "내 문서", "docs": []}]
        save(lib)
    return lib


def save(lib: dict) -> None:
    with open(_LIB_PATH(), "w", encoding="utf-8") as f:
        json.dump(lib, f, ensure_ascii=False, indent=2)


def _find_notebook(lib: dict, notebook_id: str) -> dict | None:
    for nb in lib["notebooks"]:
        if nb["id"] == notebook_id:
            return nb
    return None


def add_notebook(name: str) -> dict:
    lib = load()
    nb = {"id": _new_id(), "name": name or "새 노트북", "docs": []}
    lib["notebooks"].append(nb)
    save(lib)
    return nb


def rename_notebook(notebook_id: str, name: str) -> bool:
    lib = load()
    nb = _find_notebook(lib, notebook_id)
    if not nb:
        return False
    nb["name"] = name
    save(lib)
    return True


def delete_notebook(notebook_id: str) -> list[str]:
    """삭제된 노트북에 속한 문서 id 목록 반환(인덱스 정리용)."""
    lib = load()
    nb = _find_notebook(lib, notebook_id)
    if not nb:
        return []
    doc_ids = [d["id"] for d in nb["docs"]]
    lib["notebooks"] = [n for n in lib["notebooks"] if n["id"] != notebook_id]
    if not lib["notebooks"]:
        lib["notebooks"] = [{"id": _new_id(), "name": "내 문서", "docs": []}]
    save(lib)
    return doc_ids


def add_document(notebook_id: str, name: str, path: str, chunks: int,
                 status: str = "ready") -> dict | None:
    lib = load()
    nb = _find_notebook(lib, notebook_id)
    if not nb:
        return None
    doc = {
        "id": _new_id(),
        "name": name,
        "path": path,
        "chunks": chunks,
        "status": status,   # indexing | ready | error
        "added": time.strftime("%Y-%m-%dT%H:%M:%S"),
    }
    nb["docs"].append(doc)
    save(lib)
    return doc


def set_doc_status(doc_id: str, status: str, chunks: int | None = None) -> None:
    lib = load()
    for nb in lib["notebooks"]:
        for d in nb["docs"]:
            if d["id"] == doc_id:
                d["status"] = status
                if chunks is not None:
                    d["chunks"] = chunks
                save(lib)
                return


def set_doc_chunks(doc_id: str, chunks: int) -> None:
    lib = load()
    for nb in lib["notebooks"]:
        for d in nb["docs"]:
            if d["id"] == doc_id:
                d["chunks"] = chunks
                save(lib)
                return


def delete_document(doc_id: str) -> bool:
    lib = load()
    for nb in lib["notebooks"]:
        before = len(nb["docs"])
        nb["docs"] = [d for d in nb["docs"] if d["id"] != doc_id]
        if len(nb["docs"]) != before:
            save(lib)
            return True
    return False


def get_document(doc_id: str) -> dict | None:
    lib = load()
    for nb in lib["notebooks"]:
        for d in nb["docs"]:
            if d["id"] == doc_id:
                return d
    return None


def docs_in_notebook(notebook_id: str) -> list[dict]:
    lib = load()
    nb = _find_notebook(lib, notebook_id)
    return nb["docs"] if nb else []
