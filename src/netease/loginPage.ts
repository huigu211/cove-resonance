export const loginPage = `<!doctype html><html lang="zh-CN"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>分你一只耳机 · 备用号登录</title>
<style>body{font:16px system-ui,sans-serif;max-width:28rem;margin:3rem auto;padding:0 1.25rem;color:#222;line-height:1.6}input,button,textarea{font:inherit;padding:.8rem;width:100%;box-sizing:border-box;margin:.5rem 0}button{background:#1b1b1b;color:white;border:0;border-radius:.6rem}img{width:min(100%,300px);display:block;margin:1.5rem auto}textarea{min-height:7rem;word-break:break-all}#backup{border-top:1px solid #ddd;margin-top:1.5rem;padding-top:1rem}code{font-size:.9em}</style>
<h1>分你一只耳机</h1><p>首次输入专属密钥，这台设备会记住解锁 30 天。之后可直接用网易云音乐备用号扫码。网易云登录凭证只留在服务端。</p>
<form id="unlock"><input id="secret" type="password" autocomplete="off" required placeholder="专属密钥"><button>解锁扫码</button></form>
<section id="qr" hidden><button id="new" type="button">生成新二维码</button><img id="image" alt="网易云音乐登录二维码" hidden><p id="message" aria-live="polite"></p></section>
<section id="backup" hidden><h2>保存自动登录</h2><p>下面只有加密备份码，不是真实 Cookie。复制后到 Render 服务的 <b>Environment</b> 添加变量 <code>NETEASE_COOKIE_SEALED</code>，粘贴为它的值并保存。</p><textarea id="backupValue" readonly aria-label="加密备份码"></textarea><button id="copyBackup" type="button">复制加密备份码</button><p id="backupMessage" aria-live="polite"></p></section>
<script>
let unlocked=false, generation=0;
const qr=document.getElementById('qr'), msg=document.getElementById('message');
const show=s=>{msg.textContent=s};
async function showBackup(alreadySaved=false){
 if(alreadySaved){document.getElementById('backup').hidden=true;show('服务已配置重启后自动恢复登录。可以返回 ChatGPT。');return}
 try{const r=await fetch('/login/backup',{method:'POST'});if(!r.ok)throw Error();const v=await r.json();
  document.getElementById('backupValue').value=v.value;document.getElementById('backup').hidden=false;
  document.getElementById('backupMessage').textContent='保存后，Render 休眠、重启或重新部署都不需要重新扫码。';
 }catch{document.getElementById('backup').hidden=true;show('本次登录有效，但暂时无法生成加密备份码。')}
}
document.getElementById('copyBackup').onclick=async()=>{
 const value=document.getElementById('backupValue').value;
 try{await navigator.clipboard.writeText(value);document.getElementById('backupMessage').textContent='已复制。现在去 Render 的 Environment 粘贴并保存。'}
 catch{document.getElementById('backupValue').select();document.getElementById('backupMessage').textContent='请长按已选中的文字并复制。'}
};
document.getElementById('unlock').onsubmit=async e=>{
 e.preventDefault(); const field=document.getElementById('secret'); const secret=field.value;field.value='';
 try{const r=await fetch('/login/unlock',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({secret})});
  if(!r.ok){show('密钥不正确或服务尚未配置。');qr.hidden=false;return}
  await opened();
 }catch{show('服务暂时无法连接。');qr.hidden=false}
};
async function create(){
 if(!unlocked)return;const current=++generation;
 try{const r=await fetch('/login/qr',{method:'POST'});if(!r.ok)throw Error();
  const v=await r.json();document.getElementById('image').src=v.image;
  document.getElementById('image').hidden=false;show('请用网易云音乐备用号扫码，并在手机上确认。');
  while(current===generation){await new Promise(resolve=>setTimeout(resolve,2500));
   if(current!==generation)break;
   const q=await fetch('/login/check',{method:'POST'});if(!q.ok)throw Error();
   const status=(await q.json()).status;
   if(status==='confirmed'){show('登录成功，正在等待一起听邀请。');await showBackup(false);break}
   if(status==='expired'){show('二维码已过期，请生成新二维码。');break}
   if(status==='scanned')show('已扫码，请在网易云音乐 App 中确认。');
  }
}catch{show('扫码暂时不可用，请稍后再试。')}
}
async function opened(){
 unlocked=true;document.getElementById('unlock').hidden=true;qr.hidden=false;
 const r=await fetch('/login/status');
 if(r.status===401){unlocked=false;document.getElementById('unlock').hidden=false;show('解锁已过期，请重新输入专属密钥。');return}
 if(!r.ok)throw Error();
 const status=await r.json();
 if(status.accountReady){document.getElementById('image').hidden=true;document.getElementById('new').hidden=true;show('服务已保存本次登录。可以返回 ChatGPT 检查房间连接。');await showBackup(status.persistentCredentialReady);return}
 document.getElementById('new').hidden=false;await create();
}
async function restore(){
 try{const r=await fetch('/login/session');if(r.ok&&(await r.json()).unlocked)await opened()}
 catch{qr.hidden=false;show('服务暂时无法连接，请刷新页面再试。')}
}
document.getElementById('new').onclick=()=>{void create()};
void restore();
</script></html>`;
