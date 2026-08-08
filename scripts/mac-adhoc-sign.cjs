// electron-builder afterPack hook: give the macOS bundle an ad-hoc signature.
//
// We have no Apple Developer certificate, so electron-builder finds no identity
// and skips code signing outright ("skipped macOS application code signing").
// On Apple Silicon that is fatal rather than cosmetic: arm64 macOS refuses to
// execute a bundle carrying no signature at all, so the app would not launch by
// any route. The "right-click > Open" Gatekeeper bypass the README documents
// only rescues an app that IS signed, just not by an authority macOS trusts.
// An ad-hoc signature is the difference between "the user can choose to open
// this" and "the user cannot open this".
//
// afterPack, not afterSign: electron-builder skips the afterSign hook entirely
// when no signing occurred, which is exactly our case. This runs before the dmg
// and zip targets are built, so the signature ships inside both. It also runs
// before doAddElectronFuses, which would rewrite the binary and invalidate the
// signature, but `electronFuses` is not configured so that step is a no-op.
//
// This is NOT notarization. Downloads stay quarantined and still need the
// documented right-click > Open on first launch.

const { execFileSync } = require('child_process');
const { existsSync, readdirSync } = require('fs');
const path = require('path');

/** codesign, echoing the command so a failed build says what it tried. */
function codesign(args) {
    console.log(`  • codesign ${args.join(' ')}`);
    execFileSync('codesign', args, { stdio: 'inherit' });
}

exports.default = async function adhocSignMac(context) {
    if (context.electronPlatformName !== 'darwin') return;

    const appPath = path.join(
        context.appOutDir,
        `${context.packager.appInfo.productFilename}.app`
    );

    // Sign inside out. The bundled vpkmerge CLI is a loose Mach-O under
    // Resources rather than a nested bundle, and --deep does not reliably reach
    // those, so it gets signed on its own first. Rust binaries linked on macOS
    // usually arrive ad-hoc signed already; --force makes this idempotent
    // either way, and re-signing costs nothing.
    const vpkmergeDir = path.join(appPath, 'Contents', 'Resources', 'vpkmerge');
    if (existsSync(vpkmergeDir)) {
        for (const entry of readdirSync(vpkmergeDir)) {
            codesign(['--force', '--sign', '-', path.join(vpkmergeDir, entry)]);
        }
    }

    // --deep covers the Electron helper apps and frameworks, which fail the
    // same arm64 signature check the outer bundle does.
    codesign(['--force', '--deep', '--sign', '-', appPath]);

    // Fail the build rather than publish an installer that cannot launch.
    codesign(['--verify', '--deep', '--strict', appPath]);
    console.log('  • ad-hoc signature applied and verified');
};
