#!/usr/bin/env bun

/**
 * Test to verify MCP scraper extracts the correct 20 articles from page 1
 * Based on the actual article list provided by the user
 */

import { config } from 'dotenv';
import { scrapeEdgePropMCP } from './src/lib/scraper/edgeprop-mcp-scraper';

// Load environment variables from .env.local
config({ path: '.env.local' });

// Expected articles on page 1 (in order)
const EXPECTED_PAGE1_ARTICLES = [
  'Asia-Pacific Data Centre Association pushes for stronger sustainability frameworks',
  'APAC Realty expands ERA franchise into Hong Kong', 
  'Sunway rebrands MCL Land as Sunway MCL after $738.7 mil acquisition',
  'The Duke of the Northeast: Shaun Seah\'s landed legacy',
  'John Tan\'s real estate journey: Building trust, integrity and lasting relationships in Singapore\'s condo market',
  'From staging to strategy: How Michelle Goh turns hidden value into love at first viewing',
  'Audrey Wong: a rising powerhouse in Singapore\'s landed real estate scene',
  'James Ow and his \'customer comes first\' mantra',
  'From the gymnastics mat to million-dollar homes: Realtor Perry Koh on leaping ahead of the competition',
  'Brand new waterfront detached bungalow at Treasure Island Sentosa for new home buyers',
  'The Sail @ Marina Bay: A second wind for the residential skyscraper',
  'Singapore PR pays record $6,501 psf for first Aman-branded residence in Singapore',
  'Resale four-bedder at Four Seasons Park reaps $2.53 mil profit',
  'Residential transactions with contracts dated Oct 14 to 21 [DONE DEALS]',
  'Asia Pacific\'s private credit market: Early stages of a different growth story',
  'Four-bedroom duplex at the Sage condo listed for $16.8 mil',
  'Rare three-storey conservation shophouse along North Canal Road up for sale at $16.8 mil',
  'Wee Hur Holdings prices S$175 Million 4.80% Notes due 2030',
  'Auction listings climb 10% q-o-q in 3Q2025 amid easing interest rates: Knight Frank',
  'London Square launches County Hall Kingston in South-West London'
];

async function testPage1Articles() {
  console.log('🧪 Testing MCP Scraper Page 1 Article Extraction...\n');
  
  try {
    // Test the MCP scraper with maxArticles = 20 (page 1)
    console.log('📍 Scraping EdgeProp latest news (page 1, limit 20)...');
    const articles = await scrapeEdgePropMCP(
      1, // maxPages - just 1 page
      (progress: any) => {
        console.log(`   Progress: ${progress.message}`);
      },
      'test-page1-session', // sessionId
      false, // saveImmediately
      20 // maxArticles - limit to exactly 20 articles
    );

    console.log(`\n📊 Scraper Results:`);
    console.log(`   Articles found: ${articles.length}`);
    console.log(`   Expected: 20 articles`);
    console.log(`   Match: ${articles.length === 20 ? '✅' : '❌'}`);

    // Extract titles from scraped articles
    const scrapedTitles = articles.map((article: any) => article.title?.trim()).filter(Boolean);
    
    console.log(`\n📋 Article Title Comparison:`);
    console.log(`   Scraped titles: ${scrapedTitles.length}`);
    console.log(`   Expected titles: ${EXPECTED_PAGE1_ARTICLES.length}`);

    // Check for title matches
    let exactMatches = 0;
    let partialMatches = 0;
    
    console.log(`\n🔍 Detailed Article Analysis:`);
    
    for (let i = 0; i < Math.min(20, articles.length); i++) {
      const article = articles[i];
      const expectedTitle = EXPECTED_PAGE1_ARTICLES[i];
      const scrapedTitle = article.title?.trim() || 'No title found';
      
      // Check for exact match
      const isExactMatch = scrapedTitle === expectedTitle;
      // Check for partial match (contains key words)
      const isPartialMatch = !isExactMatch && (
        scrapedTitle.toLowerCase().includes(expectedTitle.toLowerCase().substring(0, 20)) ||
        expectedTitle.toLowerCase().includes(scrapedTitle.toLowerCase().substring(0, 20))
      );
      
      if (isExactMatch) exactMatches++;
      else if (isPartialMatch) partialMatches++;
      
      console.log(`   ${i + 1}. ${isExactMatch ? '✅' : isPartialMatch ? '🔶' : '❌'}`);
      console.log(`      Expected: "${expectedTitle}"`);
      console.log(`      Scraped:  "${scrapedTitle}"`);
      console.log(`      Path: ${article.path}`);
      console.log('');
    }

    // Summary
    console.log(`\n📈 Match Summary:`);
    console.log(`   Exact matches: ${exactMatches}/20 (${Math.round(exactMatches/20*100)}%)`);
    console.log(`   Partial matches: ${partialMatches}/20 (${Math.round(partialMatches/20*100)}%)`);
    console.log(`   Total matches: ${exactMatches + partialMatches}/20 (${Math.round((exactMatches + partialMatches)/20*100)}%)`);

    // Validation checks
    const checks = [
      {
        name: 'Article count is exactly 20',
        passed: articles.length === 20,
        value: articles.length
      },
      {
        name: 'All articles have titles',
        passed: scrapedTitles.length === articles.length,
        value: `${scrapedTitles.length}/${articles.length}`
      },
      {
        name: 'All articles have paths',
        passed: articles.every((a: any) => a.path),
        value: articles.filter((a: any) => a.path).length
      },
      {
        name: 'Match rate > 70%',
        passed: (exactMatches + partialMatches) >= 14,
        value: `${Math.round((exactMatches + partialMatches)/20*100)}%`
      }
    ];

    console.log(`\n✅ Validation Results:`);
    checks.forEach(check => {
      console.log(`   ${check.passed ? '✅' : '❌'} ${check.name}: ${check.value}`);
    });

    const allPassed = checks.every(check => check.passed);
    console.log(`\n🎯 Overall Result: ${allPassed ? '✅ PASSED' : '❌ FAILED'}`);
    
    if (allPassed) {
      console.log('   The MCP scraper is correctly extracting page 1 articles!');
    } else {
      console.log('   The MCP scraper needs adjustment for page 1 article extraction.');
    }

  } catch (error) {
    console.error('❌ Test failed with error:', error);
    process.exit(1);
  }
}

// Run the test
testPage1Articles().catch(console.error);