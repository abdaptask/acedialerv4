; Windows "Default apps" registration for tel: / callto:.
;
; WHY THIS FILE EXISTS
;
; app.setAsDefaultProtocolClient('tel') and electron-builder's `protocols`
; block both write the same thing:
;
;   Software\Classes\tel\shell\open\command
;
; That is enough for Windows to launch us when NOTHING else claims tel:. It
; is not enough to appear in Settings -> Default apps, nor in the "How do you
; want to open this?" picker. Windows only offers an app there if the app
; declares a Capabilities key and registers it under RegisteredApplications.
;
; Without those keys the Settings toggle is unwinnable on a corporate image:
; Teams (or Phone Link, or Skype) already owns tel: via a UserChoice hash
; that no application may legitimately overwrite, so our registry write lands
; and is ignored — and the user cannot pick us manually either, because we
; are not in the list. That is the bug this file closes. v0.10.220.
;
; Being LISTED is not the same as being DEFAULT. These keys only make ACE
; Dialer eligible; Windows still requires the user to choose it. That keeps
; faith with the opt-in rule in CLAUDE.md 4.4 — nothing here claims an
; association on its own, and customUnInstall removes every key.
;
; NOTE: the ProgIDs below are deliberately separate from Software\Classes\tel
; itself. Writing our command into the bare `tel` key would fight whatever
; owns the UserChoice; a ProgID we own is the sanctioned way to offer
; ourselves as a candidate and let the user decide.

!macro registerAceUrlHandler PROGID SCHEME LABEL
  WriteRegStr SHCTX "Software\Classes\${PROGID}" "" "${LABEL}"
  WriteRegStr SHCTX "Software\Classes\${PROGID}" "URL Protocol" ""
  WriteRegStr SHCTX "Software\Classes\${PROGID}\DefaultIcon" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr SHCTX "Software\Classes\${PROGID}\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
  WriteRegStr SHCTX "Software\ACEDialer\Capabilities\URLAssociations" "${SCHEME}" "${PROGID}"
!macroend

!macro customInstall
  !insertmacro registerAceUrlHandler "ACEDialer.Url.tel" "tel" "ACE Dialer phone link"
  !insertmacro registerAceUrlHandler "ACEDialer.Url.callto" "callto" "ACE Dialer phone link"

  WriteRegStr SHCTX "Software\ACEDialer\Capabilities" "ApplicationName" "ACE Dialer"
  WriteRegStr SHCTX "Software\ACEDialer\Capabilities" "ApplicationDescription" \
    "Place calls on your ApTask number from phone links in other applications."

  ; The pointer that actually makes us visible in Settings -> Default apps.
  WriteRegStr SHCTX "Software\RegisteredApplications" "ACE Dialer" "Software\ACEDialer\Capabilities"

  ; Ask the shell to re-read associations so the app shows up without a
  ; sign-out. SHCNE_ASSOCCHANGED (0x08000000), SHCNF_IDLIST (0).
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
!macroend

!macro customUnInstall
  DeleteRegValue SHCTX "Software\RegisteredApplications" "ACE Dialer"
  DeleteRegKey SHCTX "Software\ACEDialer"
  DeleteRegKey SHCTX "Software\Classes\ACEDialer.Url.tel"
  DeleteRegKey SHCTX "Software\Classes\ACEDialer.Url.callto"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
!macroend
