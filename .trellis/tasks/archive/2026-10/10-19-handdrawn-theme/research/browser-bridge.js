// Test-only route replacement for /bridge.ts. Never imported by production.
import { defaultSettings, resolveSettings } from '/@fs/Users/shen/Studio/Code/EyeCare/app/shared/contracts.ts';
const caps = Object.fromEntries(['input','mouse','lock','overlay','notification','tray','launchAtLogin'].map(key=>[key,{state:'available',reason:''}]));
const settings = defaultSettings();
settings.appearance.theme = 'handdrawn';
settings.reminder.visual = 'mask';
let snapshot = { settings, settingsRevision:0,sequence:0,status:'counting',statusReason:'正在守护你的用眼时光',elapsedActiveMs:5*60000,remainingMs:25*60000,currentReminderId:null,currentPreviewId:null,latestPreviewResult:null,theme:'handdrawn',reduceMotion:false,reduceTransparency:false,capabilities:caps,displays:[{id:'1',label:'Primary',primary:true,bounds:{x:0,y:0,width:800,height:600},scaleFactor:1}],latestReminderResult:null,restConfirmedCount:0,warnings:[] };
let overlay = {event:{id:'visual-fixture',generation:1,kind:'preview',settings:resolveSettings(settings),screenIds:['1'],createdAtMs:0},theme:'handdrawn',reduceMotion:false,reduceTransparency:false};
const snapshotListeners=new Set(), overlayListeners=new Set();
const ok=value=>({ok:true,value});
const emit=()=>snapshotListeners.forEach(fn=>fn(structuredClone(snapshot)));
const emitOverlay=()=>overlayListeners.forEach(fn=>fn(structuredClone(overlay)));
window.__visualFixture={
 get snapshot(){return structuredClone(snapshot);},
 get overlay(){return structuredClone(overlay);},
 actions:[],readyCount:0,
 update(change){snapshot={...snapshot,...change,sequence:snapshot.sequence+1};if(overlay)overlay={...overlay,theme:snapshot.theme,reduceMotion:snapshot.reduceMotion,reduceTransparency:snapshot.reduceTransparency};emit();emitOverlay();},
 resetOverlay(){overlay={event:{id:'visual-fixture',generation:1,kind:'preview',settings:resolveSettings(snapshot.settings),screenIds:['1'],createdAtMs:0},theme:snapshot.theme,reduceMotion:snapshot.reduceMotion,reduceTransparency:snapshot.reduceTransparency};emitOverlay();}
};
window.eyeCare={
 getSnapshot:async()=>structuredClone(snapshot),subscribeSnapshot:fn=>{snapshotListeners.add(fn);return()=>snapshotListeners.delete(fn);},
 saveSettings:async(revision,next)=>{if(revision!==snapshot.settingsRevision)return {ok:false,error:{code:'SETTINGS_CONFLICT',message:'conflict'}};snapshot={...snapshot,settings:structuredClone(next),settingsRevision:revision+1,sequence:snapshot.sequence+1,theme:next.appearance.theme==='system'?'light':next.appearance.theme};emit();if(overlay){overlay={...overlay,theme:snapshot.theme};emitOverlay();}return ok(structuredClone(snapshot));},
 pause:async()=>{snapshot.status='paused';emit();return ok(structuredClone(snapshot));},resume:async()=>{snapshot.status='counting';emit();return ok(structuredClone(snapshot));},remindNow:async()=>ok(structuredClone(snapshot)),
 resolveReminder:async(id,generation,action)=>{window.__visualFixture.actions.push({id,generation,action});overlay=null;emitOverlay();return ok(structuredClone(snapshot));},
 preview:async()=>ok('fixture-preview'),cancelPreview:async()=>ok(null),
 getOverlay:async()=>structuredClone(overlay),subscribeOverlay:fn=>{overlayListeners.add(fn);return()=>overlayListeners.delete(fn);},
 overlayReady:async()=>{window.__visualFixture.readyCount++;return ok(null);},overlaySoundStarted:async()=>ok(null),overlayFinished:async()=>ok(null),
 openSettings:async()=>ok(null),subscribeOpenSettings:()=>()=>{},quit:async()=>ok(null)
};
