#!/bin/sh
# zypak-wrapper (from org.electronjs.Electron2.BaseApp) provides the Chromium
# sandbox inside the flatpak sandbox; chrome-sandbox setuid does not work here.
exec zypak-wrapper /app/grimoire/grimoire "$@"
