(function(){
"use strict";
// ---------- Oklab / sRGB / P3 转换（Ottosson 矩阵） ----------
function oklabToLinSrgb(L,a,b){
  var l_=L+0.3963377774*a+0.2158037573*b, m_=L-0.1055613458*a-0.0638541728*b, s_=L-0.0894841775*a-1.2914855480*b;
  var l=l_*l_*l_, m=m_*m_*m_, s=s_*s_*s_;
  return [4.0767416621*l-3.3077115913*m+0.2309699292*s,
         -1.2684380046*l+2.6097574011*m-0.3413193965*s,
         -0.0041960863*l-0.7034186147*m+1.7076147010*s];
}
function oklabToLinP3(L,a,b){
  var l_=L+0.3963377774*a+0.2158037573*b, m_=L-0.1055613458*a-0.0638541728*b, s_=L-0.0894841775*a-1.2914855480*b;
  var l=l_*l_*l_, m=m_*m_*m_, s=s_*s_*s_;
  var X= 1.2268798758*l-0.5578149944*m+0.2813910456*s;
  var Y=-0.0405757452*l+1.1122868032*m-0.0717110580*s;
  var Z=-0.0763729366*l-0.4214933324*m+1.5869240198*s;
  return [ 2.4934969119*X-0.9313836179*Y-0.4027107845*Z,
          -0.8294889696*X+1.7626640603*Y+0.0236246858*Z,
           0.0358458302*X-0.0761723893*Y+0.9568845240*Z];
}
function linSrgbToOklab(r,g,b){
  var l=Math.cbrt(0.4122214708*r+0.5363325363*g+0.0514459929*b);
  var m=Math.cbrt(0.2119034982*r+0.6806995451*g+0.1073969566*b);
  var s=Math.cbrt(0.0883024619*r+0.2817188376*g+0.6299787005*b);
  return [0.2104542553*l+0.7936177850*m-0.0040720468*s,
          1.9779984951*l-2.4285922050*m+0.4505937099*s,
          0.0259040371*l+0.7827717662*m-0.8086757660*s];
}
var gam=function(x){return x<=0.0031308?12.92*x:1.055*Math.pow(x,1/2.4)-0.055;};
var ungam=function(x){return x<=0.04045?x/12.92:Math.pow((x+0.055)/1.055,2.4);};
function lch2lab(L,C,H){var h=H*Math.PI/180;return [L,C*Math.cos(h),C*Math.sin(h)];}
function inG(v,e){e=e||1e-4;return v[0]>=-e&&v[0]<=1+e&&v[1]>=-e&&v[1]<=1+e&&v[2]>=-e&&v[2]<=1+e;}
function clamp01(x){return x<0?0:x>1?1:x;}
function srgb255(L,C,H){
  var lab=lch2lab(L,C,H), lin=oklabToLinSrgb(lab[0],lab[1],lab[2]);
  return [Math.round(clamp01(gam(lin[0]))*255),Math.round(clamp01(gam(lin[1]))*255),Math.round(clamp01(gam(lin[2]))*255)];
}
function hex(L,C,H){
  var v=srgb255(L,C,H);
  return '#'+v.map(function(x){return x.toString(16).padStart(2,'0');}).join('');
}
function inSrgb(L,C,H){var lab=lch2lab(L,C,H);return inG(oklabToLinSrgb(lab[0],lab[1],lab[2]));}
function inP3(L,C,H){var lab=lch2lab(L,C,H);return inG(oklabToLinP3(lab[0],lab[1],lab[2]));}
function maxC(L,H,fn){
  var lo=0,hi=0.45,mid,lab;
  for(var i=0;i<28;i++){mid=(lo+hi)/2;lab=lch2lab(L,mid,H);if(inG(fn(lab[0],lab[1],lab[2])))lo=mid;else hi=mid;}
  return lo;
}
// WCAG
function relLum255(v){
  var r=ungam(v[0]/255),g=ungam(v[1]/255),b=ungam(v[2]/255);
  return 0.2126*r+0.7152*g+0.0722*b;
}
function contrastVs(v,isWhite){
  var a=relLum255(v)+0.05, b=(isWhite?1:0)+0.05;
  return a>b?a/b:b/a;
}
// hsl -> rgb255
function hsl255(h,s,l){
  s/=100;l/=100;
  var k=function(n){return (n+h/30)%12;};
  var a=s*Math.min(l,1-l);
  var f=function(n){return l-a*Math.max(-1,Math.min(Math.min(k(n)-3,9-k(n)),1));};
  return [Math.round(f(0)*255),Math.round(f(8)*255),Math.round(f(4)*255)];
}
function lumaByte(v){return relLum255(v);}
function styleVar(n){return getComputedStyle(document.documentElement).getPropertyValue(n).trim();}

function fitCanvas(cv,hCss){
  var dpr=Math.min(window.devicePixelRatio||1,2);
  var w=cv.clientWidth||cv.parentElement.clientWidth;
  var h=hCss||cv.clientHeight||40;
  cv.width=Math.max(1,Math.round(w*dpr));
  cv.height=Math.max(1,Math.round(h*dpr));
  var ctx=cv.getContext('2d');
  ctx.setTransform(dpr,0,0,dpr,0,0);
  return {ctx:ctx,w:w,h:h};
}

// ================= 01 色相扫描 =================
function drawSweeps(){
  var defs=[
    {id:'c-hsl', gray:false, fn:function(t){return hsl255(t*360,100,50);}},
    {id:'c-hsl-g',gray:true,  fn:function(t){return hsl255(t*360,100,50);}},
    {id:'c-okl', gray:false, fn:function(t){return srgb255(0.70,0.12,t*360);}},
    {id:'c-okl-g',gray:true,  fn:function(t){return srgb255(0.70,0.12,t*360);}}
  ];
  defs.forEach(function(d){
    var cv=document.getElementById(d.id); if(!cv)return;
    var s=fitCanvas(cv,cv.clientHeight);
    for(var x=0;x<s.w;x++){
      var v=d.fn(x/(s.w-1));
      if(d.gray){var y=Math.round(clamp01(gam(lumaByte(v)))*255);v=[y,y,y];}
      s.ctx.fillStyle='rgb('+v[0]+','+v[1]+','+v[2]+')';
      s.ctx.fillRect(x,0,1.5,s.h);
    }
  });
  // 统计感知亮度波动
  var hslL=[],okL=[];
  for(var i=0;i<=360;i+=2){
    hslL.push(lumaByte(hsl255(i,100,50)));
    okL.push(lumaByte(srgb255(0.70,0.12,i)));
  }
  var rng=function(a){var mn=Math.min.apply(null,a),mx=Math.max.apply(null,a);return {mn:mn,mx:mx,ratio:(mx+0.05)/(mn+0.05)};};
  var a=rng(hslL),b=rng(okL);
  var el=document.getElementById('sweep-stat');
  if(el) el.innerHTML='沿色相扫一圈的实测亮度落差 —— HSL：最亮处是最暗处的 <strong>'+a.ratio.toFixed(2)+
    '×</strong>　·　OKLCH：<strong>'+b.ratio.toFixed(2)+'×</strong>（1.00 为完全一致）';
}

// ================= 02 拆解器 =================
var rL=document.getElementById('r-l'),rC=document.getElementById('r-c'),rH=document.getElementById('r-h');
function trackGradient(kind,L,C,H){
  // 硬边台阶：每段用同色的两个 stop 封住，避免实色与 transparent 之间插值出暗边
  var stops=[],n=64,i,t,ok,col,a,b;
  for(i=0;i<n;i++){
    t=i/(n-1);
    if(kind==='L'){col=[t,C,H];}
    else if(kind==='C'){col=[L,t*0.37,H];}
    else {col=[L,C,t*360];}
    ok=inSrgb(col[0],col[1],col[2]);
    var cs=ok?hex(col[0],col[1],col[2]):'transparent';
    a=(i/n*100).toFixed(2); b=((i+1)/n*100).toFixed(2);
    stops.push(cs+' '+a+'%',cs+' '+b+'%');
  }
  return 'linear-gradient(90deg,'+stops.join(',')+')';
}
function updPicker(){
  var L=parseFloat(rL.value),C=parseFloat(rC.value),H=parseFloat(rH.value);
  var css='oklch('+L.toFixed(3)+' '+C.toFixed(3)+' '+H.toFixed(0)+')';
  var sw=document.getElementById('sw');
  sw.style.background=css;
  var v=srgb255(L,C,H);
  var textWhite=contrastVs(v,true)>=contrastVs(v,false);
  sw.style.color=textWhite?'#fff':'#000';
  document.getElementById('sw-css').textContent=css;
  document.getElementById('sw-hex').textContent=hex(L,C,H);
  document.getElementById('v-l').textContent=L.toFixed(3);
  document.getElementById('v-c').textContent=C.toFixed(3);
  document.getElementById('v-h').textContent=H.toFixed(0)+'°';
  rL.style.setProperty('--track',trackGradient('L',L,C,H));
  rC.style.setProperty('--track',trackGradient('C',L,C,H));
  rH.style.setProperty('--track',trackGradient('H',L,C,H));

  var s=inSrgb(L,C,H), p=inP3(L,C,H);
  var mS=maxC(L,H,oklabToLinSrgb), mP=maxC(L,H,oklabToLinP3);
  var cw=contrastVs(v,true), cb=contrastVs(v,false);
  var chips=[];
  chips.push('<span class="chip '+(s?'ok':'warn')+'">sRGB <b>'+(s?'在色域内':'已超出')+'</b></span>');
  chips.push('<span class="chip '+(p?'ok':'warn')+'">Display P3 <b>'+(p?'在色域内':'已超出')+'</b></span>');
  chips.push('<span class="chip">此 L/H 下 C 上限 sRGB <b>'+mS.toFixed(3)+'</b> · P3 <b>'+mP.toFixed(3)+'</b></span>');
  chips.push('<span class="chip">对比度 白字 <b>'+cw.toFixed(2)+'</b> · 黑字 <b>'+cb.toFixed(2)+'</b></span>');
  document.getElementById('ro').innerHTML=chips.join('');
  var ft=document.getElementById('pick-ft');
  if(!s&&p) ft.innerHTML='当前值<b>超出 sRGB 但落在 P3 内</b>——宽色域屏能显示，普通屏会被压回边界。滑块轨道上的透明缺口就是超出 sRGB 的区段。';
  else if(!s&&!p) ft.innerHTML='当前值<b>连 P3 都超出了</b>，任何屏幕都会做色域映射，实际显示的是边界上最接近的颜色。';
  else ft.innerHTML='当前值在 sRGB 内，所有屏幕显示一致。轨道上的透明缺口表示：其余两轴不动时，这一轴超出 sRGB 的区段。';
}

// ================= 03 色域天花板 =================
var rGL=document.getElementById('r-gl');
function drawGamut(){
  var cv=document.getElementById('c-gamut'); if(!cv)return;
  var L=parseFloat(rGL.value);
  document.getElementById('v-gl').textContent=L.toFixed(2);
  var dpr=Math.min(window.devicePixelRatio||1,2);
  var w=cv.clientWidth, h=Math.round(w*0.30);
  h=Math.max(190,Math.min(320,h));
  cv.width=w*dpr; cv.height=h*dpr;
  cv.style.height=h+'px';
  var g=cv.getContext('2d'); g.setTransform(dpr,0,0,dpr,0,0);
  var padL=44,padR=14,padT=16,padB=30;
  var pw=w-padL-padR, ph=h-padT-padB;
  var ink=styleVar('--ink'), faint=styleVar('--ink-faint'), rule=styleVar('--rule'), surf=styleVar('--surface-sunk');
  g.clearRect(0,0,w,h);
  g.fillStyle=surf; g.fillRect(padL,padT,pw,ph);
  var yMax=0.40;
  var Y=function(c){return padT+ph-(c/yMax)*ph;};
  var X=function(hh){return padL+(hh/360)*pw;};
  // 网格
  g.strokeStyle=rule; g.lineWidth=1; g.font='10px ui-monospace,Menlo,monospace'; g.fillStyle=faint;
  for(var c=0;c<=0.4;c+=0.1){
    var y=Math.round(Y(c))+0.5;
    g.beginPath();g.moveTo(padL,y);g.lineTo(padL+pw,y);g.stroke();
    g.textAlign='right';g.textBaseline='middle';
    g.fillText(c.toFixed(1),padL-7,Y(c));
  }
  // 色相底色刻度
  for(var hx=0;hx<360;hx+=1){
    var cm=maxC(L,hx,oklabToLinSrgb);
    var vv=srgb255(L,Math.min(cm,0.999),hx);
    g.fillStyle='rgb('+vv[0]+','+vv[1]+','+vv[2]+')';
    g.fillRect(X(hx),padT+ph+4,pw/360+1,7);
  }
  g.textAlign='center';g.textBaseline='top';g.fillStyle=faint;
  [0,90,180,270,360].forEach(function(t){g.fillText(t+'°',X(t),padT+ph+15);});
  // 曲线
  function curve(fn,color,dash,width){
    g.beginPath();
    for(var hh=0;hh<=360;hh+=1){
      var c=maxC(L,hh,fn);
      if(hh===0)g.moveTo(X(hh),Y(c));else g.lineTo(X(hh),Y(c));
    }
    g.setLineDash(dash);g.strokeStyle=color;g.lineWidth=width;g.stroke();g.setLineDash([]);
  }
  curve(oklabToLinP3, styleVar('--warn'), [5,3], 1.6);
  curve(oklabToLinSrgb, ink, [], 2);
  // 图例
  g.setLineDash([]);g.textAlign='left';g.textBaseline='middle';
  g.font='11px ui-monospace,Menlo,monospace';
  g.strokeStyle=ink;g.lineWidth=2;g.beginPath();g.moveTo(padL+8,padT+12);g.lineTo(padL+26,padT+12);g.stroke();
  g.fillStyle=ink;g.fillText('sRGB',padL+31,padT+12);
  g.strokeStyle=styleVar('--warn');g.setLineDash([5,3]);g.lineWidth=1.6;
  g.beginPath();g.moveTo(padL+80,padT+12);g.lineTo(padL+98,padT+12);g.stroke();g.setLineDash([]);
  g.fillStyle=styleVar('--warn');g.fillText('Display P3',padL+103,padT+12);
  g.save();g.translate(11,padT+ph/2);g.rotate(-Math.PI/2);
  g.textAlign='center';g.fillStyle=faint;g.font='10px ui-monospace,Menlo,monospace';
  g.fillText('最大 C',0,0);g.restore();
  // 说明
  var best=0,bestH=0,worst=1,worstH=0;
  for(var q=0;q<360;q++){var m=maxC(L,q,oklabToLinSrgb);if(m>best){best=m;bestH=q;}if(m<worst){worst=m;worstH=q;}}
  document.getElementById('gamut-ft').innerHTML='在 L='+L.toFixed(2)+' 这一层，sRGB 内最浓的色相是 <b>'+bestH+
    '°（C 可达 '+best.toFixed(3)+'）</b>，最受限的是 <b>'+worstH+'°（只到 '+worst.toFixed(3)+
    '）</b>，相差 <b>'+(best/Math.max(worst,1e-6)).toFixed(1)+' 倍</b>。把 L 拖向两端，整条天花板会一起塌下去——越接近黑或白，可用的浓度越少。';
}

// ================= 04 渐变 =================
var rH1=document.getElementById('r-h1'),rH2=document.getElementById('r-h2');
function buildGradRows(){
  var host=document.getElementById('grad-rows');
  var rows=[
    {k:'srgb', lb:'sRGB', sub:'CSS 默认'},
    {k:'hsl',  lb:'HSL',  sub:'沿色环'},
    {k:'oklab',lb:'Oklab',sub:'直角坐标'},
    {k:'oklch',lb:'OKLCH',sub:'极坐标'}
  ];
  host.innerHTML=rows.map(function(r){
    return '<div class="strip-row"><div class="strip-lb"><b>'+r.lb+'</b>'+r.sub+
      '</div><div class="strip"><canvas data-k="'+r.k+'"></canvas></div></div>';
  }).join('');
}
function drawGrads(){
  var h1=parseFloat(rH1.value),h2=parseFloat(rH2.value);
  document.getElementById('v-h1').textContent=h1+'°';
  document.getElementById('v-h2').textContent=h2+'°';
  var L1=0.55,L2=0.80,C1=0.16,C2=0.16;
  var e1=srgb255(L1,C1,h1), e2=srgb255(L2,C2,h2);
  var lab1=lch2lab(L1,C1,h1), lab2=lch2lab(L2,C2,h2);
  // hsl 端点（由 rgb 反推近似）
  function rgb2hsl(v){
    var r=v[0]/255,g=v[1]/255,b=v[2]/255;
    var mx=Math.max(r,g,b),mn=Math.min(r,g,b),d=mx-mn,hh=0,s=0,l=(mx+mn)/2;
    if(d){s=d/(1-Math.abs(2*l-1));
      if(mx===r)hh=60*(((g-b)/d)%6);else if(mx===g)hh=60*((b-r)/d+2);else hh=60*((r-g)/d+4);}
    if(hh<0)hh+=360;
    return [hh,s*100,l*100];
  }
  var hs1=rgb2hsl(e1),hs2=rgb2hsl(e2);
  document.querySelectorAll('#grad-rows canvas').forEach(function(cv){
    var kind=cv.dataset.k;
    var s=fitCanvas(cv,cv.clientHeight);
    for(var x=0;x<s.w;x++){
      var t=x/(s.w-1),v;
      if(kind==='srgb'){
        v=[e1[0]+(e2[0]-e1[0])*t, e1[1]+(e2[1]-e1[1])*t, e1[2]+(e2[2]-e1[2])*t];
      } else if(kind==='hsl'){
        var dh=hs2[0]-hs1[0];
        if(dh>180)dh-=360; if(dh<-180)dh+=360;
        v=hsl255((hs1[0]+dh*t+360)%360, hs1[1]+(hs2[1]-hs1[1])*t, hs1[2]+(hs2[2]-hs1[2])*t);
      } else if(kind==='oklab'){
        var lin=oklabToLinSrgb(lab1[0]+(lab2[0]-lab1[0])*t, lab1[1]+(lab2[1]-lab1[1])*t, lab1[2]+(lab2[2]-lab1[2])*t);
        v=[clamp01(gam(lin[0]))*255,clamp01(gam(lin[1]))*255,clamp01(gam(lin[2]))*255];
      } else {
        var d2=h2-h1; if(d2>180)d2-=360; if(d2<-180)d2+=360;
        v=srgb255(L1+(L2-L1)*t, C1+(C2-C1)*t, (h1+d2*t+360)%360);
      }
      s.ctx.fillStyle='rgb('+Math.round(v[0])+','+Math.round(v[1])+','+Math.round(v[2])+')';
      s.ctx.fillRect(x,0,1.5,s.h);
    }
  });
}

// ================= 06 色阶 =================
var rRH=document.getElementById('r-rh'),rRC=document.getElementById('r-rc');
var STEPS=[
  {n:50,  L:0.971, w:0.14},{n:100, L:0.936, w:0.28},{n:200, L:0.885, w:0.50},
  {n:300, L:0.808, w:0.72},{n:400, L:0.714, w:0.90},{n:500, L:0.637, w:1.00},
  {n:600, L:0.577, w:0.98},{n:700, L:0.505, w:0.86},{n:800, L:0.443, w:0.70},
  {n:900, L:0.396, w:0.56},{n:950, L:0.281, w:0.40}
];
function drawRamp(){
  var H=parseFloat(rRH.value), Cpk=parseFloat(rRC.value);
  document.getElementById('v-rh').textContent=H+'°';
  document.getElementById('v-rc').textContent=Cpk.toFixed(3);
  var html='',clipped=0,firstPass=null;
  STEPS.forEach(function(st){
    var want=Cpk*st.w;
    var cap=maxC(st.L,H,oklabToLinSrgb);
    var C=Math.min(want,cap);
    if(want-cap>0.004)clipped++;
    var v=srgb255(st.L,C,H);
    var cw=contrastVs(v,true);
    var txtWhite=cw>=contrastVs(v,false);
    if(!firstPass&&cw>=4.5)firstPass=st.n;
    html+='<div class="step" style="background:oklch('+st.L+' '+C.toFixed(3)+' '+H+');color:'+
      (txtWhite?'#fff':'#000')+'">'+
      '<span class="s-n">'+st.n+'</span>'+
      '<span class="s-c" style="'+(cw>=4.5?'text-decoration:underline;text-underline-offset:2px':'')+'">'+cw.toFixed(1)+'</span></div>';
  });
  document.getElementById('ramp').innerHTML=html;
  var msg='色相 '+H+'° 这一列，从 <b>'+(firstPass?firstPass:'—')+
    '</b> 起白字达到 WCAG AA（4.5）。换任何色相，这个分界点都落在相近的位置——因为 L 阶梯是固定的。';
  if(clipped>0) msg+=' 当前有 <b>'+clipped+' 级</b>的目标浓度超出了 sRGB 天花板，已自动收到边界；这正是「所有色相共用一个 C 值」行不通的地方。';
  document.getElementById('ramp-ft').innerHTML=msg;
}

// ================= 目录高亮 =================
function initToc(){
  var links=Array.prototype.slice.call(document.querySelectorAll('nav.toc a'));
  var secs=links.map(function(a){return document.querySelector(a.getAttribute('href'));});
  var io=new IntersectionObserver(function(es){
    es.forEach(function(e){
      if(e.isIntersecting){
        var i=secs.indexOf(e.target);
        links.forEach(function(l,j){l.classList.toggle('on',j===i);});
      }
    });
  },{rootMargin:'-15% 0px -70% 0px'});
  secs.forEach(function(s){if(s)io.observe(s);});
}

// ================= 启动 =================
function redrawAll(){drawSweeps();drawGamut();drawGrads();}
[rL,rC,rH].forEach(function(el){el.addEventListener('input',updPicker);});
rGL.addEventListener('input',drawGamut);
[rH1,rH2].forEach(function(el){el.addEventListener('input',drawGrads);});
[rRH,rRC].forEach(function(el){el.addEventListener('input',drawRamp);});

buildGradRows();
updPicker();
drawRamp();
initToc();
requestAnimationFrame(function(){redrawAll();});

var rt;
window.addEventListener('resize',function(){clearTimeout(rt);rt=setTimeout(redrawAll,180);});
if(window.matchMedia){
  var mq=window.matchMedia('(prefers-color-scheme: dark)');
  if(mq.addEventListener)mq.addEventListener('change',function(){setTimeout(drawGamut,60);});
}
new MutationObserver(function(){setTimeout(drawGamut,60);})
  .observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
})();
