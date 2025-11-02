const { chromium } = require('playwright');

async function debugPage() {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  
  try {
    // === LISTING PAGE ANALYSIS ===
console.log('=== LISTING PAGE ===');
const listingUrl = 'https://www.edgeprop.sg/property-news/latest';
await page.goto(listingUrl, { 
  waitUntil: 'domcontentloaded',
  timeout: 30000 
});

console.log('Page title:', await page.title());
console.log('Page URL:', page.url());

// Wait for React content to load and check periodically
let jsx2211414346Count = 0;
let attempts = 0;
const maxAttempts = 10;

while (jsx2211414346Count === 0 && attempts < maxAttempts) {
  await page.waitForTimeout(2000);
  jsx2211414346Count = await page.$$eval('.jsx-2211414346', els => els.length).catch(() => 0);
  attempts++;
  console.log(`Attempt ${attempts}: Found ${jsx2211414346Count} jsx elements`);
}

// Sample the jsx elements to see what they contain
const jsx2211414346Sample = await page.$$eval('.jsx-2211414346', els => 
  els.slice(0, 10).map(el => ({
    tagName: el.tagName,
    className: el.className,
    textContent: el.textContent?.trim().substring(0, 100),
    href: el.href || 'no href',
    hasLinks: el.querySelectorAll('a').length,
    innerHTML: el.innerHTML.substring(0, 200)
  }))
).catch(() => []);

// Check for actual article links within jsx elements - with detailed debugging
const allArticleLinksInJsx = await page.$$eval('.jsx-2211414346 a[href*="/property-news/"]', els => 
  els.map(el => {
    const href = el.href;
    const pathSegments = href.split('/').length;
    const text = el.textContent?.trim() || '';
    
    return {
      href: el.href,
      text: text.substring(0, 100),
      className: el.className,
      pathSegments,
      endsWithLatest: href.endsWith('/latest'),
      endsWithSpecialFeature: href.endsWith('/special-feature'),
      endsWithNews: href.endsWith('/news'),
      endsWithInDepth: href.endsWith('/in-depth'),
      endsWithShowcase: href.endsWith('/showcase'),
      endsWithDealWatch: href.endsWith('/deal-watch'),
      endsWithInternational: href.endsWith('/international'),
      passesFilter: href.includes('/property-news/') &&
                    !href.endsWith('/latest') &&
                    !href.endsWith('/special-feature') &&
                    !href.endsWith('/news') &&
                    !href.endsWith('/in-depth') &&
                    !href.endsWith('/showcase') &&
                    !href.endsWith('/deal-watch') &&
                    !href.endsWith('/international') &&
                    href.split('/').length >= 5
    };
  })
).catch(() => []);

console.log('Detailed article link analysis:', {
  totalArticleLinksInJsx: allArticleLinksInJsx.length,
  sampleLinks: allArticleLinksInJsx.slice(0, 5),
  passingFilter: allArticleLinksInJsx.filter(link => link.passesFilter).length
});

// Check if we can find articles by looking for specific patterns
const titleLinks = await page.$$eval('a[href*="/property-news/"]', els => 
  els.filter(el => {
    const text = el.textContent?.trim() || '';
    const href = el.href;
    return text.length > 20 && // Likely a title, not navigation
           href.split('/').length > 5 && // Has specific path
           !href.includes('/latest') &&
           !href.includes('/special-feature') &&
           !href.includes('/news') &&
           !href.includes('/in-depth') &&
           !href.includes('/showcase') &&
           !href.includes('/deal-watch');
  }).map(el => ({
    href: el.href,
    text: el.textContent?.trim().substring(0, 100),
    className: el.className
  }))
).catch(() => []);

console.log('Title-based article discovery:', {
  titleLinksCount: titleLinks.length,
  sampleTitleLinks: titleLinks.slice(0, 5)
});
    
    // Check if this is a SPA that loads content dynamically
    const hasReactRoot = await page.$('#__next, #root, [data-reactroot]').then(el => !!el);
    const hasAngular = await page.$('[ng-app], [data-ng-app]').then(el => !!el);
    const hasVue = await page.$('[data-v-]').then(el => !!el);
    
    console.log('Framework detection:', {
      hasReactRoot,
      hasAngular,
      hasVue
    });
    
    // Check page structure
    const bodyClasses = await page.$eval('body', el => el.className).catch(() => '');
    const mainContent = await page.$eval('main', el => el.className).catch(() => 'no main element');
    
    console.log('Page structure:', {
      bodyClasses,
      mainContent
    });
    
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await browser.close();
  }
}

debugPage();