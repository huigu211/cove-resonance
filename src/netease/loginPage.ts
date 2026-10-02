export const loginPage = `<!doctype html><html lang="zh-CN"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>分你一只耳机 · 备用号登录</title>
<style>body{font:16px system-ui,sans-serif;max-width:28rem;margin:3rem auto;padding:0 1.25rem;color:#222;line-height:1.6}input,button{font:inherit;padding:.8rem;width:100%;box-sizing:border-box;margin:.5rem 0}button{background:#1b1b1b;color:white;border:0;border-radius:.6rem}img{width:min(100%,300px);display:block;margin:1.5rem auto}</style>
<h1>分你一只耳机</h1><p>输入 Render 中设置的专属密钥，再用网易云音乐备用号扫码。登录凭证只留在服务端。</p>
<form id="unlock"><input id="secret" type="password" autocomplete="off" required placeholder="专属密钥"><button>解锁扫码</button></form>
<section id="qr" hidden><button id="new" type="button">生成新二维码</button><img id="image" alt="网易云音乐登录二维码" hidden><p id="message" aria-live="polite"></p></section>
<script>
let unlocked=false, generation=0;
const qr=document.getElementById('qr'), msg=document.getElementById('message');
const show=s=>{msg.textContent=s};
document.getElementById('unlock').onsubmit=async e=>{
 e.preventDefault(); const field=document.getElementById('secret'); const secret=field.value;field.value='';
 try{const r=await fetch('/login/unlock',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({secret})});
  if(!r.ok){show('密钥不正确或服务尚未配置。');qr.hidden=false;return}
  unlocked=true;document.getElementById('unlock').hidden=true;qr.hidden=false;await create();
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
   if(status==='confirmed'){show('登录成功，正在等待一起听邀请。');break}
   if(status==='expired'){show('二维码已过期，请生成新二维码。');break}
   if(status==='scanned')show('已扫码，请在网易云音乐 App 中确认。');
  }
 }catch{show('扫码暂时不可用，请稍后再试。')}
}
document.getElementById('new').onclick=()=>{void create()};
</script></html>`;
