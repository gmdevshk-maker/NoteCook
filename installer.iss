; NoteCook 설치 스크립트 (Inno Setup)
; per-user 설치(%LOCALAPPDATA%) → 관리자 권한 불필요 + GPU 런너 자동 다운로드를 위한 쓰기 권한 확보
; 컴파일:  ISCC.exe installer.iss   →   Output\NoteCook-Setup.exe

#define AppName "NoteCook"
#define AppVersion "1.0.0"
#define AppPublisher "NoteCook"
#define AppExe "NoteCook.exe"

[Setup]
AppId={{8F3B2A10-NC00-4C21-9E77-NOTECOOK0001}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
; per-user 설치 (Ollama 와 동일한 방식)
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
DefaultDirName={localappdata}\Programs\{#AppName}
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
UninstallDisplayIcon={app}\{#AppExe}
SetupIconFile=assets\notecook.ico
OutputDir=Output
OutputBaseFilename=NoteCook-Setup
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

[Languages]
Name: "korean"; MessagesFile: "compiler:Languages\Korean.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
; PyInstaller onedir 산출물 전체 (exe + _internal: web, ollama 번들 등)
Source: "dist\NoteCook\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\{#AppExe}"
Name: "{group}\{cm:UninstallProgram,{#AppName}}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExe}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#AppExe}"; Description: "{cm:LaunchProgram,{#AppName}}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; 앱이 생성한 모든 사용자 데이터를 일괄 제거:
;   library.json(등록 문서 목록) · index\(RAG 인덱스) · models\(Ollama LLM·임베딩 모델)
;   webview\(WebView2 캐시 + 테마/저장프롬프트/선택모델 설정)
; (등록한 "원본 파일"은 사용자 위치에 그대로 참조만 했으므로 건드리지 않음)
Type: filesandordirs; Name: "{localappdata}\NoteCook"
; 설치 중/후 다운로드된 GPU 런너도 함께 제거
Type: filesandordirs; Name: "{app}\_internal\ollama\lib\ollama\cuda_v12"
Type: filesandordirs; Name: "{app}\_internal\ollama\lib\ollama\cuda_v13"
Type: filesandordirs; Name: "{app}\_internal\ollama\lib\ollama\rocm_v7_1"
