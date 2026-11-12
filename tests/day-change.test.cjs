const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const Core=require('../web/core.js');

function appAt(date,options={}){
 let clock=new Date(date).getTime(),nextTimer=0,nextId=0;
 class ClockDate extends Date{constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}}
 const elements=new Map(),storage=new Map(),downloads=[],messages=[];
 const element=id=>{
  if(!elements.has(id))elements.set(id,{id,value:'',innerHTML:'',textContent:'',hidden:false,open:false,listeners:{},attributes:{},showModal(){this.open=true;},close(){this.open=false;},focus(){},classList:{add(){},remove(){},toggle(){}},setAttribute(name,value){this.attributes[name]=value;},querySelectorAll(){return[]},addEventListener(name,callback){this.listeners[name]=callback;}});
  return elements.get(id);
 };
 const context=vm.createContext({Core,Date:ClockDate,structuredClone,Blob,URL:{createObjectURL:blob=>{downloads.push(blob);return 'blob:fixture';},revokeObjectURL(){}},crypto:{randomUUID:()=> 'fixture-id-'+(++nextId)},document:{getElementById:element,createElement:()=>({click(){}}),querySelectorAll:()=>[],addEventListener(){},body:{classList:{toggle(){},add(){}}}},window:{addEventListener(){},...(options.native?{webkit:{messageHandlers:{native:{postMessage:message=>messages.push(message)}}}}:{})},localStorage:{setItem:(k,v)=>storage.set(k,v),getItem:k=>storage.get(k)},setTimeout:()=>++nextTimer,clearTimeout(){},setInterval:()=>++nextTimer,console});
 const source=fs.readFileSync(require.resolve('../web/app.js'),'utf8').replace(/\ninit\(\);\s*$/,'');
 vm.runInContext(source,context);vm.runInContext('financeUnlocked='+String(options.financeUnlocked!==false)+';render()',context);
 return {element,storage,downloads,messages,run:code=>vm.runInContext(code,context),json:code=>JSON.parse(vm.runInContext('JSON.stringify('+code+')',context)),advance:date=>{clock=new Date(date).getTime();}};
}

test('完整导出忽略分页和日历筛选，包含归档、历史复盘和全部已缓存日程',async()=>{
 const app=appAt('2026-10-30T12:00:00+08:00');
 app.run("state.tasks=[{id:'t',title:'已完成归档待办',archived:true,done:true}];state.projects=[{id:'p',title:'项目'}];state.business=[{id:'b',title:'商务'}];state.development=[{id:'d',title:'开发'}];state.memos=[{id:'m',text:'备忘\\n第二行',archived:true}];state.thoughts={'2026-09-01':'历史复盘','2026-10-30':'今日复盘'};state.finance=[{id:'f',amountCents:10001,status:'settled'}];state.activeDimension='tasks';state.hiddenCalendars=['hidden'];cache={'2026-10':{syncedAt:1,events:[{id:'e',calendarId:'hidden',title:'旧日程',start:1793318400000,end:1793322000000}]},'2026-11':{syncedAt:2,events:[{id:'next',calendarId:'hidden',title:'下月日程',start:1793664000000,end:1793667600000}]}};save()");
 await app.element('export').onclick();
 const exported=JSON.parse(await app.downloads[0].text());assert.equal(exported.financeIncluded,true);assert.equal(exported.tasks[0].archived,true);assert.equal(exported.memos[0].text,'备忘\n第二行');assert.equal(exported.thoughts['2026-09-01'],'历史复盘');assert.equal(exported.finance[0].amountCents,10001);assert.equal(exported.calendarEvents.length,2);assert.ok(exported.calendarCache['2026-10']);assert.equal(exported.projects.length,1);assert.equal(exported.business.length,1);assert.equal(exported.development.length,1);assert.equal(app.element('export').disabled,false);
});

test('Mac 导出全部等待最新保存、只发一次请求，取消不提示成功，失败恢复按钮',async()=>{
 const app=appAt('2026-10-30T12:00:00+08:00',{native:true,financeUnlocked:false});
 app.run("state.tasks=[{id:'t',title:'刚写下的内容'}];save()");
 const exporting=app.element('export').onclick();assert.equal(app.messages.length,1);assert.equal(app.messages[0].action,'saveState');assert.equal(app.element('export').disabled,true);
 await app.element('export').onclick();assert.equal(app.messages.length,1);
 app.run(`window.nativeResponse(${app.messages[0].id},true)`);await new Promise(resolve=>setImmediate(resolve));assert.equal(app.messages[1].action,'exportAll');assert.deepEqual(Object.keys(app.messages[1].payload),['calendarEvents']);assert.deepEqual(app.json('state.tasks'),[{id:'t',title:'刚写下的内容'}]);
 app.run(`window.nativeResponse(${app.messages[1].id},{saved:false,cancelled:true})`);await exporting;assert.doesNotMatch(app.element('toast').textContent,/已导出/);assert.equal(app.element('export').disabled,false);
 const retry=app.element('export').onclick();app.run(`window.nativeResponse(${app.messages[2].id},null,'导出失败示例')`);await retry;assert.equal(app.element('toast').textContent,'导出失败示例');assert.equal(app.element('export').disabled,false);
 const success=app.element('export').onclick();app.run(`window.nativeResponse(${app.messages[3].id},{saved:true,financeIncluded:true})`);await success;assert.match(app.element('toast').textContent,/全部内容已导出/);
});

test('Mac 最新保存失败不得静默导出旧内容，预览仍可导出内存中的备份',async()=>{
 const app=appAt('2026-10-30T12:00:00+08:00',{native:true,financeUnlocked:false});app.run("state.thoughts={'2026-10-30':'最新复盘'};save()");
 const exporting=app.element('export').onclick();app.run(`window.nativeResponse(${app.messages[0].id},null,'保存失败')`);await exporting;assert.equal(app.messages.length,1);assert.equal(app.run('dirty'),true);assert.equal(app.element('export').disabled,false);assert.match(app.element('toast').textContent,/最新修改尚未保存/);
 const preview=appAt('2026-10-30T12:00:00+08:00',{financeUnlocked:false});preview.run("state.thoughts={'2026-10-30':'浏览器最新复盘'};localStorage.setItem=()=>{throw Error('full')};save()");await preview.element('export').onclick();const data=JSON.parse(await preview.downloads[0].text());assert.equal(data.thoughts['2026-10-30'],'浏览器最新复盘');assert.equal(data.financeIncluded,false);assert.match(preview.element('toast').textContent,/财务需在 Mac 应用/);
});

test('日程明细只显示所选日期，点日期自动展开，同日刷新保持滚动，跨月和空日期正确切换',async()=>{
 const app=appAt('2026-10-26T12:00:00+08:00');
 app.run("demo=false;connected=true;cache={'2026-10':{syncedAt:1,events:[{id:'oct',calendarId:'work',title:'十月安排',start:new Date('2026-10-26T09:00:00+08:00').getTime(),end:new Date('2026-10-26T10:00:00+08:00').getTime()}]},'2026-11':{syncedAt:2,events:[{id:'nov',calendarId:'personal',title:'十一月安排',start:new Date('2026-11-02T09:00:00+08:00').getTime(),end:new Date('2026-11-02T10:00:00+08:00').getTime()}]}};renderAgenda()");
 const html=app.element('agenda').innerHTML;assert.match(html,/十月安排/);assert.doesNotMatch(html,/十一月安排/);assert.equal(app.element('event-count').textContent,'10/26 · 1项');assert.equal(app.element('agenda-title').textContent,'日程明细');
 assert.equal(app.element('agenda').hidden,true);app.element('calendar').listeners.click({target:{closest:()=>({dataset:{day:'2026-10-26'}})}});assert.equal(app.element('agenda').hidden,false);
 app.element('agenda').scrollTop=72;app.run('renderCalendar()');assert.equal(app.element('agenda').innerHTML,html);assert.equal(app.element('agenda').scrollTop,72);
 app.run('persist()');assert.equal(JSON.parse(app.storage.get('zaichang-preview')).feishuAgendaExpanded,true);await app.run('init()');assert.equal(app.element('agenda').hidden,false);
 app.run("demo=false;select(C.fromKey('2026-11-02'),true)");assert.doesNotMatch(app.element('agenda').innerHTML,/十月安排/);assert.match(app.element('agenda').innerHTML,/十一月安排/);assert.equal(app.element('agenda').scrollTop,0);assert.equal(app.element('event-count').textContent,'11/02 · 1项');
 app.run("state.hiddenCalendars=['personal'];renderAgenda()");assert.doesNotMatch(app.element('agenda').innerHTML,/十一月安排/);assert.equal(app.element('event-count').textContent,'11/02 · 0项');
 app.element('feishu-agenda-toggle').onclick();app.run('renderAgenda()');assert.equal(app.element('agenda').hidden,true);
 app.element('today').onclick();assert.equal(app.element('agenda').hidden,false);assert.equal(app.element('event-count').textContent,'10/26 · 1项');
 app.run("select(C.fromKey('2027-01-01'),true)");assert.match(app.element('agenda').innerHTML,/2027-01-01 暂无日程安排/);assert.doesNotMatch(app.element('agenda').innerHTML,/十月安排|十一月安排/);
 app.advance('2026-11-03T00:00:00+08:00');app.run("state.hiddenCalendars=[];refreshDay()");assert.match(app.element('agenda').innerHTML,/2026-11-03 暂无日程安排/);
});

test('所选日混合飞书待办商务开发，全天和跨天在先、时间递增，保留完成标记而不泄露财务',()=>{
 const app=appAt('2026-11-12T12:00:00+08:00');
 app.run(`demo=false;const stamp=s=>new Date(s+'+08:00').getTime();cache={'2026-11':{syncedAt:2,events:[
 {id:'all',calendarId:'work',title:'全天安排',allDay:true,start:stamp('2026-11-11T00:00:00'),end:stamp('2026-11-13T00:00:00')},
 {id:'night',calendarId:'work',title:'跨夜安排',start:stamp('2026-11-11T23:00:00'),end:stamp('2026-11-12T01:00:00')},
 {id:'ended',calendarId:'work',title:'零点已结束不计入',start:stamp('2026-11-11T23:00:00'),end:stamp('2026-11-12T00:00:00')},
 {id:'call',calendarId:'work',title:'飞书会议',start:stamp('2026-11-12T10:00:00'),end:stamp('2026-11-12T11:00:00')},
 {id:'hidden',calendarId:'hidden',title:'隐藏日历不计入',start:stamp('2026-11-12T08:00:00'),end:stamp('2026-11-12T09:00:00')},
 {id:'tomorrow',calendarId:'work',title:'明天不计入',start:stamp('2026-11-13T08:00:00'),end:stamp('2026-11-13T09:00:00')}]}};
 state.hiddenCalendars=['hidden'];state.tasks=[{id:'t',title:'定时待办',date:'2026-11-12',time:'09:00',done:true,notes:'备注 <检查>\\n第二行'},{id:'u',title:'未定时待办',date:'2026-11-12'},{id:'a',title:'归档不计入',date:'2026-11-12',archived:true},{id:'old',title:'昨日不计入',date:'2026-11-11'}];
 state.business=[{id:'b',title:'商务跟进',date:'2026-11-12',status:'waiting',subject:'演示客户'}];state.development=[{id:'d',title:'开发安排',date:'2026-11-12',startTime:'11:00',endTime:'12:00',status:'working',notes:'验收备注'}];state.finance=[{id:'f',date:'2026-11-12',title:'财务保密不计入'}];`);
 const original=app.json('({state,cache})');app.run('renderCalendar()');const html=app.element('agenda').innerHTML;
 const order=['全天安排','跨夜安排','定时待办','飞书会议','开发安排','未定时待办','商务跟进'];for(let i=1;i<order.length;i++)assert.ok(html.indexOf(order[i-1])<html.indexOf(order[i]),order.join(' → '));
 assert.match(html,/全天/);assert.match(html,/跨天/);assert.match(html,/11\/11–11\/12/);assert.match(html,/已完成/);assert.match(html,/等反馈/);assert.match(html,/09:00/);assert.match(html,/至 12:00/);assert.match(html,/备注 &lt;检查&gt;\n第二行/);assert.match(html,/data-schedule-source="feishu"/);assert.match(html,/data-schedule-source="local"/);
 assert.doesNotMatch(html,/零点已结束不计入|隐藏日历不计入|明天不计入|归档不计入|昨日不计入|财务保密不计入/);assert.equal(app.element('event-count').textContent,'11/12 · 7项');assert.deepEqual(app.json('({state,cache})'),original);
 app.run("select(C.fromKey('2026-11-13'),true)");assert.doesNotMatch(app.element('agenda').innerHTML,/全天安排|跨夜安排/);assert.match(app.element('agenda').innerHTML,/明天不计入/);
});

test('日程明细单击本机条目编辑原记录，修改日期时间完成和删除立即刷新，飞书保持详情入口',()=>{
 const app=appAt('2026-11-12T12:00:00+08:00');app.run("state.tasks=[{id:'t',title:'原待办',date:'2026-11-12',time:'10:00',done:false}];state.business=[{id:'b',title:'原商务',date:'2026-11-12',status:'planned'}];state.development=[{id:'d',title:'原开发',date:'2026-11-12',startTime:'11:00',endTime:'12:00',status:'working'}];renderCalendar()");
 const click=kind=>{const index=app.run(`agendaItems.findIndex(x=>x.kind===${JSON.stringify(kind)})`);app.element('agenda').onclick({target:{closest:()=>({dataset:{agendaIndex:String(index)}})}});};
 click('tasks');assert.equal(app.element('task-dialog-title').textContent,'编辑待办');assert.equal(app.element('task-title').value,'原待办');app.element('task-time').value='08:30';app.element('task-form').onsubmit({preventDefault(){}});assert.match(app.element('agenda').innerHTML,/08:30/);
 app.run("taskClick({target:{closest:s=>s==='[data-check]'?{dataset:{check:'t'}}:null}})");assert.match(app.element('agenda').innerHTML,/已完成/);
 click('business');assert.equal(app.element('record-title').value,'原商务');app.element('record-date').value='2026-11-13';app.element('record-form').onsubmit({preventDefault(){}});assert.doesNotMatch(app.element('agenda').innerHTML,/原商务/);
 click('development');assert.equal(app.element('record-title').value,'原开发');app.element('record-dialog').close();app.run("taskClick({target:{closest:s=>s==='[data-delete]'?{dataset:{delete:'t'}}:null}})");assert.doesNotMatch(app.element('agenda').innerHTML,/原待办/);
 app.run("demo=true;renderCalendar();showEvent=e=>{$('event-title').textContent=e.title}");click('feishu');assert.equal(app.element('event-title').textContent,'本周项目安排');
});

test('时间管理收起再展开保留复盘草稿和当前分页，记住收起状态且兼容旧数据',async()=>{
 const app=appAt('2026-10-26T12:00:00+08:00',{financeUnlocked:false});
 assert.equal(app.element('time-management-content').hidden,false);app.run("state.tasks=[{id:'t',date:'2026-10-26',title:'保留待办'}];switchDimension('review')");app.element('add-review').onclick();app.element('review-edit').value='未离开输入框的复盘\n第二行';app.element('review-edit').listeners.input();app.element('review-dialog').close();
 await app.element('time-management-toggle').onclick();assert.equal(app.element('time-management-content').hidden,true);assert.equal(app.run('state.activeDimension'),'review');app.run('persist()');const saved=JSON.parse(app.storage.get('zaichang-preview'));assert.equal(saved.timeManagementExpanded,false);assert.equal(saved.reviews[0].text,'未离开输入框的复盘\n第二行');assert.equal(saved.tasks[0].title,'保留待办');
 await app.element('time-management-toggle').onclick();assert.equal(app.element('time-management-content').hidden,false);assert.equal(app.element('review-edit').value,'未离开输入框的复盘\n第二行');assert.equal(app.run('state.activeDimension'),'review');
 app.storage.set('zaichang-preview',JSON.stringify(saved));await app.run('init()');assert.equal(app.element('time-management-content').hidden,true);assert.equal(app.run('state.activeDimension'),'all');assert.equal(app.json('state.tasks')[0].title,'保留待办');app.storage.set('zaichang-preview',JSON.stringify({tasks:saved.tasks}));await app.run('init()');assert.equal(app.element('time-management-content').hidden,false);
});

test('收起时间管理同时锁定已解锁财务，再展开不会直接显示账目',async()=>{
 const app=appAt('2026-10-26T12:00:00+08:00');app.run("state.finance=[{id:'f',title:'保密收入',amountCents:100,type:'income',status:'pending'}];switchDimension('finance');renderFinance()");assert.match(app.element('finance-records').innerHTML,/保密收入/);
 await app.element('time-management-toggle').onclick();assert.equal(app.element('time-management-content').hidden,true);assert.equal(app.run('financeUnlocked'),false);assert.equal(app.element('finance-records').innerHTML,'');assert.deepEqual(app.json('state.finance'),[]);await app.element('time-management-toggle').onclick();assert.equal(app.element('time-management-content').hidden,false);assert.equal(app.element('finance-content').hidden,true);assert.equal(app.element('badge-finance').textContent,'锁');
});

test('日历选择不改变六个累计列表、今日复盘或滚动位置',()=>{
 const app=appAt('2026-10-26T12:00:00+08:00');
 app.run("state.tasks=[{id:'old',date:'2026-10-20',title:'旧待办',done:false},{id:'new',date:'2026-10-26',title:'新待办',done:true}];state.business=[{id:'biz',date:'2026-10-19',title:'过往商务',status:'planned'}];state.thoughts={'2026-10-20':'历史思考','2026-10-26':'今日思考'};render()");
 const tasks=app.element('tasks').innerHTML,business=app.element('business-records').innerHTML,review=app.element('review-records').innerHTML;
 assert.ok(tasks.indexOf('旧待办')<tasks.indexOf('class="completion-heading"'));assert.ok(tasks.indexOf('新待办')>tasks.indexOf('class="completion-heading"'));assert.match(tasks,/data-timeline-date="2026-10-26"/);assert.equal(app.json('state.tasks')[0].date,'2026-10-20');assert.match(business,/过往商务/);assert.match(review,/历史思考/);
 app.element('business-records').scrollTop=85;app.run("select(C.fromKey('2025-01-01'))");
 assert.equal(app.element('tasks').innerHTML,tasks);assert.equal(app.element('business-records').innerHTML,business);assert.equal(app.element('business-records').scrollTop,85);assert.match(app.element('review-records').innerHTML,/今日思考/);assert.equal(app.element('review-records').innerHTML,review);
 app.run("openRecord('business')");assert.equal(app.element('record-date').value,'2026-10-26');app.run('openProject()');assert.equal(app.element('project-date').value,'2026-10-26');app.run('openFinance()');assert.equal(app.element('finance-date').value,'2026-10-26');
 app.element('task-input').value='不受月历影响的新待办';app.element('add-task').onsubmit({preventDefault(){}});assert.equal(app.json('state.tasks').at(-1).date,'2026-10-26');
});

test('待办时间可新增修改清空，重开与导出保留时间且兼容旧备注',async()=>{
 const app=appAt('2026-10-26T12:00:00+08:00');
 app.run("state.tasks=[{id:'old',title:'旧待办',date:'2026-10-20',notes:'旧备注保留在数据中',done:true,completedOn:'2026-10-21'}];openTask('old')");
 assert.equal(app.element('task-time').value,'');app.element('task-time').value='09:30';app.element('task-form').onsubmit({preventDefault(){}});
 const old=app.json('state.tasks')[0];assert.equal(old.time,'09:30');assert.equal(old.notes,'旧备注保留在数据中');assert.equal(old.done,true);assert.equal(old.completedOn,'2026-10-21');
 for(const id of ['tasks','all-records']){assert.match(app.element(id).innerHTML,/待办时间 09:30/);assert.doesNotMatch(app.element(id).innerHTML,/旧备注保留在数据中/);}
 app.element('task-input').value='有时间的新待办';app.element('task-input-time').value='18:45';app.element('add-task').onsubmit({preventDefault(){}});assert.equal(app.element('task-input-time').value,'');assert.equal(app.json('state.tasks')[1].time,'18:45');
 app.element('task-input').value='不填时间也能保存';app.element('add-task').onsubmit({preventDefault(){}});assert.equal(app.json('state.tasks')[2].time,'');
 app.run('persist()');await app.run('init()');app.run("openTask('old')");assert.equal(app.element('task-time').value,'09:30');
 app.element('task-time').value='10:15';app.element('task-form').onsubmit({preventDefault(){}});assert.match(app.element('all-records').innerHTML,/待办时间 10:15/);
 app.run("openTask('old')");app.element('task-time').value='';app.element('task-form').onsubmit({preventDefault(){}});assert.doesNotMatch(app.element('all-records').innerHTML,/待办时间 10:15/);assert.equal(app.json('state.tasks')[0].time,'');
 await app.element('export').onclick();const exported=JSON.parse(await app.downloads[0].text());assert.equal(exported.tasks[0].notes,'旧备注保留在数据中');assert.equal(exported.tasks[1].time,'18:45');
});

test('待办与一览使用今天起的同一顺序，编辑时间重排，换日顺延未完成并保留历史',()=>{
 const app=appAt('2026-12-31T23:59:00+08:00');
 app.run("state.tasks=[{id:'future',title:'明天任务',date:'2027-01-01',time:'08:00'},{id:'late',title:'晚间任务',date:'2026-12-31',time:'18:00'},{id:'early',title:'上午任务',date:'2026-12-31',time:'09:00'},{id:'carry',title:'过往未完成',date:'2026-12-20',time:'08:30'},{id:'done',title:'历史已完成',date:'2026-12-21',done:true}];render()");
 const order=()=>{for(const id of ['tasks','all-records']){let last=-1;for(const title of ['过往未完成','上午任务','晚间任务','明天任务','历史已完成']){const i=app.element(id).innerHTML.indexOf(title);assert.ok(i>last,id+': '+title);last=i;}assert.match(app.element(id).innerHTML,/class="completion-heading"[^>]*>已完成 · 1 项/);}};
 order();app.run("select(C.fromKey('2020-01-01'))");order();
 app.run("openTask('late')");app.element('task-time').value='08:00';app.element('task-form').onsubmit({preventDefault(){}});
 for(const id of ['tasks','all-records'])assert.ok(app.element(id).innerHTML.indexOf('晚间任务')<app.element(id).innerHTML.indexOf('过往未完成'));
 app.run("C.toggleTask(state.tasks.find(t=>t.id==='early'),new Date());render()");app.advance('2027-01-01T00:00:00+08:00');app.run('refreshDay()');
 for(const id of ['tasks','all-records']){const html=app.element(id).innerHTML;assert.match(html,/data-timeline-date="2027-01-01"/);assert.ok(html.indexOf('晚间任务')<html.indexOf('过往未完成'));assert.match(html,/class="completion-heading"[^>]*>已完成 · 2 项/);}
 assert.equal(app.json('state.tasks').find(t=>t.id==='carry').date,'2026-12-20');app.run("openTask('carry')");assert.equal(app.element('task-date').value,'2026-12-20');
});

test('待办项目商务开发和一览均完成置底，勾选恢复重开及归档视图保持一致',async()=>{
 const app=appAt('2026-11-06T12:00:00+08:00');
 app.run("state.tasks=[{id:'tasks-done',title:'完成待办',date:'2026-11-08',done:true},{id:'tasks-open',title:'未完成待办',date:'2026-10-01',time:'09:30',notes:'旧待办备注'}];state.projects=[{id:'projects-done',name:'旧版完成项目',date:'2026-11-08',status:'active',progress:100},{id:'projects-open',name:'未完成项目',date:'2026-10-01',status:'blocked',progress:65,nextStep:'原进度备注'}];state.business=[{id:'business-done',title:'完成商务',date:'2026-11-08',status:'done'},{id:'business-open',title:'未完成商务',date:'2026-10-01',status:'waiting',notes:'原商务备注'}];state.development=[{id:'development-done',title:'完成开发',date:'2026-11-08',status:'done'},{id:'development-open',title:'未完成开发',date:'2026-10-01',status:'blocked',startTime:'10:00',notes:'原开发备注'}];state.thoughts={'2026-10-01':'历史复盘保留'};state.memos=[{id:'memo',date:'2026-11-06',text:'备忘没有完成状态'}];render()");
 const pages={tasks:'tasks',projects:'projects',business:'business-records',development:'development-records'};
 const checkPage=(kind,allDone=false)=>{const html=app.element(pages[kind]).innerHTML,heading=html.indexOf('class="completion-heading"');assert.ok(heading>=0,kind);assert.ok(html.indexOf('data-edit-id="'+kind+'-done"')>heading);assert.equal(html.indexOf('data-edit-id="'+kind+'-open"')>heading,allDone);assert.doesNotMatch(html,/dimension-empty|<details/);};
 const before=app.json('state');for(const kind of Object.keys(pages)){checkPage(kind);app.element(pages[kind]).scrollTop=41;}assert.deepEqual(app.json('state'),before);
 let html=app.element('all-records').innerHTML;assert.match(html,/<summary>过往记录 · 1项/);assert.ok(html.indexOf('历史复盘保留')<html.indexOf('class="completion-heading"'));assert.match(html,/已完成 · 4 项/);assert.equal(app.element('badge-all').textContent,10);
 const click=kind=>{const row={dataset:{editKind:kind,editId:kind+'-open'}},selectors={tasks:'[data-check]',projects:'[data-project-check]',business:'[data-record-check]',development:'[data-record-check]'},key={tasks:'check',projects:'projectCheck',business:'recordCheck',development:'recordCheck'};app.element('all-records').onclick({target:{closest:selector=>selector==='[data-edit-kind]'?row:selector===selectors[kind]?{dataset:{[key[kind]]:kind+'-open'}}:null}});};
 for(const kind of Object.keys(pages)){
  click(kind);checkPage(kind,true);assert.equal(app.element(pages[kind]).scrollTop,41);assert.ok(app.element('all-records').innerHTML.indexOf('data-edit-id="'+kind+'-open"')>app.element('all-records').innerHTML.indexOf('class="completion-heading"'));
  click(kind);checkPage(kind);assert.equal(app.json('state.'+kind).find(r=>r.id===kind+'-open').date,'2026-10-01');
 }
 assert.equal(app.json('state.projects')[1].progress,65);assert.equal(app.json('state.projects')[1].status,'blocked');assert.equal(app.json('state.business')[1].status,'waiting');assert.equal(app.json('state.development')[1].status,'blocked');assert.equal(app.json('state.projects')[1].nextStep,'原进度备注');
 app.run("state.projects.push({id:'archived-open',name:'归档未完成',date:'2026-10-01',archived:true},{id:'archived-done',name:'归档已完成',date:'2026-11-08',status:'done',archived:true});showArchived=true;renderProjects()");html=app.element('projects').innerHTML;assert.ok(html.indexOf('归档未完成')<html.indexOf('class="completion-heading"'));assert.ok(html.indexOf('归档已完成')>html.indexOf('class="completion-heading"'));assert.doesNotMatch(app.element('all-records').innerHTML,/归档未完成|归档已完成/);
 app.run('showArchived=false;persist()');await app.run('init()');for(const kind of Object.keys(pages))checkPage(kind);assert.match(app.element('all-records').innerHTML,/已完成 · 4 项/);assert.equal(app.json('state.thoughts')['2026-10-01'],'历史复盘保留');
 app.run('state.tasks=[];renderTasks()');assert.doesNotMatch(app.element('tasks').innerHTML,/completion-heading/);assert.match(app.element('tasks').innerHTML,/写下第一条待办/);
});

test('项目进度备注替代固定状态与百分比，编辑旧项目保留完成恢复信息',()=>{
 const app=appAt('2026-10-26T12:00:00+08:00');
 app.run("state.projects=[{id:'p',name:'示例项目',date:'2026-10-20',status:'blocked',progress:65,nextStep:'原来的下一步',archived:false}];render();openProject('p')");
 assert.equal(app.element('project-next').value,'原来的下一步');
 app.element('project-next').value='方案已确认\n等待 <客户> 回复';app.element('project-form').onsubmit({preventDefault(){}});
 for(const id of ['all-records','projects']){const html=app.element(id).innerHTML;assert.match(html,/方案已确认\n等待 &lt;客户&gt; 回复/);assert.doesNotMatch(html,/进行中|65%|project-status/);}
 let project=app.json('state.projects')[0];assert.equal(project.progress,65);assert.equal(project.status,'blocked');
 app.run("C.toggleProject(state.projects[0]);openProject('p')");app.element('project-next').value='已经交付，保留说明';app.element('project-form').onsubmit({preventDefault(){}});
 project=app.json('state.projects')[0];assert.equal(Core.projectDone(project),true);assert.equal(project.resumeProgress,65);assert.equal(project.resumeStatus,'blocked');
 app.run('C.toggleProject(state.projects[0]);persist()');project=JSON.parse(app.storage.get('zaichang-preview')).projects[0];assert.equal(Core.projectDone(project),false);assert.equal(project.progress,65);assert.equal(project.status,'blocked');assert.equal(project.nextStep,'已经交付，保留说明');
});

test('新项目只填写名称日期和进度备注，空备注不显示默认百分比',()=>{
 const app=appAt('2026-10-26T12:00:00+08:00');app.run('openProject()');app.element('project-name').value='新项目';app.element('project-next').value='本周完成初稿';app.element('project-form').onsubmit({preventDefault(){}});
 assert.equal(app.json('state.projects').length,1);assert.match(app.element('all-records').innerHTML,/本周完成初稿/);assert.equal(app.element('project-dialog').open,false);
 app.run("openProject(state.projects[0].id)");app.element('project-next').value='';app.element('project-form').onsubmit({preventDefault(){}});assert.doesNotMatch(app.element('all-records').innerHTML,/进行中|0%|本周完成初稿/);assert.equal(app.json('state.projects')[0].nextStep,'');
});

test('同一天每次新增独立复盘，可提交修改再新增，重开搜索和导出均不覆盖',async()=>{
 const app=appAt('2026-11-08T12:00:00+08:00');app.run("state.thoughts={'2026-11-08':'原有当天复盘','2026-11-07':'历史原文'};switchDimension('review');renderThought()");
 assert.doesNotMatch(app.element('review-records').innerHTML,/id="thought"/);app.element('add-review').onclick();assert.equal(app.element('review-edit').value,'');assert.equal(await app.element('submit-review').onclick(),false);assert.deepEqual(app.json('state.reviews'),[]);
 const text='第一条复盘\n<script>保留原文</script>';app.element('review-edit').value=text;app.element('review-edit').listeners.input();await app.element('submit-review').onclick();const first=app.json('state.reviews')[0];assert.ok(first.submittedAt);assert.equal(app.element('review-dialog').open,false);assert.match(app.element('review-records').innerHTML,/&lt;script&gt;/);
 app.element('add-review').onclick();assert.equal(app.element('review-edit').value,'');app.advance('2026-11-08T12:01:00+08:00');app.element('review-edit').value='第二条复盘';app.element('review-edit').listeners.input();await app.element('submit-review').onclick();let records=app.json('state.reviews');assert.equal(records.length,2);assert.notEqual(records[0].id,records[1].id);assert.equal(records[0].date,records[1].date);assert.equal(records[0].text,text);const second=records[1];
 assert.ok(app.element('review-records').innerHTML.indexOf('第二条复盘')<app.element('review-records').innerHTML.indexOf('第一条复盘'));assert.equal(app.element('badge-review').textContent,4);assert.equal(app.element('badge-all').textContent,4);assert.match(app.element('calendar').innerHTML,/2026-11-08，有复盘/);
 app.run(`openReview('${first.id}')`);app.element('review-edit').value='第一条修改后';app.element('review-edit').listeners.input();assert.equal(app.json('state.reviews')[0].submittedAt,undefined);assert.equal(app.json('state.reviews')[1].submittedAt,second.submittedAt);await app.element('submit-review').onclick();assert.equal(app.json('state.reviews')[0].id,first.id);assert.equal(app.json('state.reviews')[1].text,'第二条复盘');
 await app.run('init()');assert.equal(app.json('state.reviews').length,2);assert.equal(app.json('state.thoughts')['2026-11-08'],'原有当天复盘');assert.equal(app.json('state.thoughts')['2026-11-07'],'历史原文');app.element('thought-history').onclick();app.element('history-search').value='条';app.element('history-search').oninput();assert.match(app.element('history-count').textContent,/找到 2 条/);assert.match(app.element('history-list').innerHTML,new RegExp(first.id));assert.match(app.element('history-list').innerHTML,new RegExp(second.id));
 await app.element('export').onclick();const exported=JSON.parse(await app.downloads[0].text());assert.equal(exported.reviews.length,2);assert.equal(exported.reviews[0].text,'第一条修改后');assert.equal(exported.reviews[1].text,'第二条复盘');assert.ok(exported.reviews.every(r=>r.submittedAt));assert.equal(exported.thoughts['2026-11-08'],'原有当天复盘');
 app.element('add-review').onclick();assert.equal(app.element('review-edit').value,'');app.element('review-dialog').close();assert.equal(app.json('state.reviews').length,2);
});

test('复盘提交失败保留该条草稿，等待保存期间阻止重复提交，跨日不改变原日期',async()=>{
 const app=appAt('2026-11-08T23:59:59+08:00',{native:true,financeUnlocked:false});app.element('add-review').onclick();app.element('review-edit').value='不能丢失的草稿';app.element('review-edit').listeners.input();const id=app.json('state.reviews')[0].id;
 const submitting=app.element('submit-review').onclick();assert.equal(app.messages.length,1);assert.equal(app.element('add-review').disabled,true);assert.equal(app.element('review-edit').disabled,true);assert.equal(await app.element('submit-review').onclick(),false);assert.equal(app.messages.length,1);assert.doesNotMatch(app.element('toast').textContent,/已提交/);
 app.run(`window.nativeResponse(${app.messages[0].id},null,'保存失败')`);assert.equal(await submitting,false);assert.equal(app.json('state.reviews')[0].text,'不能丢失的草稿');assert.equal(app.json('state.reviews')[0].submittedAt,undefined);assert.equal(app.element('review-dialog').open,true);assert.equal(app.element('add-review').disabled,false);assert.match(app.element('review-feedback').textContent,/提交未完成/);
 const retry=app.element('submit-review').onclick(),message=app.messages.at(-1);app.advance('2026-11-09T00:00:01+08:00');app.run('refreshDay()');app.run(`window.nativeResponse(${message.id},true)`);assert.equal(await retry,true);assert.equal(app.json('state.reviews')[0].date,'2026-11-08');assert.equal(app.json('state.reviews')[0].id,id);assert.ok(app.json('state.reviews')[0].submittedAt);app.element('add-review').onclick();assert.equal(app.element('review-date').value,'2026-11-09');assert.equal(app.element('review-edit').value,'');
 const preview=appAt('2026-11-08T12:00:00+08:00');preview.run("openNewReview('2026-11-07')");preview.element('review-edit').value='历史草稿';preview.element('review-edit').listeners.input();preview.run("localStorage.setItem=()=>{throw Error('full')}");assert.equal(await preview.element('submit-review').onclick(),false);assert.equal(preview.element('review-dialog').open,true);assert.equal(preview.json('state.reviews')[0].text,'历史草稿');assert.equal(preview.json('state.reviews')[0].submittedAt,undefined);
});

test('旧版每日复盘仍可修改提交，同日补写新增不覆盖旧文，重复提交不改时间',async()=>{
 const app=appAt('2026-11-08T12:00:00+08:00');app.storage.set('zaichang-preview',JSON.stringify({thoughts:{'2026-11-08':'今天旧稿','2026-11-06':'旧版历史'},reviews:null,reviewSubmitted:[]}));await app.run('init()');assert.deepEqual(app.json('state.reviews'),[]);
 app.run("openReview('2026-11-06')");assert.equal(app.element('review-date').disabled,true);assert.equal(app.element('review-edit').value,'旧版历史');await app.element('submit-review').onclick();const stamp=app.json('state.reviewSubmitted')['2026-11-06'];assert.ok(stamp);assert.equal(app.json('state.thoughts')['2026-11-08'],'今天旧稿');
 app.advance('2026-11-08T13:00:00+08:00');app.run("openReview('2026-11-06')");await app.element('submit-review').onclick();assert.equal(app.json('state.reviewSubmitted')['2026-11-06'],stamp);
 app.run("openNewReview('2026-11-06')");assert.equal(app.element('review-edit').value,'');assert.equal(app.element('review-date').disabled,false);app.element('review-edit').value='同日新增补写';app.element('review-edit').listeners.input();await app.element('submit-review').onclick();assert.equal(app.json('state.thoughts')['2026-11-06'],'旧版历史');assert.equal(app.json('state.reviews')[0].date,'2026-11-06');assert.equal(app.json('state.reviews')[0].text,'同日新增补写');
 app.run("openReview('2026-11-06')");app.element('review-edit').value='旧文修改';app.element('review-edit').listeners.input();await app.element('submit-review').onclick();assert.equal(app.json('state.thoughts')['2026-11-06'],'旧文修改');assert.equal(app.json('state.reviews')[0].text,'同日新增补写');
 await app.run('init()');assert.equal(app.json('state.thoughts')['2026-11-06'],'旧文修改');assert.equal(app.json('state.reviews').length,1);
});

test('跨年期间同一草稿保留原日期，点击新增才创建新一天记录',()=>{
 const app=appAt('2026-12-31T23:59:59+08:00');app.element('add-review').onclick();app.element('review-edit').value='跨年之前的复盘\n还没离开输入框';app.element('review-edit').listeners.input();
 app.advance('2027-01-01T00:00:00+08:00');assert.equal(app.run('refreshDay()'),true);const saved=JSON.parse(app.storage.get('zaichang-preview'));assert.equal(saved.reviews[0].date,'2026-12-31');assert.equal(saved.reviews[0].text,'跨年之前的复盘\n还没离开输入框');assert.equal(app.element('review-date').value,'2026-12-31');assert.match(app.element('review-records').innerHTML,/跨年之前的复盘/);
 app.element('review-dialog').close();app.element('add-review').onclick();assert.equal(app.element('review-edit').value,'');assert.equal(app.element('review-date').value,'2027-01-01');app.element('review-edit').value='新一天的思考';app.element('review-edit').listeners.input();app.run("select(C.fromKey('2026-12-31'))");assert.equal(app.json('state.reviews')[1].date,'2027-01-01');assert.equal(app.json('state.reviews')[1].text,'新一天的思考');assert.equal(app.json('state.reviews')[0].date,'2026-12-31');
});

test('补写草稿跨日继续编辑，修改日期只移动本条，不覆盖已有同日内容',()=>{
 const app=appAt('2026-10-26T21:00:00+08:00');app.run("state.thoughts={'2026-10-20':'原有旧文'};openNewReview('2026-10-20')");app.element('review-edit').value='补写二十日';app.element('review-edit').listeners.input();const id=app.json('state.reviews')[0].id;
 app.advance('2026-10-28T08:00:00+08:00');app.run('refreshDay()');app.element('review-edit').value='二十日继续补写';app.element('review-edit').listeners.input();assert.equal(app.json('state.reviews')[0].text,'二十日继续补写');assert.equal(app.json('state.thoughts')['2026-10-20'],'原有旧文');
 app.element('review-date').value='2026-10-21';app.element('review-date').onchange();assert.equal(app.json('state.reviews')[0].id,id);assert.equal(app.json('state.reviews')[0].date,'2026-10-21');assert.equal(app.json('state.thoughts')['2026-10-20'],'原有旧文');app.element('review-date').value='2030-01-01';app.element('review-date').onchange();assert.equal(app.json('state.reviews')[0].date,'2026-10-21');assert.match(app.element('review-records').innerHTML,/二十日继续补写/);
});

test('商务开发财务按日期累计，持久化和导出包含六个维度',async()=>{
 const app=appAt('2026-10-26T12:00:00+08:00');
 app.run("openRecord('business')");app.element('record-title').value='确认合作方案';app.element('record-subject').value='示例客户';app.element('record-status').value='waiting';app.element('record-notes').value='等待反馈';app.element('record-form').onsubmit({preventDefault(){}});
 app.run("openRecord('development')");app.element('record-title').value='开发日程视图';app.element('record-subject').value='桌面工具';app.element('record-status').value='working';app.element('record-start').value='10:00';app.element('record-end').value='11:30';app.element('record-form').onsubmit({preventDefault(){}});
 app.run('openFinance()');app.element('finance-title').value='项目尾款';app.element('finance-type').value='income';app.element('finance-amount').value='100.01';app.element('finance-status').value='pending';app.element('finance-form').onsubmit({preventDefault(){}});
 app.run("switchDimension('finance');select(C.fromKey('2026-09-01'))");assert.equal(app.element('panel-finance').hidden,false);assert.match(app.element('finance-records').innerHTML,/项目尾款/);assert.match(app.element('business-records').innerHTML,/确认合作方案/);
 app.run('persist()');const saved=JSON.parse(app.storage.get('zaichang-preview'));assert.equal(saved.finance[0].amountCents,10001);assert.equal(saved.business.length,1);assert.equal(saved.development.length,1);
 await app.element('export').onclick();const exported=JSON.parse(await app.downloads[0].text());assert.equal(exported.finance[0].amountCents,10001);assert.equal(exported.development[0].title,'开发日程视图');assert.equal(exported.financeIncluded,true);assert.deepEqual(exported.calendarEvents,[]);assert.deepEqual(exported.calendarCache,{});
 app.run("openFinance(state.finance[0].id)");app.element('archive-finance').onclick();assert.equal(app.json('state.finance')[0].archived,true);assert.doesNotMatch(app.element('finance-records').innerHTML,/项目尾款/);app.element('finance-archived').onclick();assert.match(app.element('finance-records').innerHTML,/项目尾款/);app.run("openFinance(state.finance[0].id)");app.element('archive-finance').onclick();assert.equal(app.json('state.finance')[0].archived,false);assert.match(app.element('finance-records').innerHTML,/项目尾款/);
});

test('财务无效金额不覆盖已保存账目，编辑可结清，内容按纯文本转义',()=>{
 const app=appAt('2026-10-26T12:00:00+08:00');app.run("state.finance=[{id:'money',date:'2026-10-25',title:'旧账目',amountCents:123,type:'expense',status:'pending'}];openFinance('money')");app.element('finance-amount').value='1.005';app.element('finance-form').onsubmit({preventDefault(){}});assert.equal(app.json('state.finance')[0].amountCents,123);assert.match(app.element('finance-feedback').textContent,/最多两位小数/);
 app.element('finance-amount').value='12.30';app.element('finance-title').value='<script>示例</script>';app.element('finance-status').value='settled';app.element('finance-form').onsubmit({preventDefault(){}});assert.equal(app.json('state.finance')[0].amountCents,1230);assert.equal(app.json('state.finance')[0].status,'settled');assert.match(app.element('finance-records').innerHTML,/&lt;script&gt;/);assert.doesNotMatch(app.element('finance-records').innerHTML,/<script>/);
});

test('开发记录时间校验失败不覆盖已有数据',()=>{
 const app=appAt('2026-10-26T12:00:00+08:00');app.run("openRecord('development')");app.element('record-title').value='错误时段';app.element('record-start').value='17:00';app.element('record-end').value='16:00';app.element('record-form').onsubmit({preventDefault(){}});
 assert.equal(app.json('state.development').length,0);assert.match(app.element('record-feedback').textContent,/结束时间/);
});

test('月历直接显示飞书和本机时间，优先有时间的安排，完整摘要保留其余事项且不改原数据',()=>{
 const app=appAt('2026-11-12T12:00:00+08:00');
 app.run("demo=false;cache={'2026-11':{syncedAt:1,events:[{id:'all-day',title:'全天活动',allDay:true,start:new Date('2026-11-12T00:00:00+08:00').getTime(),end:new Date('2026-11-13T00:00:00+08:00').getTime()},{id:'late',title:'晚会',start:new Date('2026-11-12T18:00:00+08:00').getTime(),end:new Date('2026-11-12T19:00:00+08:00').getTime()},{id:'early',title:'<早会>',start:new Date('2026-11-12T01:30:00Z').getTime(),end:new Date('2026-11-12T02:30:00Z').getTime()}]}};state.business=[{id:'b',title:'商务事项',date:'2026-11-12'}];state.development=[{id:'d',title:'开发安排',date:'2026-11-12',startTime:'14:00',endTime:'15:00'}];state.tasks=[{id:'t',title:'个人待办',date:'2026-11-12',time:'18:45',done:false},{id:'done',title:'已完成不显示',date:'2026-11-12',time:'07:00',done:true}]");
 const original=app.json('({tasks:state.tasks,business:state.business,development:state.development,cache})');app.run('renderCalendar()');const day=app.element('calendar').innerHTML.match(/data-day="2026-11-12"[\s\S]*?<\/button>/)[0];
 assert.match(day,/data-schedule-source="feishu"><span class="day-event-clock">09:30<\/span><span class="day-event-label">&lt;早会&gt;<\/span>/);assert.match(day,/data-schedule-source="local"><span class="day-event-clock">14:00<\/span><span class="day-event-label">开发安排<\/span>/);assert.match(day,/09:30–10:30/);assert.match(day,/18:00–19:00/);assert.match(day,/全天 全天活动/);assert.match(day,/14:00–15:00 开发安排/);assert.match(day,/18:45 个人待办/);assert.match(day,/商务事项/);assert.doesNotMatch(day,/<早会>|已完成不显示/);assert.equal((day.match(/day-source-more">\+2/g)||[]).length,2);assert.deepEqual(app.json('({tasks:state.tasks,business:state.business,development:state.development,cache})'),original);
});

test('月历全天、跨天、零点和本机截止时间分别展示，不给未填时间的事项编造时刻',()=>{
 const app=appAt('2026-11-12T12:00:00+08:00');
 app.run("demo=false;cache={'2026-11':{events:[{id:'cross',title:'跨夜安排',start:new Date('2026-11-12T23:00:00+08:00').getTime(),end:new Date('2026-11-13T09:00:00+08:00').getTime()}]}};renderCalendar()");
 const calendar=app.element('calendar').innerHTML,first=calendar.match(/data-day="2026-11-12"[\s\S]*?<\/button>/)[0],next=calendar.match(/data-day="2026-11-13"[\s\S]*?<\/button>/)[0];assert.match(first,/day-event-clock">23:00<\/span>/);assert.match(next,/day-event-clock">跨天<\/span>/);assert.match(next,/2026-11-12 23:00–2026-11-13 09:00/);
 assert.equal(app.run("calendarClock({allDay:true},'feishu','2026-11-12')"),'全天');assert.equal(app.run("calendarClock({start:new Date('2026-11-12T00:00:00+08:00').getTime()},'feishu','2026-11-12')"),'00:00');assert.equal(app.run("calendarClock({endTime:'17:00'},'local','2026-11-12')"),'至17:00');assert.equal(app.run("calendarClock({title:'未填时间'},'local','2026-11-12')"),'');assert.equal(app.run("calendarClock({time:'25:99'},'local','2026-11-12')"),'');assert.equal(app.run("calendarClock({},'feishu','2026-11-12')"),'');
});

test('月历横向手势翻月，纵向滚动和横向惯性不会连续误翻',()=>{
 const app=appAt('2026-10-31T12:00:00+08:00'),calendar=app.element('calendar');
 calendar.listeners.wheel({deltaX:1,deltaY:50,preventDefault(){throw Error('不应拦截纵向滚动');}});assert.equal(app.run('C.key(selected)'),'2026-10-31');
 const swipe={deltaX:40,deltaY:0,preventDefault(){}};calendar.listeners.wheel(swipe);calendar.listeners.wheel(swipe);assert.equal(app.run('C.key(selected)'),'2026-11-30');
 calendar.listeners.wheel({...swipe,deltaX:120});assert.equal(app.run('C.key(selected)'),'2026-11-30');
 app.advance('2026-10-31T12:00:01+08:00');calendar.listeners.wheel({...swipe,deltaX:-80});assert.equal(app.run('C.key(selected)'),'2026-10-30');
 calendar.listeners.pointerdown({button:0,isPrimary:true,clientX:200,clientY:50});calendar.listeners.pointerup({clientX:100,clientY:53});assert.equal(app.run('C.key(selected)'),'2026-11-30');
});

test('财务录入和双击编辑可依次推进三个阶段至总营收，翻月不影响汇总',async()=>{
 const app=appAt('2026-10-26T12:00:00+08:00');app.run('openFinance()');assert.equal(app.element('finance-type').value,'income');assert.equal(app.element('finance-status').value,'negotiating');for(const label of ['待接洽','待交付','待结算','已结算（实际营收）'])assert.ok(app.element('finance-status').innerHTML.includes(label));assert.equal(app.element('finance-status-label').textContent,'财务阶段');app.element('finance-title').value='示例合作';app.element('finance-amount').value='123.45';await app.element('finance-form').onsubmit({preventDefault(){}});
 assert.equal(app.json('state.finance')[0].status,'negotiating');assert.equal(app.element('finance-negotiating').textContent,'123.45');assert.equal(app.element('finance-pending').textContent,'0.00');app.run("select(C.fromKey('2020-01-01'))");assert.equal(app.element('finance-negotiating').textContent,'123.45');
 const row={dataset:{editKind:'finance',editId:app.json('state.finance')[0].id}},target={closest:s=>s==='[data-edit-kind]'?row:null};app.element('finance-records').ondblclick({target});assert.equal(app.element('finance-dialog').open,true);app.element('finance-status').value='delivery';await app.element('finance-form').onsubmit({preventDefault(){}});assert.equal(app.json('state.finance')[0].status,'delivery');assert.equal(app.element('finance-negotiating').textContent,'0.00');assert.equal(app.element('finance-delivery').textContent,'123.45');assert.equal(app.element('finance-revenue').textContent,'0.00');assert.match(app.element('finance-records').innerHTML,/待交付/);
 app.run('openFinance(state.finance[0].id)');assert.equal(app.element('finance-status').value,'delivery');app.element('finance-status').value='pending';await app.element('finance-form').onsubmit({preventDefault(){}});assert.equal(app.element('finance-delivery').textContent,'0.00');assert.equal(app.element('finance-pending').textContent,'123.45');
 app.run('openFinance(state.finance[0].id)');app.element('finance-status').value='settled';await app.element('finance-form').onsubmit({preventDefault(){}});assert.equal(app.element('finance-pending').textContent,'0.00');assert.equal(app.element('finance-revenue').textContent,'123.45');assert.match(app.element('finance-records').innerHTML,/已结算/);app.run('openFinance(state.finance[0].id)');await app.element('archive-finance').onclick();assert.equal(app.element('finance-revenue').textContent,'0.00');
 app.run('openFinance()');app.element('finance-status').value='delivery';app.element('finance-type').value='expense';app.element('finance-type').onchange();assert.equal(app.element('finance-status').value,'pending');assert.equal(app.element('finance-status-label').textContent,'付款状态');assert.doesNotMatch(app.element('finance-status').innerHTML,/接洽|交付|营收/);
});

test('财务无勾选框，下一阶段结算仍可保存并通过编辑退回原阶段',async()=>{
 const app=appAt('2026-10-30T12:00:00+08:00');
 app.run("state.finance=[{id:'pending',date:'2026-10-28',title:'项目尾款',type:'income',status:'pending',amountCents:12345,party:'示例客户',notes:'保留原备注'},{id:'settled',date:'2026-10-29',title:'已到账',type:'income',status:'settled',amountCents:20000}];switchDimension('finance');renderFinance()");
 assert.doesNotMatch(app.element('finance-records').innerHTML,/type="checkbox"|finance-check/);app.element('finance-records').scrollTop=45;
 await app.run("advanceFinance('pending','pending','settled')");const record=app.json('state.finance')[0];assert.equal(record.status,'settled');assert.equal(record.amountCents,12345);assert.equal(record.date,'2026-10-28');assert.equal(record.party,'示例客户');assert.equal(record.notes,'保留原备注');
 assert.equal(app.element('finance-pending').textContent,'0.00');assert.equal(app.element('finance-revenue').textContent,'323.45');assert.equal(app.element('finance-forecast').textContent,'323.45');assert.equal(app.element('finance-records').scrollTop,45);assert.equal(app.element('finance-dialog').open,false);assert.doesNotMatch(app.element('finance-records').innerHTML,/type="checkbox"|finance-check/);
 const snapshot=app.json('state.finance');await app.run("advanceFinance('pending','pending','settled')");assert.deepEqual(app.json('state.finance'),snapshot);
 await app.run('init()');app.run("financeUnlocked=true;switchDimension('finance');openFinance('pending')");assert.equal(app.element('finance-status').value,'settled');app.element('finance-status').value='pending';await app.element('finance-form').onsubmit({preventDefault(){}});assert.equal(app.json('state.finance')[0].status,'pending');assert.equal(app.element('finance-pending').textContent,'123.45');assert.equal(app.element('finance-revenue').textContent,'200.00');assert.equal(app.element('finance-forecast').textContent,'323.45');
 await app.element('export').onclick();const exported=JSON.parse(await app.downloads[0].text());assert.equal(exported.finance[0].status,'pending');assert.equal(exported.finance[0].amountCents,12345);
});

test('财务已结算跨日期统一置底，推进及编辑立即重排，归档和重开保留规则',async()=>{
 const app=appAt('2026-10-30T12:00:00+08:00');
 app.run("state.finance=[{id:'settled-future',title:'未来已结算',date:'2027-01-01',type:'income',status:'settled',amountCents:10000},{id:'old-pending',title:'过往待结算',date:'2026-09-01',type:'income',status:'pending',amountCents:20000,notes:'原备注'},{id:'today-settled',title:'今日已结算',date:'2026-10-30',type:'income',status:'settled',amountCents:30000},{id:'today-pending',title:'今日待结算',date:'2026-10-30',type:'income',status:'pending',amountCents:40000},{id:'future-delivery',title:'未来待交付',date:'2026-11-01',type:'income',status:'delivery',amountCents:50000},{id:'expense-settled',title:'已结清支出',date:'2026-10-31',type:'expense',status:'settled',amountCents:1000},{id:'undated',title:'无日期待接洽',type:'income',status:'negotiating',amountCents:2000},{id:'archived-settled',title:'归档已结算',date:'2026-11-01',type:'income',status:'settled',amountCents:100,archived:true},{id:'archived-pending',title:'归档待结算',date:'2026-09-01',type:'income',status:'pending',amountCents:100,archived:true}];switchDimension('finance');renderFinance()");
 const ids=()=>[...app.element('finance-records').innerHTML.matchAll(/data-edit-kind="finance" data-edit-id="([^"]+)"/g)].map(m=>m[1]);
 const original=app.json('state.finance');
 assert.deepEqual(ids(),['undated','future-delivery','today-pending','old-pending','settled-future','expense-settled','today-settled']);assert.deepEqual(app.json('state.finance'),original);
 assert.ok(app.element('finance-records').innerHTML.indexOf('data-finance-group="delivery"')<app.element('finance-records').innerHTML.indexOf('data-finance-group="pending"'));assert.equal((app.element('finance-records').innerHTML.match(/finance-settled-heading/g)||[]).length,1);assert.match(app.element('finance-records').innerHTML,/已结算 \/ 已结清 · 3 笔/);
 const change=async(id,settled)=>{if(settled)return app.run(`advanceFinance('${id}','pending','settled')`);app.run(`openFinance('${id}')`);app.element('finance-status').value='pending';await app.element('finance-form').onsubmit({preventDefault(){}});};
 await change('today-pending',true);assert.deepEqual(ids(),['undated','future-delivery','old-pending','settled-future','expense-settled','today-pending','today-settled']);assert.equal(app.element('finance-revenue').textContent,'800.00');
 await change('settled-future',false);assert.ok(ids().indexOf('settled-future')>ids().indexOf('future-delivery'));assert.ok(ids().indexOf('settled-future')<ids().indexOf('old-pending'));assert.equal(app.element('finance-revenue').textContent,'700.00');
 app.run("openFinance('old-pending')");app.element('finance-status').value='settled';await app.element('finance-form').onsubmit({preventDefault(){}});assert.equal(ids().at(-1),'old-pending');assert.equal(app.json('state.finance').find(r=>r.id==='old-pending').date,'2026-09-01');assert.equal(app.json('state.finance').find(r=>r.id==='old-pending').notes,'原备注');
 app.element('finance-archived').onclick();assert.deepEqual(ids(),['archived-pending','archived-settled']);app.element('finance-archived').onclick();app.run('persist()');await app.run('init()');app.run("financeUnlocked=true;switchDimension('finance');renderFinance()");assert.deepEqual(ids(),['undated','future-delivery','settled-future','expense-settled','today-pending','today-settled','old-pending']);
 app.run("state.finance=state.finance.filter(r=>r.status==='settled'&&!r.archived);renderFinance()");assert.doesNotMatch(app.element('finance-records').innerHTML,/dimension-empty/);assert.equal(ids().length,4);
 app.run('state.finance=[];renderFinance()');assert.match(app.element('finance-records').innerHTML,/点击“记一笔”/);assert.doesNotMatch(app.element('finance-records').innerHTML,/finance-settled-heading/);
});

test('财务各类账目及归档最近删除均无勾选框，下一阶段与编辑入口继续可用',()=>{
 const app=appAt('2026-10-30T12:00:00+08:00');
 app.run("state.finance=[{id:'n',type:'income',status:'negotiating',title:'接洽',amountCents:100},{id:'d',type:'income',status:'delivery',title:'交付',amountCents:200},{id:'p',type:'income',status:'pending',title:'待结算',amountCents:300},{id:'s',type:'income',status:'settled',title:'已结算',amountCents:400},{id:'expense',type:'expense',status:'pending',title:'支出',amountCents:500},{id:'archived',type:'income',status:'pending',title:'归档',amountCents:600,archived:true},{id:'deleted',type:'income',status:'pending',title:'删除',amountCents:700,deletedAt:123}];renderFinance()");
 const original=app.json('state.finance');assert.doesNotMatch(app.element('finance-records').innerHTML,/type="checkbox"|finance-check/);for(const id of ['n','d','p'])assert.ok(app.element('finance-records').innerHTML.includes('data-finance-advance="'+id+'"'));for(const id of ['s','expense','archived','deleted'])assert.ok(!app.element('finance-records').innerHTML.includes('data-finance-advance="'+id+'"'));
 app.element('finance-archived').onclick();assert.match(app.element('finance-records').innerHTML,/归档/);assert.doesNotMatch(app.element('finance-records').innerHTML,/type="checkbox"|finance-check/);app.element('finance-deleted').onclick();assert.match(app.element('finance-records').innerHTML,/删除/);assert.doesNotMatch(app.element('finance-records').innerHTML,/type="checkbox"|finance-check/);assert.deepEqual(app.json('state.finance'),original);
 app.run("openFinance('s')");assert.equal(app.element('finance-status').value,'settled');app.run('clearFinance()');assert.equal(app.element('finance-records').innerHTML,'');assert.equal(app.element('finance-revenue').textContent,'•••');
});

test('点击财务四阶段筛选对应收入，全部显示支出，结算及改阶段立即更新明细与金额',async()=>{
 const app=appAt('2026-11-10T12:00:00+08:00');
 app.run("state.finance=[{id:'a',title:'接洽收入',type:'income',status:'negotiating',amountCents:100},{id:'b',title:'交付收入',type:'income',status:'delivery',amountCents:200},{id:'c',title:'待结算收入',type:'income',status:'pending',amountCents:300},{id:'d',title:'已结算收入',type:'income',status:'settled',amountCents:400},{id:'expense',title:'日常支出',type:'expense',status:'pending',amountCents:500},{id:'archive',title:'归档示例',type:'income',status:'pending',amountCents:600,archived:true},{id:'deleted',title:'已删除示例',type:'income',status:'settled',amountCents:700,deletedAt:123}];renderFinance()");
 const ids=()=>[...app.element('finance-records').innerHTML.matchAll(/data-edit-id="([^"]+)"/g)].map(m=>m[1]);
 for(const [stage,id] of [['negotiating','a'],['delivery','b'],['pending','c'],['revenue','d']]){app.element('finance-stage-'+stage).onclick();assert.deepEqual(ids(),[id]);assert.equal(app.element('finance-stage-'+stage).attributes['aria-pressed'],'true');}
 app.element('finance-stage-pending').onclick();await app.run("advanceFinance('c','pending','settled')");assert.deepEqual(ids(),[]);assert.match(app.element('finance-records').innerHTML,/当前阶段暂无账目/);assert.equal(app.element('finance-pending').textContent,'0.00');assert.equal(app.element('finance-revenue').textContent,'7.00');
 app.element('finance-stage-revenue').onclick();assert.deepEqual(ids(),['c','d']);app.run("openFinance('d')");app.element('finance-status').value='delivery';await app.element('finance-form').onsubmit({preventDefault(){}});assert.deepEqual(ids(),['c']);assert.equal(app.element('finance-delivery').textContent,'6.00');
 app.element('finance-all').onclick();assert.ok(ids().includes('expense'));assert.equal(ids().length,5);app.element('finance-archived').onclick();assert.deepEqual(ids(),['archive']);app.element('finance-stage-pending').onclick();assert.deepEqual(ids(),[]);assert.equal(app.run('showFinanceArchived'),false);
 app.run('clearFinance()');app.element('finance-stage-delivery').onclick();assert.equal(app.run('financeStage'),'all');assert.equal(app.element('finance-records').innerHTML,'');assert.equal(app.element('finance-delivery').textContent,'•••');
});

test('财务列表单击下一阶段逐步转移金额，筛选同步移出，保留内容并可编辑调整阶段',async()=>{
 const app=appAt('2026-11-10T12:00:00+08:00');app.run("state.finance=[{id:'a',title:'演示合作',type:'income',status:'negotiating',amountCents:10001,date:'2026-10-01',notes:'原备注'}];renderFinance()");
 const advance=(from,next,detail=1)=>app.element('finance-records').onclick({detail,preventDefault(){},target:{closest:s=>s==='[data-finance-advance]'?{dataset:{financeAdvance:'a',financeFrom:from,financeNext:next}}:null}});
 app.element('finance-stage-negotiating').onclick();assert.match(app.element('finance-records').innerHTML,/data-finance-next="delivery"/);await advance('negotiating','delivery');assert.equal(app.json('state.finance')[0].status,'delivery');assert.equal(app.element('finance-negotiating').textContent,'0.00');assert.equal(app.element('finance-delivery').textContent,'100.01');assert.match(app.element('finance-records').innerHTML,/当前阶段暂无账目/);assert.equal(app.element('finance-dialog').open,false);
 await advance('delivery','pending',2);assert.equal(app.json('state.finance')[0].status,'delivery');await advance('negotiating','delivery');assert.equal(app.json('state.finance')[0].status,'delivery');
 app.element('finance-stage-delivery').onclick();await advance('delivery','pending');assert.equal(app.element('finance-delivery').textContent,'0.00');assert.equal(app.element('finance-pending').textContent,'100.01');app.element('finance-stage-pending').onclick();assert.match(app.element('finance-records').innerHTML,/data-finance-next="settled"/);await advance('pending','settled');assert.equal(app.element('finance-revenue').textContent,'100.01');app.element('finance-stage-revenue').onclick();assert.doesNotMatch(app.element('finance-records').innerHTML,/data-finance-advance=/);assert.doesNotMatch(app.element('finance-records').innerHTML,/type="checkbox"|finance-check/);
 const finished=app.json('state.finance')[0];assert.equal(finished.amountCents,10001);assert.equal(finished.date,'2026-10-01');assert.equal(finished.notes,'原备注');await advance('settled','delivery');assert.equal(app.json('state.finance')[0].status,'settled');
 app.run("openFinance('a')");app.element('finance-status').value='pending';await app.element('finance-form').onsubmit({preventDefault(){}});assert.equal(app.json('state.finance')[0].status,'pending');assert.equal(app.element('finance-pending').textContent,'100.01');
 app.run('persist()');await app.run('init()');assert.equal(app.json('state.finance')[0].status,'pending');
});

test('财务原生推进防重复请求，失败保留原阶段，锁定中断不重新显示账目',async()=>{
 const app=appAt('2026-11-10T12:00:00+08:00',{native:true});app.run("state.finance=[{id:'a',title:'演示合作',type:'income',status:'negotiating',amountCents:100}];renderFinance()");
 const advancing=app.run("advanceFinance('a','negotiating','delivery')");assert.equal(app.messages[0].action,'financeAdvance');assert.deepEqual(JSON.parse(JSON.stringify(app.messages[0].payload)),{id:'a',from:'negotiating'});await app.run("advanceFinance('a','negotiating','delivery')");assert.equal(app.messages.length,1);app.run(`window.nativeResponse(${app.messages[0].id},null,'加密保存失败')`);await advancing;assert.equal(app.json('state.finance')[0].status,'negotiating');assert.equal(app.element('finance-negotiating').textContent,'1.00');assert.equal(app.element('toast').textContent,'加密保存失败');
 const success=app.run("advanceFinance('a','negotiating','delivery')");app.run(`window.nativeResponse(${app.messages[1].id},{records:[{id:'a',title:'演示合作',type:'income',status:'delivery',amountCents:100}]})`);await success;assert.equal(app.json('state.finance')[0].status,'delivery');assert.equal(app.element('finance-delivery').textContent,'1.00');
 const interrupted=app.run("advanceFinance('a','delivery','pending')");app.run('clearFinance()');app.run(`window.nativeResponse(${app.messages[2].id},{records:[{id:'a',title:'不得显示的财务内容',type:'income',status:'pending',amountCents:100}]})`);await interrupted;assert.deepEqual(app.json('state.finance'),[]);assert.equal(app.element('finance-records').innerHTML,'');const count=app.messages.length;await app.run("advanceFinance('a','pending','settled')");assert.equal(app.messages.length,count);
 const preview=appAt('2026-11-10T12:00:00+08:00');preview.run("state.finance=[{id:'a',type:'income',status:'delivery',amountCents:100}];localStorage.setItem=()=>{throw Error('full')};renderFinance()");await preview.run("advanceFinance('a','delivery','pending')");assert.equal(preview.json('state.finance')[0].status,'delivery');assert.match(preview.element('toast').textContent,/保留原阶段/);
});

test('预估营收合计全部收入阶段，实际只计已结算，筛选及推进结算删除恢复同步计算',async()=>{
 const app=appAt('2026-11-10T12:00:00+08:00');
 app.run("state.finance=[{id:'n',title:'演示接洽',type:'income',status:'negotiating',amountCents:100},{id:'d',title:'演示交付',type:'income',status:'delivery',amountCents:200},{id:'p',title:'演示待结算',type:'income',status:'pending',amountCents:300},{id:'s',title:'演示已结算',type:'income',status:'settled',amountCents:400},{id:'expense',title:'支出不计入',type:'expense',status:'settled',amountCents:99999},{id:'archived',title:'归档不计入',type:'income',status:'pending',amountCents:88888,archived:true},{id:'deleted',title:'删除不计入',type:'income',status:'settled',amountCents:77777,deletedAt:123}];renderFinance()");
 assert.equal(app.element('finance-forecast').textContent,'10.00');assert.equal(app.element('finance-revenue').textContent,'4.00');
 app.element('finance-stage-forecast').onclick();const html=app.element('finance-records').innerHTML;for(const title of ['演示接洽','演示交付','演示待结算','演示已结算'])assert.ok(html.includes(title));assert.doesNotMatch(html,/支出不计入|归档不计入|删除不计入/);assert.equal(app.element('finance-summary').textContent,'预估营收 · 4 笔');
 app.run('openFinance()');assert.equal(app.element('finance-status').value,'negotiating');app.element('finance-dialog').close();
 await app.run("advanceFinance('p','pending','settled')");assert.equal(app.element('finance-forecast').textContent,'10.00');assert.equal(app.element('finance-revenue').textContent,'7.00');
 await app.run("advanceFinance('n','negotiating','delivery')");assert.equal(app.element('finance-forecast').textContent,'10.00');assert.equal(app.element('finance-revenue').textContent,'7.00');
 app.run("openFinance('d')");await app.element('delete-finance').onclick();assert.equal(app.element('finance-forecast').textContent,'8.00');assert.equal(app.element('finance-revenue').textContent,'7.00');app.element('finance-deleted').onclick();app.run("openFinance('d')");await app.element('delete-finance').onclick();assert.equal(app.element('finance-forecast').textContent,'10.00');
 app.run("openFinance('s')");await app.element('archive-finance').onclick();assert.equal(app.element('finance-forecast').textContent,'6.00');assert.equal(app.element('finance-revenue').textContent,'3.00');app.element('finance-stage-revenue').onclick();assert.equal(app.element('finance-summary').textContent,'实际营收 · 1 笔');assert.doesNotMatch(app.element('finance-records').innerHTML,/演示已结算/);
 app.run('clearFinance()');assert.equal(app.element('finance-forecast').textContent,'•••');assert.equal(app.element('finance-revenue').textContent,'•••');assert.equal(app.element('finance-records').innerHTML,'');
});

test('财务删除移入最近删除并排除汇总，可在重开后恢复原内容和归档状态',async()=>{
 const app=appAt('2026-11-10T12:00:00+08:00');
 app.run("state.finance=[{id:'a',title:'演示账目',type:'income',status:'pending',amountCents:10001,date:'2026-10-01',notes:'原备注\\n第二行'},{id:'b',title:'归档收入',type:'income',status:'settled',amountCents:500,archived:true}];renderFinance();openFinance('a')");
 await app.element('delete-finance').onclick();assert.ok(app.json('state.finance')[0].deletedAt);assert.doesNotMatch(app.element('finance-records').innerHTML,/演示账目/);assert.equal(app.element('finance-pending').textContent,'0.00');assert.equal(app.element('finance-dialog').open,false);assert.equal(app.element('finance-deleted').hidden,false);
 await app.run('init()');app.run("financeUnlocked=true;switchDimension('finance');renderFinance()");assert.equal(app.element('finance-pending').textContent,'0.00');app.element('finance-deleted').onclick();assert.match(app.element('finance-records').innerHTML,/演示账目/);assert.doesNotMatch(app.element('finance-records').innerHTML,/data-finance-check=/);
 app.run("openFinance('a')");assert.equal(app.element('finance-fields').disabled,true);assert.equal(app.element('save-finance').hidden,true);assert.equal(app.element('delete-finance').textContent,'恢复账目');await app.element('finance-form').onsubmit({preventDefault(){}});assert.equal(app.json('state.finance')[0].title,'演示账目');
 await app.element('delete-finance').onclick();assert.equal(app.json('state.finance')[0].deletedAt,undefined);assert.equal(app.element('finance-pending').textContent,'100.01');app.element('finance-all').onclick();assert.match(app.element('finance-records').innerHTML,/演示账目/);assert.equal(app.json('state.finance')[0].date,'2026-10-01');assert.equal(app.json('state.finance')[0].notes,'原备注\n第二行');
 app.element('finance-archived').onclick();app.run("openFinance('b')");await app.element('delete-finance').onclick();app.element('finance-deleted').onclick();app.run("openFinance('b')");await app.element('delete-finance').onclick();assert.equal(app.json('state.finance')[1].archived,true);assert.equal(app.element('finance-revenue').textContent,'0.00');app.element('finance-archived').onclick();assert.match(app.element('finance-records').innerHTML,/归档收入/);
});

test('财务原生删除等待保存成功、防重复请求；失败与锁定中断不显示成功或泄露账目',async()=>{
 const app=appAt('2026-11-10T12:00:00+08:00',{native:true});app.run("state.finance=[{id:'a',title:'测试收入',type:'income',status:'pending',amountCents:100}];renderFinance();openFinance('a')");
 const failure=app.element('delete-finance').onclick();assert.equal(app.messages[0].action,'financeDelete');assert.deepEqual(JSON.parse(JSON.stringify(app.messages[0].payload)),{id:'a',deleted:true});await app.element('delete-finance').onclick();assert.equal(app.messages.length,1);app.run(`window.nativeResponse(${app.messages[0].id},null,'加密保存失败')`);await failure;assert.equal(app.json('state.finance')[0].deletedAt,undefined);assert.equal(app.element('finance-dialog').open,true);assert.equal(app.element('finance-feedback').textContent,'加密保存失败');assert.equal(app.element('delete-finance').disabled,false);
 const success=app.element('delete-finance').onclick();app.run(`window.nativeResponse(${app.messages[1].id},{records:[{id:'a',title:'测试收入',type:'income',status:'pending',amountCents:100,deletedAt:123}]})`);await success;assert.equal(app.element('finance-dialog').open,false);assert.equal(app.element('finance-pending').textContent,'0.00');
 app.element('finance-deleted').onclick();app.run("openFinance('a')");const interrupted=app.element('delete-finance').onclick();app.run('clearFinance()');app.run(`window.nativeResponse(${app.messages[2].id},{records:[{id:'a',title:'不能重新显示的账目'}]})`);await interrupted;assert.deepEqual(app.json('state.finance'),[]);assert.equal(app.element('finance-records').innerHTML,'');assert.equal(app.element('finance-content').hidden,true);const count=app.messages.length;await app.element('delete-finance').onclick();assert.equal(app.messages.length,count);
 const unsaved=appAt('2026-11-10T12:00:00+08:00',{native:true});unsaved.run("state.finance=[{id:'a',title:'原账目'}];openFinance('a');save()");const blocked=unsaved.element('delete-finance').onclick();assert.equal(unsaved.messages[0].action,'saveState');unsaved.run(`window.nativeResponse(${unsaved.messages[0].id},null,'保存失败')`);await blocked;assert.equal(unsaved.messages.length,1);assert.equal(unsaved.json('state.finance')[0].deletedAt,undefined);assert.match(unsaved.element('finance-feedback').textContent,/最新修改尚未保存/);
});

test('旧财务记录保留原状态和金额，只更新显示名称，编辑仍选择原对应阶段',()=>{
 const app=appAt('2026-10-26T12:00:00+08:00');app.run("state.finance=[{id:'old-pending',date:'2026-10-25',title:'旧待收',type:'income',status:'pending',amountCents:12345},{id:'old-settled',date:'2026-10-25',title:'旧实收',type:'income',status:'settled',amountCents:23456},{id:'old-negotiating',date:'2026-10-25',title:'旧接洽',type:'income',status:'negotiating',amountCents:34567}]");const original=app.json('state.finance');app.run('renderFinance()');assert.deepEqual(app.json('state.finance'),original);assert.equal(app.element('finance-pending').textContent,'123.45');assert.equal(app.element('finance-revenue').textContent,'234.56');assert.equal(app.element('finance-negotiating').textContent,'345.67');assert.equal(app.element('finance-delivery').textContent,'0.00');
 for(const [id,status] of [['old-pending','pending'],['old-settled','settled'],['old-negotiating','negotiating']]){app.run(`openFinance('${id}')`);assert.equal(app.element('finance-status').value,status);assert.equal(app.element('finance-amount').value,(original.find(r=>r.id===id).amountCents/100).toFixed(2));}
});


test('双击所有本机记录均打开对应编辑器，任务可改内容和日期并保留完成状态',()=>{
 const app=appAt('2026-10-26T12:00:00+08:00');app.run("state.tasks=[{id:'t',title:'原待办',date:'2026-10-20',done:true,completedOn:'2026-10-21'}];state.projects=[{id:'p',name:'原项目',date:'2026-10-20',status:'active'}];state.business=[{id:'b',title:'原商务',date:'2026-10-20',status:'planned'}];state.development=[{id:'d',title:'原开发',date:'2026-10-20',status:'planned'}];state.finance=[{id:'f',title:'原账目',date:'2026-10-20',type:'income',amountCents:100,status:'pending'}];state.thoughts={'2026-10-20':'原复盘'};render()");
 for(const [kind,id,container,dialog] of [['tasks','t','tasks','task-dialog'],['projects','p','projects','project-dialog'],['business','b','business-records','record-dialog'],['development','d','development-records','record-dialog'],['finance','f','finance-records','finance-dialog'],['review','2026-10-20','review-records','review-dialog']]){
  const row={dataset:{editKind:kind,editId:id}},target={closest:s=>s==='[data-edit-kind]'?row:null};app.element(container).ondblclick({target});assert.equal(app.element(dialog).open,true,kind);app.element(dialog).close();
 }
 app.run("openTask('t')");app.element('task-title').value='改后的待办';app.element('task-date').value='2026-10-22';app.element('task-time').value='09:30';app.element('task-form').onsubmit({preventDefault(){}});assert.equal(app.json('state.tasks')[0].done,true);assert.equal(app.json('state.tasks')[0].title,'改后的待办');assert.equal(app.json('state.tasks')[0].date,'2026-10-22');assert.equal(app.json('state.tasks')[0].completedOn,'2026-10-21');assert.match(app.element('all-records').innerHTML,/改后的待办/);
});
test('长短样式持久化，一览视图按日期合并四类记录且不包含财务复盘',()=>{
 const app=appAt('2026-10-26T12:00:00+08:00');app.run("state.tasks=[{id:'a',date:'2026-10-26',title:'统一待办'}];state.projects=[{id:'b',date:'2026-10-25',name:'统一项目',status:'active'}];state.business=[{id:'c',date:'2026-10-24',title:'统一商务',status:'waiting'}];state.development=[{id:'d',date:'2026-10-23',title:'统一开发',status:'working'}];state.finance=[{id:'f',date:'2026-10-26',title:'保密账目',amountCents:500,type:'income'}];switchDimension('all')");
 const html=app.element('all-records').innerHTML;for(const t of ['统一待办','统一项目','统一商务','统一开发'])assert.match(html,new RegExp(t));assert.ok(html.indexOf('统一待办')<html.indexOf('统一项目'));assert.doesNotMatch(html,/保密账目/);assert.equal(app.element('panel-all').hidden,false);
 app.element('view-long').onclick();app.run('persist()');assert.equal(JSON.parse(app.storage.get('zaichang-preview')).listStyle,'long');app.run("select(C.fromKey('2020-01-01'))");assert.equal(app.element('all-records').innerHTML,html);app.element('view-short').onclick();assert.equal(app.run('state.listStyle'),'short');
});
test('一览混合六类记录按日期展示，单击复盘备忘编辑原记录并保留历史',()=>{
 const app=appAt('2026-10-26T12:00:00+08:00');
 app.run("state.tasks=[{id:'t',date:'2026-10-20',title:'排在最前的待办'}];state.projects=[{id:'p',date:'2026-10-26',name:'第二类项目'}];state.business=[{id:'b',date:'2026-10-25',title:'第三类商务'}];state.development=[{id:'d',date:'2026-10-24',title:'第四类开发'}];state.thoughts={'2026-10-23':'第五类复盘内容'};state.memos=[{id:'m',date:'2026-10-26',text:'第六类备忘内容'}];renderDimensions()");
 const kinds=['tasks','projects','business','development','memo','review'];let html=app.element('all-records').innerHTML;let previous=-1;for(const kind of kinds){const index=html.indexOf('data-edit-kind="'+kind+'"');assert.ok(index>previous,kind);previous=index;}assert.equal(app.element('badge-all').textContent,6);
 const click=(kind,id)=>{const row={dataset:{editKind:kind,editId:id}},target={closest:selector=>selector==='[data-edit-kind]'?row:null};app.element('all-records').onclick({target});};
 click('review','2026-10-23');assert.equal(app.element('review-dialog').open,true);assert.equal(app.element('review-edit').value,'第五类复盘内容');app.element('review-edit').value='修改复盘 <纯文本>';app.element('review-edit').listeners.input();app.element('review-dialog').close();
 click('memo','m');assert.equal(app.element('memo-dialog').open,true);app.element('memo-text').value='修改备忘\n第二行';app.element('memo-text').listeners.input();app.run('persist()');assert.equal(app.json('state.memos').length,1);assert.equal(app.json('state.memos')[0].id,'m');html=app.element('all-records').innerHTML;assert.match(html,/修改复盘 &lt;纯文本&gt;/);assert.match(html,/修改备忘\n第二行/);assert.ok(html.indexOf('data-edit-kind="memo"')<html.indexOf('data-edit-kind="review"'));assert.equal(JSON.parse(app.storage.get('zaichang-preview')).thoughts['2026-10-23'],'修改复盘 <纯文本>');
 app.element('all-kind').value='review';app.element('add-all').onclick();assert.equal(app.element('review-date').value,'2026-10-26');app.element('all-kind').value='memo';app.element('add-all').onclick();assert.equal(app.element('memo-dialog').open,true);
});

test('一览把不同类型按日期时间混排，修改时间立即重排，重开仍保持顺序',async()=>{
 const app=appAt('2026-10-26T12:00:00+08:00');
 app.run("state.tasks=[{id:'t',title:'十点待办',date:'2026-10-26',time:'10:00'}];state.projects=[{id:'p',name:'后天项目',date:'2026-10-28'}];state.business=[{id:'b',title:'明天商务',date:'2026-10-27',status:'waiting'}];state.development=[{id:'d',title:'九点开发',date:'2026-10-26',startTime:'09:00',endTime:'12:00',status:'planned'}];state.thoughts={'2026-10-25':'过往复盘'};state.memos=[{id:'m',date:'2026-10-26',text:'今日备忘'}];render()");
 const ordered=titles=>{let previous=-1;for(const title of titles){const index=app.element('all-records').innerHTML.indexOf(title);assert.ok(index>previous,title);previous=index;}};
 ordered(['九点开发','十点待办','今日备忘','明天商务','后天项目','过往复盘']);assert.match(app.element('all-records').innerHTML,/<summary>过往记录 · 1项/);
 const before=app.element('all-records').innerHTML;app.run("select(C.fromKey('2020-01-01'))");assert.equal(app.element('all-records').innerHTML,before);
 app.run("openRecord('development','d')");app.element('record-start').value='11:00';app.element('record-form').onsubmit({preventDefault(){}});ordered(['十点待办','九点开发','今日备忘','明天商务','后天项目','过往复盘']);
 app.run('persist()');await app.run('init()');ordered(['十点待办','九点开发','今日备忘','明天商务','后天项目','过往复盘']);assert.equal(app.json('state.development')[0].startTime,'11:00');
});

test('新安装与已有记录每次打开均默认一览长列表，仍可临时切换且不改动记录',async()=>{
 const app=appAt('2026-10-26T12:00:00+08:00',{financeUnlocked:false});assert.equal(app.run('state.activeDimension'),'all');assert.equal(app.run('state.listStyle'),'long');
 const saved={activeDimension:'finance',listStyle:'short',tasks:[{id:'kept',title:'保留已有记录',date:'2026-10-25',notes:'展开查看完整说明'}],projects:[],business:[],development:[],thoughts:{'2026-10-25':'原复盘'}};app.storage.set('zaichang-preview',JSON.stringify(saved));await app.run('init()');assert.equal(app.run('state.activeDimension'),'all');assert.equal(app.run('state.listStyle'),'long');assert.equal(app.run('financeUnlocked'),false);assert.equal(app.element('panel-all').hidden,false);assert.match(app.element('all-records').innerHTML,/保留已有记录/);assert.deepEqual(app.json('state.tasks'),saved.tasks);assert.deepEqual(app.json('state.thoughts'),saved.thoughts);
 app.element('view-short').onclick();app.run("switchDimension('projects');persist()");assert.equal(JSON.parse(app.storage.get('zaichang-preview')).listStyle,'short');assert.equal(app.run('state.activeDimension'),'projects');await app.run('init()');assert.equal(app.run('state.activeDimension'),'all');assert.equal(app.run('state.listStyle'),'long');assert.deepEqual(app.json('state.tasks'),saved.tasks);
});
test('财务锁定不渲染账目、合计和数量，无法直接编辑或经导出泄露',async()=>{
 const app=appAt('2026-10-26T12:00:00+08:00',{financeUnlocked:false});app.run("state.finance=[{id:'secret',title:'保密账目',type:'income',amountCents:99999,status:'pending'}];renderFinance();renderDimensions();openFinance('secret')");
 assert.equal(app.element('finance-records').innerHTML,'');for(const key of ['negotiating','delivery','pending','forecast','revenue'])assert.equal(app.element('finance-'+key).textContent,'•••');assert.equal(app.element('badge-finance').textContent,'锁');assert.equal(app.element('finance-content').hidden,true);assert.equal(app.element('finance-dialog').open,false);
 await app.element('export').onclick();const exported=JSON.parse(await app.downloads[0].text());assert.deepEqual(exported.finance,[]);
 app.run("financeUnlocked=true;renderFinance()");assert.match(app.element('finance-records').innerHTML,/保密账目/);const locking=app.run('lockFinancialView()');assert.equal(app.run('financeUnlocked'),false);assert.equal(app.element('badge-finance').textContent,'锁');await locking;assert.deepEqual(app.json('state.finance'),[]);assert.equal(app.element('finance-records').innerHTML,'');await app.run('lockFinancialView()');assert.equal(app.run('financeLockPromise'),null);
});

test('新增备忘空白时不建记录，输入即自动保存，双击在原记录上修改并保留换行',async()=>{
 const app=appAt('2026-10-26T12:00:00+08:00');app.element('add-memo').onclick();assert.equal(app.element('memo-dialog').open,true);assert.equal(app.element('memo-date').value,'2026-10-26');assert.equal(app.json('state.memos').length,0);
 app.element('memo-text').value='记下灵感\n第二行 <script>纯文本</script>';app.element('memo-text').listeners.input();assert.equal(app.json('state.memos').length,1);app.element('memo-text').listeners.blur();const saved=JSON.parse(app.storage.get('zaichang-preview'));assert.equal(saved.memos[0].text,'记下灵感\n第二行 <script>纯文本</script>');assert.match(app.element('memo-records').innerHTML,/&lt;script&gt;/);assert.doesNotMatch(app.element('memo-records').innerHTML,/<script>/);app.element('memo-dialog').close();
 const id=app.json('state.memos')[0].id,row={dataset:{editKind:'memo',editId:id}},target={closest:s=>s==='[data-edit-kind]'?row:null};app.element('memo-records').ondblclick({target});assert.equal(app.element('memo-dialog').open,true);assert.equal(app.element('memo-text').value,saved.memos[0].text);app.element('memo-text').value='继续修改后的内容\n完整保留';app.element('memo-text').listeners.input();await app.element('memo-form').onsubmit({preventDefault(){}});assert.equal(app.json('state.memos').length,1);assert.equal(app.json('state.memos')[0].id,id);assert.equal(app.json('state.memos')[0].text,'继续修改后的内容\n完整保留');assert.equal(app.element('memo-dialog').open,false);
});

test('备忘日期累计倒序，翻月换日不清空，日期错误不覆盖，归档可恢复并进入导出',async()=>{
 const app=appAt('2026-10-26T12:00:00+08:00');app.run("state.memos=[{id:'old',date:'2026-09-30',text:'旧备忘',archived:false},{id:'new',date:'2026-10-26',text:'新备忘',archived:false}];render();switchDimension('memo')");const html=app.element('memo-records').innerHTML;assert.ok(html.indexOf('新备忘')<html.indexOf('旧备忘'));assert.equal(app.element('panel-memo').hidden,false);assert.equal(app.element('badge-memo').textContent,2);app.element('memo-records').scrollTop=60;app.run("select(C.fromKey('2025-01-01'))");assert.equal(app.element('memo-records').innerHTML,html);assert.equal(app.element('memo-records').scrollTop,60);app.advance('2026-10-27T08:00:00+08:00');app.run('refreshDay()');assert.equal(app.element('memo-records').innerHTML,html);
 app.run("openMemo('new')");app.element('memo-date').value='invalid';app.element('memo-text').value='无效日期下的修改';app.element('memo-text').listeners.input();assert.equal(app.json('state.memos')[1].text,'新备忘');assert.match(app.element('memo-feedback').textContent,/有效日期/);app.element('memo-date').value='2026-10-20';app.element('memo-date').onchange();assert.equal(app.json('state.memos')[1].date,'2026-10-20');await app.element('archive-memo').onclick();assert.equal(app.json('state.memos')[1].archived,true);assert.doesNotMatch(app.element('memo-records').innerHTML,/无效日期下的修改/);app.element('memo-archived').onclick();assert.match(app.element('memo-records').innerHTML,/无效日期下的修改/);app.run("openMemo('new')");await app.element('archive-memo').onclick();assert.equal(app.json('state.memos')[1].archived,false);await app.element('export').onclick();const exported=JSON.parse(await app.downloads[0].text());assert.equal(exported.memos.length,2);assert.equal(exported.memos[1].date,'2026-10-20');assert.match(app.element('all-records').innerHTML,/旧备忘/);assert.match(app.element('all-records').innerHTML,/无效日期下的修改/);
});

test('备忘重开后完整保留，兼容没有备忘的旧数据，默认仍是一览长列表',async()=>{
 const app=appAt('2026-10-26T12:00:00+08:00',{financeUnlocked:false});const memos=[{id:'m',date:'2026-10-20',text:'重新打开仍可看到',archived:false}];app.storage.set('zaichang-preview',JSON.stringify({memos,activeDimension:'memo',listStyle:'short'}));await app.run('init()');assert.deepEqual(app.json('state.memos'),memos);assert.match(app.element('memo-records').innerHTML,/重新打开仍可看到/);assert.equal(app.run('state.activeDimension'),'all');assert.equal(app.run('state.listStyle'),'long');app.storage.set('zaichang-preview',JSON.stringify({tasks:[],memos:null}));await app.run('init()');assert.deepEqual(app.json('state.memos'),[]);
});

test('列表快捷键保留输入框回车和中文输入确认，焦点在记录上仍可回车编辑',()=>{
 const app=appAt('2026-10-26T12:00:00+08:00');app.run("state.memos=[{id:'m',date:'2026-10-26',text:'原备忘'}];renderMemos()");
 for(const container of ['memo-records','review-records','tasks']){let prevented=false;const target={closest:selector=>selector.includes('textarea')?{}:null};app.element(container).onkeydown({key:'Enter',target,preventDefault(){prevented=true;}});assert.equal(prevented,false,container);}
 const row={dataset:{editKind:'memo',editId:'m'}},target={closest:selector=>selector==='[data-edit-kind]'?row:null};let prevented=false;app.element('memo-records').onkeydown({key:'Enter',isComposing:true,target,preventDefault(){prevented=true;}});assert.equal(prevented,false);assert.equal(app.element('memo-dialog').open,false);app.element('memo-records').onkeydown({key:'Enter',target,preventDefault(){prevented=true;}});assert.equal(prevented,true);assert.equal(app.element('memo-dialog').open,true);
});

test('备忘正文回车不阻止默认换行且不关闭编辑，日期回车不误提交',()=>{
 const app=appAt('2026-10-26T12:00:00+08:00');app.run('openMemo()');let stopped=false,prevented=false;app.element('memo-text').listeners.keydown({key:'Enter',stopPropagation(){stopped=true;},preventDefault(){prevented=true;}});assert.equal(stopped,true);assert.equal(prevented,false);assert.equal(app.element('memo-dialog').open,true);
 app.element('memo-form').listeners.keydown({key:'Enter',target:{closest:()=>null},preventDefault(){prevented=true;}});assert.equal(prevented,true);assert.equal(app.element('memo-dialog').open,true);prevented=false;app.element('memo-form').listeners.keydown({key:'Enter',isComposing:true,target:{closest:()=>null},preventDefault(){prevented=true;}});assert.equal(prevented,false);
});
