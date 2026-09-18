import { config } from 'dotenv';
import path from 'path';
import { chromium } from 'playwright';
import {
  checkFlaresolverr,
  getBrowserRuntimeStatus,
  getRequiredScraperEnv,
  inspectAuthState,
} from '../src/lib/scraper/runtime-health';

config({ path: path.resolve(process.cwd(), '.env'), override: false, quiet: true });
config({ path: path.resolve(process.cwd(), '.env.local'), override: false, quiet: true });

async function main() {
  const report = {
    generatedAt: new Date().toISOString(),
    cwd: process.cwd(),
    env: getRequiredScraperEnv(),
    browser: getBrowserRuntimeStatus(chromium.executablePath()),
    flaresolverr: await checkFlaresolverr(),
    auth: {
      propertyguru: inspectAuthState('propertyguru'),
      edgeprop: inspectAuthState('edgeprop'),
    },
  };

  const authStates = Object.values(report.auth);
  const failed =
    report.env.missing.length > 0 ||
    !report.browser.ok ||
    !report.flaresolverr.reachable ||
    authStates.some((auth) => !auth.isAuthenticated);

  process.stdout.write(`${JSON.stringify(report)}\n`);

  if (failed) {
    const failures = [
      ...(report.env.missing.length > 0 ? [`missing env: ${report.env.missing.join(', ')}`] : []),
      ...(!report.browser.ok ? [`browser: ${report.browser.error ?? 'unavailable'}`] : []),
      ...(!report.flaresolverr.reachable ? [`FlareSolverr: ${report.flaresolverr.error ?? 'unreachable'}`] : []),
      ...authStates
        .filter((auth) => !auth.isAuthenticated)
        .map((auth) => `${auth.platform} auth state: ${auth.failureReason ?? 'saved state is not usable'}`),
    ];
    process.stderr.write(`Scraper health failed: ${failures.join('; ')}\n`);
  }

  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
