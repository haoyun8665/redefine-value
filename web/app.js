'use strict';
const $=id=>document.getElementById(id), C=Core;
const native=Boolean(window.webkit?.messageHandlers?.native), pending=new Map();let sequence=0;
function call(action,payload={}) {
  if(!native)return Promise.reject(new Error('请在 Mac 应用中使用这个功能'));
  return new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});window.webkit.messageHandlers.native.postMessage({id,action,payload});});
}
window.nativeResponse=(id,result,error)=>{const p=pending.get(id);if(!p)return;pending.delete(id);error?p.reject(new Error(error)):p.resolve(result);};
window.nativeEvent=async(name,data)=>{if(name==='financeLocked'){financeInfo=data||financeInfo;clearFinance();return;}if(name==='authorized'){source=data?.source||'api';syncGeneration++;connected=true;demo=false;state.showDemo=false;cache={};calendars=[];state.hiddenCalendars=[];save();$('auth-feedback').textContent='已连接，正在读取你的日程…';if(syncing)syncAgain=true;else await sync();renderSettings();}if(name==='authError')$('auth-feedback').textContent=data;};
const icons={lock:'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4"/>',unlock:'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 7.6-1.7"/>',settings:'<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3" fill="#100b1a"/><circle cx="15" cy="17" r="3" fill="#100b1a"/>',hide:'<path d="M5 12h14"/>',prev:'<path d="m14 6-6 6 6 6"/>',next:'<path d="m10 6 6 6-6 6"/>',refresh:'<path d="M20 8a8 8 0 1 0 0 8M20 3v5h-5"/>',bell:'<path d="M5 17h14l-2-4V9a5 5 0 0 0-10 0v4l-2 4ZM10 21h4"/>'};
const svg=name=>`<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name]}</svg>`;
for(const id of ['settings','hide','prev','next','refresh'])$(id).innerHTML=svg(id);
const defaultState={tasks:[],projects:[],business:[],development:[],finance:[],memos:[],thoughts:{},activeDimension:'all',listStyle:'long',hiddenCalendars:[],mode:'desktop',locked:false,reflectionEnabled:false,reflectionTime:'21:00',prompt:'今天，什么值得记住？',eventsEnabled:false,showDemo:true,calendarExpanded:true,feishuAgendaExpanded:false,timeManagementExpanded:true};
let state=structuredClone(defaultState),selected=new Date(),view=new Date(selected.getFullYear(),selected.getMonth(),1),cache={},calendars=[],connected=false,demo=false,syncing=false,syncAgain=false,syncError='',appId='',source='api',cliInfo={},dirty=false,saveTimer,toastTimer,syncGeneration=0;
let financeUnlocked=false,financeInfo={configured:false,locked:true,available:true},financeLockPromise=null,financeEpoch=0,financeIdleTimer;
let editingTask=null,editingProject=null,showArchived=false,editingFinance=null,showFinanceArchived=false,reviewEditDate='';
let editingMemo=null,showMemoArchived=false;
let currentDay=C.key(new Date()),dayTimer;
const dimensions=['all','tasks','projects','business','development','review','finance','memo'];
const recordConfig={business:{label:'商务推进',subject:'客户 / 合作方',notes:'进度备注',statuses:{planned:'待跟进',working:'推进中',waiting:'等反馈',done:'已完成'}},development:{label:'开发日程',subject:'所属项目',notes:'开发内容 / 验收目标',statuses:{planned:'计划中',working:'开发中',blocked:'有卡点',done:'已完成'}}};
let editingRecord=null;const recordArchiveView={business:false,development:false};
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const time=d=>new Date(d).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false});
function toast(s){$('toast').textContent=s;$('toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('show'),2600);}
function sampleEvents(){
  const today=new Date(), b=(offset,h,m=0)=>new Date(today.getFullYear(),today.getMonth(),today.getDate()+offset,h,m).getTime();
  return [{id:'demo-1',title:'本周项目安排',start:b(0,9,30),end:b(0,10,15),calendar:'工作日历',calendarId:'demo-work',color:'#a886f3',location:'飞书会议',description:'演示日程。连接飞书后，这里会显示你的真实安排。'},
  {id:'demo-2',title:'留给自己的一小时',start:b(0,15),end:b(0,16),calendar:'个人日历',calendarId:'demo-personal',color:'#d199ef',location:'专注时间',description:'演示日程。'},
  {id:'demo-3',title:'下周计划',start:b(1,10),end:b(1,11),calendar:'工作日历',calendarId:'demo-work',color:'#a886f3',location:'',description:'演示日程。'},
  {id:'demo-4',title:'阅读与整理',start:b(3,14),end:b(3,15),calendar:'个人日历',calendarId:'demo-personal',color:'#d199ef',location:'',description:'演示日程。'}];
}
function events(){return C.dedupe(demo?sampleEvents():(cache[C.monthKey(view)]?.events||[])).filter(e=>!state.hiddenCalendars.includes(e.calendarId));}
function persist(){
  clearTimeout(saveTimer);const snapshot=JSON.stringify(state);
  if(native)return call('saveState',{state}).then(()=>{if(JSON.stringify(state)===snapshot){dirty=false;$('save-status').textContent='已保存在这台 Mac';}}).catch(e=>{$('save-status').textContent='保存失败，请导出备份';toast(e.message);});
  try{localStorage.setItem('zaichang-preview',snapshot);dirty=false;$('save-status').textContent='已保存在此浏览器';}catch{$('save-status').textContent='无法保存，请导出备份';}
}
function save(){dirty=true;$('save-status').textContent='保存中…';clearTimeout(saveTimer);saveTimer=setTimeout(persist,220);}
function calendarSourceLine(records,source){
  if(!records.length)return '';
  return `<span class="day-event" data-schedule-source="${source}"><span class="day-event-label">${escape(records[0].title)}</span>${records.length>1?`<small class="day-source-more">+${records.length-1}</small>`:''}</span>`;
}
function renderCalendar(){
  $('month').textContent=(view.getMonth()+1)+'月';$('year').textContent=view.getFullYear();
  const offset=(view.getDay()+6)%7,days=new Date(view.getFullYear(),view.getMonth()+1,0).getDate(),count=Math.ceil((offset+days)/7)*7;
  const all=events();let html='';
  $('prev').setAttribute('aria-label','上个月');$('next').setAttribute('aria-label','下个月');
  for(let i=0;i<count;i++){
    const d=new Date(view.getFullYear(),view.getMonth(),i-offset+1),k=C.key(d),ev=C.onDay(all,d),thought=Boolean(state.thoughts[k]?.trim());
    const local=[...C.recordsOnDay(state.business,d),...C.recordsOnDay(state.development,d),...state.tasks.filter(t=>t.date===k&&!t.done)],total=ev.length+local.length;
    html+=`<button class="day ${d.getMonth()!==view.getMonth()?'outside ':''}${k===C.key(new Date())?'today ':''}${k===C.key(selected)?'selected ':''}${thought?'has-thought':''}" data-day="${k}" aria-label="${k}${total?'，'+total+'项安排':''}${thought?'，有复盘':''}" aria-pressed="${k===C.key(selected)}" title="${escape([...ev.map(e=>'飞书：'+e.title),...local.map(e=>'本机：'+e.title)].join(' · '))}"><span class="day-number">${d.getDate()}</span>${calendarSourceLine(ev,'feishu')}${calendarSourceLine(local,'local')}</button>`;
  }
  $('calendar').innerHTML=html;$('calendar').classList.toggle('six-weeks',count===42);
  const last=cache[C.monthKey(view)]?.syncedAt;
  const info=demo?'演示日程 · 尚未连接飞书':syncing?'正在同步飞书…':syncError?(last?'同步失败 · 显示上次数据':'同步失败 · 点击查看原因'):connected?(last?(source==='cli'?'飞书 CLI':'飞书')+' · '+time(last)+' 同步':'飞书已连接 · 等待同步'):'连接飞书，日程自动出现在这里';
  $('connection').textContent=info;$('connection').className='connection'+(connected?' connected':'')+(syncError?' error':'');$('connection').title=syncError||'点击管理飞书连接';$('refresh').disabled=syncing;
}
function renderAgenda(){
  const el=$('agenda'),scroll=el.scrollTop||0;
  const events=(demo?C.dedupe(sampleEvents()):C.cachedEvents(cache)).filter(e=>!state.hiddenCalendars.includes(e.calendarId)),groups=C.eventTimeline(events,new Date()),list=groups.flatMap(g=>g.items);let index=0;
  $('agenda-title').textContent='飞书日程';$('event-count').textContent=list.length?groups.length+'天 · '+list.length+'项':'暂无日程';
  renderAgendaExpansion();
  el.innerHTML=groups.length?timeline(list,e=>{
    const start=new Date(e.start),end=new Date(Math.max(e.start,e.end-(e.allDay?1:0))),crossDay=C.key(start)!==C.key(end),shortDate=d=>(d.getMonth()+1)+'/'+d.getDate();
    const span=crossDay?shortDate(start)+'–'+shortDate(end):'',endTime=(crossDay?shortDate(end)+' ':'')+time(e.end);
    return `<button class="event ${e.end<Date.now()?'past':''}" data-schedule-source="feishu" data-event="${index++}"><div class="event-time">${e.allDay?'全天':time(e.start)}${e.allDay?'':`<small>${escape(endTime)}</small>`}</div><div class="event-body"><div class="event-title">${escape(e.title)}</div><div class="event-meta">${escape([e.allDay?span:'',e.calendar,e.location].filter(Boolean).join(' · '))}</div></div></button>`;
  },'',groups):`<div class="empty"><strong>${connected||demo?'今天起暂无已同步日程。':'把飞书日程贴到桌面。'}</strong>${connected||demo?'翻动月历，可同步其他月份的安排。':'连接后，安排会自动跟随飞书更新。'}</div>`;
  el.scrollTop=scroll;el.querySelectorAll('[data-event]').forEach(b=>b.addEventListener('click',()=>showEvent(list[Number(b.dataset.event)])));renderAgendaLayout();
}
function renderAgendaLayout(){document.body.classList.toggle('agenda-fills-space',state.feishuAgendaExpanded===true&&state.timeManagementExpanded===false);}
function renderAgendaExpansion(){const expanded=state.feishuAgendaExpanded===true;$('feishu-agenda-toggle').setAttribute('aria-expanded',String(expanded));$('feishu-agenda').classList.toggle('expanded',expanded);$('agenda').hidden=!expanded;renderAgendaLayout();}
$('feishu-agenda-toggle').onclick=()=>{state.feishuAgendaExpanded=!state.feishuAgendaExpanded;renderAgendaExpansion();save();};
function dateBadge(date){
  if(!date)return '<span class="date-badge undated">未标<small>日期</small></span>';
  const today=date===C.key(new Date());return `<time class="date-badge ${today?'is-today':''}" datetime="${escape(date)}" title="${escape(date)}"><span>${date.slice(5).replace('-','/')}</span><small>${today?'今天':date.slice(0,4)}</small></time>`;
}
function timeline(records,row,empty='暂无记录',groups=C.timelineGroups(records),historyLabel='过往已完成'){
  if(!groups.length)return `<div class="dimension-empty">${empty}</div>`;
  const markup=g=>`<div class="timeline-group" data-timeline-date="${escape(g.date)}">${dateBadge(g.date)}<div class="timeline-items">${g.items.map(row).join('')}</div></div>`;
  let html='',history=[];
  const flushHistory=()=>{if(history.length){html+=`<details class="task-history"><summary>${escape(historyLabel)} · ${history.reduce((sum,g)=>sum+g.items.length,0)}项</summary>${history.map(markup).join('')}</details>`;history=[];}};
  for(const group of groups){if(group.history)history.push(group);else{flushHistory();html+=markup(group);}}
  flushHistory();return html;
}
const workLabels={tasks:'待办',projects:'项目',business:'商务',development:'开发',review:'复盘',memo:'备忘'};
const workBadge=label=>label?`<small class="work-kind">${label}</small>`:'';
function taskRow(t,label=''){
  return `<div class="task ${t.done?'done':''}" data-edit-kind="tasks" data-edit-id="${escape(t.id)}"><button class="task-check" role="checkbox" aria-checked="${Boolean(t.done)}" aria-label="${escape(t.title)}" data-check="${escape(t.id)}">${t.done?'✓':''}</button><button class="task-copy" data-task-edit="${escape(t.id)}" aria-label="编辑待办：${escape(t.title)}"><span class="task-title">${workBadge(label)}${escape(t.title)}</span>${t.time?`<time class="overview-note task-time" datetime="${escape(t.time)}" aria-label="待办时间 ${escape(t.time)}">${escape(t.time)}</time>`:''}</button><button class="task-delete" data-delete="${escape(t.id)}" aria-label="删除 ${escape(t.title)}" title="删除事项">×</button></div>`;
}
function renderTasks(){
  const pending=state.tasks.filter(t=>!t.done).length;
  $('focus-title').textContent='待办';$('task-progress').textContent=pending+' 未完成 · '+state.tasks.length+' 条';$('task-input').placeholder='记下今天的待办…';
  $('tasks').innerHTML=timeline(state.tasks,t=>taskRow(t),'写下第一条待办，未完成的会一直保留。',C.taskTimeline(state.tasks,new Date()));
}
function openTask(id=null){
  const t=state.tasks.find(x=>x.id===id);editingTask=t?.id||null;$('task-dialog-title').textContent=t?'编辑待办':'新增待办';$('task-title').value=t?.title||'';$('task-date').value=t?.date||C.key(new Date());$('task-time').value=t?.time||'';$('task-feedback').textContent='';$('task-dialog').showModal();$('task-title').focus();
}
function renderAll(){
  const el=$('all-records'),scroll=el.scrollTop||0,feed=C.workFeed(state);
  el.innerHTML=timeline(feed,r=>r.kind==='tasks'?taskRow(r,workLabels[r.kind]):r.kind==='projects'?projectRow(r,workLabels[r.kind]):r.kind==='review'||r.kind==='memo'?personalOverviewRow(r):recordRow(r.kind,r,workLabels[r.kind]),'各类记录按日期和时间汇总在这里。',C.overviewGroups(feed,new Date()),'过往记录');el.scrollTop=scroll;
}
function personalOverviewRow(r){
  return `<div class="overview-personal" data-edit-kind="${r.kind}" data-edit-id="${escape(r.id)}"><span class="overview-personal-marker" aria-hidden="true">${r.kind==='review'?'◇':'≡'}</span><button class="overview-personal-edit" aria-label="编辑${workLabels[r.kind]}：${escape(r.date||'未标日期')}"><span class="overview-personal-title">${workLabels[r.kind]}</span><span class="overview-note" title="${escape(r.text)}">${escape(r.text)}</span></button></div>`;
}
function projectRow(p,label=''){
  const done=C.projectDone(p);
  return `<div class="project-item ${done?'completed':''}" data-edit-kind="projects" data-edit-id="${escape(p.id)}"><button class="task-check project-check" role="checkbox" aria-checked="${done}" aria-label="${done?'恢复项目':'完成项目'}：${escape(p.name)}" data-project-check="${escape(p.id)}">${done?'✓':''}</button><button class="project-row" data-project="${escape(p.id)}" aria-label="编辑项目：${escape(p.name)}"><div class="project-heading"><span class="project-name">${workBadge(label)}${escape(p.name)}</span>${p.nextStep?`<span class="project-note" title="${escape(p.nextStep)}">${escape(p.nextStep)}</span>`:''}</div></button></div>`;
}
function renderProjects(){
  const archived=state.projects.filter(p=>p.archived).length;
  $('show-archived').hidden=!archived&&!showArchived;$('show-archived').textContent=showArchived?'返回项目':'归档 '+archived;
  const list=state.projects.filter(p=>Boolean(p.archived)===showArchived);
  $('projects').innerHTML=timeline(list,projectRow,showArchived?'暂无归档项目。':'暂无项目 · 点击“新项目”开始');
}
function openProject(id=null){
  const p=state.projects.find(p=>p.id===id);editingProject=p?.id||null;
  $('project-dialog-title').textContent=p?'编辑项目':'新建项目';$('project-name').value=p?.name||'';$('project-date').value=p?C.recordDate(p)||C.key(new Date()):C.key(new Date());$('project-next').value=p?.nextStep||'';
  $('archive-project').hidden=!p;$('archive-project').textContent=p?.archived?'恢复项目':'归档项目';$('project-dialog').showModal();$('project-name').focus();
}
function renderDimensions(){
  const active=dimensions.includes(state.activeDimension)?state.activeDimension:'all';state.activeDimension=active;
  renderTimeManagement();
  state.listStyle=state.listStyle==='short'?'short':'long';document.body.classList.toggle('long-list',state.listStyle==='long');$('view-controls').hidden=!['all','tasks','projects','business','development'].includes(active);for(const style of ['short','long'])$('view-'+style).setAttribute('aria-pressed',String(state.listStyle===style));
  const counts={all:C.workFeed(state).length,tasks:state.tasks.filter(t=>!t.done).length,projects:state.projects.filter(p=>!p.archived&&!C.projectDone(p)).length,business:state.business.filter(r=>!r.archived&&r.status!=='done').length,development:state.development.filter(r=>!r.archived&&r.status!=='done').length,review:Object.values(state.thoughts).filter(t=>typeof t==='string'&&t.trim()).length,finance:financeUnlocked?state.finance.filter(r=>!r.archived&&r.status!=='settled').length:'锁',memo:state.memos.filter(m=>!m.archived).length};
  for(const kind of dimensions){$('panel-'+kind).hidden=kind!==active;const tab=$('tab-'+kind);tab.setAttribute('aria-selected',String(kind===active));tab.tabIndex=kind===active?0:-1;$('badge-'+kind).textContent=counts[kind]||'';}renderAll();
}
function renderTimeManagement(){
  const expanded=state.timeManagementExpanded!==false;
  $('time-management-toggle').setAttribute('aria-expanded',String(expanded));$('time-management-content').hidden=!expanded;$('time-management').classList.toggle('collapsed',!expanded);
  renderAgendaLayout();
}
async function toggleTimeManagement(){
  state.timeManagementExpanded=state.timeManagementExpanded===false;renderTimeManagement();
  if(!state.timeManagementExpanded&&financeUnlocked)await lockFinancialView();
  save();
}
$('time-management-toggle').onclick=toggleTimeManagement;
function switchDimension(kind){if(!dimensions.includes(kind))return;if(state.activeDimension==='finance'&&kind!=='finance')void lockFinancialView();else if(dirty)persist();state.activeDimension=kind;renderDimensions();save();}
function renderRecords(kind){
  const config=recordConfig[kind],list=state[kind].filter(r=>Boolean(r.archived)===recordArchiveView[kind]),archived=state[kind].filter(r=>r.archived).length;
  $(kind+'-archived').hidden=!archived&&!recordArchiveView[kind];$(kind+'-archived').textContent=recordArchiveView[kind]?'返回记录':'归档 '+archived;
  $(kind+'-summary').textContent=recordArchiveView[kind]?'已归档 '+list.length+' 条':list.length+' 条 · '+list.filter(r=>r.status!=='done').length+' 未完成';
  $(kind+'-records').innerHTML=timeline(list,r=>recordRow(kind,r),recordArchiveView[kind]?'暂无归档记录。':'点击“新增”，记录'+config.label+'。');
}
function recordRow(kind,r,label=''){
  const config=recordConfig[kind],done=r.status==='done',clock=r.startTime?(r.startTime+(r.endTime?'–'+r.endTime:'')):(r.endTime?'截至 '+r.endTime:'');
  return `<div class="daily-record ${done?'completed':''}" data-edit-kind="${kind}" data-edit-id="${escape(r.id)}"><button class="task-check record-check" role="checkbox" aria-checked="${done}" aria-label="${done?'恢复':'完成'}${config.label}：${escape(r.title)}" data-record-check="${escape(r.id)}">${done?'✓':''}</button><button class="record-body" data-record-edit="${escape(r.id)}" aria-label="编辑${config.label}：${escape(r.title)}"><div class="record-heading"><strong>${workBadge(label)}${escape(r.title)}</strong><span class="record-status">${config.statuses[r.status]||config.statuses.planned}</span>${(label||kind==='business')&&r.notes?`<span class="overview-note" title="${escape(r.notes)}">${escape(r.notes)}</span>`:''}</div>${r.subject||clock||r.notes?`<div class="record-meta short-record-meta">${escape([clock,r.subject,r.notes].filter(Boolean).join(' · '))}</div>`:''}${r.subject||clock?`<div class="record-meta long-record-meta">${escape([clock,r.subject].filter(Boolean).join(' · '))}</div>`:''}${r.notes?`<div class="work-note">${escape(r.notes)}</div>`:''}</button></div>`;
}
function openRecord(kind,id=null){
  const config=recordConfig[kind],record=state[kind].find(r=>r.id===id);editingRecord={kind,id:record?.id||null};
  $('record-dialog-title').textContent=(record?'编辑':'新增')+config.label;$('record-title').value=record?.title||'';$('record-subject-label').textContent=config.subject;$('record-subject').value=record?.subject||'';
  $('record-date').value=record?.date||C.key(new Date());$('record-status').innerHTML=Object.entries(config.statuses).map(([value,label])=>`<option value="${value}">${label}</option>`).join('');$('record-status').value=record?.status||'planned';
  $('record-time-row').hidden=kind!=='development';$('record-start').value=record?.startTime||'';$('record-end').value=record?.endTime||'';$('record-notes-label').textContent=config.notes;$('record-notes').placeholder=kind==='business'?'记录接洽进展、反馈或下一步，可回车换行。':'';$('record-notes').value=record?.notes||'';$('record-feedback').textContent='';
  $('archive-record').hidden=!record;$('archive-record').textContent=record?.archived?'恢复记录':'归档记录';$('record-dialog').showModal();$('record-title').focus();
}
function recordClick(kind,e){const check=e.target.closest('[data-record-check]'),edit=e.target.closest('[data-record-edit]');if(check){const record=state[kind].find(r=>r.id===check.dataset.recordCheck);if(record){C.toggleRecord(record);save();renderRecords(kind);renderDimensions();renderCalendar();}}else if(kind==='business'&&edit)openRecord(kind,edit.dataset.recordEdit);}
const money=cents=>(cents/100).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2});
const financeMetricKeys=['negotiating','delivery','pending','revenue'];
const financeIncomeStages={negotiating:'待接洽',delivery:'待交付',pending:'待结算',settled:'已结算（总营收）'};
const financeStatus=r=>r.type==='income'?(r.status==='settled'?'已结算':financeIncomeStages[r.status]||'待结算'):(r.status==='settled'?'已结清':'待付款');
function renderFinanceStatuses(status='pending'){
  const income=$('finance-type').value==='income',options=income?financeIncomeStages:{pending:'待付款',settled:'已结清'};
  $('finance-status').innerHTML=Object.entries(options).map(([value,label])=>`<option value="${value}">${label}</option>`).join('');$('finance-status').value=Object.hasOwn(options,status)?status:'pending';
  $('finance-status-label').textContent=income?'财务阶段':'付款状态';
  $('finance-stage-note').textContent=income?'已结算收入计入总营收。':'支出单独记录，不计入收入的四项汇总。';
}
function clearFinance(){
  ++financeEpoch;financeUnlocked=false;clearTimeout(financeIdleTimer);state.finance=[];editingFinance=null;
  $('finance-dialog').close();for(const id of ['finance-title','finance-amount','finance-party','finance-notes'])$(id).value='';
  $('finance-records').innerHTML='';$('finance-summary').textContent='';for(const id of financeMetricKeys)$('finance-'+id).textContent='•••';renderFinance();renderDimensions();
}
async function lockFinancialView(){
  if(financeLockPromise)return financeLockPromise;
  ++financeEpoch;financeUnlocked=false;$('finance-content').hidden=true;$('finance-gate').hidden=false;renderDimensions();
  financeLockPromise=(async()=>{await Promise.resolve();try{if(dirty)await persist();if(native)await call('financeLock');}catch(e){toast(e.message);}finally{clearFinance();financeLockPromise=null;}})();return financeLockPromise;
}
window.lockFinancialView=lockFinancialView;
function touchFinance(){if(!financeUnlocked)return;clearTimeout(financeIdleTimer);financeIdleTimer=setTimeout(()=>void lockFinancialView(),5*60*1000);}
async function unlockFinance(){
  if(!native){$('finance-gate-feedback').textContent='请在 Mac 应用中设置密码并解锁财务。';return;}
  if(financeLockPromise)await financeLockPromise;
  const epoch=++financeEpoch;$('finance-unlock').disabled=true;$('finance-gate-feedback').textContent='';
  try{if(dirty)await persist();const result=await call('financeUnlock');financeInfo=result.info||financeInfo;if(epoch!==financeEpoch){await call('financeLock');return;}if(result.unlocked){state.finance=result.records||[];financeUnlocked=true;financeInfo.locked=false;renderFinance();renderDimensions();touchFinance();}else renderFinance();}
  catch(e){$('finance-gate-feedback').textContent=e.message;}finally{$('finance-unlock').disabled=false;}
}
function renderFinance(){
  $('finance-gate').hidden=financeUnlocked;$('finance-content').hidden=!financeUnlocked;$('finance-unlock').textContent=financeInfo.configured?'解锁财务':'设置财务密码';$('finance-gate-note').textContent=financeInfo.configured?'输入密码后查看账目与金额汇总。':'首次查看前，请在本机设置财务密码。';
  if(!financeUnlocked){$('finance-records').innerHTML='';$('finance-summary').textContent='';for(const id of financeMetricKeys)$('finance-'+id).textContent='•••';return;}
  const totals=C.financeTotals(state.finance);for(const key of financeMetricKeys)$('finance-'+key).textContent=money(totals[key]);
  const list=state.finance.filter(r=>Boolean(r.archived)===showFinanceArchived),archived=state.finance.filter(r=>r.archived).length;
  $('finance-archived').hidden=!archived&&!showFinanceArchived;$('finance-archived').textContent=showFinanceArchived?'返回账目':'归档 '+archived;
  $('finance-summary').textContent=(showFinanceArchived?'已归档 ':'')+list.length+' 笔 · '+list.filter(r=>r.status!=='settled').length+' 未结清';
  $('finance-records').innerHTML=timeline(list,r=>`<button class="finance-row" data-edit-kind="finance" data-edit-id="${escape(r.id)}" data-finance="${escape(r.id)}" aria-label="编辑财务：${escape(r.title)}"><span class="finance-heading"><strong>${escape(r.title)}</strong><span class="finance-amount ${r.type==='income'?'income':'expense'}">${r.type==='income'?'+':'−'}${money(r.amountCents)}</span></span><span class="record-meta">${escape([r.type==='income'?'收入':'支出',r.party,financeStatus(r)].filter(Boolean).join(' · '))}</span>${r.notes?`<span class="record-notes">${escape(r.notes)}</span>`:''}</button>`,'点击“记一笔”，记录收入和支出。');
}
function openFinance(id=null){
  if(!financeUnlocked){renderFinance();return;}
  const r=state.finance.find(x=>x.id===id);editingFinance=r?.id||null;
  $('finance-dialog-title').textContent=r?'编辑账目':'记一笔';$('finance-title').value=r?.title||'';$('finance-type').value=r?.type||'income';$('finance-amount').value=r?(r.amountCents/100).toFixed(2):'';$('finance-date').value=r?.date||C.key(new Date());renderFinanceStatuses(r?(r.status||'pending'):'negotiating');$('finance-party').value=r?.party||'';$('finance-notes').value=r?.notes||'';$('finance-feedback').textContent='';$('archive-finance').hidden=!r;$('archive-finance').textContent=r?.archived?'恢复账目':'归档账目';$('finance-dialog').showModal();$('finance-title').focus();
}
function updateThought(date,text){
  state.thoughts[date]=text;renderDimensions();save();
}
function renderThought(){
  const today=C.key(new Date()),entries=Object.entries(state.thoughts).filter(([date,text])=>C.validDate(date)&&typeof text==='string'&&text.trim()).map(([date,text])=>({date,text}));
  if(!entries.some(r=>r.date===today))entries.push({date:today,text:''});
  $('thought-history').textContent='搜索';$('thought-reminder').innerHTML=svg('bell')+(state.reflectionEnabled?state.reflectionTime:'提醒');
  $('review-records').innerHTML=timeline(entries,r=>r.date===today?`<div class="review-editor"><p class="prompt" id="prompt">${escape(state.prompt)}</p><textarea id="thought" maxlength="20000" aria-label="今日复盘" placeholder="今天的进展、卡点和思考…"></textarea><div class="thought-footer"><span>右下角拖动拉长 · 自动保存</span><span id="word-count">${Array.from(r.text).length} 字</span></div></div>`:`<button class="review-entry" data-edit-kind="review" data-edit-id="${escape(r.date)}" data-review="${escape(r.date)}" aria-label="编辑 ${escape(r.date)} 的复盘"><span>${escape(r.text)}</span><small>编辑</small></button>`);
  $('thought').value=state.thoughts[today]||'';
  $('thought').addEventListener('input',()=>{updateThought(today,$('thought').value);$('word-count').textContent=Array.from($('thought').value).length+' 字';});
  $('thought').addEventListener('blur',()=>{if(dirty)persist();renderCalendar();});
}
function openReview(date=C.key(new Date())){
  if(dirty)persist();reviewEditDate=date;$('review-date').value=date;$('review-date').max=C.key(new Date());$('review-edit').value=state.thoughts[date]||'';$('review-dialog').showModal();$('review-edit').focus();
}
function renderWindow(){
  document.body.classList.toggle('locked',state.locked);$('lock').innerHTML=svg(state.locked?'lock':'unlock');$('lock').classList.toggle('active',state.locked);$('lock').title=state.locked?'解除位置锁定':state.mode==='desktop'?'锁定并贴到桌面':'锁定位置';$('lock').setAttribute('aria-label',$('lock').title);$('lock').setAttribute('aria-pressed',String(state.locked));
  $('window-status').textContent=state.mode==='desktop'&&!state.locked?'拖动摆放 · 锁定后贴到桌面':(state.mode==='desktop'?'已贴在桌面':state.mode==='top'?'始终置顶':'普通浮窗')+(state.locked?' · 位置已锁定':' · 可拖动');
}
function renderMemos(){
  const list=state.memos.filter(m=>Boolean(m.archived)===showMemoArchived),archived=state.memos.filter(m=>m.archived).length;
  $('memo-archived').hidden=!archived&&!showMemoArchived;$('memo-archived').textContent=showMemoArchived?'返回备忘':'归档 '+archived;
  $('memo-summary').textContent=(showMemoArchived?'已归档 ':'')+list.length+' 条 · 输入自动保存';
  $('memo-records').innerHTML=timeline(list,m=>`<button class="memo-entry" data-edit-kind="memo" data-edit-id="${escape(m.id)}" aria-label="编辑备忘：${escape((m.text||'空白备忘').split('\n')[0].slice(0,60))}"><span>${escape(m.text||'空白备忘 · 双击填写')}</span></button>`,showMemoArchived?'暂无归档备忘。':'记下灵感、资料和临时想法。点击“新增”开始。');
}
function openMemo(id=null){
  const memo=state.memos.find(m=>m.id===id);editingMemo=memo?.id||null;$('memo-dialog-title').textContent=memo?'编辑备忘':'新增备忘';$('memo-date').value=memo?C.recordDate(memo)||C.key(new Date()):C.key(new Date());$('memo-text').value=memo?.text||'';$('memo-feedback').textContent='';$('archive-memo').hidden=!memo;$('archive-memo').textContent=memo?.archived?'恢复备忘':'归档备忘';$('memo-dialog').showModal();$('memo-text').focus();
}
function saveMemoDraft(){
  const date=$('memo-date').value,text=$('memo-text').value;
  if(!C.validDate(date)){$('memo-feedback').textContent='请选择有效日期，原内容已保留。';return false;}
  let memo=state.memos.find(m=>m.id===editingMemo);if(!memo&&!text.trim())return false;
  const now=Date.now();if(memo)Object.assign(memo,{date,text,updatedAt:now});else{memo={id:crypto.randomUUID(),date,text,archived:false,createdAt:now,updatedAt:now};state.memos.push(memo);editingMemo=memo.id;showMemoArchived=false;$('memo-records').scrollTop=0;}
  $('memo-dialog-title').textContent='编辑备忘';$('memo-feedback').textContent='';$('archive-memo').hidden=false;$('archive-memo').textContent=memo.archived?'恢复备忘':'归档备忘';save();renderMemos();renderDimensions();return true;
}
function render(){renderCalendar();renderAgenda();renderTasks();renderProjects();renderRecords('business');renderRecords('development');renderFinance();renderThought();renderMemos();renderWindow();renderDimensions();}
function renderSettings(){
  $('finance-security-status').textContent=financeInfo.configured?'已设置财务密码；切换分页、收起或闲置 5 分钟后锁定。':'尚未设置密码，财务内容保持隐藏。';
  $('window-mode').value=state.mode;$('lock-setting').checked=state.locked;$('app-id').value=appId;$('app-secret').placeholder=appId?'已保存；留空沿用本机凭据':'只存入本机钥匙串';
  $('reflection-enabled').checked=state.reflectionEnabled;$('reflection-time').value=state.reflectionTime;$('reflection-prompt').value=state.prompt;$('events-enabled').checked=state.eventsEnabled;
  $('disconnect').hidden=!connected;$('account-status').textContent=connected?'飞书已连接 · 每分钟刷新，支持手动同步':'尚未连接。连接后每分钟自动同步。';
  $('cli-status').textContent=cliInfo.installed?(source==='cli'&&connected?'已通过官方 CLI 连接，只读取日历。':cliInfo.authenticated?'CLI 已登录，还需授权读取个人日历。':'官方 CLI 已安装，授权后自动同步日历。'):'未检测到官方 CLI。';$('cli-connect').textContent=source==='cli'&&connected?'重新检查连接':'连接飞书 CLI';$('authorize').textContent=connected?'重新授权':'连接飞书';$('browser-note').hidden=native;
  $('calendar-filters').innerHTML=calendars.length?'<p class="hint">选择要显示的日历</p>'+calendars.map(c=>`<label class="toggle-row"><span>${escape(c.summary_alias||c.summary||'未命名日历')}${['primary','shared'].includes(c.type)&&['owner','writer','reader'].includes(c.role)?'':'<span class="hint">该类型或权限暂不支持</span>'}</span><input type="checkbox" data-calendar="${escape(c.calendar_id)}" ${state.hiddenCalendars.includes(c.calendar_id)?'':'checked'} ${!['primary','shared'].includes(c.type)||!['owner','writer','reader'].includes(c.role)?'disabled':''}></label>`).join(''):'';
}
function select(d){if(dirty)persist();selected=d;const changed=C.monthKey(view)!==C.monthKey(d);view=new Date(d.getFullYear(),d.getMonth(),1);renderCalendar();renderAgenda();if(changed)sync();}
function openSettings(){renderSettings();$('settings-dialog').showModal();}
async function applyWindow(){renderWindow();save();if(native){try{await call('window',{mode:state.mode,locked:state.locked});}catch(e){toast(e.message);}}else toast('Mac 应用中可固定桌面和锁定位置');}
async function sync(){
  if(!native||!connected||syncing)return;
  syncing=true;syncAgain=false;syncError='';renderCalendar();const target=C.monthKey(view),generation=syncGeneration;
  const now=new Date(),months=new Map([[target,new Date(view)],[C.monthKey(now),new Date(now.getFullYear(),now.getMonth(),1)]]);
  const next=new Date(now.getFullYear(),now.getMonth()+1,1);months.set(C.monthKey(next),next);
  try{
    const updated={};let latestCalendars=[];
    for(const [key,date] of months){
      const result=await call('sync',C.bounds(date));if(generation!==syncGeneration||!connected)return;
      updated[key]={events:C.dedupe(result.events.map(x=>C.normalize(x.event,x.calendar)).filter(Boolean)),syncedAt:Date.now()};latestCalendars=result.calendars;
    }
    Object.assign(cache,updated);calendars=latestCalendars;
    await call('saveCache',{cache});$('auth-feedback').textContent='已连接，日程已更新。';
    if(state.eventsEnabled)await schedule();
  }catch(e){if(generation===syncGeneration){syncError=e.message;$('auth-feedback').textContent=e.message;}}
  finally{syncing=false;renderCalendar();renderAgenda();if($('settings-dialog').open)renderSettings();if(connected&&(syncAgain||target!==C.monthKey(view)))sync();}
}
async function schedule(){
  if(!native)return;
  const now=new Date(),validMonths=[C.monthKey(now),C.monthKey(new Date(now.getFullYear(),now.getMonth()+1,1))];
  const upcoming=C.dedupe(validMonths.flatMap(k=>cache[k]?.events||[])).filter(e=>!state.hiddenCalendars.includes(e.calendarId));
  const result=await call('notifications',{enabled:state.reflectionEnabled,time:state.reflectionTime,prompt:state.prompt,eventsEnabled:state.eventsEnabled,events:upcoming.filter(e=>!e.allDay&&e.start>Date.now()).map(e=>({id:e.id,title:e.title,start:e.start/1000}))});
  if(!result.allowed&& (state.reflectionEnabled||state.eventsEnabled))$('notification-status').textContent='尚未获得通知权限，请到“系统设置 → 通知 → 重新定义价值”允许通知。';
}
async function notificationChange(){
  if(!native){toast('系统通知在 Mac 应用中使用');renderSettings();return;}
  const before={reflectionEnabled:state.reflectionEnabled,eventsEnabled:state.eventsEnabled};
  state.reflectionEnabled=$('reflection-enabled').checked;state.reflectionTime=$('reflection-time').value||'21:00';state.eventsEnabled=$('events-enabled').checked;
  try{if((state.reflectionEnabled&&!before.reflectionEnabled)||(state.eventsEnabled&&!before.eventsEnabled)){const r=await call('requestNotifications');if(!r.allowed){state.reflectionEnabled=before.reflectionEnabled;state.eventsEnabled=before.eventsEnabled;toast('请在系统设置中允许“重新定义价值”发送通知');}}await schedule();save();renderSettings();renderThought();if(state.eventsEnabled&&!before.eventsEnabled)sync();}catch(e){toast(e.message);}
}
function showEvent(e){
  $('event-title').textContent=e.title;$('event-detail').replaceChildren();
  for(const [label,value] of [['时间',e.allDay?`${C.key(new Date(e.start))} · 全天${e.end-e.start>86400000?' · 至 '+C.key(new Date(e.end-1)):''}`:new Date(e.start).toLocaleString('zh-CN',{month:'long',day:'numeric',hour:'2-digit',minute:'2-digit'})+' — '+new Date(e.end).toLocaleString('zh-CN',{month:'long',day:'numeric',hour:'2-digit',minute:'2-digit'})],['日历',e.calendar],['地点',e.location],['时区',e.timezone],['备注',e.description]]){
    if(!value)continue;const row=document.createElement('div');row.className='detail-line';const title=document.createElement('span');title.className='detail-label';title.textContent=label;row.append(title,document.createTextNode(value));$('event-detail').append(row);
  }
  if(e.link){const button=document.createElement('button');button.className='primary-button';button.textContent='在飞书中查看';button.onclick=()=>openURL(e.link);$('event-detail').append(button);}
  if(e.meeting){const button=document.createElement('button');button.className='secondary-button';button.textContent='打开会议';button.style.marginLeft='8px';button.onclick=()=>openURL(e.meeting.startsWith('https://')?e.meeting:'https://'+e.meeting);$('event-detail').append(button);}
  $('event-dialog').showModal();
}
function openURL(url){if(!/^https?:\/\//i.test(url)){toast('此链接格式暂不支持');return;}if(native)call('openURL',{url}).catch(e=>toast(e.message));else window.open(url,'_blank','noopener,noreferrer');}
let suppressCalendarClick=false,calendarPointer=null,wheelGesture={last:0,total:0,used:false};
function navigateMonth(delta){select(C.shiftMonth(selected,delta));}
$('calendar').addEventListener('click',e=>{if(suppressCalendarClick){e.preventDefault();return;}const b=e.target.closest('[data-day]');if(b)select(C.fromKey(b.dataset.day));});
$('prev').onclick=()=>navigateMonth(-1);$('next').onclick=()=>navigateMonth(1);$('today').onclick=()=>select(new Date());
$('calendar').addEventListener('pointerdown',e=>{if(e.button===0&&e.isPrimary!==false)calendarPointer={x:e.clientX,y:e.clientY};});
$('calendar').addEventListener('pointercancel',()=>{calendarPointer=null;});
$('calendar').addEventListener('pointerup',e=>{if(!calendarPointer)return;const dx=e.clientX-calendarPointer.x,dy=e.clientY-calendarPointer.y;calendarPointer=null;if(Math.abs(dx)>=55&&Math.abs(dx)>Math.abs(dy)*1.4){suppressCalendarClick=true;navigateMonth(dx<0?1:-1);setTimeout(()=>{suppressCalendarClick=false;},0);}});
$('calendar').addEventListener('wheel',e=>{if(e.ctrlKey||Math.abs(e.deltaX)<=Math.abs(e.deltaY)||Math.abs(e.deltaX)<2)return;e.preventDefault();const now=Date.now();if(now-wheelGesture.last>220)wheelGesture={last:now,total:0,used:false};wheelGesture.last=now;wheelGesture.total+=e.deltaX;if(!wheelGesture.used&&Math.abs(wheelGesture.total)>=65){wheelGesture.used=true;navigateMonth(wheelGesture.total>0?1:-1);}},{passive:false});
$('dimensions').onclick=e=>{const tab=e.target.closest('[data-dimension]');if(tab)switchDimension(tab.dataset.dimension);};
$('dimensions').addEventListener('keydown',e=>{const index=dimensions.indexOf(state.activeDimension);let target;if(e.key==='ArrowRight')target=(index+1)%dimensions.length;else if(e.key==='ArrowLeft')target=(index+dimensions.length-1)%dimensions.length;else if(e.key==='Home')target=0;else if(e.key==='End')target=dimensions.length-1;else return;e.preventDefault();switchDimension(dimensions[target]);$('tab-'+dimensions[target]).focus();});
for(const kind of ['business','development']){$('add-'+kind).onclick=()=>openRecord(kind);$(kind+'-records').onclick=e=>recordClick(kind,e);$(kind+'-archived').onclick=()=>{recordArchiveView[kind]=!recordArchiveView[kind];renderRecords(kind);};}
$('record-form').onsubmit=e=>{
  e.preventDefault();if(!editingRecord)return;const {kind,id}=editingRecord,title=$('record-title').value.trim(),date=$('record-date').value;
  if(!title){$('record-title').focus();return;}if(!C.validDate(date)){$('record-feedback').textContent='请选择有效日期。';return;}
  const startTime=kind==='development'?$('record-start').value:'',endTime=kind==='development'?$('record-end').value:'';
  if(startTime&&endTime&&startTime>=endTime){$('record-feedback').textContent='结束时间需要晚于开始时间。';return;}
  const existing=state[kind].find(r=>r.id===id),now=Date.now(),data={title,date,subject:$('record-subject').value.trim(),status:$('record-status').value,startTime,endTime,notes:$('record-notes').value.trim(),updatedAt:now};
  if(data.status==='done'){data.completedAt=existing?.completedAt||now;if(existing&&existing.status!=='done')data.resumeStatus=existing.status;}else data.completedAt=null;
  if(existing)Object.assign(existing,data);else state[kind].push({id:crypto.randomUUID(),archived:false,createdAt:now,...data});
  save();renderRecords(kind);renderDimensions();renderCalendar();if(!existing)$(kind+'-records').scrollTop=0;$('record-dialog').close();
};
$('archive-record').onclick=()=>{if(!editingRecord)return;const {kind,id}=editingRecord,record=state[kind].find(r=>r.id===id);if(!record)return;record.archived=!record.archived;record.updatedAt=Date.now();if(!record.archived)recordArchiveView[kind]=false;save();renderRecords(kind);renderDimensions();renderCalendar();$('record-dialog').close();toast(record.archived?'记录已归档，可随时恢复':'记录已恢复');};
$('settings').onclick=openSettings;$('connection').onclick=openSettings;$('thought-reminder').onclick=()=>{openSettings();$('reflection-enabled').focus();};
$('refresh').onclick=()=>{if(connected)sync();else openSettings();};
$('lock').onclick=()=>{state.locked=!state.locked;applyWindow();};$('lock-setting').onchange=()=>{state.locked=$('lock-setting').checked;applyWindow();};$('window-mode').onchange=()=>{state.mode=$('window-mode').value;applyWindow();};
$('hide').onclick=async()=>{await lockFinancialView();if(native)await call('hide');else toast('Mac 应用收起后，可从菜单栏再次打开');};
$('drag-area').addEventListener('mousedown',e=>{if(native&&!state.locked&&!e.target.closest('button'))call('drag');});
$('add-task').onsubmit=e=>{e.preventDefault();const title=$('task-input').value.trim();if(!title)return;state.tasks.push({id:crypto.randomUUID(),title,date:C.key(new Date()),time:$('task-input-time').value,done:false,createdAt:Date.now()});$('task-input').value='';$('task-input-time').value='';save();renderTasks();renderDimensions();renderCalendar();$('tasks').scrollTop=0;};
function taskClick(e){
  const check=e.target.closest('[data-check]'),del=e.target.closest('[data-delete]'),edit=e.target.closest('[data-task-edit]');
  if(check){const task=state.tasks.find(t=>t.id===check.dataset.check);if(task)C.toggleTask(task,new Date());}
  if(del)state.tasks=state.tasks.filter(t=>t.id!==del.dataset.delete);
  if(check||del){save();renderTasks();renderDimensions();renderCalendar();}
  else if(edit)openTask(edit.dataset.taskEdit);
}
$('tasks').onclick=taskClick;
$('add-project').onclick=()=>openProject();$('show-archived').onclick=()=>{showArchived=!showArchived;renderProjects();};
function projectClick(e){
  const check=e.target.closest('[data-project-check]'),row=e.target.closest('[data-project]');
  if(check){const project=state.projects.find(p=>p.id===check.dataset.projectCheck);if(project){C.toggleProject(project);save();renderProjects();renderDimensions();}}
  else if(row)openProject(row.dataset.project);
}
$('projects').onclick=projectClick;
$('project-form').onsubmit=e=>{
  e.preventDefault();const name=$('project-name').value.trim();if(!name){$('project-name').focus();return;}
  const date=$('project-date').value;if(!C.validDate(date)){$('project-date').focus();return;}
  const existing=state.projects.find(p=>p.id===editingProject),now=Date.now();
  const data={name,date,nextStep:$('project-next').value.trim(),updatedAt:now};
  if(existing)Object.assign(existing,data);else{state.projects.push({id:crypto.randomUUID(),archived:false,createdAt:now,status:'active',progress:0,completedAt:null,...data});showArchived=false;}
  save();renderProjects();renderDimensions();if(!existing)$('projects').scrollTop=0;$('project-dialog').close();
};
$('archive-project').onclick=()=>{const p=state.projects.find(p=>p.id===editingProject);if(!p)return;p.archived=!p.archived;if(!p.archived)showArchived=false;p.updatedAt=Date.now();save();renderProjects();renderDimensions();$('project-dialog').close();toast(p.archived?'项目已归档，可随时恢复':'项目已恢复');};
$('add-finance').onclick=()=>openFinance();
$('finance-type').onchange=()=>renderFinanceStatuses($('finance-status').value);
$('finance-archived').onclick=()=>{showFinanceArchived=!showFinanceArchived;renderFinance();};
$('finance-unlock').onclick=unlockFinance;$('finance-lock-now').onclick=()=>void lockFinancialView();
$('finance-password').onclick=async()=>{if(!native){toast('请在 Mac 应用中设置财务密码');return;}try{await lockFinancialView();const result=await call('financePassword');financeInfo=result.info||financeInfo;clearFinance();renderSettings();if(result.changed)toast('财务密码已更新');}catch(e){toast(e.message);}};
$('finance-form').onsubmit=async e=>{
  e.preventDefault();if(!financeUnlocked)return;const title=$('finance-title').value.trim(),date=$('finance-date').value,amount=C.amountCents($('finance-amount').value);
  if(!title){$('finance-title').focus();return;}if(!C.validDate(date)){$('finance-feedback').textContent='请选择有效日期。';return;}if(amount===null){$('finance-feedback').textContent='请输入大于 0 的金额，最多两位小数。';return;}
  const type=$('finance-type').value==='income'?'income':'expense',stage=$('finance-status').value,status=type==='income'&&Object.hasOwn(financeIncomeStages,stage)?stage:stage==='settled'?'settled':'pending';
  const existing=state.finance.find(r=>r.id===editingFinance),now=Date.now(),data={title,date,amountCents:amount,type,status,party:$('finance-party').value.trim(),notes:$('finance-notes').value.trim(),updatedAt:now};
  if(existing)Object.assign(existing,data);else{state.finance.push({id:crypto.randomUUID(),createdAt:now,archived:false,...data});showFinanceArchived=false;}
  save();renderFinance();renderDimensions();if(!existing)$('finance-records').scrollTop=0;try{await persist();$('finance-dialog').close();}catch(e){$('finance-feedback').textContent=e.message;}
};
$('archive-finance').onclick=async()=>{if(!financeUnlocked)return;const r=state.finance.find(x=>x.id===editingFinance);if(!r)return;r.archived=!r.archived;r.updatedAt=Date.now();if(!r.archived)showFinanceArchived=false;save();renderFinance();renderDimensions();await persist();$('finance-dialog').close();};
$('write-review').onclick=()=>openReview();
$('add-memo').onclick=()=>openMemo();$('memo-archived').onclick=()=>{showMemoArchived=!showMemoArchived;renderMemos();};
$('memo-text').addEventListener('input',saveMemoDraft);$('memo-date').onchange=saveMemoDraft;$('memo-text').addEventListener('blur',()=>{if(dirty)persist();});
$('memo-text').addEventListener('keydown',e=>{if(e.key==='Enter')e.stopPropagation();});
$('memo-form').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.isComposing&&!e.target.closest('textarea,button')){e.preventDefault();$('memo-text').focus();}});
$('memo-form').onsubmit=async e=>{e.preventDefault();if(!saveMemoDraft()){if(!$('memo-text').value.trim())$('memo-feedback').textContent='先写一点内容。';return;}await persist();$('memo-dialog').close();};
$('archive-memo').onclick=async()=>{const memo=state.memos.find(m=>m.id===editingMemo);if(!memo)return;memo.archived=!memo.archived;memo.updatedAt=Date.now();if(!memo.archived)showMemoArchived=false;save();renderMemos();renderDimensions();await persist();$('memo-dialog').close();};

$('review-edit').addEventListener('input',()=>{if(!C.validDate(reviewEditDate))return;updateThought(reviewEditDate,$('review-edit').value);renderThought();renderCalendar();});
$('review-edit').addEventListener('blur',()=>{if(dirty)persist();});
$('review-date').onchange=()=>{const date=$('review-date').value;if(!C.validDate(date)||date>C.key(new Date())){$('review-date').value=reviewEditDate;return;}if(dirty)persist();reviewEditDate=date;$('review-edit').value=state.thoughts[date]||'';};
function renderHistory(){
  const query=$('history-search').value.trim().toLocaleLowerCase(),entries=Object.entries(state.thoughts).filter(([date,text])=>typeof text==='string'&&text.trim()).sort((a,b)=>b[0].localeCompare(a[0]));
  const filtered=entries.filter(([date,text])=>(date+' '+text).toLocaleLowerCase().includes(query));
  $('history-count').textContent=entries.length+' 篇复盘 · '+(query?'找到 '+filtered.length+' 篇':'按日期自动保存');
  $('history-list').innerHTML=filtered.length?filtered.map(([date,text])=>`<button class="history-entry" data-history="${escape(date)}"><time>${escape(date)}</time><span>${escape(text.trim().slice(0,160))}</span><small>${Array.from(text).length} 字 ↗</small></button>`).join(''):'<p class="hint">'+(query?'没有匹配的复盘。':'写下第一篇复盘，这里会自动留下记录。')+'</p>';
}
$('thought-history').onclick=()=>{if(dirty)persist();$('history-search').value='';renderHistory();$('history-dialog').showModal();};
$('history-search').oninput=renderHistory;
$('history-list').ondblclick=e=>{const row=e.target.closest('[data-history]');if(row){$('history-dialog').close();openReview(row.dataset.history);}};
$('open-archive').onclick=()=>native?call('openArchive').catch(e=>toast(e.message)):toast('独立归档文件在 Mac 应用中使用');
$('task-form').onsubmit=e=>{
  e.preventDefault();const title=$('task-title').value.trim(),date=$('task-date').value;if(!title)return;if(!C.validDate(date)){$('task-feedback').textContent='请选择有效日期。';return;}
  const existing=state.tasks.find(t=>t.id===editingTask),now=Date.now(),data={title,date,time:$('task-time').value,updatedAt:now};if(existing)Object.assign(existing,data);else state.tasks.push({id:crypto.randomUUID(),createdAt:now,done:false,...data});save();renderTasks();renderCalendar();renderDimensions();$('task-dialog').close();
};
$('add-all').onclick=()=>{const kind=$('all-kind').value;if(kind==='tasks')openTask();else if(kind==='projects')openProject();else if(kind==='review')openReview();else if(kind==='memo')openMemo();else openRecord(kind);};
for(const style of ['short','long'])$('view-'+style).onclick=()=>{state.listStyle=style;renderDimensions();save();};
function editWritten(kind,id){if(kind==='tasks')openTask(id);else if(kind==='projects')openProject(id);else if(kind==='business'||kind==='development')openRecord(kind,id);else if(kind==='finance')openFinance(id);else if(kind==='review')openReview(id);else if(kind==='memo')openMemo(id);}
function editRecordEvent(e){
  if(e.target.closest('[data-check],[data-delete],[data-project-check],[data-record-check],textarea,input,select,[contenteditable="true"]'))return false;
  const row=e.target.closest('[data-edit-kind]');if(!row)return false;editWritten(row.dataset.editKind,row.dataset.editId);return true;
}
for(const id of ['tasks','projects','business-records','development-records','finance-records','review-records','all-records','memo-records']){
  $(id).ondblclick=editRecordEvent;$(id).onkeydown=e=>{if((e.key==='Enter'||e.key==='F2')&&!e.isComposing&&editRecordEvent(e))e.preventDefault();};
}
$('all-records').onclick=e=>{const row=e.target.closest('[data-edit-kind]');if(!row)return;const kind=row.dataset.editKind;if(kind==='tasks')taskClick(e);else if(kind==='projects')projectClick(e);else if(kind==='review'||kind==='memo')editWritten(kind,row.dataset.editId);else recordClick(kind,e);};
for(const type of ['pointerdown','keydown','input'])document.addEventListener(type,touchFinance);
$('cli-connect').onclick=async()=>{if(!native){toast('请在 Mac 应用中连接飞书');return;}$('cli-connect').disabled=true;try{const result=await call('cliConnect');$('auth-feedback').textContent=result.ready?'已连接，正在同步…':'请在飞书授权页面确认日历只读权限，完成后自动同步。';}catch(e){$('auth-feedback').textContent=e.message;}finally{$('cli-connect').disabled=false;}};
async function detectCLI(){
  if(!native||connected||syncing)return;
  try{const info=await call('cliStatus');cliInfo=info.cli||{};if(info.connected){source=info.source;await window.nativeEvent('authorized',{source});}if($('settings-dialog').open)renderSettings();}catch{}
}
document.querySelectorAll('.close-dialog').forEach(b=>b.onclick=()=>b.closest('dialog').close());
for(const d of document.querySelectorAll('dialog'))d.addEventListener('click',e=>{if(e.target===d){const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)d.close();}});
$('setup-help').onclick=()=>$('help-dialog').showModal();$('developer-console').onclick=()=>openURL('https://open.feishu.cn/app');
$('copy-callback').onclick=async()=>{try{if(native)await call('copy',{text:'http://127.0.0.1:41863/callback'});else await navigator.clipboard.writeText('http://127.0.0.1:41863/callback');toast('已复制回调地址');}catch{toast('请选中并复制回调地址');}};
$('authorize').onclick=async()=>{if(!native){toast('请在 Mac 应用中连接飞书');return;}const id=$('app-id').value.trim(),secret=$('app-secret').value.trim();if(!id){$('auth-feedback').textContent='请先填写 App ID';return;}$('authorize').disabled=true;try{await call('authorize',{appId:id,secret});appId=id;$('app-secret').value='';$('auth-feedback').textContent='请在打开的浏览器中确认授权，完成后自动返回。';}catch(e){$('auth-feedback').textContent=e.message;}finally{$('authorize').disabled=false;}};
$('disconnect').onclick=async()=>{try{await call('disconnect');syncGeneration++;connected=false;cache={};calendars=[];demo=false;state.showDemo=false;appId='';syncError='';state.hiddenCalendars=[];await call('saveCache',{cache});await schedule();save();render();renderSettings();toast('已断开飞书，本地记录已保留');}catch(e){toast(e.message);}};
$('calendar-filters').onchange=e=>{const id=e.target.dataset.calendar;if(!id)return;if(e.target.checked)state.hiddenCalendars=state.hiddenCalendars.filter(x=>x!==id);else state.hiddenCalendars.push(id);save();renderCalendar();renderAgenda();schedule().catch(e=>toast(e.message));};
for(const id of ['reflection-enabled','reflection-time','events-enabled'])$(id).onchange=notificationChange;
$('reflection-prompt').onchange=()=>{state.prompt=$('reflection-prompt').value.trim()||defaultState.prompt;save();renderThought();schedule().catch(e=>toast(e.message));};
$('export').onclick=async()=>{try{if(dirty)await persist();const data=JSON.stringify({exportedAt:new Date().toISOString(),tasks:state.tasks,projects:state.projects,business:state.business,development:state.development,finance:financeUnlocked?state.finance:[],memos:state.memos,thoughts:state.thoughts},null,2);if(native){const r=await call('export',{data,includeFinance:financeUnlocked});if(r.saved)toast(r.financeIncluded?'记录已导出（含财务）':'其他记录已导出；财务未包含');}else{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([data],{type:'application/json'}));a.download='重新定义价值记录-'+C.key(new Date())+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),500);}}catch(e){toast(e.message);}};
document.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key==='s'){e.preventDefault();persist();toast('记录已保存');}});
function refreshDay(){
  const now=new Date(),day=C.key(now);if(day===currentDay)return false;
  if(dirty)persist();currentDay=day;select(now);renderTasks();renderThought();renderDimensions();$('review-date').max=day;if($('history-dialog').open)renderHistory();return true;
}
function scheduleDayChange(){clearTimeout(dayTimer);dayTimer=setTimeout(()=>{refreshDay();scheduleDayChange();},Math.max(100,C.untilNextDay(new Date()))+20);}
document.addEventListener('visibilitychange',()=>{if(document.hidden&&dirty)persist();if(!document.hidden){refreshDay();scheduleDayChange();sync();}});
window.addEventListener('focus',()=>{refreshDay();scheduleDayChange();});
window.addEventListener('beforeunload',()=>{if(dirty)persist();});
async function init(){
  document.body.classList.add(native?'native':'preview');
  try{if(native){const data=await call('bootstrap');state={...defaultState,...data.state};connected=data.connected;source=data.source||'api';cliInfo=data.cli||{};financeInfo=data.finance||financeInfo;state.finance=[];if(data.financeWarning)toast(data.financeWarning);if(data.archiveWarning)toast(data.archiveWarning);cache=data.cache||{};appId=data.appId||'';demo=!connected&&state.showDemo;if(data.firstRun){state.tasks=[{id:crypto.randomUUID(),title:'写下今天最重要的一件事',date:C.key(new Date()),done:false}];}await call('window',{mode:state.mode,locked:state.locked});}else{state={...defaultState,...JSON.parse(localStorage.getItem('zaichang-preview')||'{}')};demo=true;}}
  catch(e){toast(e.message);}
  for(const kind of ['tasks','projects','business','development','finance','memos'])if(!Array.isArray(state[kind]))state[kind]=[];
  if(!state.thoughts||typeof state.thoughts!=='object'||Array.isArray(state.thoughts))state.thoughts={};
  financeUnlocked=false;state.calendarExpanded=true;state.activeDimension='all';state.listStyle='long';
  render();$('save-status').textContent=native?'保存在这台 Mac':'保存在此浏览器';if(connected)await sync();
  refreshDay();scheduleDayChange();setInterval(()=>{refreshDay();if(connected)sync();else detectCLI();},60000);
}
init();
