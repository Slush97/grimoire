# Grimoire built from source. Pattern follows nixpkgs cherry-studio
# (electron-vite + electron-builder --dir + native modules rebuilt against
# nixpkgs electron headers). The derivation never invokes the project's
# direct @electron/rebuild CLI (the route that SIGILL'd in the stalled
# nixpkgs PR #519608); electron-builder's internal rebuild handles natives,
# steered to the nix headers via npm_config_nodedir.
#
# The upstream Electron pin (35.7.5) is EOL and absent from nixpkgs, so this
# runs on nixpkgs' current electron. better-sqlite3 is rebuilt against the
# same electron's headers, keeping the native ABI consistent. If runtime
# breakage from the 35 -> current API drift ever appears, pin the oldest
# electron_NN still in nixpkgs here.
{
  lib,
  stdenv,
  fetchPnpmDeps,
  pnpmConfigHook,
  pnpm_10,
  nodejs_22,
  electron,
  makeWrapper,
  copyDesktopItems,
  makeDesktopItem,
  writableTmpDirAsHomeHook,
  python3,
  p7zip,
  xdg-utils,
  procps,
  grimoire-src,
  social-src,
  vpkmerge,
}:

let
  pnpm = pnpm_10;

  packageJson = builtins.fromJSON (builtins.readFile (grimoire-src + "/package.json"));

  # The pnpm lockfile links @grimoire/social-types from
  # ../grimoire-social/packages/social-types, and electron.vite.config.ts
  # aliases the same path. Materialize the sibling checkout next to the
  # unpacked source, IDENTICALLY in the pnpm fetcher and the main build:
  # pnpm validates the out-of-tree importer in both.
  siblingPostUnpack = ''
    cp -r ${social-src} "$(dirname "$sourceRoot")/grimoire-social"
    chmod -R u+w "$(dirname "$sourceRoot")/grimoire-social" "$sourceRoot"
  '';
in
stdenv.mkDerivation (finalAttrs: {
  pname = "grimoire";
  version = packageJson.version;

  src = grimoire-src;
  postUnpack = siblingPostUnpack;

  pnpmDeps = fetchPnpmDeps {
    inherit (finalAttrs) pname version src;
    postUnpack = siblingPostUnpack;
    inherit pnpm;
    # The hash changes when pnpm-lock.yaml, the pinned pnpm major,
    # fetcherVersion, or social-types' package.json change.
    fetcherVersion = 4;
    hash = "sha256-T3fw9+/NfUuk7O+dkAXeKPaH8MaD2znFrOPN6+MW+yA=";
  };

  nativeBuildInputs = [
    nodejs_22
    pnpm
    pnpmConfigHook
    makeWrapper
    copyDesktopItems
    # electron-builder writes caches under $HOME.
    writableTmpDirAsHomeHook
    # node-gyp for the better-sqlite3 rebuild.
    python3
  ];

  strictDeps = true;

  env = {
    ELECTRON_SKIP_BINARY_DOWNLOAD = "1";
    NO_UPDATE_NOTIFIER = "1";
    # Baked textually into the bundle by the vite define; the production
    # build refuses to run without an https value.
    GRIMOIRE_SOCIAL_BASE_URL = "https://grimoire-social.slusheliott.workers.dev";
  };

  # pnpmConfigHook installed with --ignore-scripts (the vpkmerge postinstall
  # download and husky prepare are skipped by design). The aliased
  # social-types sources import zod; guarantee resolution from grimoire's own
  # node_modules since the sibling has none in the sandbox.
  postConfigure = ''
    if [ ! -e ../grimoire-social/packages/social-types/node_modules/zod ]; then
      mkdir -p ../grimoire-social/packages/social-types/node_modules
      ln -s "$PWD/node_modules/zod" ../grimoire-social/packages/social-types/node_modules/zod
    fi
  '';

  # resources/vpkmerge is gitignored (normally fetched by the postinstall
  # script), but electron-builder.yml lists it as extraResources. Provide the
  # nix-built binary under the exact name the app resolves. Runtime primarily
  # uses VPKMERGE_BINARY from the wrapper; this keeps the packaged layout
  # complete and self-consistent.
  preBuild = ''
    mkdir -p resources/vpkmerge
    cp ${lib.getExe vpkmerge} resources/vpkmerge/vpkmerge-linux-x86_64
  '';

  buildPhase = ''
    runHook preBuild

    cp -r ${electron.dist} electron-dist
    chmod -R u+w electron-dist

    node_modules/.bin/electron-vite build

    npm_config_nodedir=${electron.headers} npm_config_build_from_source=true \
      node_modules/.bin/electron-builder --dir \
        --config electron-builder.yml \
        --config.electronDist="$PWD/electron-dist" \
        --config.electronVersion=${electron.version} \
        --config.buildDependenciesFromSource=true

    runHook postBuild
  '';

  desktopItems = [
    (makeDesktopItem {
      name = "grimoire";
      desktopName = "Grimoire";
      comment = "Mod manager for Deadlock";
      exec = "grimoire %U";
      icon = "grimoire";
      terminal = false;
      categories = [ "Game" ];
      # gb1click deep links arrive on the grimoire: scheme.
      mimeTypes = [ "x-scheme-handler/grimoire" ];
      # package.json name; also keeps userData at ~/.config/grimoire.
      startupWMClass = "grimoire";
    })
  ];

  installPhase = ''
    runHook preInstall

    mkdir -p $out/share/grimoire
    cp -r release/linux-unpacked/resources $out/share/grimoire/

    for size in 16 24 32 48 64 128 256 512; do
      install -Dm644 resources/icons/"$size"x"$size".png \
        "$out/share/icons/hicolor/''${size}x''${size}/apps/grimoire.png"
    done

    # ELECTRON_FORCE_IS_PACKAGED: undocumented but verified in Electron
    # source (presence check in App::IsPackaged) and used by several nixpkgs
    # packages. Without it `electron <app>` reports isPackaged=false, which
    # auto-opens devtools and skips the production CSP. If Electron ever
    # drops the variable, gate those upstream on execPath instead.
    # USE_SYSTEM_7ZA makes 7zip-bin return bare "7za"; p7zip is on PATH.
    makeWrapper ${lib.getExe electron} $out/bin/grimoire \
      --inherit-argv0 \
      --set ELECTRON_FORCE_IS_PACKAGED 1 \
      --set-default VPKMERGE_BINARY ${lib.getExe vpkmerge} \
      --set-default USE_SYSTEM_7ZA true \
      --prefix PATH : ${
        lib.makeBinPath [
          p7zip
          xdg-utils
          procps
        ]
      } \
      --add-flags $out/share/grimoire/resources/app.asar \
      --add-flags "\''${NIXOS_OZONE_WL:+\''${WAYLAND_DISPLAY:+--ozone-platform-hint=auto --enable-features=WaylandWindowDecorations --enable-wayland-ime=true --wayland-text-input-version=3}}"

    runHook postInstall
  '';

  passthru = {
    inherit electron;
    inherit (finalAttrs) pnpmDeps;
  };

  meta = {
    description = "Mod manager and companion tool for Deadlock";
    homepage = "https://github.com/Slush97/grimoire";
    changelog = "https://github.com/Slush97/grimoire/blob/main/CHANGELOG.md";
    license = lib.licenses.mit;
    mainProgram = "grimoire";
    platforms = [ "x86_64-linux" ];
  };
})
