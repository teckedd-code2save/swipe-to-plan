import {venueMentions} from './venue-mentions.js';

function linked(text,stops,onPlace,key){
  return venueMentions(text,stops).map((part,index)=>part.stop&&onPlace
    ?<button type="button" className="cs-venue-mention" key={`${key}-${index}`} onClick={()=>onPlace(part.stop,'practical')}>{part.text}</button>
    :part.text);
}
export default function AgentReply({text,stops=[],onPlace}){
  const paragraphs=text.trim().split(/\n\s*\n/).filter(Boolean);
  return <div className="agent-reply">{paragraphs.map((paragraph,i)=><p key={i}>{paragraph.split(/(\*\*[^*]+\*\*)/g).map((part,j)=>part.startsWith('**')&&part.endsWith('**')?<strong key={j}>{linked(part.slice(2,-2),stops,onPlace,`${i}-${j}`)}</strong>:<span key={j}>{linked(part,stops,onPlace,`${i}-${j}`)}</span>)}</p>)}</div>;
}
