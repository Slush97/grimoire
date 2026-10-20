#!/bin/bash

# rpm runs the old package's %postun after the new package's %post on an
# upgrade, with $1 set to the number of versions still installed. Cleaning up
# then deletes the /usr/bin link the new version just created, so only do it on
# a real uninstall. The rest is electron-builder's stock after-remove.tpl.
if [ "$1" -ge 1 ]; then
    exit 0
fi

if type update-alternatives >/dev/null 2>&1; then
    update-alternatives --remove '${executable}' '/opt/${sanitizedProductName}/${executable}'
else
    rm -f '/usr/bin/${executable}'
fi

APPARMOR_PROFILE_DEST='/etc/apparmor.d/${executable}'

if [ -f "$APPARMOR_PROFILE_DEST" ]; then
  if apparmor_status --enabled > /dev/null 2>&1; then
    if ! { [ -x '/usr/bin/ischroot' ] && /usr/bin/ischroot; } && hash apparmor_parser 2>/dev/null; then
      apparmor_parser --remove "$APPARMOR_PROFILE_DEST" || true
    fi
  fi
  rm -f "$APPARMOR_PROFILE_DEST"
fi
