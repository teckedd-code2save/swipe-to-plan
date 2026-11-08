import * as fs from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

// Standalone capability probe, never an account store or API process. It does
// not inspect account files, recovery markers, directory contents or secrets.
export async function probeAccountFilesystem({directory='/data',io=fs}={}){
  let owned,source,target;
  const errors=[];
  async function syncDirectory(path){const handle=await io.open(path,'r');try{await handle.sync();}finally{await handle.close();}}
  async function unlink(path){try{await io.unlink(path);}catch(e){if(e.code!=='ENOENT')throw e;}}
  try{
    owned=await io.mkdtemp(join(directory,'.account-fsync-probe-'));
    source=join(owned,'pending');target=join(owned,'renamed');
    await syncDirectory(directory);
    const handle=await io.open(source,'wx',0o600);
    try{await handle.writeFile('Unstressed filesystem primitive probe\n');await handle.sync();}finally{await handle.close();}
    await io.rename(source,target);
    await syncDirectory(owned);
  }catch(e){errors.push(e);}
  finally{
    if(owned){
      // Both names belong exclusively to this invocation. Even an ambiguous
      // rename is safe to clean; never scan, recursively delete or touch peers.
      for(const path of [source,target])try{await unlink(path);}catch(e){errors.push(e);}
      try{await syncDirectory(owned);}catch(e){errors.push(e);}
      try{await io.rmdir(owned);}catch(e){errors.push(e);}
      try{await syncDirectory(directory);}catch(e){errors.push(e);}
    }
  }
  if(errors.length)throw new AggregateError(errors,'Filesystem primitive probe or its cleanup failed.');
}

if(process.argv[1]==='-'||(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)){
  try{await probeAccountFilesystem();console.log('Filesystem file-sync, rename and directory-sync primitives supported; not a power-loss guarantee.');}
  catch{console.error('Filesystem primitive probe failed; live service must remain untouched. Check storage support and private probe cleanup before retrying.');process.exitCode=1;}
}
