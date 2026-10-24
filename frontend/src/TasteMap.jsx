import { useMemo, useState } from 'react';
import { Icon, Sun, PERSON_COLORS } from './PlannerIcons.jsx';

export default function TasteMap({plan,initialSelection,onEdit}) {
  const [selected,setSelected]=useState(initialSelection||null);
  const [personFilter,setPersonFilter]=useState('all');
  const {nodes,edges}=plan.tasteMap;
  const people=nodes.filter(n=>n.kind==='person');
  const preferences=nodes.filter(n=>['artist','vibe'].includes(n.kind));
  const shown=preferences.filter(n=>personFilter==='all'||n.personId===personFilter).slice(0,18);
  const stops=nodes.filter(n=>n.kind==='stop');
  const height=Math.max(430,shown.length*51+120);
  const positions=new Map();
  people.forEach((n,i)=>positions.set(n.id,{x:92,y:100+(height-190)*(people.length===1?.5:i/(people.length-1))}));
  shown.forEach((n,i)=>positions.set(n.id,{x:355,y:95+i*51}));
  stops.forEach((n,i)=>positions.set(n.id,{x:640,y:105+(height-210)*(stops.length===1?.5:i/(stops.length-1))}));
  const visibleEdges=edges.filter(e=>positions.has(e.from)&&positions.has(e.to));
  const focus=nodes.find(n=>n.id===selected);
  const highlighted=useMemo(()=>{
    if(!selected)return new Set(edges.map(e=>e.id));
    const node=nodes.find(n=>n.id===selected);
    if(node?.kind==='person')return new Set(edges.filter(e=>e.personId===selected||e.from===selected).map(e=>e.id));
    if(node?.kind==='stop') {const related=edges.filter(e=>e.to===selected);return new Set([...related,...edges.filter(e=>related.some(r=>r.from===e.to))].map(e=>e.id));}
    return new Set(edges.filter(e=>e.from===selected||e.to===selected).map(e=>e.id));
  },[selected,nodes,edges]);
  const color=(personId)=>PERSON_COLORS[people.findIndex(p=>p.id===personId)%PERSON_COLORS.length]||'#7d8877';
  const select=(id)=>setSelected(selected===id?null:id);
  const interactions=(node)=>({role:'button',tabIndex:0,'aria-label':`Explore ${node.label}`,'aria-pressed':selected===node.id,onClick:()=>select(node.id),onKeyDown:(e)=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();select(node.id);}}});
  if(!preferences.length)return <div className="pl-empty-map"><Sun size={64}/><h2>A day with your fingerprints on it.</h2><p>Add a favorite artist or a few things you enjoy. Then follow the connections from your taste to your day.</p><button className="pl-button" onClick={onEdit}>Add your tastes <Icon name="plus" size={16}/></button></div>;
  const detailEdges=edges.filter(e=>e.kind!=='preference'&&highlighted.has(e.id));
  return <section className="pl-taste-map">
    <div className="pl-section-heading"><div><p className="pl-kicker">FOLLOW THE CONNECTIONS</p><h2>Your people. Your tastes. Your day.</h2><p>Select a person, a preference, or a stop to see the threads between them.</p></div><span className="pl-outline-badge"><Icon name="nodes" size={14}/> Taste by Qloo</span></div>
    <div className="pl-map-filters"><button className={personFilter==='all'?'selected':''} onClick={()=>{setPersonFilter('all');setSelected(null);}}>Everyone</button>{people.map(person=><button key={person.id} className={personFilter===person.id?'selected':''} onClick={()=>{setPersonFilter(person.id);setSelected(person.id);}}><i style={{background:color(person.id)}}/>{person.label}</button>)}</div>
    <div className="pl-map-scroll"><svg className="pl-connection-canvas" viewBox={`0 0 860 ${height}`} role="group" aria-label="Interactive taste connections">
      <defs><pattern id="taste-dots" x="0" y="0" width="22" height="22" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".7" fill="#ddd9cf"/></pattern></defs>
      <rect width="860" height={height} fill="url(#taste-dots)"/>
      <text x="92" y="36" textAnchor="middle" className="pl-map-column">THE PEOPLE</text><text x="355" y="36" textAnchor="middle" className="pl-map-column">WHAT THEY LOVE</text><text x="712" y="36" textAnchor="middle" className="pl-map-column">WHERE IT LEADS</text>
      {visibleEdges.map(edge=>{const from=positions.get(edge.from),to=positions.get(edge.to);const x1=from.x+(edge.kind==='preference'?28:95),x2=to.x-(edge.kind==='preference'?95:0);return <path className={`pl-taste-path ${selected&&highlighted.has(edge.id)?'active':''}`} key={edge.id} d={`M${x1} ${from.y} C${x1+(x2-x1)*.5} ${from.y},${x2-(x2-x1)*.5} ${to.y},${x2} ${to.y}`} fill="none" stroke={color(edge.personId||nodes.find(n=>n.id===edge.to)?.personId)} strokeWidth={edge.kind==='preference'?1.5:edge.kind==='affinity'?2.5:2} strokeDasharray={edge.kind==='search_signal'?'4 7':undefined} opacity={!selected||highlighted.has(edge.id)? .65:.08}/>;})}
      {people.map(node=>{const p=positions.get(node.id);return <g key={node.id} {...interactions(node)} className="pl-graph-node"><circle cx={p.x} cy={p.y} r="29" fill={color(node.id)} stroke={selected===node.id?'#292b26':'#fff'} strokeWidth="3"/><text x={p.x} y={p.y+6} textAnchor="middle" fill="white" fontSize="17" fontWeight="600">{node.label.slice(0,2).toUpperCase()}</text><text x={p.x} y={p.y+49} textAnchor="middle" className="pl-person-label">{node.label}</text></g>;})}
      {shown.map(node=>{const p=positions.get(node.id);return <g key={node.id} {...interactions(node)} className="pl-graph-node"><rect x={p.x-95} y={p.y-18} width="190" height="36" rx="18" fill={selected===node.id?'#f4eadc':'#fffefa'} stroke={selected===node.id?color(node.personId):'#ddd9ce'} strokeWidth={selected===node.id?2:1}/><circle cx={p.x-77} cy={p.y} r="4" fill={node.status==='unresolved'?'#c1bbae':color(node.personId)}/><text x={p.x-62} y={p.y+4} className="pl-pref-label">{node.label.length>23?node.label.slice(0,22)+'…':node.label}</text>{node.status==='unresolved'&&<text x={p.x+78} y={p.y+4} fill="#8a8072" fontSize="12">?</text>}</g>;})}
      {stops.map((node,i)=>{const p=positions.get(node.id);const label=node.label.length>24?node.label.slice(0,23)+'…':node.label;return <g key={node.id} {...interactions(node)} className="pl-graph-node"><rect x={p.x} y={p.y-32} width="205" height="64" rx="12" fill={selected===node.id?'#f9e9db':'#fffefa'} stroke={selected===node.id?'#bd5a2e':'#ddd9ce'} strokeWidth={selected===node.id?2:1}/><text x={p.x+14} y={p.y-9} className="pl-stop-map-type">{String(i+1).padStart(2,'0')} · {node.intent==='dinner'?'A GOOD MEAL':node.intent.toUpperCase()}</text><text x={p.x+14} y={p.y+13} className="pl-stop-map-name">{label}</text></g>;})}
    </svg></div>
    <div className="pl-map-legend"><span><i/> Supported connection</span><span><i className="dotted"/> Considered in search</span><span>Tap a thread’s endpoint to explore</span></div>
    {shown.length<preferences.filter(n=>personFilter==='all'||n.personId===personFilter).length&&<p className="pl-muted">Showing the first 18 tastes. Select a person to explore their connections.</p>}
    <div className="pl-map-story" aria-live="polite"><div className="pl-story-symbol"><Icon name="nodes" size={24}/></div><div><p className="pl-kicker">{focus?'A CLOSER LOOK':'THE STORY BEHIND THE DAY'}</p><h3>{focus?focus.label:'Every connection has a source.'}</h3>{focus?.status==='unresolved'&&<p>This artist could not be resolved in Qloo and did not influence this plan.</p>}{detailEdges.length?<div className="pl-trace-list">{detailEdges.slice(0,selected?12:3).map(edge=>{const from=nodes.find(n=>n.id===edge.from),to=nodes.find(n=>n.id===edge.to),person=nodes.find(n=>n.id===from.personId);return <div key={edge.id} className="pl-trace-item"><p><span style={{color:color(from.personId)}}>{person.label}’s {from.label}</span><Icon name="arrow" size={13}/><strong>{to.label}</strong></p><small>{edge.label}{edge.kind==='affinity'?`. Relative contribution ${edge.contribution.toFixed(2)}; not a likelihood or rating.`:'.'}</small><details><summary>Source evidence</summary>{edge.evidence.map((e,i)=><code key={i}>{e.field}: {String(e.value)}{e.entityId?` · ${e.entityId}`:''}</code>)}</details></div>;})}</div>:<p>No individual connection is evidenced for this selection. Location and activity requirements still shape the plan.</p>}</div></div>
  </section>;
}
