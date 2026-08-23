/* eslint-disable */
// electron-builder afterPack hook: ad-hoc code-sign the macOS app.
//
// We have no paid Apple Developer certificate, so the app can't be notarized. But an *unsigned*
// arm64 app that has been downloaded (and therefore quarantined) is hard-blocked by Gatekeeper with
// "“<app>” is damaged and can't be opened." Re-signing ad-hoc (identity "-") gives the app a
// valid signature, which downgrades that hard block to the normal "unidentified developer" prompt a
// user can bypass with right-click -> Open. Runs on macOS builds only.
const { execFileSync } = require('child_process');
const path = require('path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;

  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, `${appName}.app`);

  console.log(`[afterPack] ad-hoc signing ${appPath}`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' });

  // Verify the signature is valid — this is exactly what prevents the "damaged" error.
  execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], { stdio: 'inherit' });
  console.log('[afterPack] ad-hoc signature verified');
};
