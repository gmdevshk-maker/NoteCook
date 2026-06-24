"""
Ollama 연동 모듈.

- 설치/실행 상태 확인 (필요 시 `ollama serve` 자동 기동)
- 설치된 모델 목록 (/api/tags)
- 모델 다운로드 (/api/pull, 스트리밍 진행률)
- 모델 삭제 (/api/delete)

진행률은 콜백(on_progress)으로 흘려보내고, 호출 측(api.py)이 이를
webview 로 push 한다. 배포 시 번들된 ollama.exe 경로도 탐색 대상에 포함된다.
"""

import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import zipfile

import requests

from backend.paths import models_dir

OLLAMA_HOST = os.environ.get("OLLAMA_HOST", "http://127.0.0.1:11434")

# GUI 앱(콘솔 숨김)에서 자식 프로세스를 띄울 때 콘솔창이 깜빡이지 않도록.
NO_WINDOW = 0x08000000 if os.name == "nt" else 0  # CREATE_NO_WINDOW

# 다운로드 추천 목록 (Gemma 4). 실제 용량/메타데이터는 다운로드 시 Ollama 가 알려준다.
RECOMMENDED_MODELS = [
    {"tag": "gemma4:e2b", "label": "Gemma 4 E2B", "approx": "~5–7 GB",
     "note": "가장 가벼움 · 저사양/CPU", "context": "128K", "multimodal": True},
    {"tag": "gemma4:e4b", "label": "Gemma 4 E4B", "approx": "~7–10 GB",
     "note": "권장 · 균형 잡힌 선택", "context": "128K", "multimodal": True, "recommended": True},
    {"tag": "gemma4:12b", "label": "Gemma 4 12B", "approx": "~8 GB",
     "note": "고품질 · GPU 권장", "context": "256K", "multimodal": True},
    {"tag": "gemma4:26b", "label": "Gemma 4 26B (MoE)", "approx": "~18 GB",
     "note": "최고품질 · 고사양", "context": "256K", "multimodal": True},
]

# RAG 용 임베딩 모델 추천 (3단계에서 사용)
RECOMMENDED_EMBED = [
    {"tag": "bge-m3", "label": "BGE-M3 (임베딩)", "approx": "~1.2 GB",
     "note": "다국어·한국어 강함 · RAG 검색 필수", "embedding": True, "required": True},
]

# 다운로드 진행 상태 캐시 (tag -> 마지막 진행 dict)
_pull_state: dict = {}


def find_ollama_exe() -> str | None:
    """시스템 PATH / 알려진 설치 경로 / 번들 경로에서 ollama.exe 를 찾는다."""
    # 1) 번들(PyInstaller) 경로 우선
    base = getattr(sys, "_MEIPASS", None)
    if base:
        cand = os.path.join(base, "ollama", "ollama.exe")
        if os.path.isfile(cand):
            return cand

    # 2) PATH
    found = shutil.which("ollama") or shutil.which("ollama.exe")
    if found and os.path.isfile(found):
        return found

    # 3) Windows 기본 설치 위치
    local = os.environ.get("LOCALAPPDATA", "")
    pf = os.environ.get("ProgramFiles", "")
    for cand in (
        os.path.join(local, "Programs", "Ollama", "ollama.exe"),
        os.path.join(pf, "Ollama", "ollama.exe"),
    ):
        if cand and os.path.isfile(cand):
            return cand
    return None


def is_running(timeout: float = 2.0) -> bool:
    """Ollama 서버가 응답하는지 확인."""
    try:
        r = requests.get(f"{OLLAMA_HOST}/api/tags", timeout=timeout)
        return r.status_code == 200
    except requests.RequestException:
        return False


# 앱이 직접 띄운 ollama serve 프로세스 (앱 종료 시 정리용).
# 이미 실행 중이던(사용자/서비스가 띄운) ollama 는 여기에 잡히지 않으므로 건드리지 않는다.
_serve_proc = None


def ensure_server(wait: float = 8.0) -> bool:
    """서버가 안 떠 있으면 ollama serve 를 백그라운드로 기동하고 준비될 때까지 대기."""
    if is_running():
        return True
    exe = find_ollama_exe()
    if not exe:
        return False
    global _serve_proc
    # 모델을 앱 데이터 폴더(%LOCALAPPDATA%\NoteCook\data\models)에 저장 → 앱 삭제 시 함께 정리.
    # 사용자가 OLLAMA_MODELS 를 직접 설정했다면 그 값을 존중(setdefault).
    env = dict(os.environ)
    env.setdefault("OLLAMA_MODELS", models_dir())
    try:
        _serve_proc = subprocess.Popen(
            [exe, "serve"],
            creationflags=NO_WINDOW,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            env=env,
        )
    except OSError:
        return False
    deadline = time.time() + wait
    while time.time() < deadline:
        if is_running(timeout=1.0):
            return True
        time.sleep(0.4)
    return False


def stop_server() -> None:
    """앱이 직접 띄운 ollama serve 만 종료. 외부에서 실행 중이던 ollama 는 건드리지 않는다."""
    global _serve_proc
    proc = _serve_proc
    _serve_proc = None
    if proc is None or proc.poll() is not None:
        return
    try:
        if os.name == "nt":
            # serve 가 띄운 모델 러너 자식까지 트리 전체 종료 (/T) — terminate 는 자식을 남길 수 있음
            subprocess.run(
                ["taskkill", "/PID", str(proc.pid), "/T", "/F"],
                creationflags=NO_WINDOW,
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                timeout=10,
            )
        else:
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
    except Exception:
        try:
            proc.kill()
        except Exception:
            pass


def load_model(model: str, timeout: float = 180.0) -> bool:
    """
    모델을 메모리에 미리 로드(warmup)하고 로드가 끝날 때까지 블록한다.
    Ollama 는 prompt 없이 /api/generate 요청을 받으면 모델만 로드하고 즉시 반환하며,
    이미 로드돼 있으면 곧바로 응답한다. keep_alive 로 일정 시간 메모리에 유지한다.
    재시작 직후 콜드 모델에 곧장 생성 요청을 보내 빈 응답이 나오는 것을 막기 위함.
    """
    if not model:
        return False
    try:
        r = requests.post(
            f"{OLLAMA_HOST}/api/generate",
            json={"model": model, "keep_alive": "30m"},
            timeout=timeout,
        )
        r.raise_for_status()
        return True
    except requests.RequestException:
        return False


def status() -> dict:
    """앱이 표시할 Ollama 상태 요약."""
    exe = find_ollama_exe()
    running = is_running()
    if not running and exe:
        # 설치돼 있는데 안 떠 있으면 자동 기동 시도
        running = ensure_server()
    return {
        "installed": exe is not None,
        "running": running,
        "exe_path": exe,
        "host": OLLAMA_HOST,
    }


def list_models() -> list[dict]:
    """설치된 모델 목록 (이름, 용량, 수정시각)."""
    try:
        r = requests.get(f"{OLLAMA_HOST}/api/tags", timeout=5)
        r.raise_for_status()
        data = r.json().get("models", [])
    except requests.RequestException:
        return []
    out = []
    for m in data:
        out.append({
            "name": m.get("name") or m.get("model", ""),
            "size": m.get("size", 0),
            "modified": m.get("modified_at", ""),
        })
    return out


def is_model_installed(tag: str) -> bool:
    """tag 모델이 설치돼 있는지 (':latest' 접미사 변형 포함)."""
    names = [m["name"] for m in list_models()]
    if tag in names or f"{tag}:latest" in names:
        return True
    return any(n.split(":")[0] == tag for n in names)


def delete_model(tag: str) -> bool:
    try:
        r = requests.delete(f"{OLLAMA_HOST}/api/delete", json={"name": tag}, timeout=10)
        return r.status_code == 200
    except requests.RequestException:
        return False


def pull_model(tag: str, on_progress) -> None:
    """
    모델을 다운로드하며 진행률을 on_progress(dict) 로 흘려보낸다.
    dict 예: {tag, status, percent, completed, total, done, ok, error}
    동기 함수이므로 호출 측에서 스레드로 돌릴 것.
    """
    def emit(payload: dict):
        payload["tag"] = tag
        _pull_state[tag] = payload
        try:
            on_progress(payload)
        except Exception:
            pass

    if not ensure_server():
        emit({"status": "Ollama 미실행", "done": True, "ok": False,
              "error": "Ollama 서버를 시작할 수 없습니다."})
        return

    emit({"status": "준비 중…", "percent": 0, "done": False})
    try:
        with requests.post(
            f"{OLLAMA_HOST}/api/pull",
            json={"name": tag, "stream": True},
            stream=True,
            timeout=None,
        ) as resp:
            resp.raise_for_status()
            for line in resp.iter_lines(decode_unicode=True):
                if not line:
                    continue
                try:
                    msg = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if "error" in msg:
                    emit({"status": "오류", "done": True, "ok": False, "error": msg["error"]})
                    return
                total = msg.get("total")
                completed = msg.get("completed")
                percent = None
                if total:
                    percent = round((completed or 0) / total * 100, 1)
                emit({
                    "status": msg.get("status", ""),
                    "percent": percent,
                    "completed": completed,
                    "total": total,
                    "done": False,
                })
        emit({"status": "완료", "percent": 100, "done": True, "ok": True})
    except requests.RequestException as e:
        emit({"status": "오류", "done": True, "ok": False, "error": str(e)})


# ===================== GPU 가속 런너 (베이스=CPU+Vulkan, 런너 자동 다운로드) =====================
GPU_RELEASE_BASE = "https://github.com/ollama/ollama/releases/download"

# gpu -> (릴리스 자산, 추출 대상 런너 접두사, 다운로드 용량 MB)
GPU_ASSET = {
    "nvidia": ("ollama-windows-amd64.zip", "cuda", 1394),
    "amd": ("ollama-windows-amd64-rocm.zip", "rocm", 282),
}


def ollama_version() -> str | None:
    """번들/시스템 ollama.exe 의 버전 문자열(예: '0.30.10'). 런너 URL 핀 고정용."""
    exe = find_ollama_exe()
    if not exe:
        return None
    try:
        out = subprocess.run([exe, "--version"], capture_output=True, text=True,
                             timeout=10, creationflags=NO_WINDOW).stdout
    except (OSError, subprocess.SubprocessError):
        return None
    for tok in out.replace("\n", " ").split():
        if tok[:1].isdigit() and "." in tok:
            return tok
    return None


def detect_gpu() -> str:
    """'nvidia' | 'amd' | 'none'."""
    if shutil.which("nvidia-smi"):
        return "nvidia"
    try:
        out = subprocess.run(
            ["powershell", "-NoProfile", "-Command",
             "(Get-CimInstance Win32_VideoController).Name"],
            capture_output=True, text=True, timeout=15, creationflags=NO_WINDOW,
        ).stdout.lower()
    except (OSError, subprocess.SubprocessError):
        out = ""
    if "nvidia" in out:
        return "nvidia"
    if "amd" in out or "radeon" in out:
        return "amd"
    return "none"


def _runner_lib_dir() -> str | None:
    """Ollama 런너가 위치하는 lib/ollama 디렉터리 (ollama.exe 기준)."""
    exe = find_ollama_exe()
    if not exe:
        return None
    return os.path.join(os.path.dirname(exe), "lib", "ollama")


def gpu_runner_present(gpu: str | None = None) -> bool:
    gpu = gpu or detect_gpu()
    if gpu not in GPU_ASSET:
        return True  # GPU 없음 → 런너 불필요
    prefix = GPU_ASSET[gpu][1]
    d = _runner_lib_dir()
    if not d or not os.path.isdir(d):
        return False
    return any(name.startswith(prefix) for name in os.listdir(d))


def gpu_status() -> dict:
    gpu = detect_gpu()
    info = GPU_ASSET.get(gpu)
    return {
        "gpu": gpu,
        "supported": gpu in GPU_ASSET,
        "present": gpu_runner_present(gpu),
        "download_mb": info[2] if info else 0,
        "version": ollama_version(),
    }


def extract_runner(zip_path: str, prefix: str, target_root: str) -> int:
    """
    zip 에서 lib/ollama/<prefix>* 항목만 target_root 아래로 추출 (구조 보존).
    추출 파일 수 반환. (download 없이 단위 테스트 가능)
    """
    count = 0
    with zipfile.ZipFile(zip_path) as z:
        for m in z.namelist():
            norm = m.replace("\\", "/")
            if norm.endswith("/"):
                continue
            if norm.startswith(f"lib/ollama/{prefix}"):
                dest = os.path.join(target_root, *norm.split("/"))
                os.makedirs(os.path.dirname(dest), exist_ok=True)
                with z.open(m) as src, open(dest, "wb") as out:
                    shutil.copyfileobj(src, out)
                count += 1
    return count


def ensure_gpu_runner(on_progress) -> None:
    """GPU 감지 → 필요 시 맞는 런너를 다운로드/추출. 진행률은 on_progress(tag='gpu-runner')."""
    def emit(p: dict):
        p["tag"] = "gpu-runner"
        try:
            on_progress(p)
        except Exception:
            pass

    gpu = detect_gpu()
    info = GPU_ASSET.get(gpu)
    if not info:
        emit({"status": "GPU 미감지 — 건너뜀", "done": True, "ok": True})
        return
    if gpu_runner_present(gpu):
        emit({"status": "이미 설치됨", "percent": 100, "done": True, "ok": True})
        return
    ver = ollama_version()
    if not ver:
        emit({"status": "Ollama 버전 확인 실패", "done": True, "ok": False, "error": "version"})
        return

    asset, prefix, _ = info
    url = f"{GPU_RELEASE_BASE}/v{ver}/{asset}"
    target_root = os.path.dirname(find_ollama_exe())
    if not os.access(target_root, os.W_OK):
        emit({"status": "설치 폴더 쓰기 불가", "done": True, "ok": False,
              "error": "관리자 권한 없이 쓰려면 앱을 per-user 위치(%LOCALAPPDATA%)에 설치하세요."})
        return

    tmp = os.path.join(tempfile.gettempdir(), asset)
    try:
        emit({"status": "다운로드 중…", "percent": 0, "done": False})
        with requests.get(url, stream=True, timeout=None) as r:
            r.raise_for_status()
            total = int(r.headers.get("content-length", 0))
            got = 0
            with open(tmp, "wb") as f:
                for chunk in r.iter_content(262144):
                    f.write(chunk)
                    got += len(chunk)
                    pct = round(got / total * 100, 1) if total else None
                    emit({"status": "다운로드 중…", "percent": pct,
                          "completed": got, "total": total, "done": False})
        emit({"status": "압축 해제 중…", "percent": 100, "done": False})
        n = extract_runner(tmp, prefix, target_root)
        emit({"status": f"완료 ({n}개) — 다음 실행부터 GPU 가속",
              "percent": 100, "done": True, "ok": True})
    except requests.RequestException as e:
        emit({"status": "다운로드 실패", "done": True, "ok": False, "error": str(e)})
    except Exception as e:
        emit({"status": "설치 실패", "done": True, "ok": False, "error": str(e)})
    finally:
        try:
            os.remove(tmp)
        except OSError:
            pass
