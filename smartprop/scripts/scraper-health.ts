import { config } from 'dotenv';
import path from 'path';
import { chromium } from 'playwright';
import {
  checkFlaresolverr,
  getBrowserRuntimeStatus,
  getRequiredScraperEnv,
  inspectAuthState,
} from '../src/lib/scraper/runtime-health';

config({ path: path.resolve(process.cwd(), '.env'), override: false });
config({ path: path.resolve(process.cwd(), '.env.local'), override: false });

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

  console.log(JSON.stringify(report, null, 2));

  const authStates = Object.values(report.auth);
  const failed =
    report.env.missing.length > 0 ||
    !report.browser.ok ||
    !report.flaresolverr.reachable ||
    authStates.some((auth) => !auth.isAuthenticated);

  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
