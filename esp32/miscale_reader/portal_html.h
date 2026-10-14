#pragma once
// Setup portal page served by the Mi Scale gateway.
// Kept in a separate .h so the Arduino IDE's .ino preprocessor
// doesn't mistake the JavaScript for C++ functions.

#include <Arduino.h>

static const char PORTAL_HTML[] PROGMEM = R"rawliteral(<!DOCTYPE html>
<html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Mi Scale Gateway Setup</title>
<style>
body{font-family:-apple-system,system-ui,Segoe UI,Roboto,sans-serif;background:#f4f5f7;margin:0;padding:16px;color:#222}
.card{max-width:420px;margin:0 auto;background:#fff;border-radius:12px;padding:20px;box-shadow:0 2px 8px rgba(0,0,0,.08)}
h1{font-size:20px;margin:0 0 4px}
.sub{margin:0 0 8px;color:#666;font-size:14px}
h2{font-size:15px;margin:20px 0 8px;display:flex;justify-content:space-between;align-items:center}
#nets{border:1px solid #ddd;border-radius:8px;max-height:240px;overflow-y:auto}
.net{display:flex;justify-content:space-between;padding:11px 12px;border-bottom:1px solid #eee;cursor:pointer}
.net:last-child{border-bottom:0}
.net.sel{background:#e8f0fe}
.net span:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.meta{color:#888;font-size:13px;white-space:nowrap;margin-left:8px}
.empty{padding:12px;color:#888;font-size:14px}
label{display:block;font-size:13px;color:#555;margin:12px 0 4px}
input{width:100%;box-sizing:border-box;padding:10px;border:1px solid #ccc;border-radius:8px;font-size:16px}
.row{display:flex;gap:8px}.row>div:first-child{flex:3}.row>div:last-child{flex:1.3}
.chk{display:flex;align-items:center;gap:6px;margin-top:8px;font-size:13px;color:#555}
.chk input{width:auto;margin:0}
button{font-size:16px;border:0;border-radius:8px;padding:12px;cursor:pointer}
.primary{width:100%;background:#1a73e8;color:#fff;margin-top:20px}
.link{background:none;color:#1a73e8;padding:0;font-size:14px}
.link:disabled{color:#aaa}
.preview{font-family:monospace;font-size:12px;background:#f4f5f7;padding:8px;border-radius:6px;margin-top:10px;word-break:break-all}
</style></head><body><div class="card">
<h1>Mi Scale Gateway</h1>
<p class="sub">Pick your Wi-Fi network and enter the dashboard server.</p>
<form method="POST" action="/save">
<h2>Wi-Fi networks <button type="button" class="link" id="rescan">Rescan</button></h2>
<div id="nets"><div class="empty">Loading…</div></div>
<label for="ssid">Network name (SSID)</label>
<input id="ssid" name="ssid" maxlength="32" required autocomplete="off" autocapitalize="none" autocorrect="off">
<label for="pass">Password</label>
<input id="pass" name="pass" type="password" maxlength="64" autocomplete="off">
<label class="chk"><input type="checkbox" id="showpw"> Show password</label>
<h2>Dashboard server</h2>
<div class="row">
<div><label for="server">Server</label><input id="server" name="server" placeholder="http://192.168.1.130" required autocapitalize="none" autocorrect="off"></div>
<div><label for="port">Port</label><input id="port" name="port" type="number" min="1" max="65535" placeholder="8800" required></div>
</div>
<div class="preview" id="preview"></div>
<button class="primary" type="submit">Save &amp; reboot</button>
</form></div>
<script>
const $=id=>document.getElementById(id);
let savedSsid='',hasPass=false;
function bars(r){return r>=-55?'▂▄▆█':r>=-67?'▂▄▆':r>=-78?'▂▄':'▂';}
function norm(s){s=s.trim();let sch='http://';const l=s.toLowerCase();
 if(l.startsWith('https://')){sch='https://';s=s.slice(8);}else if(l.startsWith('http://'))s=s.slice(7);
 s=s.split('/')[0].split(':')[0];return s?sch+s:'';}
function preview(){const s=norm($('server').value),p=$('port').value||'?';
 $('preview').textContent=s?'POST → '+s+':'+p+'/api/scale/raw':'Enter the server address';}
function passHint(){$('pass').placeholder=(hasPass&&$('ssid').value===savedSsid)?'(unchanged – leave blank to keep)':'';}
function render(list){const box=$('nets');box.innerHTML='';
 if(!list.length){box.innerHTML='<div class="empty">No networks found. Tap Rescan or type the SSID.</div>';return;}
 list.forEach(n=>{const d=document.createElement('div');d.className='net'+(n.ssid===$('ssid').value?' sel':'');
  const a=document.createElement('span');a.textContent=n.ssid;
  const m=document.createElement('span');m.className='meta';m.textContent=(n.secure?'🔒 ':'')+bars(n.rssi);
  d.append(a,m);
  d.onclick=()=>{$('ssid').value=n.ssid;document.querySelectorAll('.net').forEach(x=>x.classList.remove('sel'));
   d.classList.add('sel');if(n.ssid!==savedSsid)$('pass').value='';passHint();if(n.secure)$('pass').focus();};
  box.append(d);});}
async function scan(refresh){$('rescan').disabled=true;
 if(refresh)$('nets').innerHTML='<div class="empty">Scanning…</div>';
 try{let r=await(await fetch('/scan'+(refresh?'?refresh=1':''))).json();
  while(r.scanning){await new Promise(x=>setTimeout(x,1000));r=await(await fetch('/scan')).json();}
  render(r.networks);
 }catch(e){$('nets').innerHTML='<div class="empty">Scan failed. Type the SSID manually.</div>';}
 $('rescan').disabled=false;}
$('rescan').onclick=()=>scan(true);
$('showpw').onchange=e=>$('pass').type=e.target.checked?'text':'password';
$('ssid').addEventListener('input',passHint);
['server','port'].forEach(i=>$(i).addEventListener('input',preview));
fetch('/config').then(r=>r.json()).then(c=>{savedSsid=c.ssid||'';hasPass=!!c.hasPass;
 $('ssid').value=savedSsid;$('server').value=c.server||'';$('port').value=c.port||8800;
 passHint();preview();scan(false);}).catch(()=>{preview();scan(false);});
</script></body></html>)rawliteral";
