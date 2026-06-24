"""
NoteCook - JS<->Python 브리지 API.

pywebview 가 이 클래스의 public 메서드를 webview 안에서
window.pywebview.api.<메서드명>() 형태로 호출할 수 있게 노출한다.

1단계: ping (연결 확인)
2단계: Ollama 상태/모델 목록/선택 다운로드(진행률 push)
3단계(예정): 문서 업로드/RAG
"""

import json
import os
import platform
import sys
import threading

import requests
import webview
from webview.dom import DOMEventHandler

from backend import library, ollama, rag

# 라이브러리에 추가 가능한 문서 확장자 (파일 대화상자/드래그앤드롭 공통).
ALLOWED_EXT = (".pdf", ".docx", ".hwpx", ".txt", ".md")


class Api:
    """webview 에 노출되는 API. 메서드는 JSON 직렬화 가능한 값을 반환해야 한다."""

    def __init__(self):
        self._window = None
        self._maximized = False
        self._dnd_registered = False

    def set_window(self, window):
        """app.py 에서 창 생성 후 주입. 진행률 push(evaluate_js)에 사용."""
        self._window = window

    def register_dnd(self) -> None:
        """
        DOM 로드 후 호출. 왼쪽 트리(#tree) 컨테이너에 파일 드롭 핸들러를 건다.
        탐색기에서 파일을 폴더 위로 끌어다 놓으면 해당 노트북에 문서가 추가된다.
        (pywebview WebView2 는 드롭된 파일에 pywebviewFullPath 를 채워준다.)
        """
        if self._dnd_registered or not self._window:
            return
        try:
            tree = self._window.dom.get_element("#tree")
            if not tree:
                return
            tree.on("drop", DOMEventHandler(self._on_drop, prevent_default=True))
            self._dnd_registered = True
        except Exception:
            pass

    # --- 창 제어 (frameless 커스텀 타이틀바용) ---
    def win_minimize(self) -> None:
        try:
            self._window.minimize()
        except Exception:
            pass

    def win_toggle_maximize(self) -> dict:
        try:
            if self._maximized:
                self._window.restore()
                self._maximized = False
            else:
                self._window.maximize()
                self._maximized = True
        except Exception:
            pass
        return {"maximized": self._maximized}

    def win_close(self) -> None:
        try:
            self._window.destroy()
        except Exception:
            pass

    def win_get_bounds(self) -> dict:
        """현재 창 위치/크기 (frameless JS 리사이즈 핸들 시작값)."""
        w = self._window
        return {"x": w.x, "y": w.y, "width": w.width, "height": w.height}

    def win_set_bounds(self, x: int, y: int, width: int, height: int) -> bool:
        """창 크기/위치 동시 적용 (리사이즈 핸들 드래그용)."""
        w = self._window
        try:
            w.resize(int(width), int(height))
            w.move(int(x), int(y))
        except Exception:
            pass
        return True

    # --- 1단계 ---
    def ping(self) -> dict:
        return {
            "app": "NoteCook",
            "status": "ok",
            "python": sys.version.split()[0],
            "platform": platform.platform(),
        }

    # --- 2단계: Ollama ---
    def ollama_status(self) -> dict:
        """설치/실행 상태. 설치돼 있으면 서버 자동 기동까지 시도."""
        return ollama.status()

    def ollama_models(self) -> dict:
        """설치된 모델 + 추천(Gemma 4) + 추천 임베딩 목록."""
        return {
            "installed": ollama.list_models(),
            "recommended": ollama.RECOMMENDED_MODELS,
            "embed": ollama.RECOMMENDED_EMBED,
        }

    def ollama_delete(self, tag: str) -> dict:
        ok = ollama.delete_model(tag)
        return {"ok": ok}

    def gpu_status(self) -> dict:
        """감지된 GPU + 가속 런너 설치 여부."""
        return ollama.gpu_status()

    def gpu_install(self) -> dict:
        """GPU 가속 런너 비동기 다운로드/설치. 진행률은 window.onPullProgress(tag='gpu-runner')."""
        threading.Thread(
            target=lambda: ollama.ensure_gpu_runner(self._push_progress),
            daemon=True,
        ).start()
        return {"started": True}

    def ollama_download(self, tag: str) -> dict:
        """
        비동기 다운로드 시작. 진행률은 프런트의 window.onPullProgress(payload) 로 push.
        즉시 {started: True} 반환.
        """
        tag = (tag or "").strip()
        if not tag:
            return {"started": False, "error": "모델 태그가 비어 있습니다."}

        def worker():
            ollama.pull_model(tag, self._push_progress)

        threading.Thread(target=worker, daemon=True).start()
        return {"started": True, "tag": tag}

    def _push_progress(self, payload: dict) -> None:
        if not self._window:
            return
        try:
            self._window.evaluate_js(
                f"window.onPullProgress && window.onPullProgress({json.dumps(payload)})"
            )
        except Exception:
            pass

    # --- 3단계: 라이브러리 + RAG ---
    def get_library(self) -> dict:
        """노트북/문서 트리 + 추천 임베딩 태그."""
        return {"library": library.load(), "embed_model": rag.EMBED_MODEL}

    def prepare(self, model: str = "") -> dict:
        """
        앱 시작 시 호출. Ollama 서버를 기동하고 임베딩/생성 모델을 백그라운드로
        미리 메모리에 올려, 첫 질문이 콜드 로드 없이 바로 답하도록 준비한다.
        UI 를 막지 않도록 즉시 반환하고 실제 준비는 워커 스레드에서 수행한다.
        준비 단계는 window.onPrepareStatus(payload) 로 프런트에 알린다.
        """
        def worker():
            if not ollama.is_running():
                self._push_prepare({"step": "server", "status": "Ollama 서버 시작 중…"})
                if not ollama.ensure_server():
                    self._push_prepare({"step": "done", "ok": False,
                                        "status": "Ollama 미실행 — 모델 관리에서 확인하세요."})
                    return
            self._push_prepare({"step": "embed", "status": "검색 모델 준비 중…"})
            ollama.load_model(rag.EMBED_MODEL)
            if model:
                self._push_prepare({"step": "model", "status": f"{model} 로딩 중…"})
                ollama.load_model(model)
            self._push_prepare({"step": "done", "ok": True, "status": "준비 완료"})

        threading.Thread(target=worker, daemon=True).start()
        return {"started": True}

    def _push_prepare(self, payload: dict) -> None:
        if not self._window:
            return
        try:
            self._window.evaluate_js(
                f"window.onPrepareStatus && window.onPrepareStatus({json.dumps(payload, ensure_ascii=True)})"
            )
        except Exception:
            pass

    def add_notebook(self, name: str) -> dict:
        return {"notebook": library.add_notebook(name)}

    def rename_notebook(self, notebook_id: str, name: str) -> dict:
        return {"ok": library.rename_notebook(notebook_id, name)}

    def delete_notebook(self, notebook_id: str) -> dict:
        doc_ids = library.delete_notebook(notebook_id)
        for did in doc_ids:
            rag.delete_index(did)
        return {"ok": True}

    def delete_document(self, doc_id: str) -> dict:
        rag.delete_index(doc_id)
        return {"ok": library.delete_document(doc_id)}

    def add_documents(self, notebook_id: str) -> dict:
        """
        파일 선택 대화상자 → 문서를 라이브러리에 '처리 중'으로 즉시 추가하고 바로 반환한다.
        파싱·임베딩·인덱싱은 백그라운드 스레드에서 수행하며, 완료/실패 시
        window.onDocStatus(payload) 로 트리에 반영한다. (트리 즉시 표시용)
        """
        if not self._window:
            return {"error": "창 참조가 없습니다."}
        try:
            paths = self._window.create_file_dialog(
                webview.OPEN_DIALOG,
                allow_multiple=True,
                file_types=("문서 파일 (*.pdf;*.docx;*.hwpx;*.txt;*.md)", "모든 파일 (*.*)"),
            )
        except Exception as e:
            return {"error": f"파일 선택 실패: {e}"}
        if not paths:
            return {"canceled": True, "added": []}

        pending, _skipped = self._add_paths(notebook_id, paths)
        return {"added": pending}

    def _add_paths(self, notebook_id: str, paths: list) -> tuple:
        """
        주어진 파일 경로들을 라이브러리에 '처리 중'으로 즉시 추가하고
        백그라운드 인덱싱을 시작한다. (지원하지 않는 확장자는 건너뜀)
        반환: (추가된 문서 목록, 건너뛴 파일명 목록)
        """
        pending, skipped = [], []
        for p in paths:
            if os.path.splitext(p)[1].lower() not in ALLOWED_EXT:
                skipped.append(os.path.basename(p))
                continue
            doc = library.add_document(notebook_id, os.path.basename(p), p, 0, status="indexing")
            if doc:
                pending.append(doc)
        if pending:
            threading.Thread(target=self._ingest_docs, args=(pending,), daemon=True).start()
        return pending, skipped

    def _on_drop(self, event: dict) -> None:
        """
        탐색기 → 트리 폴더 드롭. (util.py 가 채워준 pywebviewFullPath 로 실제 경로 획득)
        대상 노트북은 JS 가 dragover 중 기록해 둔 window.__lastDropNb 에서 읽는다.
        """
        try:
            files = (event.get("dataTransfer") or {}).get("files") or []
        except Exception:
            files = []
        paths = [f.get("pywebviewFullPath") for f in files if f.get("pywebviewFullPath")]
        if not paths:
            return

        nb_id = ""
        try:
            nb_id = self._window.evaluate_js("window.__lastDropNb || ''")
        except Exception:
            nb_id = ""
        if not nb_id:  # 폴백: 첫 번째 노트북
            nbs = library.load().get("notebooks") or []
            nb_id = nbs[0]["id"] if nbs else ""
        if not nb_id:
            return

        pending, skipped = self._add_paths(nb_id, paths)
        payload = {"notebook_id": nb_id, "added": pending, "skipped": skipped}
        if self._window:
            try:
                self._window.evaluate_js(
                    f"window.onDropAdded && window.onDropAdded({json.dumps(payload, ensure_ascii=True)})"
                )
            except Exception:
                pass

    def _ingest_docs(self, docs: list) -> None:
        if docs and not ollama.is_running():
            ollama.ensure_server()
        for doc in docs:
            try:
                n = rag.ingest(doc["id"], doc["name"], doc["path"], embed_model=rag.EMBED_MODEL)
                library.set_doc_status(doc["id"], "ready", n)
                self._push_doc_status({"doc_id": doc["id"], "status": "ready",
                                       "name": doc["name"], "chunks": n})
            except requests.RequestException:
                library.delete_document(doc["id"])
                rag.delete_index(doc["id"])
                self._push_doc_status({"doc_id": doc["id"], "status": "error", "name": doc["name"],
                                       "error": f"임베딩 실패. 임베딩 모델({rag.EMBED_MODEL})을 먼저 다운로드하세요."})
            except Exception as e:
                library.delete_document(doc["id"])
                rag.delete_index(doc["id"])
                self._push_doc_status({"doc_id": doc["id"], "status": "error",
                                       "name": doc["name"], "error": str(e)})

    def _push_doc_status(self, payload: dict) -> None:
        if not self._window:
            return
        try:
            self._window.evaluate_js(
                f"window.onDocStatus && window.onDocStatus({json.dumps(payload, ensure_ascii=True)})"
            )
        except Exception:
            pass

    def _push_stream(self, delta: str) -> None:
        """생성 토큰 조각을 프런트로 push (window.onAnalyzeStream). 답변 스트리밍용."""
        if not self._window:
            return
        try:
            self._window.evaluate_js(
                f"window.onAnalyzeStream && window.onAnalyzeStream({json.dumps({'delta': delta}, ensure_ascii=True)})"
            )
        except Exception:
            pass

    def open_source(self, doc_id: str, page=None) -> dict:
        """
        출처 칩 클릭 → 원본 파일을 연다.
        PDF 이고 page 가 있으면 기본 브라우저의 PDF 뷰어로 file://...#page=N 을 열어
        해당 페이지로 이동한다(Windows 11 기본 Edge 가 #page 지원). 그 외는 기본 앱으로 연다.
        """
        doc = library.get_document(doc_id)
        if not doc:
            return {"ok": False, "error": "문서를 찾을 수 없습니다."}
        path = doc.get("path") or ""
        if not path or not os.path.isfile(path):
            return {"ok": False, "error": "원본 파일을 찾을 수 없습니다. 이동되었거나 삭제되었을 수 있습니다."}

        ext = os.path.splitext(path)[1].lower()
        try:
            if ext == ".pdf" and page:
                import webbrowser
                from pathlib import Path
                url = Path(path).as_uri() + f"#page={int(page)}"
                webbrowser.open(url)
            else:
                os.startfile(path)  # Windows 기본 연결 앱
            return {"ok": True}
        except Exception as e:
            # 페이지 이동 실패 시 기본 앱으로라도 연다.
            try:
                os.startfile(path)
                return {"ok": True, "note": "페이지 이동은 지원되지 않아 파일만 열었습니다."}
            except Exception:
                return {"ok": False, "error": str(e)}

    def analyze(self, question: str, doc_ids: list, model: str) -> dict:
        """선택된 문서 범위에서 RAG 질의응답."""
        question = (question or "").strip()
        if not question:
            return {"error": "질문을 입력하세요."}
        if not doc_ids:
            return {"error": "분석할 문서를 먼저 선택하거나 추가하세요."}
        if not ollama.is_running():
            ollama.ensure_server()
        if not ollama.is_model_installed(rag.EMBED_MODEL):
            return {"error": f"임베딩 모델({rag.EMBED_MODEL})이 설치되어 있지 않습니다. "
                             f"문서 검색에 필요하니 모델 관리에서 다운로드하세요."}
        # 콜드 로드 방지: 검색(임베딩)·생성 모델을 메모리에 먼저 올린 뒤 질의한다.
        # 재시작 직후 모델이 언로드된 상태에서 곧장 생성하면 빈 응답이 날 수 있다.
        ollama.load_model(rag.EMBED_MODEL)
        ollama.load_model(model)
        try:
            return rag.answer(question, list(doc_ids), model,
                              embed_model=rag.EMBED_MODEL, on_token=self._push_stream)
        except requests.RequestException as e:
            return {"error": f"모델 호출 실패: {e}. Ollama 실행 및 모델 다운로드 상태를 확인하세요."}
        except Exception as e:
            return {"error": str(e)}
