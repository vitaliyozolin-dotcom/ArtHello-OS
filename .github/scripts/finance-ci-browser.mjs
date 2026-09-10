// Exercises the actual built app behind a CI-only, fixed-origin transport map.
// Server responses, authentication and database writes are real; no API mocks or sessions are injected.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { inspectSandbox } from './flow.mjs';

const ORIGIN='https://finance.ci.invalid';
let stage='guard',actionStage=null,browser,page;
const errors=[],writes=[];let requests=0,loginCount=0,transportFailed=false,transportFailure=null;
try {
  assert.equal(process.env.ARTHELLO_FINANCE_CI,'disposable-hosted-fixture');
  assert.match(process.env.CHECKED_SOURCE_SHA||'',/^[a-f0-9]{40}$/);
  stage='launch';
  browser=await chromium.launch({channel:'chromium',headless:true,chromiumSandbox:true,timeout:20000,args:['--disable-background-networking','--disable-quic','--force-webrtc-ip-handling-policy=disable_non_proxied_udp']});
  const sandbox=await browser.newPage();await sandbox.goto('chrome://sandbox');
  const rows=await sandbox.locator('#sandbox-status tr').evaluateAll(rows=>Object.fromEntries(rows.map(row=>Array.from(row.querySelectorAll('td')).map(cell=>cell.textContent.trim()))));
  assert(Object.values(inspectSandbox(rows)).every(Boolean));await sandbox.close();
  const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block',acceptDownloads:false,ignoreHTTPSErrors:false});
  await context.route('**/*',async route=>{
    let routePhase='origin',requestKind='other',method='unknown',statusCode=null,destinationKind='other',destinationOrigin=null;
    try {
      const request=route.request(),url=new URL(request.url());
      destinationOrigin=url.origin.slice(0,120);
      destinationKind=url.origin===ORIGIN?'fixture':url.origin==='null'?'opaque':url.hostname==='127.0.0.1'?'localhost':url.protocol==='http:'?'other_http':'other_https';
      requestKind=url.pathname==='/'?'root':url.pathname.startsWith('/assets/')?'asset':['/api/auth/login','/api/auth/me','/api/finance','/api/finance-actions','/api/user-dashboard-layouts','/api/notifications','/api/settings'].includes(url.pathname)?url.pathname:'other';
      // The actual stylesheet requests these optional public fonts. Keep this
      // disposable fixture offline and exercise its normal system-font fallback.
      if(['https://fonts.googleapis.com','https://fonts.gstatic.com'].includes(url.origin)&&request.method()==='GET') {await route.abort();return;}
      assert.equal(url.origin,ORIGIN);routePhase='request_budget';assert(++requests<=500);
      method=request.method();routePhase='method';
      if(!['GET','HEAD'].includes(method)) {
        assert.equal(method,'POST');
        if(url.pathname==='/api/auth/login') assert.equal(++loginCount,1);
        else { assert.equal(url.pathname,'/api/finance-actions');const action=JSON.parse(request.postData()||'{}').action;assert(['createArticle','approveArticle','archiveArticle','classifyOperation'].includes(action));writes.push(action); }
      }
      const headers={...request.headers(),host:'finance.ci.invalid'};
      delete headers['content-length'];delete headers['accept-encoding'];
      routePhase='fetch';const response=await fetch('http://127.0.0.1:8081'+url.pathname+url.search,{method,headers,body:['GET','HEAD'].includes(method)?undefined:request.postDataBuffer(),redirect:'manual',signal:AbortSignal.timeout(20000)});
      statusCode=response.status;routePhase='headers';const out=Object.fromEntries(response.headers);delete out['content-encoding'];delete out['content-length'];delete out['transfer-encoding'];
      const cookies=response.headers.getSetCookie();if(cookies.length)out['set-cookie']=cookies.join('\n');
      routePhase='fulfill';await route.fulfill({status:response.status,headers:out,body:Buffer.from(await response.arrayBuffer())});
    } catch(error) {transportFailed=true;transportFailure??={routePhase,requestKind,destinationKind,destinationOrigin,method,statusCode,errorKind:['AssertionError','TypeError','Error'].includes(error?.name)?error.name:'other',cause:['ECONNREFUSED','ETIMEDOUT','UND_ERR_CONNECT_TIMEOUT'].includes(error?.cause?.code)?error.cause.code:null};await route.abort().catch(()=>{});}
  });
  page=await context.newPage();page.setDefaultTimeout(20000);page.on('pageerror',()=>errors.push('pageerror'));
  stage='natural_login';await page.goto(ORIGIN);
  await page.getByLabel('Логин',{exact:true}).fill('owner');
  await page.getByLabel('Пароль',{exact:true}).fill(readFileSync('/run/secrets/fixture-password','utf8').trim());
  const login=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/auth/login');
  await page.getByRole('button',{name:'Войти',exact:true}).click();assert.equal((await login).status(),200);
  stage='finance_navigation';await page.getByRole('link',{name:'Деньги',exact:true}).click();
  await page.getByRole('tab',{name:'Статьи',exact:true}).click();
  stage='empty_catalog';await page.getByText('Статьи ещё не добавлены',{exact:true}).waitFor();
  async function save(click,expected=200) { const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/finance-actions'&&r.request().method()==='POST');await click();const r=await response;assert.equal(r.status(),expected);await page.waitForFunction(()=>!document.querySelector('.ahFinanceArticles button:disabled')); }
  async function create(name,report,direction) {
    await page.getByRole('tab',{name:'Статьи',exact:true}).click();
    const form=page.locator('.ahFinanceArticleForm').first();
    actionStage='article_name';await form.getByLabel('Название статьи',{exact:true}).fill(name);
    actionStage='report_select';await form.getByRole('combobox',{name:'Отчёт'}).selectOption(report);
    actionStage='direction_select';await form.getByRole('combobox',{name:report==='cashflow'?'Направление':'Тип статьи'}).selectOption(direction);
    actionStage='create_draft';await save(()=>form.getByRole('button',{name:'Создать черновик',exact:true}).click());
    const row=page.locator('.ahFinanceArticleList li').filter({has:page.getByText(name,{exact:true})});
    actionStage='draft_visible';await row.getByText('Черновик',{exact:true}).waitFor();
    actionStage='approve_draft';await save(()=>row.getByRole('button',{name:'Утвердить',exact:true}).click());await row.getByText('Утверждена',{exact:true}).waitFor();actionStage=null;
  }
  async function preview(article,inn,purpose) {
    const form=page.locator('form').filter({has:page.getByRole('button',{name:'Предпросмотр',exact:true})});
    await form.getByRole('combobox',{name:'Статья ДДС'}).selectOption({label:article});
    await form.getByLabel('ИНН контрагента — точное совпадение',{exact:true}).fill(inn);await form.getByLabel('Назначение содержит',{exact:true}).fill(purpose);
    await form.getByRole('button',{name:'Предпросмотр',exact:true}).click();await page.getByText(/Найдено: 1 · сумма/).waitFor();
    await page.getByRole('button',{name:'Открыть операции',exact:true}).click();
    await page.locator('.finance-table tbody tr').first().click();await page.getByRole('dialog').waitFor();
  }
  stage='desktop_articles';await create('CI Обучение','cashflow','Поступление');await create('CI Услуги','pnl','Поступление');
  await page.screenshot({path:'/evidence/desktop-articles.png',fullPage:true});
  stage='desktop_allocation';await preview('CI Обучение','9999999999','CI обучение');
  const dialog=page.getByRole('dialog');await dialog.getByRole('combobox',{name:'Статья ДДС'}).selectOption('CI Обучение');
  await dialog.getByRole('combobox',{name:'Класс ОПиУ'}).selectOption('Доходы ОПиУ');await dialog.getByRole('combobox',{name:'Статья ОПиУ'}).selectOption('CI Услуги');await dialog.getByLabel('Период ОПиУ',{exact:true}).fill('2026-09');
  await save(()=>dialog.getByRole('button',{name:'Сохранить разнесение',exact:true}).click());await dialog.waitFor({state:'hidden'});
  stage='reload_dds';await page.reload();await page.getByRole('tab',{name:'ДДС',exact:true}).click();
  const dds=page.locator('.finance-table tbody tr').filter({has:page.getByRole('button',{name:'CI Обучение',exact:true})});await dds.waitFor();assert.match(await dds.innerText(),/1\D*234,56/);
  await page.screenshot({path:'/evidence/desktop-dds.png',fullPage:true});await dds.getByRole('button',{name:'CI Обучение',exact:true}).click();assert.equal(await page.locator('.finance-table tbody tr').count(),1);
  stage='mobile_articles';await page.setViewportSize({width:390,height:844});await create('CI Аренда','cashflow','Списание');
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));
  await page.screenshot({path:'/evidence/mobile-articles.png',fullPage:true});
  stage='mobile_allocation';await preview('CI Аренда','8888888888','CI аренда');
  assert(await dialog.evaluate(e=>e.scrollWidth<=e.clientWidth+2));await dialog.getByRole('combobox',{name:'Статья ДДС'}).selectOption('CI Аренда');
  await dialog.getByRole('button',{name:'Не включать в ОПиУ',exact:true}).click();await page.screenshot({path:'/evidence/mobile-allocation.png',fullPage:true});
  await save(()=>dialog.getByRole('button',{name:'Сохранить разнесение',exact:true}).click());await dialog.waitFor({state:'hidden'});
  stage='archive_history';await page.getByRole('tab',{name:'Статьи',exact:true}).click();
  const archived=page.locator('.ahFinanceArticleList li').filter({has:page.getByText('CI Обучение',{exact:true})});await save(()=>archived.getByRole('button',{name:'В архив',exact:true}).click());
  await page.getByLabel('Показывать архив',{exact:true}).check();await archived.getByText('Архив',{exact:true}).waitFor();
  await page.reload();await page.getByRole('tab',{name:'ДДС',exact:true}).click();await page.getByRole('button',{name:'CI Обучение',exact:true}).click();await page.locator('.finance-table tbody tr').first().click();
  assert.equal(await dialog.getByRole('combobox',{name:'Статья ДДС'}).inputValue(),'CI Обучение');
  assert.equal(loginCount,1);assert.equal(transportFailed,false);assert.equal(errors.length,0);assert.equal(writes.filter(x=>x==='classifyOperation').length,2);assert.equal(writes.length,9);
  const result={kind:'finance-isolated-browser',result:'pass',sourceSha:process.env.CHECKED_SOURCE_SHA,viewports:[1440,390],actualApplication:true,actualDatabase:true,apiMocked:false,sessionInjected:false,chromiumSandbox:'verified',productionAcceptance:'not_run',bankFacts:'synthetic CI only',screenshots:['desktop-articles.png','desktop-dds.png','mobile-articles.png','mobile-allocation.png']};
  writeFileSync('/evidence/result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
} catch(error) {
  if(page&&stage!=='natural_login')await page.screenshot({path:'/evidence/failure.png',fullPage:true}).catch(()=>{});
  const reason=String(error?.message||'').includes('strict mode violation')?'ambiguous_locator':error?.name==='TimeoutError'?'timeout':error?.name==='AssertionError'?'assertion':'other';
  console.error(JSON.stringify({kind:'finance-isolated-browser',result:'fail',stage,actionStage,reason,requests,writes:writes.length,transportFailed,transportFailure,pageErrors:errors.length,productionAcceptance:'not_run'}));process.exitCode=2;
} finally {await browser?.close();}
