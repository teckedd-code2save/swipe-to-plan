export function localDate(timeZone,offset=0,now=Date.now()) {
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:timeZone||Intl.DateTimeFormat().resolvedOptions().timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
  const get=key=>parts.find(p=>p.type===key).value;
  const date=new Date(`${get('year')}-${get('month')}-${get('day')}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate()+offset);return date.toISOString().slice(0,10);
}
export const needsTiming=brief=>brief.timing&&(brief.timing.dateConfirmed===false||brief.timing.timeConfirmed===false);
export const timingLabel=brief=>brief.timing?.timeConfirmed===false?'Choose a time':brief.timing?.mode==='flexible'?`Find a time between ${brief.startTime}–${brief.endTime}`:`Start ${brief.startTime} · back by ${brief.endTime}`;
