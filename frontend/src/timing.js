export function localDate(timeZone,offset=0,now=Date.now()) {
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:timeZone||Intl.DateTimeFormat().resolvedOptions().timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
  const get=key=>parts.find(p=>p.type===key).value;
  const date=new Date(`${get('year')}-${get('month')}-${get('day')}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate()+offset);return date.toISOString().slice(0,10);
}
export const needsTiming=brief=>brief.timing&&(brief.timing.dateConfirmed===false||brief.timing.timeConfirmed===false);
export const timingLabel=brief=>brief.timing?.timeConfirmed===false?'Choose a time':brief.timing?.window==='any'?'Find a time from reported opening hours':brief.timing?.mode==='flexible'?`Find a time between ${brief.startTime}–${brief.endTime}`:`Start ${brief.startTime} · back by ${brief.endTime}`;


// The weekend is a range, not a silently chosen visit date.
export function weekendChoices(history,timeZone,now=Date.now()) {
  const recent=[...(history||[])].reverse().filter(turn=>turn.role==='user');
  const temporal=recent.find(turn=>/\b(?:weekend|today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next week|\d{4}-\d{2}-\d{2})\b/i.test(turn.text||''));
  if(!temporal||!/\bthis weekend\b/i.test(temporal.text||''))return [];
  const today=localDate(timeZone,0,now),day=new Date(`${today}T12:00:00Z`).getUTCDay();
  if(day===0)return [[today,'Sunday']];
  const saturday=6-day;
  return [[localDate(timeZone,saturday,now),'Saturday'],[localDate(timeZone,saturday+1,now),'Sunday']];
}
