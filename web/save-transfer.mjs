import {openStorage} from './storage.mjs';
import {createBackup} from './backup.mjs';
import {verokImage} from './config.mjs';

const button=document.querySelector('#download-backup'),status=document.querySelector('#status');
button.onclick=async()=>{
  button.disabled=true;
  status.textContent='Preparing backup…';
  let storage;
  try {
    storage=await openStorage(verokImage);
    if(!storage)throw new Error('Browser save storage is unavailable.');
    const records=await storage.load();
    if(!records.length){
      status.textContent='No saves were found on this address in this browser.';
      return;
    }
    const url=URL.createObjectURL(createBackup(verokImage,records));
    const link=document.createElement('a');
    link.href=url;
    link.download=`nfs5-saves-${new Date().toISOString().slice(0,10)}.json`;
    document.body.append(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),60000);
    status.textContent='Backup downloaded. Open nfspu.com and upload it from the Game menu.';
  }catch(error){
    status.textContent='Download failed. '+error.message;
  }finally{
    storage?.close();
    button.disabled=false;
  }
};
