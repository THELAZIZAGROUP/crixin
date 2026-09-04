/**
 * `crixin license` — activate / status / deactivate
 *
 * The license JWT is issued by the Stripe webhook on `checkout.session.completed`
 * and emailed to the customer via Resend. Activating writes the JWT to
 * ~/.crixin/license.json (after offline Ed25519 verification).
 */
import { existsSync, writeFileSync, unlinkSync } from "node:fs";
import { paths, ensureCrixinHome } from "../lib/paths.js";
import {
  verifyLicenseToken,
  getCurrentLicense,
  resetLicenseCache,
} from "../license/features.js";
import { log } from "../lib/log.js";
import kleur from "kleur";

export function runLicense(args: { sub: "activate" | "status" | "deactivate"; token?: string }): void {
  ensureCrixinHome();
  switch (args.sub) {
    case "activate": {
      const token = args.token?.trim();
      if (!token) {
        log.error("Pass the license token: crixin license activate <token>");
        log.hint("You'll find your token in the welcome email after Stripe checkout.");
        process.exitCode = 1;
        return;
      }
      if (!verifyLicenseToken(token)) {
        log.error("That license token didn't verify.");
        log.hint("Tokens are signed with our Ed25519 key — copy/paste error or expired token?");
        log.hint("Re-check the email from hello@hello.crixin.com or open the customer portal.");
        process.exitCode = 1;
        return;
      }
      writeFileSync(paths.licenseFile, JSON.stringify({ token }, null, 2));
      resetLicenseCache();
      log.success("License activated. Pro features unlocked.");
      log.hint(`Stored at ${paths.licenseFile}`);
      return;
    }
    case "status": {
      const { valid, claims } = getCurrentLicense();
      if (valid && claims) {
        const expDate = new Date(claims.exp * 1000).toISOString().slice(0, 10);
        log.success(kleur.bold(`Pro · ${claims.tier}`));
        if (claims.email) console.log("  " + kleur.gray(`account: ${claims.email}`));
        console.log("  " + kleur.gray(`renews:  ${expDate}`));
      } else if (valid) {
        log.success("Pro · active (env override)");
      } else {
        log.info("Free tier.");
        log.hint("Upgrade with a 3-day free trial: https://crixin.com/install");
      }
      return;
    }
    case "deactivate": {
      if (existsSync(paths.licenseFile)) {
        unlinkSync(paths.licenseFile);
        resetLicenseCache();
        log.success("License deactivated.");
      } else {
        log.info("No license to deactivate.");
      }
      return;
    }
    default: {
      log.error(`Unknown license subcommand: ${String((args as { sub: string }).sub)}`);
      process.exitCode = 1;
    }
  }
}
