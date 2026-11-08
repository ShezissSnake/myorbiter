; Hooks into the Windows installer (tauri.windows.conf.json, bundle.windows.nsis.installerHooks).

; Before the rename to MyOrbiter the app was installed as "orbiter": its own folder, Start menu
; entry and Add/Remove Programs entry. Left there, both could run at once and act on the same
; warframe.market account. So once MyOrbiter is in place (not before: an install that stops
; halfway would leave neither), orbiter's own uninstaller runs, silently. orbiter is closed first
; if it is open, asking as the installer asks for MyOrbiter itself (in passive mode, as an update
; runs, it is closed without asking). Its settings and data (the dev.orbiter.app folders) stay: a
; silent uninstall never removes them, and MyOrbiter copies them on its first start, which comes
; after this.
!macro NSIS_HOOK_POSTINSTALL
  Push $R8
  Push $R9
  ReadRegStr $R8 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\orbiter" "UninstallString"
  ; "C:\...\orbiter\uninstall.exe", quoted, as the installer wrote it.
  StrCpy $R9 $R8 1
  ${If} $R9 == '"'
    StrCpy $R9 $R8 "" 1
    StrCpy $R9 $R9 -1
    ${GetParent} $R9 $R9
    ; Never orbiter's folder if MyOrbiter was installed into it: its uninstaller would take
    ; MyOrbiter's files.
    ${If} $R9 != $INSTDIR
    ${AndIf} ${FileExists} "$R9\orbiter.exe"
    ${AndIf} ${FileExists} "$R9\uninstall.exe"
      !insertmacro CheckIfAppIsRunning "$R9\orbiter.exe" "orbiter"
      ClearErrors
      ExecWait '"$R9\uninstall.exe" /S _?=$R9' $R8
      ; Run in place (`_?=`, so that ExecWait waits for it), the uninstaller can't remove itself
      ; or its folder.
      ${If} ${Errors}
      ${OrIf} $R8 <> 0
        DetailPrint "orbiter (MyOrbiter's name before the rename) could not be removed: uninstall it from Settings, Apps."
      ${Else}
        Delete "$R9\uninstall.exe"
        RMDir "$R9"
      ${EndIf}
    ${EndIf}
  ${EndIf}
  Pop $R9
  Pop $R8
!macroend
