const {test}=require('node:test');
const assert=require('node:assert/strict');
const C=require('../web/core.js');
const calendar={calendar_id:'work',summary:'工作',color:0x4f8b6c};
const timed=(start,end,status='confirmed')=>({event_id:'event-1',summary:'讨论',start_time:{timestamp:String(new Date(start).getTime()/1000)},end_time:{timestamp:String(new Date(end).getTime()/1000)},status});
test('跨月飞书时间线使用最新快照，修改去重且删除不被旧月份缓存复活',()=>{
 const event=(id,start,end,title=id)=>({id,title,start:new Date(start).getTime(),end:new Date(end).getTime(),calendarId:'work'});
 const keep=event('keep','2026-10-10T09:00:00+08:00','2026-10-10T10:00:00+08:00');
 const cancelled=event('removed','2026-10-31T09:00:00+08:00','2026-11-02T10:00:00+08:00');
 const old=event('edit','2026-10-31T09:00:00+08:00','2026-11-01T10:00:00+08:00','旧标题'),updated=event('edit','2026-11-05T09:00:00+08:00','2026-11-05T10:00:00+08:00','新标题');
 const cache={'2026-11':{syncedAt:200,events:[updated]},'2026-10':{syncedAt:100,events:[keep,cancelled,old]},invalid:{events:[cancelled]}};
 const before=structuredClone(cache),list=C.cachedEvents(cache);
 assert.deepEqual(list.map(e=>e.id).sort(),['edit','keep']);assert.equal(list.find(e=>e.id==='edit').title,'新标题');assert.deepEqual(cache,before);
});
test('飞书时间线从今天按日期递增，同一天全天在先、时间递增，跨日安排只出现一条',()=>{
 const stamp=s=>new Date(s).getTime(),list=[{id:'afternoon',title:'下午',start:stamp('2026-10-26T15:00:00+08:00'),end:stamp('2026-10-26T16:00:00+08:00')},{id:'morning',title:'上午',start:stamp('2026-10-26T09:00:00+08:00'),end:stamp('2026-10-26T10:00:00+08:00')},{id:'all',title:'跨日全天',allDay:true,start:stamp('2026-10-26T00:00:00+08:00'),end:stamp('2026-10-29T00:00:00+08:00')},{id:'future',title:'下个月',start:stamp('2026-11-01T10:00:00+08:00'),end:stamp('2026-11-01T11:00:00+08:00')}];
 const groups=C.eventTimeline(list,new Date(2026,9,26));assert.deepEqual(groups.map(g=>g.date),['2026-10-26','2026-11-01']);assert.deepEqual(groups[0].items.map(e=>e.id),['all','morning','afternoon']);assert.equal(groups.flatMap(g=>g.items).length,4);assert.equal(list[0].id,'afternoon');
});
test('今天以前结束的日程不展示，跨日进行中的安排归入今天且不修改原始时间',()=>{
 const stamp=s=>new Date(s).getTime(),event=(id,start,end)=>({id,title:id,start:stamp(start),end:stamp(end)}),today=new Date(2026,9,26,12);
 const events=[event('yesterday','2026-10-25T09:00:00+08:00','2026-10-25T10:00:00+08:00'),event('ends-at-midnight','2026-10-25T23:00:00+08:00','2026-10-26T00:00:00+08:00'),event('continuing','2026-10-25T00:00:00+08:00','2026-10-27T00:00:00+08:00'),event('today-morning','2026-10-26T09:00:00+08:00','2026-10-26T10:00:00+08:00'),event('zero','2026-10-26T00:00:00+08:00','2026-10-26T00:00:00+08:00')];
 const before=structuredClone(events),groups=C.eventTimeline(events,today);assert.deepEqual(groups.map(g=>g.date),['2026-10-26']);assert.deepEqual(groups[0].items.map(e=>e.id),['continuing','zero','today-morning']);assert.deepEqual(events,before);
 assert.deepEqual(C.eventTimeline(events,new Date(2026,9,27)),[]);
});
test('全天日程以本地日历日期显示，结束日期不包含在内',()=>{
 const e=C.normalize({event_id:'all-day',start_time:{date:'2026-10-25'},end_time:{date:'2026-10-27'},summary:'跨日安排'},calendar);
 assert.equal(C.onDay([e],new Date(2026,9,24)).length,0);
 assert.equal(C.onDay([e],new Date(2026,9,25)).length,1);
 assert.equal(C.onDay([e],new Date(2026,9,26)).length,1);
 assert.equal(C.onDay([e],new Date(2026,9,27)).length,0);
});
test('跨午夜与零时长日程归属正确',()=>{
 const e=C.normalize(timed('2026-10-25T23:30:00+08:00','2026-10-26T00:00:00+08:00'),calendar);
 assert.equal(C.onDay([e],new Date(2026,9,25)).length,1);
 assert.equal(C.onDay([e],new Date(2026,9,26)).length,0);
 const zero=C.normalize(timed('2026-10-26T00:00:00+08:00','2026-10-26T00:00:00+08:00'),calendar);
 assert.equal(C.onDay([zero],new Date(2026,9,26)).length,1);
});
test('取消和缺失时间的日程不进入展示',()=>{
 assert.equal(C.normalize(timed('2026-10-25T09:00+08:00','2026-10-25T10:00+08:00','cancelled'),calendar),null);
 assert.equal(C.normalize({event_id:'broken'},calendar),null);
});
test('同一实例去重且最新内容覆盖旧内容，日历颜色回退正确',()=>{
 const a=C.normalize(timed('2026-10-25T09:00+08:00','2026-10-25T10:00+08:00'),calendar);
 const b={...a,title:'已修改'};assert.equal(C.dedupe([a,b]).length,1);assert.equal(C.dedupe([a,b])[0].title,'已修改');assert.equal(a.color,'#4f8b6c');
});
test('每个月的查询跨度小于40天，覆盖闰年2月',()=>{
 for(let m=0;m<12;m++){const b=C.bounds(new Date(2028,m,10));assert.ok(b.end>b.start);assert.ok(b.end-b.start<40*86400);}
 assert.equal((C.bounds(new Date(2028,1,1)).end-C.bounds(new Date(2028,1,1)).start)/86400,29);
});

test('待办跨日、跨月、跨年持续显示，未到日期的待办不提前出现',()=>{
 const tasks=[{id:'carry',date:'2026-12-30',title:'未完成',done:false},{id:'today',date:'2027-01-01',title:'当天',done:false},{id:'future',date:'2027-01-02',title:'未来',done:false},{id:'done',date:'2026-12-31',title:'完成',done:true}];
 assert.deepEqual(C.tasksOnDay(tasks,new Date(2027,0,1)).map(t=>t.id),['carry','today']);
 assert.equal(tasks[0].date,'2026-12-30');
 assert.deepEqual(C.tasksOnDay(tasks,new Date(2027,1,1)).map(t=>t.id),['carry','today','future']);
});
test('勾选跨日待办后不再延续，完成当日可回看、取消勾选后继续延续',()=>{
 const task={id:'carry',date:'2026-10-25',title:'完成方案',done:false};
 C.toggleTask(task,new Date(2026,9,27));
 assert.equal(task.date,'2026-10-25');assert.equal(task.completedOn,'2026-10-27');
 assert.equal(C.tasksOnDay([task],new Date(2026,9,27)).length,1);
 assert.equal(C.tasksOnDay([task],new Date(2026,9,28)).length,0);
 assert.equal(C.tasksOnDay([task],new Date(2026,9,25)).length,1);
 C.toggleTask(task,new Date(2026,9,27));
 assert.equal(task.completedOn,undefined);assert.equal(C.tasksOnDay([task],new Date(2027,0,1)).length,1);
});
test('项目完成后可恢复原状态与进度，兼容旧版已完成项目',()=>{
 const project={id:'project',name:'独立项目',status:'blocked',progress:65,nextStep:'确认方案'};
 C.toggleProject(project,1);assert.equal(C.projectDone(project),true);assert.equal(project.progress,100);
 C.toggleProject(project,2);assert.equal(C.projectDone(project),false);assert.equal(project.progress,65);assert.equal(project.status,'blocked');assert.equal(project.nextStep,'确认方案');
 const legacy={status:'done',progress:100};C.toggleProject(legacy,3);assert.equal(legacy.status,'active');assert.equal(legacy.progress,0);
});
test('换日定时使用本地日历，覆盖跨年与闰日',()=>{
 assert.equal(C.untilNextDay(new Date(2026,11,31,23,59,59)),1000);
 assert.equal(C.untilNextDay(new Date(2028,1,28,23,59,59)),1000);
 assert.equal(C.untilNextDay(new Date(2028,1,29,0,0,0)),86400000);
});

test('翻月保留具体日号，在月末和闰年正确收敛',()=>{
 assert.equal(C.key(C.shiftMonth(new Date(2026,0,31),1)),'2026-02-28');
 assert.equal(C.key(C.shiftMonth(new Date(2028,0,31),1)),'2028-02-29');
 assert.equal(C.key(C.shiftMonth(new Date(2026,11,26),1)),'2027-01-26');
 assert.equal(C.key(C.shiftMonth(new Date(2027,0,26),-1)),'2026-12-26');
 assert.equal(C.validDate('2026-02-29'),false);assert.equal(C.validDate('2028-02-29'),true);
});
test('商务与开发按具体日期隔离，归档不删除，完成不改变所属日期',()=>{
 const records=[{id:'tomorrow',date:'2026-10-27',status:'planned'},{id:'late',date:'2026-10-26',status:'working',startTime:'15:00'},{id:'early',date:'2026-10-26',status:'planned',startTime:'09:00'},{id:'archive',date:'2026-10-26',status:'planned',archived:true}];
 assert.deepEqual(C.recordsOnDay(records,new Date(2026,9,26)).map(r=>r.id),['early','late']);
 assert.deepEqual(C.recordsOnDay(records,new Date(2026,9,26),true).map(r=>r.id),['archive']);
 C.toggleRecord(records[1],1);assert.equal(records[1].date,'2026-10-26');assert.equal(records[1].status,'done');
 C.toggleRecord(records[1],2);assert.equal(records[1].status,'working');
 assert.deepEqual(C.recordsOnDay(records,new Date(2026,9,27)).map(r=>r.id),['tomorrow']);
});


test('累计时间流跨月跨年倒序、同日最新在上、完成记录保留，未知日期置底',()=>{
 const records=[{id:'old',date:'2026-12-31',done:false},{id:'a',date:'2027-01-01',createdAt:1},{id:'b',date:'2027-01-01',createdAt:2,done:true},{id:'unknown'},{id:'legacy',updatedAt:new Date('2026-10-20T12:00:00+08:00').getTime()}];
 const groups=C.timelineGroups(records);assert.deepEqual(groups.map(g=>g.date),['2027-01-01','2026-12-31','2026-10-20','']);assert.deepEqual(groups[0].items.map(r=>r.id),['b','a']);assert.equal(groups[0].items[0].done,true);assert.equal(records[0].id,'old');
});
test('人民币金额精确转换为分，拒绝超精度、非数字、零、负数和过大数字',()=>{
 assert.equal(C.amountCents('0.01'),1);assert.equal(C.amountCents('100.1'),10010);assert.equal(C.amountCents('100.01'),10001);assert.equal(C.amountCents(' 12.30 '),1230);
 for(const bad of ['0','-1','1.001','1e3','NaN','Infinity','1,000','10000000000',''])assert.equal(C.amountCents(bad),null,bad);
});

test('财务三个待办阶段各自汇总，总营收只计已结算收入，排除支出与归档',()=>{
 const rows=[{type:'income',status:'pending',amountCents:10001},{type:'income',status:'pending',amountCents:99},{type:'income',status:'settled',amountCents:23456},{type:'income',status:'negotiating',amountCents:30000},{type:'income',status:'delivery',amountCents:40001},{type:'expense',status:'pending',amountCents:99999},{type:'expense',status:'settled',amountCents:99999},{type:'income',status:'settled',amountCents:99999,archived:true},{type:'income',status:'delivery',amountCents:-1},{type:'income',status:'delivery',amountCents:1.5}];
 assert.deepEqual(C.financeTotals(rows),{negotiating:30000,delivery:40001,pending:10100,revenue:23456});
 rows[0].status='settled';assert.deepEqual(C.financeTotals(rows),{negotiating:30000,delivery:40001,pending:99,revenue:33457});assert.deepEqual(C.financeTotals([]),{negotiating:0,delivery:0,pending:0,revenue:0});
});


test('一览保留原始标识和日期，排除归档和财务',()=>{
 const state={tasks:[{id:'same',title:'待办',date:'2026-10-26',done:true}],projects:[{id:'same',name:'项目',date:'2026-10-25'},{id:'archived',name:'旧',archived:true}],business:[{id:'b',title:'商务',date:'2026-10-24'}],development:[],finance:[{id:'private',title:'账目',amountCents:100}]};
 const feed=C.workFeed(state);assert.equal(feed.length,3);assert.deepEqual(C.timelineGroups(feed).map(g=>g.date),['2026-10-26','2026-10-25','2026-10-24']);assert.deepEqual(feed.filter(x=>x.id==='same').map(x=>x.kind),['tasks','projects']);assert.equal(feed[1].title,'项目');assert.equal(state.projects[0].title,undefined);assert.ok(!feed.some(x=>x.id==='private'));
});

test('一览固定按待办项目商务开发复盘备忘排序，同类日期倒序且不过滤已完成记录',()=>{
 const state={tasks:[{id:'old',title:'旧待办',date:'2026-10-20'},{id:'new',title:'新待办',date:'2026-10-22',done:true}],projects:[{id:'p',name:'项目',date:'2026-10-30'}],business:[{id:'b',title:'商务',date:'2026-10-29'}],development:[{id:'d',title:'开发',date:'2026-10-28'}],thoughts:{'2026-10-27':'复盘正文','2026-10-26':'  ',invalid:'无效日期'},memos:[{id:'m',date:'2026-10-31',text:'备忘正文'},{id:'archived',text:'不展示',archived:true},{id:'empty',text:'  '}],finance:[{id:'private',title:'保密财务'}]};
 const snapshot=structuredClone(state),groups=C.overviewGroups(C.workFeed(state)),records=groups.flatMap(g=>g.items);
 assert.deepEqual(records.map(r=>r.kind),['tasks','tasks','projects','business','development','review','memo']);assert.deepEqual(records.map(r=>r.id),['new','old','p','b','d','2026-10-27','m']);assert.equal(records[0].done,true);assert.equal(records[5].text,'复盘正文');assert.equal(records[6].text,'备忘正文');assert.deepEqual(state,snapshot);
});
