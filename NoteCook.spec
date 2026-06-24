# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller 빌드 스펙 (onedir).

번들 포함:
- web/                : UI (index.html + vendored Tabler 아이콘)
- vendor/ollama/      : (선택) Ollama 런타임. 폴더가 있으면 _internal/ollama 로 동봉됨.
                        Ollama 설치 폴더(보통 %LOCALAPPDATA%\\Programs\\Ollama) 내용을
                        vendor/ollama 로 복사해 두면 find_ollama_exe() 가 번들 경로를 우선 사용.

빌드:  python -m PyInstaller NoteCook.spec --noconfirm
결과:  dist/NoteCook/NoteCook.exe
"""

import os

datas = [('web', 'web'), ('assets', 'assets')]
if os.path.isdir('vendor/ollama'):
    datas.append(('vendor/ollama', 'ollama'))

ICON_PATH = os.path.join('assets', 'notecook.ico')

a = Analysis(
    ['app.py'],
    pathex=[],
    binaries=[],
    datas=datas,
    hiddenimports=['clr'],   # pywebview WinForms 백엔드(pythonnet)
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='NoteCook',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,          # GUI 앱: 콘솔 창 숨김 (디버깅 시 True 로)
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=ICON_PATH,         # 앱 실행 파일/작업표시줄 아이콘
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    # numpy/BLAS 등 네이티브 수치연산 DLL 은 UPX 압축 시 손상되어 실행 실패할 수 있어 제외
    upx_exclude=['vcruntime140.dll', 'python*.dll',
                 '*numpy*', 'libopenblas*', '*mkl*', 'libffi*'],
    name='NoteCook',
)
