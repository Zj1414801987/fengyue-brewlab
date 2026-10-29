; 风月酿研所 · Windows 安装包脚本（参考模板）
; 用法：把 OUTDIR 改成你本地打好的绿色版目录，再执行
;   makensis -V2 installer.nsi
;
; 依赖：NSIS 3.10（nsis.sourceforge.io），无需管理员权限。
; 设计要点：
;   1. 装到 $LOCALAPPDATA\Programs，不写系统目录，不弹 UAC；
;   2. 配方数据在 %APPDATA%\风月酿研所，与本目录无关，卸载不删数据；
;   3. 主程序文件名带版本号，覆盖安装时必须先删旧 exe，否则会残留 200MB+。

Unicode true
!include "MUI2.nsh"

!define APPNAME "风月酿研所"
!define APPVERSION "1.3.0"
!define EXENAME "风月酿研所_Windows_v1.3.exe"
!define OUTDIR "..\build\out\风月酿研所-Windows-v1.3"
!define REGKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\风月酿研所"

Name "${APPNAME}"
OutFile "风月酿研所_Windows_v${APPVERSION}_安装程序.exe"
InstallDir "$LOCALAPPDATA\Programs\风月酿研所"
InstallDirRegKey HKCU "Software\风月酿研所" "InstallDir"
RequestExecutionLevel user
SetCompressor /SOLID lzma
SetCompressorDictSize 64

!define MUI_ICON "..\src\assets\app.ico"
!define MUI_UNICON "..\src\assets\app.ico"
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\${EXENAME}"
!define MUI_FINISHPAGE_RUN_TEXT "立即启动 ${APPNAME}"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"

Section "主程序" SecMain
  SetOutPath "$INSTDIR"
  RMDir /r "$INSTDIR\resources\app"        ; v1.0 的散装目录
  Delete "$INSTDIR\${APPNAME}_Windows_v*.exe"  ; 旧版本体
  File /r "${OUTDIR}\*.*"

  WriteUninstaller "$INSTDIR\卸载.exe"
  CreateShortcut "$DESKTOP\${APPNAME}.lnk" "$INSTDIR\${EXENAME}"
  CreateDirectory "$SMPROGRAMS\${APPNAME}"
  CreateShortcut "$SMPROGRAMS\${APPNAME}\${APPNAME}.lnk" "$INSTDIR\${EXENAME}"
  CreateShortcut "$SMPROGRAMS\${APPNAME}\卸载 ${APPNAME}.lnk" "$INSTDIR\卸载.exe"

  WriteRegStr HKCU "Software\风月酿研所" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "${REGKEY}" "DisplayName" "${APPNAME}"
  WriteRegStr HKCU "${REGKEY}" "DisplayVersion" "${APPVERSION}"
  WriteRegStr HKCU "${REGKEY}" "DisplayIcon" "$INSTDIR\${EXENAME}"
  WriteRegStr HKCU "${REGKEY}" "Publisher" "${APPNAME}"
  WriteRegStr HKCU "${REGKEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${REGKEY}" "UninstallString" "$\"$INSTDIR\卸载.exe$\""
  WriteRegStr HKCU "${REGKEY}" "QuietUninstallString" "$\"$INSTDIR\卸载.exe$\" /S"
  WriteRegDWORD HKCU "${REGKEY}" "NoModify" 1
  WriteRegDWORD HKCU "${REGKEY}" "NoRepair" 1
SectionEnd

Section "Uninstall"
  Delete "$DESKTOP\${APPNAME}.lnk"
  RMDir /r "$SMPROGRAMS\${APPNAME}"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKCU "${REGKEY}"
  DeleteRegKey HKCU "Software\风月酿研所"
SectionEnd
