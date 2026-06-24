"""앱 데이터 경로. 개발/배포 모두 %LOCALAPPDATA%\\NoteCook 아래에 저장."""

import os


def data_dir() -> str:
    base = os.environ.get("LOCALAPPDATA") or os.path.expanduser("~")
    d = os.path.join(base, "NoteCook", "data")
    os.makedirs(d, exist_ok=True)
    return d


def index_dir() -> str:
    d = os.path.join(data_dir(), "index")
    os.makedirs(d, exist_ok=True)
    return d


def models_dir() -> str:
    """Ollama 모델 저장 위치. 앱 데이터 폴더 아래에 두어 앱 삭제 시 함께 정리되게 한다."""
    d = os.path.join(data_dir(), "models")
    os.makedirs(d, exist_ok=True)
    return d
