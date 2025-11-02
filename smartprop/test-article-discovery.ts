import { chromium } from 'playwright';

async function testArticleDiscovery() {
  console.log('🚀 Testing improved article discovery logic...');
  
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  try {
    await page.goto('https://www.edgeprop.sg/property-news/latest', { 
      waitUntil: 'networkidle',
      timeout: 30000 
    });
    
    const results = await page.evaluate(() => {
      // Simulate the improved article discovery logic
      console.log('🔍 Trying multiple selectors to find article links...');
      
      // Try multiple strategies to find article containers
      let articleContainers: Element[] = [];
      
      // Strategy 1: Look for any class containing "article"
      const articleClassContainers = Array.from(document.querySelectorAll('[class*="article"]'));
      console.log(`✅ Found ${articleClassContainers.length} containers with "article" in class`);
      
      // Strategy 2: Look for JSX containers (EdgeProp uses Next.js with JSX classes)
      const jsxContainers = Array.from(document.querySelectorAll('div[class*="jsx-"]'));
      console.log(`✅ Found ${jsxContainers.length} JSX containers`);
      
      // Strategy 3: Look for divs that contain article links and images
      const linkContainers = Array.from(document.querySelectorAll('div')).filter(div => {
        const hasArticleLink = div.querySelector('a[href*="/property-news/"]:not([href*="/property-news-search"]):not([href*="/property-news/latest"]):not([href*="/property-news/news"]):not([href*="/property-news/in-depth"])');
        const hasImage = div.querySelector('img');
        const href = hasArticleLink?.getAttribute('href');
        if (hasArticleLink && hasImage && href && href.includes('/property-news/')) {
          const isRelativeUrl = href.startsWith('/property-news/');
          const isAbsoluteUrl = href.includes('edgeprop.sg/property-news/');
          const pathSegments = href.split('/').length;
          return (isRelativeUrl && pathSegments >= 3) || (isAbsoluteUrl && pathSegments >= 5);
        }
        return false;
      });
      console.log(`✅ Found ${linkContainers.length} containers with article links and images`);
      
      // Use the strategy that found the most containers
      if (linkContainers.length > 0) {
        articleContainers = linkContainers;
        console.log(`Using link containers strategy: ${linkContainers.length} containers`);
      } else if (articleClassContainers.length > 0) {
        articleContainers = articleClassContainers;
        console.log(`Using article class strategy: ${articleClassContainers.length} containers`);
      } else if (jsxContainers.length > 0) {
        articleContainers = jsxContainers;
        console.log(`Using JSX containers strategy: ${jsxContainers.length} containers`);
      }
      
      // Extract unique article hrefs from the containers (limit to 25 for testing)
      const uniqueHrefs = new Map<string, any>();
      
      for (let index = 0; index < articleContainers.length && uniqueHrefs.size < 25; index++) {
        const container = articleContainers[index];
        
        const allLinks = Array.from(container.querySelectorAll('a[href*="/property-news/"]'));
        const articleLinks = allLinks.filter(link => {
          const href = link.getAttribute('href') || '';
          const isRelativeUrl = href.startsWith('/property-news/');
          const isAbsoluteUrl = href.includes('edgeprop.sg/property-news/');
          const pathSegments = href.split('/').length;
          
          return (isRelativeUrl || isAbsoluteUrl) && 
                 !href.includes('/property-news-search') &&
                 !href.includes('/property-news/latest') &&
                 !href.includes('/property-news/news') &&
                 !href.includes('/property-news/in-depth') &&
                 !href.includes('/property-news/showcase') &&
                 !href.includes('/property-news/deal-watch') &&
                 !href.includes('/property-news/international') &&
                 !href.includes('/property-news/personality') &&
                 !href.includes('/property-news/mandarin') &&
                 ((isRelativeUrl && pathSegments >= 3) || (isAbsoluteUrl && pathSegments >= 5));
        });
        
        let articleHref = '';
        let title = '';
        
        // Get the first valid article link
        const sortedLinks = articleLinks.sort((a, b) => (b.textContent?.trim().length || 0) - (a.textContent?.trim().length || 0));
        
        sortedLinks.forEach(link => {
          const href = link.getAttribute('href') || '';
          const text = link.textContent?.trim() || '';
          
          if (href && !articleHref) {
            articleHref = href;
          }
          
          // Improved title extraction (more flexible)
          if (text && text.length > 10 && !text.includes('EDGEPROP SINGAPORE') && !text.includes('PROPERTY NEWS') && !text.includes('PERSONALITY') && !text.includes('SPECIAL FEATURE')) {
            if (!title || text.length > title.length) {
              title = text;
            }
          }
        });
        
        // Fallback title extraction
        if (!title || title.length < 10) {
          const heading = container.querySelector('h2, h3, h4, [class*="title"], [class*="heading"], [class*="headline"]');
          if (heading) {
            const headingText = heading.textContent?.trim() || '';
            if (headingText && headingText.length > 5 && !headingText.includes('EDGEPROP SINGAPORE')) {
              title = headingText;
            }
          }
        }
        
        const normalizedHref = articleHref.replace(/^https?:\/\/www\.edgeprop\.sg/, '').replace(/^([^/])/, '/$1');
        
        // URL slug fallback for title
        if (!title || title.length < 10) {
          const urlParts = normalizedHref.split('/');
          const slug = urlParts[urlParts.length - 1] || '';
          if (slug && slug.length > 10) {
            title = slug.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
          }
        }
        
        if (normalizedHref && normalizedHref.includes('/property-news/') && !uniqueHrefs.has(normalizedHref)) {
          uniqueHrefs.set(normalizedHref, {
            href: normalizedHref,
            title: title,
            index: index
          });
        }
      }
      
      return {
        totalContainers: articleContainers.length,
        uniqueArticles: uniqueHrefs.size,
        articles: Array.from(uniqueHrefs.values()).slice(0, 25)
      };
    });
    
    console.log(`📊 Results:`);
    console.log(`- Total containers processed: ${results.totalContainers}`);
    console.log(`- Unique articles found: ${results.uniqueArticles}`);
    console.log(`\n📝 Articles found:`);
    
    results.articles.forEach((article, index) => {
      console.log(`${index + 1}. ${article.href}`);
      console.log(`   Title: "${article.title}"`);
    });
    
    if (results.uniqueArticles >= 20) {
      console.log(`\n✅ SUCCESS: Found ${results.uniqueArticles} articles (≥20 expected)`);
    } else {
      console.log(`\n⚠️  WARNING: Only found ${results.uniqueArticles} articles (expected ≥20)`);
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await browser.close();
  }
}

testArticleDiscovery().catch((error) => console.error(error));