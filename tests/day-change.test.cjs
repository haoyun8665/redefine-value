const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const Core=require('../web/core.js');

function appAt(date,options={}){
 let clock=new Date(date).getTime(),nextTimer=0;
 class ClockDate extends Date{constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}}
 const elements=new Map(),storage=new Map(),downloads=[];
 const element=id=>{
  if(!elements.has(id))elements.set(id,{id,value:'',innerHTML:'',textContent:'',hidden:false,open:false,listeners:{},showModal(){this.open=true;},close(){this.open=false;},focus(){},classList:{add(){},remove(){},toggle(){}},setAttribute(){},querySelectorAll(){return[]},addEventListener(name,callback){this.listeners[name]=callback;}});
  return elements.get(id);
 };
 const context=vm.createContext({Core,Date:ClockDate,structuredClone,Blob,URL:{createObjectURL:blob=>{downloads.push(blob);return 'blob:fixture';},revokeObjectURL(){}},crypto:{randomUUID:()=> 'fixture-id'},document:{getElementById:element,createElement:()=>({click(){}}),querySelectorAll:()=>[],addEventListener(){},body:{classList:{toggle(){},add(){}}}},window:{addEventListener(){}},localStorage:{setItem:(k,v)=>storage.set(k,v),getItem:k=>storage.get(k)},setTimeout:()=>++nextTimer,clearTimeout(){},setInterval:()=>++nextTimer,console});
 const source=fs.readFileSync(require.resolve('../web/app.js'),'utf8').replace(/\ninit\(\);\s*$/,'');
 vm.runInContext(source,context);vm.runInContext('financeUnlocked='+String(options.financeUnlocked!==false)+';render()',context);
 return {element,storage,downloads,run:code=>vm.runInContext(code,context),json:code=>JSON.parse(vm.runInContext('JSON.stringify('+code+')',context)),advance:date=>{clock=new Date(date).getTime();}};
}

test('飞书时间线跨月累计、保持滚动和展开状态，并遵循日历筛选',async()=>{
 const app=appAt('2026-10-26T12:00:00+08:00');
 app.run("demo=false;connected=true;cache={'2026-10':{syncedAt:1,events:[{id:'oct',calendarId:'work',title:'十月安排',start:new Date('2026-10-26T09:00:00+08:00').getTime(),end:new Date('2026-10-26T10:00:00+08:00').getTime()}]},'2026-11':{syncedAt:2,events:[{id:'nov',calendarId:'personal',title:'十一月安排',start:new Date('2026-11-02T09:00:00+08:00').getTime(),end:new Date('2026-11-02T10:00:00+08:00').getTime()}]}};renderAgenda()");
 const html=app.element('agenda').innerHTML;assert.ok(html.indexOf('十月安排')<html.indexOf('十一月安排'));assert.equal(app.element('event-count').textContent,'2天 · 2项');
 app.element('agenda').scrollTop=72;app.element('feishu-agenda-toggle').onclick();app.run("select(C.fromKey('2027-01-01'))");assert.equal(app.element('agenda').innerHTML,html);assert.equal(app.element('agenda').scrollTop,72);assert.equal(app.element('agenda').hidden,false);
 app.run('persist()');assert.equal(JSON.parse(app.storage.get('zaichang-preview')).feishuAgendaExpanded,true);await app.run('init()');assert.equal(app.element('agenda').hidden,false);
 app.run("demo=false;state.hiddenCalendars=['personal'];renderAgenda()");assert.match(app.element('agenda').innerHTML,/十月安排/);assert.doesNotMatch(app.element('agenda').innerHTML,/十一月安排/);assert.equal(app.element('event-count').textContent,'1天 · 1项');
 app.element('feishu-agenda-toggle').onclick();app.run('renderAgenda()');assert.equal(app.element('agenda').hidden,true);
 app.advance('2026-11-03T00:00:00+08:00');app.run("state.hiddenCalendars=[];refreshDay()");assert.doesNotMatch(app.element('agenda').innerHTML,/十月安排|十一月安排/);assert.match(app.element('agenda').innerHTML,/今天起暂无已同步日程/);
});

test('时间管理收起再展开保留复盘草稿和当前分页，记住收起状态且兼容旧数据',async()=>{
 const app=appAt('2026-10-26T12:00:00+08:00',{financeUnlocked:false});
 assert.equal(app.element('time-management-content').hidden,false);app.run("state.tasks=[{id:'t',date:'2026-10-26',title:'保留待办'}];switchDimension('review')");app.element('thought').value='未离开输入框的复盘\n第二行';app.element('thought').listeners.input();
 await app.element('time-management-toggle').onclick();assert.equal(app.element('time-management-content').hidden,true);assert.equal(app.run('state.activeDimension'),'review');app.run('persist()');const saved=JSON.parse(app.storage.get('zaichang-preview'));assert.equal(saved.timeManagementExpanded,false);assert.equal(saved.thoughts['2026-10-26'],'未离开输入框的复盘\n第二行');assert.equal(saved.tasks[0].title,'保留待办');
 await app.element('time-management-toggle').onclick();assert.equal(app.element('time-management-content').hidden,false);assert.equal(app.element('thought').value,'未离开输入框的复盘\n第二行');assert.equal(app.run('state.activeDimension'),'review');
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
 assert.ok(tasks.indexOf('新待办')<tasks.indexOf('旧待办'));assert.match(tasks,/data-timeline-date="2026-10-26"/);assert.equal(app.json('state.tasks')[0].date,'2026-10-20');assert.match(business,/过往商务/);assert.match(review,/历史思考/);
 app.element('business-records').scrollTop=85;app.run("select(C.fromKey('2025-01-01'))");
 assert.equal(app.element('tasks').innerHTML,tasks);assert.equal(app.element('business-records').innerHTML,business);assert.equal(app.element('business-records').scrollTop,85);assert.equal(app.element('thought').value,'今日思考');assert.equal(app.element('review-records').innerHTML,review);
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
 const order=()=>{for(const id of ['tasks','all-records']){let last=-1;for(const title of ['过往未完成','上午任务','晚间任务','明天任务','历史已完成']){const i=app.element(id).innerHTML.indexOf(title);assert.ok(i>last,id+': '+title);last=i;}assert.match(app.element(id).innerHTML,new RegExp('<details class="task-history"><summary>'+(id==='tasks'?'过往已完成':'过往记录')+' · 1项'));}};
 order();app.run("select(C.fromKey('2020-01-01'))");order();
 app.run("openTask('late')");app.element('task-time').value='08:00';app.element('task-form').onsubmit({preventDefault(){}});
 for(const id of ['tasks','all-records'])assert.ok(app.element(id).innerHTML.indexOf('晚间任务')<app.element(id).innerHTML.indexOf('过往未完成'));
 app.run("C.toggleTask(state.tasks.find(t=>t.id==='early'),new Date());render()");app.advance('2027-01-01T00:00:00+08:00');app.run('refreshDay()');
 for(const id of ['tasks','all-records']){const html=app.element(id).innerHTML;assert.match(html,/data-timeline-date="2027-01-01"/);assert.ok(html.indexOf('晚间任务')<html.indexOf('过往未完成'));assert.match(html,new RegExp('<summary>'+(id==='tasks'?'过往已完成':'过往记录')+' · 2项'));}
 assert.equal(app.json('state.tasks').find(t=>t.id==='carry').date,'2026-12-20');app.run("openTask('carry')");assert.equal(app.element('task-date').value,'2026-12-20');
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

test('跨年先保存旧复盘，再显示新日输入；过往复盘留在累计列表',()=>{
 const app=appAt('2026-12-31T23:59:59+08:00');
 app.element('thought').value='跨年之前的复盘\n还没离开输入框';app.element('thought').listeners.input();
 app.advance('2027-01-01T00:00:00+08:00');assert.equal(app.run('refreshDay()'),true);
 const saved=JSON.parse(app.storage.get('zaichang-preview'));assert.equal(saved.thoughts['2026-12-31'],'跨年之前的复盘\n还没离开输入框');assert.equal(app.element('thought').value,'');assert.match(app.element('review-records').innerHTML,/跨年之前的复盘/);
 app.element('thought').value='新一天的思考';app.element('thought').listeners.input();app.run("select(C.fromKey('2026-12-31'))");assert.equal(app.element('thought').value,'新一天的思考');assert.equal(app.json('state.thoughts')['2027-01-01'],'新一天的思考');
});

test('休眠换日和历史复盘编辑互不覆盖，补写日期独立于月历',()=>{
 const app=appAt('2026-10-26T21:00:00+08:00');app.run("openReview('2026-10-20')");app.element('review-edit').value='补写二十日';app.element('review-edit').listeners.input();
 app.advance('2026-10-28T08:00:00+08:00');app.run('refreshDay()');app.element('review-edit').value='二十日继续补写';app.element('review-edit').listeners.input();
 assert.equal(app.json('state.thoughts')['2026-10-20'],'二十日继续补写');assert.equal(app.json('state.thoughts')['2026-10-28'],undefined);assert.equal(app.element('thought').value,'');assert.match(app.element('review-records').innerHTML,/二十日继续补写/);
});

test('商务开发财务按日期累计，持久化和导出包含六个维度',async()=>{
 const app=appAt('2026-10-26T12:00:00+08:00');
 app.run("openRecord('business')");app.element('record-title').value='确认合作方案';app.element('record-subject').value='示例客户';app.element('record-status').value='waiting';app.element('record-notes').value='等待反馈';app.element('record-form').onsubmit({preventDefault(){}});
 app.run("openRecord('development')");app.element('record-title').value='开发日程视图';app.element('record-subject').value='桌面工具';app.element('record-status').value='working';app.element('record-start').value='10:00';app.element('record-end').value='11:30';app.element('record-form').onsubmit({preventDefault(){}});
 app.run('openFinance()');app.element('finance-title').value='项目尾款';app.element('finance-type').value='income';app.element('finance-amount').value='100.01';app.element('finance-status').value='pending';app.element('finance-form').onsubmit({preventDefault(){}});
 app.run("switchDimension('finance');select(C.fromKey('2026-09-01'))");assert.equal(app.element('panel-finance').hidden,false);assert.match(app.element('finance-records').innerHTML,/项目尾款/);assert.match(app.element('business-records').innerHTML,/确认合作方案/);
 app.run('persist()');const saved=JSON.parse(app.storage.get('zaichang-preview'));assert.equal(saved.finance[0].amountCents,10001);assert.equal(saved.business.length,1);assert.equal(saved.development.length,1);
 await app.element('export').onclick();const exported=JSON.parse(await app.downloads[0].text());assert.equal(exported.finance[0].amountCents,10001);assert.equal(exported.development[0].title,'开发日程视图');assert.deepEqual(Object.keys(exported).sort(),['business','development','exportedAt','finance','memos','projects','tasks','thoughts'].sort());
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

test('月历横向手势翻月，纵向滚动和横向惯性不会连续误翻',()=>{
 const app=appAt('2026-10-31T12:00:00+08:00'),calendar=app.element('calendar');
 calendar.listeners.wheel({deltaX:1,deltaY:50,preventDefault(){throw Error('不应拦截纵向滚动');}});assert.equal(app.run('C.key(selected)'),'2026-10-31');
 const swipe={deltaX:40,deltaY:0,preventDefault(){}};calendar.listeners.wheel(swipe);calendar.listeners.wheel(swipe);assert.equal(app.run('C.key(selected)'),'2026-11-30');
 calendar.listeners.wheel({...swipe,deltaX:120});assert.equal(app.run('C.key(selected)'),'2026-11-30');
 app.advance('2026-10-31T12:00:01+08:00');calendar.listeners.wheel({...swipe,deltaX:-80});assert.equal(app.run('C.key(selected)'),'2026-10-30');
 calendar.listeners.pointerdown({button:0,isPrimary:true,clientX:200,clientY:50});calendar.listeners.pointerup({clientX:100,clientY:53});assert.equal(app.run('C.key(selected)'),'2026-11-30');
});

test('财务录入和双击编辑可依次推进三个阶段至总营收，翻月不影响汇总',async()=>{
 const app=appAt('2026-10-26T12:00:00+08:00');app.run('openFinance()');assert.equal(app.element('finance-type').value,'income');assert.equal(app.element('finance-status').value,'negotiating');for(const label of ['待接洽','待交付','待结算','已结算（总营收）'])assert.ok(app.element('finance-status').innerHTML.includes(label));assert.equal(app.element('finance-status-label').textContent,'财务阶段');app.element('finance-title').value='示例合作';app.element('finance-amount').value='123.45';await app.element('finance-form').onsubmit({preventDefault(){}});
 assert.equal(app.json('state.finance')[0].status,'negotiating');assert.equal(app.element('finance-negotiating').textContent,'123.45');assert.equal(app.element('finance-pending').textContent,'0.00');app.run("select(C.fromKey('2020-01-01'))");assert.equal(app.element('finance-negotiating').textContent,'123.45');
 const row={dataset:{editKind:'finance',editId:app.json('state.finance')[0].id}},target={closest:s=>s==='[data-edit-kind]'?row:null};app.element('finance-records').ondblclick({target});assert.equal(app.element('finance-dialog').open,true);app.element('finance-status').value='delivery';await app.element('finance-form').onsubmit({preventDefault(){}});assert.equal(app.json('state.finance')[0].status,'delivery');assert.equal(app.element('finance-negotiating').textContent,'0.00');assert.equal(app.element('finance-delivery').textContent,'123.45');assert.equal(app.element('finance-revenue').textContent,'0.00');assert.match(app.element('finance-records').innerHTML,/待交付/);
 app.run('openFinance(state.finance[0].id)');assert.equal(app.element('finance-status').value,'delivery');app.element('finance-status').value='pending';await app.element('finance-form').onsubmit({preventDefault(){}});assert.equal(app.element('finance-delivery').textContent,'0.00');assert.equal(app.element('finance-pending').textContent,'123.45');
 app.run('openFinance(state.finance[0].id)');app.element('finance-status').value='settled';await app.element('finance-form').onsubmit({preventDefault(){}});assert.equal(app.element('finance-pending').textContent,'0.00');assert.equal(app.element('finance-revenue').textContent,'123.45');assert.match(app.element('finance-records').innerHTML,/已结算/);app.run('openFinance(state.finance[0].id)');await app.element('archive-finance').onclick();assert.equal(app.element('finance-revenue').textContent,'0.00');
 app.run('openFinance()');app.element('finance-status').value='delivery';app.element('finance-type').value='expense';app.element('finance-type').onchange();assert.equal(app.element('finance-status').value,'pending');assert.equal(app.element('finance-status-label').textContent,'付款状态');assert.doesNotMatch(app.element('finance-status').innerHTML,/接洽|交付|营收/);
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
 assert.equal(app.element('finance-records').innerHTML,'');for(const key of ['negotiating','delivery','pending','revenue'])assert.equal(app.element('finance-'+key).textContent,'•••');assert.equal(app.element('badge-finance').textContent,'锁');assert.equal(app.element('finance-content').hidden,true);assert.equal(app.element('finance-dialog').open,false);
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
