(function (root) {
  const pad = n => String(n).padStart(2, '0');
  const key = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  const fromKey = s => { const [y,m,d]=s.split('-').map(Number); return new Date(y,m-1,d); };
  const monthKey = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}`;
  const bounds = d => ({start:new Date(d.getFullYear(),d.getMonth(),1).getTime()/1000,end:new Date(d.getFullYear(),d.getMonth()+1,1).getTime()/1000});
  function eventTime(t) {
    if (t && t.date) return fromKey(t.date).getTime();
    return Number(t?.timestamp)*1000;
  }
  function normalize(raw, calendar) {
    const start=eventTime(raw.start_time), end=eventTime(raw.end_time);
    if (!Number.isFinite(start)||!Number.isFinite(end)||end<start||raw.status==='cancelled') return null;
    const rgb=raw.color && raw.color!==-1 ? raw.color : calendar.color;
    return {id:calendar.calendar_id+':'+raw.event_id, eventId:raw.event_id,calendarId:calendar.calendar_id,
      calendar:calendar.summary_alias||calendar.summary||'飞书日历',title:raw.summary||'未命名日程',
      start,end,allDay:Boolean(raw.start_time?.date),timezone:raw.start_time?.timezone||'',
      description:raw.description||'',location:raw.location?.name||raw.location?.address||'',
      link:raw.app_link||'',meeting:raw.vchat?.meeting_url||'',
      color:rgb&&rgb!==-1?'#'+(rgb&0xffffff).toString(16).padStart(6,'0'):'#287568'};
  }
  function onDay(events, date) {
    const start=fromKey(key(date)).getTime(), end=new Date(date.getFullYear(),date.getMonth(),date.getDate()+1).getTime();
    return events.filter(e=>e.start<end&&(e.end>start||(e.end===e.start&&e.start>=start)))
      .sort((a,b)=>Number(b.allDay)-Number(a.allDay)||a.start-b.start||a.title.localeCompare(b.title));
  }
  function dedupe(events) { return [...new Map(events.map(e=>[e.id,e])).values()]; }
  function tasksOnDay(tasks, date) {
    const day=key(date);
    return tasks.filter(t=>t.date===day || (!t.done && t.date<day) || (t.done && t.completedOn===day))
      .sort((a,b)=>Number(Boolean(a.done))-Number(Boolean(b.done)) || a.date.localeCompare(b.date));
  }
  function toggleTask(task, date) {
    task.done=!task.done;
    if(task.done)task.completedOn=key(date);else delete task.completedOn;
  }
  const projectDone=p=>p.status==='done' || Number(p.progress)>=100;
  function toggleProject(project, now=Date.now()) {
    if(projectDone(project)) {
      project.status=['active','waiting','blocked'].includes(project.resumeStatus)?project.resumeStatus:'active';
      project.progress=Math.max(0,Math.min(99,Number(project.resumeProgress)||0));
      delete project.completedAt;
    }else {
      project.resumeStatus=project.status;project.resumeProgress=project.progress;
      project.status='done';project.progress=100;project.completedAt=now;
    }
    project.updatedAt=now;
  }
  const untilNextDay=now=>new Date(now.getFullYear(),now.getMonth(),now.getDate()+1).getTime()-now.getTime();
  function shiftMonth(date, delta) {
    const first=new Date(date.getFullYear(),date.getMonth()+delta,1);
    return new Date(first.getFullYear(),first.getMonth(),Math.min(date.getDate(),new Date(first.getFullYear(),first.getMonth()+1,0).getDate()));
  }
  const validDate=s=>typeof s==='string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && key(fromKey(s))===s;
  function recordsOnDay(records,date,archived=false) {
    const day=key(date);
    return records.filter(r=>r.date===day && Boolean(r.archived)===archived)
      .sort((a,b)=>Number(a.status==='done')-Number(b.status==='done') || (a.startTime||'99:99').localeCompare(b.startTime||'99:99') || (b.updatedAt||0)-(a.updatedAt||0));
  }
  function toggleRecord(record,now=Date.now()) {
    if(record.status==='done'){record.status=['planned','working','waiting','blocked'].includes(record.resumeStatus)?record.resumeStatus:'planned';delete record.completedAt;}
    else{record.resumeStatus=record.status;record.status='done';record.completedAt=now;}
    record.updatedAt=now;
  }
  function recordDate(record) {
    if(validDate(record.date))return record.date;
    const stamp=record.createdAt||record.updatedAt;
    return Number.isFinite(stamp)&&stamp>0?key(new Date(stamp)):'';
  }
  function timelineGroups(records) {
    const groups=new Map();
    for(const [index,record] of records.entries()){
      const date=recordDate(record);
      if(!groups.has(date))groups.set(date,[]);
      groups.get(date).push({record,index});
    }
    return [...groups].sort(([a],[b])=>b.localeCompare(a)).map(([date,items])=>({date,items:items.sort((a,b)=>(b.record.updatedAt||b.record.createdAt||0)-(a.record.updatedAt||a.record.createdAt||0)||b.index-a.index).map(x=>x.record)}));
  }
  function amountCents(value) {
    const text=String(value).trim();
    if(!/^\d{1,10}(\.\d{1,2})?$/.test(text))return null;
    const [whole,fraction='']=text.split('.'),amount=Number(whole)*100+Number(fraction.padEnd(2,'0'));
    return Number.isSafeInteger(amount)&&amount>0?amount:null;
  }
  function financeTotals(records) {
    const totals={negotiating:0,delivery:0,pending:0,revenue:0};
    for(const r of records){
      if(r.archived||r.type!=='income'||!Number.isSafeInteger(r.amountCents)||r.amountCents<=0)continue;
      const bucket=r.status==='settled'?'revenue':r.status==='negotiating'?'negotiating':r.status==='delivery'?'delivery':'pending';
      totals[bucket]+=r.amountCents;
    }
    return totals;
  }
  function workFeed(state) {
    return ['tasks','projects','business','development'].flatMap(kind=>(state[kind]||[]).filter(r=>!r.archived).map(r=>({...r,kind,date:recordDate(r),title:kind==='projects'?r.name:r.title})));
  }
  const api={pad,key,fromKey,monthKey,bounds,normalize,onDay,dedupe,tasksOnDay,toggleTask,projectDone,toggleProject,untilNextDay,shiftMonth,validDate,recordsOnDay,toggleRecord,recordDate,timelineGroups,amountCents,financeTotals,workFeed};
  if(typeof module!=='undefined')module.exports=api; else root.Core=api;
})(typeof window!=='undefined'?window:globalThis);
