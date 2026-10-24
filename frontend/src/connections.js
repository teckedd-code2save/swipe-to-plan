export function connectedPeople(user,circles){
  if(!user)return [];
  return [...new Map(circles.flatMap(c=>c.people.filter(p=>c.accountIds?.includes(p.id)&&p.id!==user.id)).map(p=>[p.id,p])).values()];
}

export function newlyJoinedPeople(circle,knownIds){
  return circle.people.filter(p=>circle.accountIds?.includes(p.id)&&!knownIds.includes(p.id));
}
