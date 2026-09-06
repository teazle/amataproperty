import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { normalizeArticleCategories } from '../src/lib/scraper/article-categories';

test('article category arrays retain every meaningful category for containment filtering', () => {
  expect(normalizeArticleCategories(['Residential', 'Investment'])).toEqual(['Residential', 'Investment']);
  expect(normalizeArticleCategories(['Tags', 'Residential', 'Residential', 'Property News'])).toEqual(['Residential']);
  expect(normalizeArticleCategories('Investment')).toEqual(['Investment']);
  expect(normalizeArticleCategories([])).toEqual(['News']);
});

test('the real article query emits scalar JSONB containment for legacy strings and arrays', () => {
  const code = `
    process.env.NEXT_PUBLIC_SUPABASE_URL='https://fixture.invalid';
    process.env.SUPABASE_SERVICE_ROLE='fixture-only';
    let filter;
    globalThis.fetch=async (input)=>{
      const url=new URL(typeof input==='string'?input:input.url??String(input));
      filter=url.searchParams.get('category');
      return new Response('[]',{status:200,headers:{'content-type':'application/json','content-range':'0-0/0'}});
    };
    const {getArticles}=await import('./src/lib/db/articles');
    await getArticles(1,50,undefined,'Residential');
    console.log(JSON.stringify({filter}));
  `;
  const result = spawnSync(process.execPath, ['-e', code], { cwd: process.cwd(), encoding: 'utf8', timeout: 10000 });
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout.trim())).toEqual({ filter: 'cs."Residential"' });
});

test('the real article insert retains the complete category array', () => {
  const code = `
    process.env.NEXT_PUBLIC_SUPABASE_URL='https://fixture.invalid';
    process.env.SUPABASE_SERVICE_ROLE='fixture-only';
    let category;
    globalThis.fetch=async (input, init)=>{
      const url=new URL(typeof input==='string'?input:input.url??String(input));
      const insert=init?.method==='POST' && url.pathname.endsWith('/scraped_articles');
      if(insert) category=JSON.parse(init.body).category;
      return new Response(JSON.stringify(insert?{id:'fixture-article'}:[]),{status:200,headers:{'content-type':'application/json'}});
    };
    const {upsertArticles}=await import('./src/lib/db/articles');
    await upsertArticles([{nid:'fixture',title:'Fixture',thumbnail:'',path:'/fixture',author:'Fixture',created:'2026-09-06',created_on:'2026-09-06',category:['Residential','Investment']}],'fixture-session');
    console.log(JSON.stringify({category}));
  `;
  const result = spawnSync(process.execPath, ['-e', code], { cwd: process.cwd(), encoding: 'utf8', timeout: 10000 });
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout.trim())).toEqual({ category: ['Residential', 'Investment'] });
});
