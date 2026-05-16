# Grimoire gameinfo.gi diagnostic
# Read-only. Does not modify Steam, Deadlock, or any file.
# Writes a plain-text report to the Desktop and opens it in Notepad.

$ErrorActionPreference = 'Continue'
$report = New-Object System.Text.StringBuilder

function W($line) { [void]$report.AppendLine([string]$line) }
function Section($name) { W ''; W ("===== {0} =====" -f $name) }

W 'Grimoire gameinfo.gi diagnostic'
W ("Generated: {0}" -f (Get-Date -Format o))
W ("Host: {0} ({1})" -f $env:COMPUTERNAME, $env:USERNAME)
try {
    $os = Get-CimInstance Win32_OperatingSystem -ErrorAction Stop
    W ("Windows: {0} build {1}" -f $os.Caption, $os.BuildNumber)
} catch {
    W ("Windows: (could not query: {0})" -f $_.Exception.Message)
}
W ("PowerShell: {0}" -f $PSVersionTable.PSVersion)

# Steam install location (registry)
Section 'Steam install'
$steamPath = $null
try {
    $steamPath = (Get-ItemProperty 'HKLM:\SOFTWARE\WOW6432Node\Valve\Steam' -ErrorAction Stop).InstallPath
} catch {
    try {
        $steamPath = (Get-ItemProperty 'HKCU:\SOFTWARE\Valve\Steam' -ErrorAction Stop).SteamPath
    } catch {}
}
W ("InstallPath: {0}" -f $steamPath)

# Library folders
Section 'Steam libraries'
$libraries = @()
if ($steamPath) {
    $libVdf = Join-Path $steamPath 'steamapps\libraryfolders.vdf'
    if (Test-Path $libVdf) {
        $vdf = Get-Content $libVdf -Raw
        [regex]::Matches($vdf, '"path"\s+"([^"]+)"') | ForEach-Object {
            $libraries += ($_.Groups[1].Value -replace '\\\\', '\')
        }
        W 'Libraries found:'
        foreach ($lib in $libraries) { W ("  {0}" -f $lib) }
    } else {
        W ("libraryfolders.vdf not found at: {0}" -f $libVdf)
    }
} else {
    W 'Skipped (no Steam install path).'
}

# Locate Deadlock via appmanifest (appid 1422450)
Section 'Deadlock location (via appmanifest)'
$deadlockAppId = '1422450'
$activeLib = $null
foreach ($lib in $libraries) {
    $manifest = Join-Path $lib ("steamapps\appmanifest_{0}.acf" -f $deadlockAppId)
    if (Test-Path $manifest) {
        $activeLib = $lib
        $size = (Get-Item $manifest).Length
        W ("appmanifest_{0}.acf in: {1}  ({2} bytes)" -f $deadlockAppId, $lib, $size)
        $content = Get-Content $manifest -Raw
        if ($content -match '"installdir"\s+"([^"]+)"')  { W ("  installdir:  {0}" -f $Matches[1]) }
        if ($content -match '"StateFlags"\s+"([^"]+)"')  { W ("  StateFlags:  {0}" -f $Matches[1]) }
        if ($content -match '"SizeOnDisk"\s+"([^"]+)"')  { W ("  SizeOnDisk:  {0}" -f $Matches[1]) }
        if ($content -match '"LastUpdated"\s+"([^"]+)"') { W ("  LastUpdated: {0}" -f $Matches[1]) }
        break
    }
}
if (-not $activeLib) {
    W ("appmanifest_{0}.acf not found in any known library." -f $deadlockAppId)
}

# Resolve game folder
Section 'Game folder'
$deadlockPath = $null
if ($activeLib) {
    $deadlockPath = Join-Path $activeLib 'steamapps\common\Deadlock'
}
W ("Expected path: {0}" -f $deadlockPath)
if ($deadlockPath -and (Test-Path $deadlockPath)) {
    $item = Get-Item -LiteralPath $deadlockPath -Force
    W 'Exists: yes'
    W ("Attributes: {0}" -f $item.Attributes)
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
        W '  *** ReparsePoint detected (junction/symlink).'
        try { W ("  Target: {0}" -f $item.Target) } catch {}
    }
} else {
    W 'Exists: NO'
}

# gameinfo.gi check
Section 'gameinfo.gi check'
$citadelPath = $null
$gameinfoPath = $null
if ($deadlockPath) {
    $citadelPath = Join-Path $deadlockPath 'game\citadel'
    $gameinfoPath = Join-Path $citadelPath 'gameinfo.gi'
}
W ("citadel path:    {0}" -f $citadelPath)
W ("gameinfo.gi:     {0}" -f $gameinfoPath)
W ("Test-Path citadel/:    {0}" -f (Test-Path $citadelPath))
W ("Test-Path gameinfo.gi: {0}" -f (Test-Path $gameinfoPath))

if ($citadelPath -and (Test-Path $citadelPath)) {
    # Per-directory case sensitivity flag
    try {
        $cs = & fsutil.exe file queryCaseSensitiveInfo $citadelPath 2>&1 | Out-String
        W ("fsutil case-sensitivity: {0}" -f $cs.Trim())
    } catch {
        W ("fsutil failed: {0}" -f $_.Exception.Message)
    }

    # List anything that looks like gameinfo
    W 'Entries in citadel/ matching gameinfo* (case-insensitive):'
    $hits = @()
    try {
        $hits = Get-ChildItem -LiteralPath $citadelPath -Force -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -match '(?i)^gameinfo' }
    } catch {}
    if ($hits.Count -gt 0) {
        foreach ($m in $hits) {
            W ("  {0}  size={1}  attrs={2}  modified={3}" -f $m.Name, $m.Length, $m.Attributes, $m.LastWriteTime.ToString('o'))
        }
    } else {
        W '  (none)'
    }
}

# Permissions
Section 'Permissions'
if ($citadelPath -and (Test-Path $citadelPath)) {
    try {
        $acl = Get-Acl -LiteralPath $citadelPath
        W ("citadel/ Owner: {0}" -f $acl.Owner)
        foreach ($a in $acl.Access) {
            W ("  {0}  {1}  {2}" -f $a.IdentityReference, $a.AccessControlType, $a.FileSystemRights)
        }
    } catch {
        W ("Failed to read citadel/ ACL: {0}" -f $_.Exception.Message)
    }
}
if ($gameinfoPath -and (Test-Path $gameinfoPath)) {
    try {
        $acl = Get-Acl -LiteralPath $gameinfoPath
        W ''
        W ("gameinfo.gi Owner: {0}" -f $acl.Owner)
        foreach ($a in $acl.Access) {
            W ("  {0}  {1}  {2}" -f $a.IdentityReference, $a.AccessControlType, $a.FileSystemRights)
        }
    } catch {
        W ("Failed to read gameinfo.gi ACL: {0}" -f $_.Exception.Message)
    }
}

# Windows Defender Protection History (best-effort; may need admin)
Section 'Defender Protection History (best-effort)'
try {
    if (Get-Command Get-MpThreatDetection -ErrorAction SilentlyContinue) {
        $detections = Get-MpThreatDetection -ErrorAction Stop
        $hits = $detections | Where-Object { ($_.Resources -join ' ') -match '(?i)(gameinfo|citadel|Deadlock)' }
        if ($hits) {
            foreach ($h in $hits) {
                W ("  {0}  ThreatID={1}" -f $h.InitialDetectionTime.ToString('o'), $h.ThreatID)
                foreach ($r in $h.Resources) { W ("    {0}" -f $r) }
            }
        } else {
            W '  No Defender detections referencing gameinfo / citadel / Deadlock.'
        }
    } else {
        W '  Get-MpThreatDetection not available (Defender module not present).'
    }
} catch {
    W ("  Could not read Defender history (may need admin): {0}" -f $_.Exception.Message)
}

# Grimoire's own settings (best-effort, to see what path Grimoire is configured for)
Section 'Grimoire settings (best-effort)'
$grimoireSettings = Join-Path $env:APPDATA 'Grimoire\settings.json'
W ("Path: {0}" -f $grimoireSettings)
if (Test-Path $grimoireSettings) {
    try {
        $s = Get-Content $grimoireSettings -Raw | ConvertFrom-Json
        W ("  deadlockPath:    {0}" -f $s.deadlockPath)
        W ("  devMode:         {0}" -f $s.devMode)
        W ("  devDeadlockPath: {0}" -f $s.devDeadlockPath)
    } catch {
        W ("  Failed to parse settings.json: {0}" -f $_.Exception.Message)
    }
} else {
    W '  (settings.json not found; Grimoire may not have been run yet)'
}

# Write the report
$reportPath = Join-Path ([Environment]::GetFolderPath('Desktop')) 'grimoire-gameinfo-diagnostic.txt'
$report.ToString() | Set-Content -LiteralPath $reportPath -Encoding utf8

Write-Host ''
Write-Host ("Report saved to: {0}" -f $reportPath) -ForegroundColor Green
Write-Host ''
try { Start-Process notepad.exe $reportPath } catch {}
