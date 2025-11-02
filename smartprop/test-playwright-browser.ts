import { chromium } from 'playwright';

async function testBrowser() {
  try {
    console.log('Attempting to launch browser...');
    const browser = await chromium.launch({ headless: false });
    console.log('Browser launched successfully!');
    
    const page = await browser.newPage();
    await page.goto('https://www.edgeprop.sg/property-news/latest');
    console.log('Page loaded successfully!');
    
    const title = await page.title();
    console.log('Page title:', title);
    
    await browser.close();
    console.log('Test completed successfully!');
  } catch (error) {
    console.error('Error:', error);
  }
}

testBrowser();