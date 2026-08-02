{
  description = "Grimoire: Deadlock mod manager (from-source package + contributor devShell)";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    # Sibling repo: pnpm-lock links @grimoire/social-types from
    # ../grimoire-social; the package build materializes this input there.
    grimoire-social = {
      url = "github:Slush97/grimoire-social";
      flake = false;
    };
    # Rust CLI the app shells out to for VPK merge/split. Keep the ref in
    # sync with VPKMERGE_VERSION in scripts/fetch-vpkmerge.mjs.
    vpkmerge = {
      url = "github:Slush97/vpkmerge?ref=v0.19.0";
      flake = false;
    };
  };

  outputs =
    {
      self,
      nixpkgs,
      grimoire-social,
      vpkmerge,
    }:
    let
      system = "x86_64-linux";
      pkgs = import nixpkgs {
        inherit system;
        # electron_40 is nixpkgs-flagged insecure (EOL upstream) but is the
        # newest Electron the locked electron-builder stack can rebuild
        # natives for (node-abi ends at 40; see the callPackage below). The
        # predicate permits insecure Electron only, nothing else. Drop it
        # when electron-builder's node-abi learns the current Electron.
        config.allowInsecurePredicate = pkg: (pkg.pname or "") == "electron";
      };
      lib = pkgs.lib;

      nodeVersion = pkgs.nodejs_22.version;
      nodeVersionOk = lib.versionAtLeast nodeVersion "22.12.0";

      # Electron 35.7.5 (locked in pnpm-lock.yaml) is not in nixpkgs anymore;
      # we run the npm-fetched Electron binary via nix-ld instead. The
      # runtime shared-library list below (electronLibPath) is copied
      # VERBATIM (not abbreviated from memory) from nixpkgs'
      # pkgs/development/tools/electron/binary/generic.nix at the
      # nixos-unstable revision this flake.lock pins:
      #   rev 1559d3daa3ecc813a650b79375ea61b6741b8746
      #   pkgs/development/tools/electron/binary/generic.nix (electronLibPath)
      electronRuntimeLibs = with pkgs; [
        alsa-lib
        at-spi2-atk
        cairo
        cups
        dbus
        expat
        gdk-pixbuf
        glib
        gtk3
        gtk4
        nss
        nspr
        libx11
        libxcb
        libxcomposite
        libxdamage
        libxext
        libxfixes
        libxrandr
        libxkbfile
        pango
        pciutils
        stdenv.cc.cc
        systemd
        libnotify
        pipewire
        libsecret
        libpulseaudio
        speechd-minimal
        libdrm
        libgbm
        libxkbcommon
        libxshmfence
        libGL
        vulkan-loader
      ];

      gappsDataDirs = lib.concatStringsSep ":" [
        "${pkgs.gsettings-desktop-schemas}/share/gsettings-schemas/${pkgs.gsettings-desktop-schemas.name}"
        "${pkgs.gtk3}/share/gsettings-schemas/${pkgs.gtk3.name}"
      ];

      # ELF interpreter path is derived per-system rather than hardcoded,
      # even though this flake only exposes x86_64-linux today.
      expectedInterpreter =
        if system == "aarch64-linux" then
          "/lib/ld-linux-aarch64.so.1"
        else if system == "x86_64-linux" then
          "/lib64/ld-linux-x86-64.so.2"
        else
          throw "unsupported system: ${system}";
      vpkmergePkg = pkgs.callPackage ./nix/vpkmerge.nix { src = vpkmerge; };
      grimoirePkg = pkgs.callPackage ./nix/grimoire.nix {
        grimoire-src = self;
        social-src = grimoire-social;
        vpkmerge = vpkmergePkg;
        # Not the default electron (41+): electron-builder 26's bundled
        # @electron/rebuild uses node-abi 3.85, whose registry ends at
        # Electron 40. Bump when the locked electron-builder stack catches up.
        electron = pkgs.electron_40;
      };
    in
    {
      # From-source build. nixpkgs PR #519608 packages the released AppImage
      # instead (grimoire-deadlock, stalled unreviewed); this flake is the
      # canonical source build.
      packages.${system} = {
        default = grimoirePkg;
        grimoire = grimoirePkg;
        vpkmerge = vpkmergePkg;
      };

      overlays.default = final: prev: {
        vpkmerge = final.callPackage ./nix/vpkmerge.nix { src = vpkmerge; };
        grimoire = final.callPackage ./nix/grimoire.nix {
          grimoire-src = self;
          social-src = grimoire-social;
          vpkmerge = final.vpkmerge;
          # See packages: node-abi in the locked electron-builder stack
          # ends at Electron 40.
          electron = final.electron_40;
        };
      };

      devShells.${system}.default = pkgs.mkShell {
        packages =
          (with pkgs; [
            nodejs_22
            pnpm_10
            python3
            gnumake
            pkg-config
            git
            p7zip
            procps
            util-linux
          ])
          ++ electronRuntimeLibs;

        shellHook = ''
          # Extend (never replace) the host's nix-ld library path so libraries
          # configured via programs.nix-ld.libraries stay visible.
          export NIX_LD_LIBRARY_PATH="${lib.makeLibraryPath electronRuntimeLibs}''${NIX_LD_LIBRARY_PATH:+:$NIX_LD_LIBRARY_PATH}"

          if ! ${lib.boolToString nodeVersionOk}; then
            echo "ERROR: nodejs_22 (${nodeVersion}) is older than the required 22.12.0." >&2
            echo "  @electron/rebuild 4.0.2 needs Node >=22.12.0. Bump the nixpkgs input." >&2
            exit 1
          fi

          # Extend (never replace) XDG_DATA_DIRS so GSettings schemas used by
          # GTK/Electron (via wrapGAppsHook upstream, which we don't use since
          # we run the npm-fetched Electron binary unwrapped) are found.
          export XDG_DATA_DIRS="${gappsDataDirs}''${XDG_DATA_DIRS:+:$XDG_DATA_DIRS}"

          echo "== Grimoire devShell diagnostics =="

          if [ -e "${expectedInterpreter}" ]; then
            echo "  [ok] ELF interpreter present: ${expectedInterpreter}"
          else
            echo "  [warn] ELF interpreter missing: ${expectedInterpreter}"
            echo "         Enable nix-ld on this host: programs.nix-ld.enable = true;"
          fi

          if command -v unshare >/dev/null 2>&1 && unshare -Ur true >/dev/null 2>&1; then
            echo "  [ok] unprivileged user namespaces available (Chromium sandbox can run)"
          else
            echo "  [warn] unshare -Ur true failed: unprivileged userns unavailable."
            echo "         The Electron sandbox needs this. Never pass --no-sandbox as a workaround."
          fi

          if [ ! -d "../grimoire-social/packages/social-types" ]; then
            echo "  [warn] ../grimoire-social/packages/social-types not found."
            echo "         Clone grimoire-social as a sibling checkout and install it FIRST"
            echo "         (grimoire's zod resolution and @grimoire/social-types both come from there)."
          fi

          echo ""
          echo "First-run commands (run in this order, after grimoire-social's own"
          echo "'pnpm install' has completed):"
          echo "  pnpm install --frozen-lockfile"
          echo "  pnpm exec electron-rebuild -f -w better-sqlite3"
          echo "  pnpm dev"
        '';
      };
    };
}
