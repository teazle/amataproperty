import { chromium } from 'playwright';

async function debugAuthorDate() {
  console.log('🔍 Debugging author and date extraction...\n');
  
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  
  try {
    const url = 'https://www.edgeprop.sg/property-news/asia-pacific-data-centre-association-pushes-stronger-sustainability-frameworks';
    console.log(`📄 Navigating to: ${url}`);
    
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);
    
    // Debug author and date extraction
    const debugInfo = await page.evaluate(() => {
      console.log('🔍 Looking for author and date elements...');
      
      // Check all elements that might contain date/author info
      const timeElements = Array.from(document.querySelectorAll('time'));
      const dateElements = Array.from(document.querySelectorAll('[class*="date"]'));
      const byElements = Array.from(document.querySelectorAll('*')).filter(el => 
        el.textContent?.includes('By ') && el.textContent.length < 200
      );
      
      return {
        timeElements: timeElements.map(el => ({
          tagName: el.tagName,
          className: el.className,
          textContent: el.textContent?.trim(),
          datetime: el.getAttribute('datetime'),
          outerHTML: el.outerHTML
        })),
        dateElements: dateElements.map(el => ({
          tagName: el.tagName,
          className: el.className,
          textContent: el.textContent?.trim(),
          outerHTML: el.outerHTML
        })),
        byElements: byElements.map(el => ({
          tagName: el.tagName,
          className: el.className,
          textContent: el.textContent?.trim(),
          outerHTML: el.outerHTML
        })),
        allElementsWithBy: Array.from(document.querySelectorAll('*')).filter(el => 
          el.textContent?.includes('By ') && el.textContent.length < 300
        ).map(el => ({
          tagName: el.tagName,
          className: el.className,
          textContent: el.textContent?.trim()
        }))
      };
    });
    
    console.log('⏰ TIME ELEMENTS:');
    console.log('='.repeat(50));
    debugInfo.timeElements.forEach((el, i) => {
      console.log(`${i + 1}. Tag: ${el.tagName}, Class: ${el.className}`);
      console.log(`   Text: ${el.textContent}`);
      console.log(`   DateTime: ${el.datetime}`);
      console.log(`   HTML: ${el.outerHTML}\n`);
    });
    
    console.log('📅 DATE ELEMENTS:');
    console.log('='.repeat(50));
    debugInfo.dateElements.forEach((el, i) => {
      console.log(`${i + 1}. Tag: ${el.tagName}, Class: ${el.className}`);
      console.log(`   Text: ${el.textContent}`);
      console.log(`   HTML: ${el.outerHTML}\n`);
    });
    
    console.log('✍️  BY ELEMENTS:');
    console.log('='.repeat(50));
    debugInfo.byElements.forEach((el, i) => {
      console.log(`${i + 1}. Tag: ${el.tagName}, Class: ${el.className}`);
      console.log(`   Text: ${el.textContent}`);
      console.log(`   HTML: ${el.outerHTML}\n`);
    });
    
    console.log('🔍 ALL ELEMENTS WITH "By":');
    console.log('='.repeat(50));
    debugInfo.allElementsWithBy.forEach((el, i) => {
      console.log(`${i + 1}. Tag: ${el.tagName}, Class: ${el.className}`);
      console.log(`   Text: ${el.textContent}\n`);
    });
    
    console.log('✅ Debug completed. Browser will stay open for manual inspection.');
    console.log('Press Ctrl+C to close when done.');
    
    // Keep browser open for manual inspection
    await new Promise(() => {});
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await browser.close();
  }
}

debugAuthorDate().catch(console.error);