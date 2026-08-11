// electron-builder afterPack hook: ad-hoc sign the macOS app bundle.
//
// Why this exists: we have no Developer ID certificate, so electron-builder is
// configured with `identity: null` and skips signing. That is NOT the same as
// leaving the app unsigned. electron-builder rewrites the bundle (injects
// app.asar, rewrites Info.plist, renames the executable), which INVALIDATES the
// linker-signed ad-hoc signature Electron ships with. macOS treats an invalid
// signature on a quarantined download as "damaged and can't be opened", which
// the user cannot click past. A valid ad-hoc signature instead produces the
// ordinary "unidentified developer" prompt, which they can.
//
// So: re-sign ad-hoc after packing. This does not make the app notarized or
// trusted, it just makes it honestly unsigned rather than broken.

import { execFileSync } from 'child_process';
import { join } from 'path';

export default async function adhocSignMac(context) {
    if (context.electronPlatformName !== 'darwin') return;

    const appPath = join(
        context.appOutDir,
        `${context.packager.appInfo.productFilename}.app`
    );

    // --deep is deprecated for distribution signing but remains the supported
    // way to ad-hoc sign a whole bundle, and the nested Electron helpers and
    // frameworks must all be re-signed or the outer signature will not verify.
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], {
        stdio: 'inherit',
    });

    // Fail the build rather than ship another "damaged" artifact.
    execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], {
        stdio: 'inherit',
    });

    console.log(`  • ad-hoc signed and verified  file=${appPath}`);
}
