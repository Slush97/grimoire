# vpkmerge CLI (github.com/Slush97/vpkmerge), pinned via the flake's
# `vpkmerge` input. The repo is a Cargo workspace (core + cli + tauri GUI +
# morphic); buildAndTestSubdir restricts build and tests to the CLI crate so
# the GUI's system dependencies stay out of the closure.
{
  lib,
  rustPlatform,
  src,
}:

rustPlatform.buildRustPackage {
  pname = "vpkmerge";
  version = "0.19.1";
  inherit src;

  cargoHash = "sha256-zrTeSBjgZtzFXkKVlctf4yHR4G+39rFJIWh4sRp/ra0=";

  buildAndTestSubdir = "vpkmerge-cli";

  meta = {
    description = "Command-line tool to combine and split Valve Pak (VPK) files";
    homepage = "https://github.com/Slush97/vpkmerge";
    license = lib.licenses.mit;
    mainProgram = "vpkmerge";
    platforms = [
      "x86_64-linux"
      "aarch64-linux"
    ];
  };
}
