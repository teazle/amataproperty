import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

async function inspectMessageButtons() {
  console.log('🔍 Inspecting LinkedIn message buttons...\n');

  // Check if we have a saved session
  const storageStatePath = path.join(process.cwd(), 'storage', 'linkedin.state.json');
  const hasStorageState = fs.existsSync(storageStatePath);

  if (!hasStorageState) {
    console.log('❌ No saved session found. Please run the LinkedIn automation first to save a session.');
    console.log('   Or manually log in and save the session.');
    return;
  }

  const browser = await chromium.launch({
    headless: false,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
      '--no-sandbox',
    ]
  });

  const context = await browser.newContext({
    storageState: storageStatePath,
    viewport: { width: 1920, height: 1080 },
  });

  const page = await context.newPage();

  try {
    // Navigate to catch-up page
    console.log('📍 Navigating to catch-up page...');
    await page.goto('https://www.linkedin.com/mynetwork/catch-up/all/', {
      waitUntil: 'networkidle',
      timeout: 60000
    });

    await page.waitForTimeout(3000);

    // Inspect all message buttons/links
    console.log('🔍 Inspecting message buttons on page...\n');

    const buttonInfo = await page.evaluate(() => {
      const allMessageLinks = Array.from(document.querySelectorAll('a[href*="/messaging/compose/"]'));
      const results = [];

      for (let i = 0; i < allMessageLinks.length; i++) {
        const link = allMessageLinks[i];
        const href = link.getAttribute('href') || '';
        const ariaLabel = link.getAttribute('aria-label') || '';
        const text = link.textContent?.trim() || '';
        const classes = link.className || '';
        const id = link.id || '';
        const role = link.getAttribute('role') || '';
        const dataTestId = link.getAttribute('data-test-id') || '';

        // Get parent structure
        let parent = link.parentElement;
        let parentInfo = '';
        let depth = 0;
        while (parent && depth < 5) {
          const parentClass = parent.className ? '.' + parent.className.split(' ').filter(c => c).join('.') : '';
          const parentId = parent.id ? '#' + parent.id : '';
          parentInfo = ` > ${parent.tagName}${parentId}${parentClass}` + parentInfo;
          parent = parent.parentElement;
          depth++;
        }

        // Check visibility
        const rect = link.getBoundingClientRect();
        const style = window.getComputedStyle(link);

        results.push({
          index: i,
          href: href,
          ariaLabel: ariaLabel,
          text: text,
          classes: classes,
          id: id,
          role: role,
          dataTestId: dataTestId,
          parentStructure: parentInfo,
          visible: (link as HTMLElement).offsetParent !== null &&
                  style.display !== 'none' &&
                  style.visibility !== 'hidden' &&
                  rect.width > 0 &&
                  rect.height > 0,
          position: {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height
          },
          computedStyle: {
            display: style.display,
            visibility: style.visibility,
            opacity: style.opacity,
            pointerEvents: style.pointerEvents
          }
        });
      }

      return results;
    });

    console.log(`📊 Found ${buttonInfo.length} message links on page:\n`);
    console.log('='.repeat(80));

    buttonInfo.forEach((info, idx) => {
      console.log(`\n[${idx}] ${info.visible ? '✅ VISIBLE' : '❌ HIDDEN'}`);
      console.log(`    href: ${info.href}`);
      console.log(`    aria-label: ${info.ariaLabel || '(none)'}`);
      console.log(`    text: "${info.text}"`);
      console.log(`    classes: ${info.classes || '(none)'}`);
      console.log(`    id: ${info.id || '(none)'}`);
      console.log(`    role: ${info.role || '(none)'}`);
      console.log(`    data-test-id: ${info.dataTestId || '(none)'}`);
      console.log(`    parent: ${info.parentStructure}`);
      if (info.visible) {
        console.log(`    position: x=${info.position.x}, y=${info.position.y}, w=${info.position.width}, h=${info.position.height}`);
      }
      console.log(`    style: display=${info.computedStyle.display}, visibility=${info.computedStyle.visibility}, opacity=${info.computedStyle.opacity}`);
    });

    console.log('\n' + '='.repeat(80));
    console.log('\n💡 Recommended selectors based on inspection:');

    // Analyze and suggest selectors
    const visibleLinks = buttonInfo.filter(info => info.visible);
    if (visibleLinks.length > 0) {
      const firstVisible = visibleLinks[0];
      console.log(`\n1. By href (most reliable):`);
      console.log(`   page.locator('a[href*="/messaging/compose/"]').nth(${firstVisible.index})`);

      if (firstVisible.ariaLabel) {
        console.log(`\n2. By aria-label:`);
        console.log(`   page.locator('a[aria-label*="${firstVisible.ariaLabel.substring(0, 30)}..."]')`);
      }

      if (firstVisible.classes) {
        const mainClass = firstVisible.classes.split(' ')[0];
        if (mainClass) {
          console.log(`\n3. By class:`);
          console.log(`   page.locator('a.${mainClass}')`);
        }
      }

      if (firstVisible.dataTestId) {
        console.log(`\n4. By data-test-id:`);
        console.log(`   page.locator('[data-test-id="${firstVisible.dataTestId}"]')`);
      }
    }

    console.log('\n⏸️  Browser will stay open for 30 seconds for manual inspection...');
    await page.waitForTimeout(30000);

  } catch (error: any) {
    console.error('❌ Error:', error.message);
  } finally {
    await browser.close();
  }
}

inspectMessageButtons().catch(console.error);

