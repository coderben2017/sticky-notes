#define AppName "Sticky Notes"
#ifndef AppVersion
  #define AppVersion "1.1.1"
#endif
#define AppPublisher "coderben2017"
#define AppUrl "https://github.com/coderben2017/sticky-notes"
#define AppExeName "StickyNotes.exe"

#ifndef SourceDir
  #define SourceDir "..\..\dist\windows-installer\StickyNotes"
#endif

#ifndef OutputDir
  #define OutputDir "..\..\artifacts"
#endif

[Setup]
AppId={{C8304D1F-5103-48E1-8320-D05F8F0C9BF4}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
AppPublisherURL={#AppUrl}
AppSupportURL={#AppUrl}/issues
AppUpdatesURL={#AppUrl}/releases
DefaultDirName={localappdata}\Programs\{#AppName}
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir={#OutputDir}
OutputBaseFilename=StickyNotes-Setup-x64
SetupIconFile=icon.ico
UninstallDisplayIcon={app}\Resources\app.ico
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes
RestartApplications=no
VersionInfoVersion={#AppVersion}.0
VersionInfoCompany={#AppPublisher}
VersionInfoDescription={#AppName} Installer
VersionInfoProductName={#AppName}
VersionInfoProductVersion={#AppVersion}

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"
Name: "chinesesimp"; MessagesFile: "compiler:Languages\ChineseSimplified.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\{#AppName}"; Filename: "{app}\bin\{#AppExeName}"; WorkingDir: "{app}\bin"; IconFilename: "{app}\Resources\app.ico"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\bin\{#AppExeName}"; WorkingDir: "{app}\bin"; IconFilename: "{app}\Resources\app.ico"; Tasks: desktopicon

[Run]
Filename: "{app}\bin\{#AppExeName}"; WorkingDir: "{app}\bin"; Description: "{cm:LaunchProgram,{#StringChange(AppName, '&', '&&')}}"; Flags: nowait postinstall skipifsilent
