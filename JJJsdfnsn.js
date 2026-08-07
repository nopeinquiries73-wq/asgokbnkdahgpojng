// Paste this entire block into injected.js, then obfuscate.
// It’s the exact script you already use in Tampermonkey, but now run as a plain IIFE.
(function() {
'use strict';
if(window.__OCEAN_V128S)return;window.__OCEAN_V128S=1;

console.clear();console.log=console.warn=console.error=()=>{};

const host=location.hostname;
const isVeck=host.includes('veck.io');
const isBuildNow=host.includes('buildnow.gg');

const siteConfig={
    'veck.io':{
        targetColor:[210,40,40], tolerance:45, minBarWidth:6, maxBarHeight:5,
        searchTopPercent:0.3, aimOffsetY:15
    },
    'buildnow.gg':{
        targetColor:[0,200,100], tolerance:50, minBarWidth:5, maxBarHeight:6,
        searchTopPercent:0.35, aimOffsetY:10
    }
};
const cfg=isVeck?siteConfig['veck.io']:isBuildNow?siteConfig['buildnow.gg']:siteConfig['veck.io'];

// ─── State ───
const S={
    active:false,
    toggle:false,
    smooth:0.35,
    fovRadius:140,
    prediction:true,
    predictionFactor:0.5,
    triggerbot:true,
    triggerDistance:8,
    fireDelay:400,
    targetColor:cfg.targetColor,
    colorTolerance:cfg.tolerance,
    minBarWidth:cfg.minBarWidth,
    maxBarHeight:cfg.maxBarHeight,
    aimOffsetY:cfg.aimOffsetY,
    searchTopPercent:cfg.searchTopPercent,
    lastShot:0,
    lastScan:0,
    scanFPS:30,
    overlay:null,
    ringCanvas:null,
    trackedPlayers:[],
    nextPlayerId:1,
    trackingDist:50,
    uiPanel:null,
    panelMinimized:false,
    dragging:false,
    dragStartX:0,dragStartY:0,
    panelX:20,panelY:100,
    streamerMode:false
};

// Caps Lock
let capsState=false;
document.addEventListener('keydown',e=>{
    if(e.code==='CapsLock'){capsState=!capsState;e.preventDefault();}
});
function capsActive(){
    try{return KeyboardEvent.prototype.getModifierState?.call({},'CapsLock')||capsState;}catch(e){return capsState;}
}

// Overlay with FOV ring
function createOverlay(){
    if(S.overlay)return;
    const ov=document.createElement('div');ov.id='_oc128sov';
    ov.style.cssText='position:fixed;top:0;left:0;width:100vw;height:100vh;pointer-events:none;z-index:2147483630;display:none;';
    document.body.appendChild(ov);
    const ring=document.createElement('canvas');ring.id='_oc128sring';
    ring.width=innerWidth;ring.height=innerHeight;
    ring.style.cssText='width:100vw;height:100vh;';
    ov.appendChild(ring);
    S.overlay=ov;S.ringCanvas=ring;
}
function showOverlay(v){
    if(S.overlay){
        S.overlay.style.display=(v && !S.streamerMode)?'block':'none';
    }
}
function drawRing(){
    if(!S.ringCanvas||!S.active||S.streamerMode)return;
    const ctx=S.ringCanvas.getContext('2d');
    ctx.clearRect(0,0,S.ringCanvas.width,S.ringCanvas.height);
    const cx=S.ringCanvas.width/2,cy=S.ringCanvas.height/2;
    ctx.save();
    ctx.strokeStyle='rgba(255,80,80,0.3)';ctx.lineWidth=2;
    ctx.beginPath();ctx.arc(cx,cy,S.fovRadius,0,2*Math.PI);ctx.stroke();
    ctx.restore();
}

function updateTracking(bars){
    const now=Date.now();
    const matched=new Set();
    const newTracked=[];
    for(const bar of bars){
        let bestDist=Infinity,bestPlayer=null;
        for(const p of S.trackedPlayers){
            if(matched.has(p.id))continue;
            const dist=Math.hypot(bar.x-p.lastPos.x,bar.y-p.lastPos.y);
            if(dist<S.trackingDist&&dist<bestDist){bestDist=dist;bestPlayer=p;}
        }
        if(bestPlayer){
            bestPlayer.velocity={x:bar.x-bestPlayer.lastPos.x,y:bar.y-bestPlayer.lastPos.y};
            bestPlayer.lastPos={x:bar.x,y:bar.y};
            bestPlayer.lastSeen=now;
            bestPlayer.bar=bar;
            newTracked.push(bestPlayer);
            matched.add(bestPlayer.id);
        }else{
            newTracked.push({
                id:S.nextPlayerId++, lastPos:{x:bar.x,y:bar.y}, lastSeen:now,
                velocity:{x:0,y:0}, bar:bar
            });
        }
    }
    S.trackedPlayers=newTracked.filter(p=>now-p.lastSeen<1000);
}

function scanForBars(){
    const gameCanvas=document.querySelector('canvas');
    if(!gameCanvas)return [];
    const scale=0.2;
    const offW=Math.floor(gameCanvas.width*scale);
    const offH=Math.floor(gameCanvas.height*scale);
    const off=document.createElement('canvas');
    off.width=offW;off.height=offH;
    const ctx=off.getContext('2d');
    ctx.drawImage(gameCanvas,0,0,offW,offH);
    const img=ctx.getImageData(0,0,offW,offH);
    const pixels=img.data;

    const centerX=Math.floor(offW/2),centerY=Math.floor(offH/2);
    const radius=Math.floor(S.fovRadius*scale);
    const [rT,gT,bT]=S.targetColor,tol=S.colorTolerance;
    const searchTop=Math.floor(offH*S.searchTopPercent),searchBottom=offH-5;
    const bars=[];
    const redMask=new Uint8Array(offW*offH);

    for(let y=Math.max(centerY-radius,searchTop);y<=Math.min(centerY+radius,searchBottom);y++){
        const dy=y-centerY;
        for(let x=centerX-radius;x<=centerX+radius;x++){
            const dx=x-centerX;
            if(dx*dx+dy*dy>radius*radius)continue;
            const idx=(y*offW+x)*4;
            const r=pixels[idx],g=pixels[idx+1],b=pixels[idx+2];
            if(Math.sqrt((r-rT)**2+(g-gT)**2+(b-bT)**2)<tol) redMask[y*offW+x]=1;
        }
    }

    const minRun=S.minBarWidth,maxVHeight=S.maxBarHeight;
    for(let y=Math.max(centerY-radius,searchTop);y<=Math.min(centerY+radius,searchBottom);y++){
        let runStart=-1;
        for(let x=centerX-radius;x<=centerX+radius;x++){
            if(x<0||x>=offW)continue;
            const dx=x-centerX,dy=y-centerY;
            if(dx*dx+dy*dy>radius*radius){runStart=-1;continue;}
            if(redMask[y*offW+x]){
                if(runStart===-1)runStart=x;
            }else{
                if(runStart!==-1&&x-runStart>=minRun){
                    let vThickness=1;
                    for(let vy=y+1;vy<Math.min(centerY+radius,searchBottom);vy++){
                        let has=false;
                        for(let vx=runStart;vx<x;vx++) if(redMask[vy*offW+vx]){has=true;break;}
                        if(has)vThickness++; else break;
                    }
                    for(let vy=y-1;vy>=Math.max(centerY-radius,searchTop);vy--){
                        let has=false;
                        for(let vx=runStart;vx<x;vx++) if(redMask[vy*offW+vx]){has=true;break;}
                        if(has)vThickness++; else break;
                    }
                    if(vThickness<=maxVHeight)
                        bars.push({x:(runStart+x-1)/2/scale, y:y/scale});
                }
                runStart=-1;
            }
        }
    }
    return bars;
}

function processAimbot(){
    if(!S.active)return;
    const now=performance.now();
    if(now-S.lastScan<1000/S.scanFPS)return;
    S.lastScan=now;

    const bars=scanForBars();
    updateTracking(bars);

    const screenCenterX=innerWidth/2,screenCenterY=innerHeight/2;
    let bestPlayer=null,bestDist=S.fovRadius;
    for(const p of S.trackedPlayers){
        const bar=p.bar;
        const dist=Math.hypot(bar.x-screenCenterX, bar.y-screenCenterY);
        if(dist<bestDist){bestDist=dist;bestPlayer=p;}
    }
    if(!bestPlayer)return;

    let aimX=bestPlayer.bar.x;
    let aimY=bestPlayer.bar.y;
    if(S.prediction && (bestPlayer.velocity.x!==0||bestPlayer.velocity.y!==0)){
        const speed=Math.hypot(bestPlayer.velocity.x, bestPlayer.velocity.y);
        if(speed>0){
            const nx=bestPlayer.velocity.x/speed, ny=bestPlayer.velocity.y/speed;
            const predDist=Math.hypot(aimX-screenCenterX, aimY-screenCenterY)*S.predictionFactor;
            aimX+=nx*predDist*0.5; aimY+=ny*predDist*0.5;
        }
    }
    aimY+=S.aimOffsetY;

    const dx=(aimX-screenCenterX)*S.smooth;
    const dy=(aimY-screenCenterY)*S.smooth;
    if(Math.abs(dx)<0.2&&Math.abs(dy)<0.2)return;

    const gameCanvas=document.querySelector('canvas');
    if(!gameCanvas)return;
    gameCanvas.dispatchEvent(new MouseEvent('mousemove',{
        clientX:screenCenterX+dx,clientY:screenCenterY+dy,
        movementX:dx,movementY:dy,bubbles:true
    }));

    if(S.triggerbot){
        const distToTarget=Math.hypot(aimX-screenCenterX, aimY-screenCenterY);
        if(distToTarget<=S.triggerDistance && now-S.lastShot>=S.fireDelay){
            gameCanvas.dispatchEvent(new MouseEvent('mousedown',{button:0,bubbles:true}));
            gameCanvas.dispatchEvent(new MouseEvent('mouseup',{button:0,bubbles:true}));
            S.lastShot=now;
        }
    }
}

function createPanel(){
    if(S.uiPanel)return;
    const panel=document.createElement('div');panel.id='_oc128sui';
    panel.style.cssText=`
        position:fixed;left:${S.panelX}px;top:${S.panelY}px;z-index:2147483650;
        background:rgba(10,20,45,0.75); backdrop-filter:blur(16px) saturate(180%);
        border:1px solid rgba(0,180,255,0.25); border-radius:16px;
        box-shadow:0 8px 32px rgba(0,0,0,0.5), 0 0 20px rgba(0,150,255,0.15);
        font-family:'Segoe UI',system-ui,monospace; color:#e0e8f0;
        font-size:12px; min-width:240px; pointer-events:auto; user-select:none;
        transition:all 0.3s ease; overflow:hidden;
    `;
    panel.innerHTML=`
        <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;cursor:move;background:rgba(0,0,0,0.2);border-bottom:1px solid rgba(0,180,255,0.2);" id="_oc128sdrag">
            <div style="display:flex;align-items:center;gap:6px;">
                <span style="font-size:16px;filter:drop-shadow(0 0 6px rgba(0,180,255,0.6));">🌊</span>
                <span style="font-weight:700;font-size:13px;background:linear-gradient(135deg,#00c6ff,#0072ff);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;">OCEAN v12.8s</span>
            </div>
            <div style="display:flex;gap:6px;align-items:center;">
                <span id="_oc128sminimize" style="color:rgba(255,255,255,0.4);font-size:14px;cursor:pointer;transition:0.2s;line-height:1;" onmouseover="this.style.color='#0cf'" onmouseout="this.style.color='rgba(255,255,255,0.4)'">–</span>
                <span id="_oc128sclose" style="color:rgba(255,255,255,0.4);font-size:14px;cursor:pointer;transition:0.2s;line-height:1;" onmouseover="this.style.color='#f66'" onmouseout="this.style.color='rgba(255,255,255,0.4)'">✕</span>
            </div>
        </div>

        <div id="_oc128scontent" style="padding:12px; transition:all 0.3s ease;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
                <span style="font-weight:600;letter-spacing:0.5px;text-shadow:0 0 8px rgba(0,180,255,0.3);">⚡ ACTIVE</span>
                <div id="_oc128stoggle" class="oc128ssw ${S.toggle?'on':''}" style="transform:scale(1.1);"><div class="knob"></div></div>
            </div>

            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;padding:6px 8px;background:rgba(0,255,100,0.05);border:1px solid rgba(0,255,100,0.2);border-radius:8px;">
                <span style="font-weight:600;color:#0f0;letter-spacing:0.5px;font-size:10px;">🎭 STREAMER (HIDE RING)</span>
                <div id="_oc128sstreamerToggle" class="oc128ssw ${S.streamerMode?'on':''}"><div class="knob"></div></div>
            </div>

            <div style="margin-bottom:12px;">
                <div style="font-weight:700;color:rgba(0,180,255,0.7);margin-bottom:6px;letter-spacing:1px;font-size:10px;">🎯 AIMBOT</div>
                <div style="display:flex;justify-content:space-between;align-items:center;margin:6px 0;">
                    <span>Prediction</span>
                    <div id="_oc128spred" class="oc128ssw ${S.prediction?'on':''}"><div class="knob"></div></div>
                </div>
                <div style="display:flex;justify-content:space-between;align-items:center;margin:6px 0;">
                    <span>Smooth</span>
                    <span style="color:#7eb8ff;font-weight:600;" id="_oc128ssval">${S.smooth}</span>
                </div>
                <input type="range" id="_oc128ssmooth" min="0.05" max="1" step="0.05" value="${S.smooth}" style="width:100%;margin:4px 0;accent-color:#00a6ff;">

                <div style="display:flex;justify-content:space-between;align-items:center;margin:6px 0;">
                    <span>FOV</span>
                    <span style="color:#7eb8ff;font-weight:600;" id="_oc128sfval">${S.fovRadius}px</span>
                </div>
                <input type="range" id="_oc128sfov" min="50" max="300" value="${S.fovRadius}" style="width:100%;margin:4px 0;accent-color:#00a6ff;">

                <div style="display:flex;justify-content:space-between;align-items:center;margin:6px 0;">
                    <span>Offset</span>
                    <span style="color:#7eb8ff;font-weight:600;" id="_oc128soval">${S.aimOffsetY}px</span>
                </div>
                <input type="range" id="_oc128soffset" min="0" max="40" value="${S.aimOffsetY}" style="width:100%;margin:4px 0;accent-color:#00a6ff;">

                <div style="display:flex;justify-content:space-between;align-items:center;margin:6px 0;">
                    <span>Pred Factor</span>
                    <span style="color:#7eb8ff;font-weight:600;" id="_oc128spfval">${S.predictionFactor}</span>
                </div>
                <input type="range" id="_oc128spfactor" min="0" max="1" step="0.1" value="${S.predictionFactor}" style="width:100%;margin:4px 0;accent-color:#00a6ff;">
            </div>

            <div style="margin-bottom:12px;">
                <div style="font-weight:700;color:rgba(0,180,255,0.7);margin-bottom:6px;letter-spacing:1px;font-size:10px;">💥 TRIGGERBOT</div>
                <div style="display:flex;justify-content:space-between;align-items:center;margin:6px 0;">
                    <span>Auto Fire</span>
                    <div id="_oc128strigger" class="oc128ssw ${S.triggerbot?'on':''}"><div class="knob"></div></div>
                </div>
                <div style="display:flex;justify-content:space-between;align-items:center;margin:6px 0;">
                    <span>Trigger Dist</span>
                    <span style="color:#7eb8ff;font-weight:600;" id="_oc128stdval">${S.triggerDistance}px</span>
                </div>
                <input type="range" id="_oc128stdist" min="2" max="30" value="${S.triggerDistance}" style="width:100%;margin:4px 0;accent-color:#00a6ff;">

                <div style="display:flex;justify-content:space-between;align-items:center;margin:6px 0;">
                    <span>Fire Delay</span>
                    <span style="color:#7eb8ff;font-weight:600;" id="_oc128sfdval">${S.fireDelay}ms</span>
                </div>
                <input type="range" id="_oc128sfdelay" min="50" max="600" step="10" value="${S.fireDelay}" style="width:100%;margin:4px 0;accent-color:#00a6ff;">
            </div>

            <div style="display:flex;justify-content:space-between;align-items:center;padding-top:8px;border-top:1px solid rgba(0,180,255,0.2);font-size:9px;">
                <span style="color:rgba(0,180,255,0.5);">Caps Lock / Streamer toggle in panel</span>
                <span style="color:rgba(0,180,255,0.3);font-style:italic;">ratman4080 ©2026</span>
            </div>
        </div>
    `;

    document.body.appendChild(panel);
    S.uiPanel=panel;

    const style=document.createElement('style');
    style.textContent=`
        .oc128ssw{
            width:32px;height:18px;background:rgba(255,255,255,0.08);
            border-radius:9px;position:relative;cursor:pointer;transition:all 0.3s ease;
            box-shadow:inset 0 1px 3px rgba(0,0,0,0.4), 0 0 6px rgba(0,180,255,0.2);
            border:1px solid rgba(0,180,255,0.2);
        }
        .oc128ssw.on{
            background:linear-gradient(135deg,#00a6ff,#0055ff);
            box-shadow:0 0 12px rgba(0,150,255,0.5);
            border-color:rgba(0,200,255,0.8);
        }
        .oc128ssw .knob{
            width:14px;height:14px;background:#fff;
            border-radius:50%;position:absolute;top:2px;left:2px;
            transition:all 0.3s cubic-bezier(0.4,0.0,0.2,1);
            box-shadow:0 1px 4px rgba(0,0,0,0.5);
        }
        .oc128ssw.on .knob{
            left:16px;background:#fff;
            box-shadow:0 0 10px rgba(255,255,255,0.8);
        }
        input[type=range]{
            -webkit-appearance:none;appearance:none;
            height:4px;background:rgba(255,255,255,0.1);
            border-radius:2px;outline:none;margin:4px 0;
        }
        input[type=range]::-webkit-slider-thumb{
            -webkit-appearance:none;appearance:none;
            width:16px;height:16px;background:linear-gradient(135deg,#00a6ff,#0072ff);
            border-radius:50%;cursor:pointer;border:2px solid rgba(255,255,255,0.8);
            box-shadow:0 0 8px rgba(0,150,255,0.6);
        }
    `;
    document.head.appendChild(style);

    const dragHandle=document.getElementById('_oc128sdrag');
    dragHandle.addEventListener('mousedown',e=>{
        S.dragging=true;S.dragStartX=e.clientX-S.panelX;S.dragStartY=e.clientY-S.panelY;e.preventDefault();
    });
    window.addEventListener('mousemove',e=>{
        if(!S.dragging)return;
        S.panelX=e.clientX-S.dragStartX;S.panelY=e.clientY-S.dragStartY;
        S.uiPanel.style.left=S.panelX+'px';S.uiPanel.style.top=S.panelY+'px';
    });
    window.addEventListener('mouseup',()=>{if(S.dragging)S.dragging=false;});

    document.getElementById('_oc128sclose').addEventListener('click',()=>{S.uiPanel.style.display='none';});

    const minimizeBtn=document.getElementById('_oc128sminimize');
    const contentDiv=document.getElementById('_oc128scontent');
    minimizeBtn.addEventListener('click',()=>{
        S.panelMinimized=!S.panelMinimized;
        if(S.panelMinimized){
            contentDiv.style.display='none';
            panel.style.minWidth='auto';
            panel.style.borderRadius='12px';
            dragHandle.style.padding='4px 8px';
            minimizeBtn.textContent='_';
        }else{
            contentDiv.style.display='block';
            panel.style.minWidth='240px';
            panel.style.borderRadius='16px';
            dragHandle.style.padding='8px 12px';
            minimizeBtn.textContent='–';
        }
    });

    const bindToggle=(id, key, after)=>{
        document.getElementById(id).addEventListener('click',function(){
            const sw=this.querySelector('.oc128ssw')||this;
            S[key]=!S[key];
            sw.classList.toggle('on',S[key]);
            if(after) after();
        });
    };
    bindToggle('_oc128stoggle','toggle',()=>{S.active=S.toggle||capsActive();});
    bindToggle('_oc128spred','prediction');
    bindToggle('_oc128strigger','triggerbot');
    bindToggle('_oc128sstreamerToggle','streamerMode',()=>{
        if(S.streamerMode){
            showOverlay(false);
        } else {
            showOverlay(S.active);
        }
    });

    const bindSlider=(id, key, isFloat, valId, suffix)=>{
        document.getElementById(id).addEventListener('input',e=>{
            S[key]=isFloat?parseFloat(e.target.value):parseInt(e.target.value);
            document.getElementById(valId).textContent=S[key]+suffix;
        });
    };
    bindSlider('_oc128ssmooth','smooth',true,'_oc128ssval','');
    bindSlider('_oc128sfov','fovRadius',false,'_oc128sfval','px');
    bindSlider('_oc128soffset','aimOffsetY',false,'_oc128soval','px');
    bindSlider('_oc128spfactor','predictionFactor',true,'_oc128spfval','');
    bindSlider('_oc128stdist','triggerDistance',false,'_oc128stdval','px');
    bindSlider('_oc128sfdelay','fireDelay',false,'_oc128sfdval','ms');
}

function loop(){
    requestAnimationFrame(loop);
    S.active=S.toggle||capsActive();
    showOverlay(S.active);
    drawRing();
    processAimbot();
    if(!S.active)S.lastShot=0;
}

function init(){
    createOverlay();
    createPanel();
    if(S.toggle||capsActive()){
        S.active=true;
        showOverlay(true);
    }
    requestAnimationFrame(loop);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);
else setTimeout(init,30);
})();
