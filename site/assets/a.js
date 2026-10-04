/* Nazryx first-party analytics. No cookies, no identifiers stored. */
(function(){
var d=document,w=window,n=navigator,L=location;
if(n.webdriver||/^\/(analytics|api)(\/|$)/.test(L.pathname)||d.visibilityState==='prerender'||d.prerendering)return;
var pv=Math.random().toString(36).slice(2,12),nw=1,t0=Date.now(),act=0,mx=0,sent={},q=L.search;
try{nw=localStorage.getItem('nzx_seen')?0:1;localStorage.setItem('nzx_seen','1');localStorage.removeItem('nzx-v')}catch(e){}
function s(t,v,k){try{var b=JSON.stringify({t:t,p:L.pathname,q:q,r:t=='pageview'?d.referrer:'',v:v||0,k:k||'',i:pv,n:nw,l:n.language||''});
n.sendBeacon?n.sendBeacon('/api/collect',new Blob([b],{type:'text/plain'})):fetch('/api/collect',{method:'POST',body:b,keepalive:true})}catch(e){}}
s('pageview');
function sc(){var e=d.documentElement,h=e.scrollHeight-w.innerHeight,p=h>0?Math.round((w.pageYOffset||e.scrollTop)/h*100):100;
[25,50,75,100].forEach(function(m){if(p>=m&&!sent[m]){sent[m]=1;s('scroll',m)}})}
w.addEventListener('scroll',sc,{passive:true});setTimeout(sc,1500);
function hid(f){if(f===1||d.visibilityState==='hidden'){if(t0){act+=Date.now()-t0;t0=0}var x=Math.round(act/1000);if(x>mx){mx=x;s('time',x)}}else t0=Date.now()}
d.addEventListener('visibilitychange',hid);w.addEventListener('pagehide',function(){hid(1)});
d.addEventListener('click',function(e){var a=e.target.closest&&e.target.closest('[data-track],a[href]');if(!a)return;
var k=a.getAttribute('data-track'),h=a.getAttribute('href')||'';
if(!k){if(/\.pdf($|\?)/i.test(h))k='pdf:'+h;else if(a.host&&a.host!==L.host)k='out:'+a.host;else return}
s('click',0,k.slice(0,120))},true);
d.addEventListener('submit',function(e){s('submit',0,(e.target.getAttribute('data-track')||e.target.id||'form').slice(0,60))},true);
})();
