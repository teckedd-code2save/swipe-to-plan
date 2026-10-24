// Keep the reason for the outing as well as recent corrections. This stays in
// chat context; personal concerns must not become shareable plan metadata.
export function conversationHistory(turns) {
  const messages=turns.filter(t=>['user','assistant'].includes(t.role)&&typeof t.text==='string'&&t.text.trim());
  const selected=messages.length<=16?messages:[...messages.slice(0,4),...messages.slice(-12)];
  return selected.map(({role,text})=>({role,text:text.slice(0,1600)}));
}
