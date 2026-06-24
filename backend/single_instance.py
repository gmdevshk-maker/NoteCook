"""앱 중복 실행 방지 (Windows 단일 인스턴스).

named mutex 로 두 번째 인스턴스를 감지한다. 이미 실행 중이면 기존 NoteCook 창을
앞으로 가져온 뒤 새 인스턴스는 즉시 종료한다. (pywin32 불필요 — ctypes 만 사용)
"""

import ctypes
import sys

_MUTEX_NAME = "NoteCook_SingleInstance_Mutex_v1"
_WINDOW_TITLE = "NoteCook"
_ERROR_ALREADY_EXISTS = 183

_mutex_handle = None  # GC 로 닫히지 않도록 프로세스 수명 동안 참조 유지


def acquire() -> bool:
    """
    단일 인스턴스 락 획득.
    첫 실행이면 True, 이미 다른 인스턴스가 실행 중이면 False 를 반환한다.
    (Windows 외 플랫폼에서는 항상 True — 락 미적용)
    """
    global _mutex_handle
    if sys.platform != "win32":
        return True
    try:
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel32.CreateMutexW.argtypes = [ctypes.c_void_p, ctypes.c_bool, ctypes.c_wchar_p]
        kernel32.CreateMutexW.restype = ctypes.c_void_p
        handle = kernel32.CreateMutexW(None, False, _MUTEX_NAME)
        err = ctypes.get_last_error()
        if not handle:
            return True  # 락 생성 실패 시엔 안전하게 실행 허용
        if err == _ERROR_ALREADY_EXISTS:
            return False
        _mutex_handle = handle
        return True
    except Exception:
        return True  # 어떤 이유로든 실패하면 실행을 막지 않는다


def focus_existing() -> None:
    """이미 실행 중인 NoteCook 창을 복원/포커스한다 (best-effort)."""
    if sys.platform != "win32":
        return
    try:
        user32 = ctypes.windll.user32
        user32.FindWindowW.argtypes = [ctypes.c_wchar_p, ctypes.c_wchar_p]
        user32.FindWindowW.restype = ctypes.c_void_p
        hwnd = user32.FindWindowW(None, _WINDOW_TITLE)
        if hwnd:
            user32.ShowWindow(ctypes.c_void_p(hwnd), 9)  # SW_RESTORE
            user32.SetForegroundWindow(ctypes.c_void_p(hwnd))
    except Exception:
        pass
