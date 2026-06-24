"""
NoteCook - 앱 진입점.

pywebview 로 web/index.html(목업 UI)을 네이티브 창에 띄운다.
PyInstaller 로 패키징했을 때도 web/ 리소스를 찾을 수 있도록 resource_path 를 사용한다.
"""

import os
import sys

import webview

from backend import ollama, single_instance
from backend.api import Api
from backend.paths import data_dir


def resource_path(relative: str) -> str:
    """개발 실행과 PyInstaller 번들(_MEIPASS) 양쪽에서 리소스 절대경로를 반환."""
    base = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(base, relative)


def apply_window_icon() -> None:
    """
    창 표시 후 작업표시줄/타이틀바 아이콘을 notecook.ico 로 설정 (Windows).
    패키징된 exe 는 PyInstaller 가 박은 아이콘을 쓰지만, 개발 실행(python app.py)이나
    창 단위 아이콘까지 확실히 적용하기 위해 런타임에서 WM_SETICON 으로도 지정한다.
    """
    if sys.platform != "win32":
        return
    try:
        import ctypes

        ico = resource_path(os.path.join("assets", "notecook.ico"))
        if not os.path.isfile(ico):
            return
        user32 = ctypes.windll.user32
        user32.LoadImageW.restype = ctypes.c_void_p
        user32.LoadImageW.argtypes = [ctypes.c_void_p, ctypes.c_wchar_p, ctypes.c_uint,
                                      ctypes.c_int, ctypes.c_int, ctypes.c_uint]
        user32.FindWindowW.restype = ctypes.c_void_p
        user32.FindWindowW.argtypes = [ctypes.c_wchar_p, ctypes.c_wchar_p]
        user32.SendMessageW.restype = ctypes.c_void_p
        user32.SendMessageW.argtypes = [ctypes.c_void_p, ctypes.c_uint,
                                        ctypes.c_void_p, ctypes.c_void_p]

        IMAGE_ICON, LR_LOADFROMFILE = 1, 0x00000010
        WM_SETICON, ICON_SMALL, ICON_BIG = 0x0080, 0, 1
        hwnd = user32.FindWindowW(None, "NoteCook")
        if not hwnd:
            return
        big = user32.LoadImageW(None, ico, IMAGE_ICON, 0, 0, LR_LOADFROMFILE)
        small = user32.LoadImageW(None, ico, IMAGE_ICON, 16, 16, LR_LOADFROMFILE)
        if big:
            user32.SendMessageW(hwnd, WM_SETICON, ICON_BIG, big)
        if small:
            user32.SendMessageW(hwnd, WM_SETICON, ICON_SMALL, small)
    except Exception:
        pass


def main() -> None:
    # 중복 실행 방지: 이미 실행 중이면 기존 창을 앞으로 가져오고 종료
    if not single_instance.acquire():
        single_instance.focus_existing()
        return

    api = Api()
    index = resource_path(os.path.join("web", "index.html"))

    window = webview.create_window(
        title="NoteCook",
        url=index,
        js_api=api,
        width=1100,
        height=720,
        min_size=(820, 560),
        frameless=True,       # OS 타이틀바 제거 → 커스텀 타이틀바 사용
        easy_drag=False,      # .pywebview-drag-region 요소로만 드래그
    )
    api.set_window(window)  # 진행률 push(evaluate_js)용 창 참조 주입
    # DOM 로드 후 트리에 파일 드롭(탐색기→폴더) 핸들러 등록
    window.events.loaded += api.register_dnd
    # 창이 뜨면 앱 아이콘 적용 (작업표시줄/타이틀바)
    window.events.shown += apply_window_icon
    # 개발 시에만 NOTECOOK_DEBUG=1 로 개발자 도구 활성화. 릴리스에선 비활성.
    debug = os.environ.get("NOTECOOK_DEBUG") == "1"
    # private_mode=False + storage_path 로 localStorage(저장된 프롬프트·테마·모델 선택)를
    # 재시작 후에도 유지. (기본값 private_mode=True 는 종료 시 모두 삭제됨)
    storage = os.path.join(data_dir(), "webview")
    os.makedirs(storage, exist_ok=True)
    try:
        webview.start(debug=debug, private_mode=False, storage_path=storage)
    finally:
        # 앱이 직접 띄운 ollama serve 만 함께 종료 (외부 실행 ollama 는 보존)
        ollama.stop_server()


if __name__ == "__main__":
    main()
