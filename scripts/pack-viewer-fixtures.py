"""Package exported viewer fixtures with integrity checks, without game VPKs."""
import argparse
import hashlib
import json
from pathlib import Path
import zipfile


def digest(path):
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    fixtures = root / ".codex-run" / "source2-physics"
    cases = json.loads((fixtures / "cases.json").read_text(encoding="utf-8"))
    files = [fixtures / "cases.json"]
    for case in cases:
        name = case["name"]
        if not name.replace("_", "").replace("-", "").isalnum():
            raise ValueError(f"Invalid fixture name: {name}")
        directory = fixtures / name
        metadata = json.loads((directory / "metadata.json").read_text(encoding="utf-8"))
        files.append(directory / "metadata.json")
        for key in ["rigged", "posed"]:
            entry = metadata.get("viewer", {}).get(key)
            if entry:
                path = directory / entry["file"]
                if path.resolve().parent != directory.resolve():
                    raise ValueError(f"Invalid fixture path: {path}")
                if digest(path) != entry["sha256"]:
                    raise ValueError(f"Fixture hash mismatch: {path}")
                files.append(path)
        for name in ["cloth.json", "clips.json", "effect.json"]:
            if (directory / name).is_file():
                files.append(directory / name)
        files.extend(sorted((directory / "effect-tex").glob("*.png")))
    manifest = {str(path.relative_to(root)).replace("\\", "/"): digest(path) for path in files}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(args.output, "w", zipfile.ZIP_DEFLATED, compresslevel=3) as archive:
        for path in files:
            archive.write(path, str(path.relative_to(root)).replace("\\", "/"))
        archive.writestr("viewer-fixtures-manifest.json", json.dumps(manifest, indent=2) + "\n")
        archive.writestr("VIEWER-FIXTURES.txt", "Private game-derived fixtures. Extract into the Grimoire checkout.\n"
            "Start: node scripts/preview-cloth.mjs --serve-only --grimoire\n"
            "These assets are not repository files. Keep them out of public commits.\n"
            "The cloth testbed also needs model.glb: copy model-viewer.glb to that name per case.\n")
    with zipfile.ZipFile(args.output) as archive:
        if archive.testzip() is not None:
            raise ValueError("Archive failed its integrity check")
    checksum = digest(args.output)
    args.output.with_suffix(".zip.sha256").write_text(f"{checksum}  {args.output.name}\n", encoding="utf-8")
    print(f"{args.output}: {args.output.stat().st_size / 1024 ** 2:.1f} MiB, {len(files)} files")
    print(f"SHA256 {checksum}")


if __name__ == "__main__":
    main()
