// Keep one location prompt until the conversation moves on. Reusing its ID
// preserves the picker's local search and selected result across repeated sends.
export function locationPromptId(chat,fallback){
  for(let i=chat.length-1;i>=0;i--){if(chat[i].role==='user')break;if(chat[i].widget==='location')return chat[i].id;}
  return fallback;
}
export function upsertLocationPrompt(chat,turn){
  let boundary=chat.length-1;while(boundary>=0&&chat[boundary].role!=='user')boundary--;
  const prefix=chat.slice(0,boundary+1),tail=chat.slice(boundary+1);
  return [...prefix,...tail.filter(item=>item.widget!=='location'),turn].slice(-60);
}
