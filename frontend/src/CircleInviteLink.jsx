import {useState} from 'react';
import {Card,Flex,IconButton,Text} from '@radix-ui/themes';
import {Icon} from './PlannerIcons.jsx';

export function circleInviteUrl(circle){
  return circle?.inviteToken?`${location.origin}/#/circle/${encodeURIComponent(circle.id)}?invite=${encodeURIComponent(circle.inviteToken)}`:null;
}

export default function CircleInviteLink({name,url,compact=false}){
  const [notice,setNotice]=useState('');
  if(!url)return null;
  async function copy(){try{await navigator.clipboard.writeText(url);setNotice('Link copied');}catch{setNotice('Select and copy the link below.');}}
  async function share(){try{await navigator.share({title:`Join ${name} on Unstressed`,text:`Join ${name} and plan our next outing together.`,url});}catch(e){if(e.name!=='AbortError')await copy();}}
  const actions=<Flex gap="2" align="center" wrap="wrap">{typeof navigator.share==='function'&&<IconButton type="button" size="3" variant="soft" aria-label={`Share invite to ${name}`} title="Share invite" onClick={share}><Icon name="share" size={18}/></IconButton>}<IconButton type="button" size="3" variant="soft" aria-label={`Copy invite link for ${name}`} title="Copy invite link" onClick={copy}><Icon name="copy" size={18}/></IconButton>{notice&&<Text size="2" role="status">{notice}</Text>}</Flex>;
  if(compact)return <section aria-label={`Invite to ${name}`}><Flex direction="column" gap="2">{actions}{notice==='Select and copy the link below.'&&<input aria-label={`Invite link for ${name}`} readOnly value={url} onFocus={e=>e.target.select()}/>}</Flex></section>;
  return <Card size="2" variant="soft" mt="3"><Flex direction="column" gap="2"><Text weight="medium">Invite to {name}</Text><Text size="2" color="gray">Members can see plans made with this circle after signing in.</Text>{actions}{notice==='Select and copy the link below.'&&<input aria-label={`Invite link for ${name}`} readOnly value={url} onFocus={e=>e.target.select()}/>}</Flex></Card>;
}

