(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const STORAGE_KEY = 'movida-sst-multigas-log-v1';
  const SETTINGS_KEY = 'movida-sst-multigas-settings-v1';
  const TICK_MS = 500;
  const SIM_ACCEL = 120;

  const defs = {
    o2: { label:'O₂', unit:'%vol', decimals:1, range:[0,30], low:19.5, high:23.0, t90:12, direction:'both' },
    lel:{ label:'LEL',unit:'%LEL',decimals:0,range:[0,100],low:10,high:20,t90:10,direction:'high' },
    co: { label:'CO', unit:'ppm', decimals:0, range:[0,1999], low:25, high:100, stel:100, twa:25, refED:20, refEC:100, t90:15, direction:'high' },
    h2s:{ label:'H₂S',unit:'ppm',decimals:0,range:[0,200],low:10,high:15,stel:15,twa:10,refED:5,refEC:10,t90:15,direction:'high' },
    ph3:{ label:'PH₃',unit:'ppm',decimals:2,range:[0,20],low:.10,high:.20,stel:.20,twa:.10,refED:.10,refEC:.20,t90:15,direction:'high' }
  };

  const scenarios = {
    clean:{ label:'Aire limpio', drift:false, values:{ top:{o2:20.8,lel:0,co:0,h2s:0,ph3:0}, middle:{o2:20.8,lel:0,co:0,h2s:0,ph3:0}, bottom:{o2:20.8,lel:0,co:0,h2s:0,ph3:0} }, note:'Atmósfera prevista como limpia. Úsala para practicar la secuencia de arranque y FAS.' },
    tank:{ label:'Tanque estratificado', drift:false, values:{ top:{o2:20.8,lel:0,co:2,h2s:.5,ph3:.01}, middle:{o2:20.2,lel:5,co:10,h2s:4,ph3:.03}, bottom:{o2:18.6,lel:12,co:20,h2s:18,ph3:.08} }, note:'Las concentraciones cambian con la altura. Compara superior, media e inferior.' },
    welding:{ label:'Soldadura confinada', drift:true, values:{ top:{o2:20.5,lel:0,co:18,h2s:0,ph3:0}, middle:{o2:20.0,lel:0,co:42,h2s:0,ph3:0}, bottom:{o2:19.4,lel:1,co:75,h2s:0,ph3:0} }, note:'La tarea genera CO y puede reducir O₂. Observa cómo evolucionan TWA y STEL.' },
    leak:{ label:'Fuga combustible', drift:true, values:{ top:{o2:20.5,lel:8,co:2,h2s:0,ph3:0}, middle:{o2:20.0,lel:18,co:3,h2s:0,ph3:0}, bottom:{o2:19.4,lel:34,co:4,h2s:0,ph3:0} }, note:'Una fuga incrementa %LEL. El canal catalítico depende de oxígeno suficiente y estado del sensor.' },
    ph3:{ label:'Fumigación de granos', drift:true, values:{ top:{o2:20.8,lel:0,co:0,h2s:0,ph3:.05}, middle:{o2:20.8,lel:0,co:0,h2s:0,ph3:.18}, bottom:{o2:20.7,lel:0,co:0,h2s:0,ph3:.62} }, note:'Fosfina en área próxima a fumigación. Compara alarma del instrumento con referencia higiénica.' }
  };

  const state = {
    power:false, booting:false, ready:false, fasDone:false, bumpPassed:false, page:'live', profile:'standard', scenario:'clean', position:'middle', fault:'none', muted:false,
    readings:{o2:20.8,lel:0,co:0,h2s:0,ph3:0}, displayReadings:{o2:20.8,lel:0,co:0,h2s:0,ph3:0}, baselines:{o2:20.8,lel:0,co:0,h2s:0,ph3:0},
    peaks:{co:0,h2s:0,ph3:0,lel:0}, o2Min:20.8, simMinutes:0, history:[], alarmLatch:false, bumping:false, exposureStarted:false, lastTs:performance.now(), bootToken:0,
    alarms: JSON.parse(JSON.stringify({ o2:{low:19.5,high:23}, lel:{low:10,high:20}, co:{low:25,high:100,stel:100,twa:25}, h2s:{low:10,high:15,stel:15,twa:10}, ph3:{low:.10,high:.20,stel:.20,twa:.10} }))
  };

  let intervalId = null, audioCtx = null, lastBeepAt = 0;
  const fmt = (gas, n) => Number.isFinite(n) ? n.toFixed(defs[gas].decimals) : '--';
  const toxicGas = () => state.profile === 'ph3' ? 'ph3' : 'h2s';
  const activeGases = () => ['o2','lel','co',toxicGas()];
  const clamp = (v,min,max) => Math.min(max,Math.max(min,v));

  function currentTarget(gas){
    const scenario = scenarios[state.scenario];
    let base = scenario.values[state.position][gas] ?? 0;
    if (scenario.drift && state.power && state.ready) {
      const t = state.simMinutes / 10;
      if (state.scenario === 'welding') { if(gas==='co') base *= 1 + Math.min(.55,t*.025); if(gas==='o2') base -= Math.min(.6,t*.02); }
      if (state.scenario === 'leak') { if(gas==='lel') base *= 1 + Math.min(1.2,t*.045); if(gas==='o2') base -= Math.min(.7,t*.02); }
      if (state.scenario === 'ph3' && gas==='ph3') base *= 1 + Math.min(.8,t*.035);
    }
    if (state.bumping) {
      const tests = {o2:15,lel:35,co:60,h2s:20,ph3:.50}; base = tests[gas];
    }
    if (state.fault === 'poisoned' && gas === 'lel') base *= .08;
    if (state.fault === 'blocked') base *= gas === 'o2' ? 1 : .55;
    return clamp(base, defs[gas].range[0], defs[gas].range[1]*1.2);
  }

  function sensorStep(gas, dtSec){
    const targetRaw = currentTarget(gas);
    let target = targetRaw;
    if (state.fasDone && !state.bumping) {
      if (gas === 'o2') target = 20.8 + (targetRaw - state.baselines.o2);
      else target = Math.max(0, targetRaw - state.baselines[gas]);
    }
    let t90 = defs[gas].t90;
    if (state.fault === 'blocked') t90 *= 2.8;
    const tau = Math.max(.4,t90 / Math.log(10));
    const a = 1 - Math.exp(-dtSec/tau);
    let next = state.readings[gas] + (target-state.readings[gas])*a;
    const noiseBase = gas==='o2' ? .015 : (gas==='ph3' ? .002 : defs[gas].decimals===0 ? .12 : .01);
    let noise = (Math.random()-.5)*noiseBase;
    if (state.fault === 'airflow') noise *= 8;
    next += noise;
    if (!state.power) next = gas==='o2' ? 20.8 : 0;
    state.readings[gas] = clamp(next,0,defs[gas].range[1]*1.25);
  }

  function exposureUpdate(dtSec){
    if (!state.power || !state.ready || state.bumping) return;
    const factor = $('acceleratedTime')?.checked ? SIM_ACCEL : 1;
    const dtMin = dtSec * factor / 60;
    state.simMinutes += dtMin;
    state.history.push({ minute:state.simMinutes, co:state.readings.co, h2s:state.readings.h2s, ph3:state.readings.ph3 });
    const cutoff = state.simMinutes - 480;
    if (state.history.length > 5000) state.history = state.history.filter(x => x.minute >= cutoff);
    state.peaks.co = Math.max(state.peaks.co,state.readings.co); state.peaks.h2s=Math.max(state.peaks.h2s,state.readings.h2s); state.peaks.ph3=Math.max(state.peaks.ph3,state.readings.ph3); state.peaks.lel=Math.max(state.peaks.lel,state.readings.lel);
    state.o2Min = Math.min(state.o2Min,state.readings.o2);
    state.exposureStarted = true;
  }

  function rollingAverage(gas, windowMin){
    if (!state.history.length) return 0;
    const start = Math.max(0,state.simMinutes-windowMin);
    const rows = state.history.filter(x=>x.minute>=start);
    if (!rows.length) return 0;
    let area=0, prevMin=start, prevVal=rows[0][gas]||0;
    for(const row of rows){ const dt=Math.max(0,row.minute-prevMin); area += prevVal*dt; prevMin=row.minute; prevVal=row[gas]||0; }
    area += prevVal*Math.max(0,state.simMinutes-prevMin);
    return area/windowMin;
  }
  function twa8(gas){
    if (!state.history.length) return 0;
    let area=0;
    for(let i=1;i<state.history.length;i++){ const a=state.history[i-1],b=state.history[i]; area += ((a[gas]+b[gas])/2)*(b.minute-a.minute); }
    return area/480;
  }

  function alarmFor(gas, value){
    const a = state.alarms[gas]; if(!a) return {level:'none',label:''};
    if(gas==='o2') { if(value<a.low || value>a.high) return {level:'high',label:value<a.low?'LOW':'HIGH'}; return {level:'none',label:''}; }
    if(value>=a.high) return {level:'high',label:'HIGH'};
    if(value>=a.low) return {level:'low',label:'LOW'};
    if((gas==='co'||gas==='h2s'||gas==='ph3') && state.ready){
      const st=rollingAverage(gas,15),tw=twa8(gas);
      if(a.stel!=null && st>=a.stel) return {level:'high',label:'STEL'};
      if(a.twa!=null && tw>=a.twa) return {level:'low',label:'TWA'};
    }
    return {level:'none',label:''};
  }

  function overallAlarm(){
    if(!state.power||!state.ready||state.bumping) return 'none';
    let level='none';
    for(const g of activeGases()){ const a=alarmFor(g,state.readings[g]); if(a.level==='high') return 'high'; if(a.level==='low') level='low'; }
    if(state.alarmLatch && $('latchHigh')?.checked) return 'high';
    return level;
  }

  function beep(level){
    if(state.muted||level==='none'||Date.now()-lastBeepAt<900) return; lastBeepAt=Date.now();
    try{
      audioCtx ||= new (window.AudioContext||window.webkitAudioContext)();
      const osc=audioCtx.createOscillator(),gain=audioCtx.createGain(); osc.type='square'; osc.frequency.value=level==='high'?1380:880; gain.gain.value=.025; osc.connect(gain);gain.connect(audioCtx.destination);osc.start();gain.gain.exponentialRampToValueAtTime(.001,audioCtx.currentTime+.16);osc.stop(audioCtx.currentTime+.17);
      navigator.vibrate?.(level==='high'?[160,80,160]:[100]);
    }catch{}
  }

  function setLcdMessage(status,message,footer=''){
    $('lcdStatus').textContent=status; $('lcdMessage').textContent=message; $('lcdMessage').hidden=false; $('gasGrid').hidden=true; $('lcdFooter').textContent=footer;
  }
  function showLive(){ $('lcdMessage').hidden=true; $('gasGrid').hidden=false; }

  function renderLCD(){
    const lcd=$('lcd');
    if(!state.power){ lcd.classList.add('lcd-off'); setLcdMessage('OFF','POWER','Mantén ● para encender'); return; }
    lcd.classList.remove('lcd-off');
    if(state.booting) return;
    if(state.bumping){ setLcdMessage('BUMP','GAS TEST','Verificando respuesta de sensores…'); return; }
    if(!state.ready){ setLcdMessage('READY?','FAS','Realiza o confirma ajuste en aire fresco'); return; }
    showLive(); $('lcdStatus').textContent=state.page==='live'?'LIVE':state.page.toUpperCase();
    const tg=toxicGas(); $('toxicName').textContent=defs[tg].label;
    $('valO2').textContent=fmt('o2',state.readings.o2); $('valLEL').textContent=fmt('lel',state.readings.lel); $('valCO').textContent=fmt('co',state.readings.co); $('valToxic').textContent=fmt(tg,state.readings[tg]);
    for(const [cellGas,gas] of [['o2','o2'],['lel','lel'],['co','co'],['toxic',tg]]){
      const cell=document.querySelector(`.gas-cell[data-gas="${cellGas}"]`), em=cell.querySelector('em'), a=alarmFor(gas,state.readings[gas]); cell.classList.toggle('warn',a.level==='low'); cell.classList.toggle('danger',a.level==='high'); em.textContent=a.label;
    }
    if(state.page==='peak') $('lcdFooter').textContent=`PEAK ${defs[tg].label}: ${fmt(tg,state.peaks[tg])} ${defs[tg].unit}`;
    else if(state.page==='stel') $('lcdFooter').textContent=`STEL/EC 15 min ${defs[tg].label}: ${fmt(tg,rollingAverage(tg,15))}`;
    else if(state.page==='twa') $('lcdFooter').textContent=`TWA/ED 8 h ${defs[tg].label}: ${fmt(tg,twa8(tg))}`;
    else $('lcdFooter').textContent=`${scenarios[state.scenario].label} · ${state.position.toUpperCase()}`;
  }

  function renderExposure(){
    const tg=toxicGas(), st=rollingAverage(tg,15), tw=twa8(tg);
    $('stelValue').textContent=fmt(tg,st); $('stelGas').textContent=`${defs[tg].unit} · ${defs[tg].label}`;
    $('twaValue').textContent=fmt(tg,tw); $('twaGas').textContent=`${defs[tg].unit} · ${defs[tg].label}`;
    $('peakValue').textContent=fmt(tg,state.peaks[tg]); $('peakGas').textContent=`${defs[tg].unit} · ${defs[tg].label}`; $('o2MinValue').textContent=fmt('o2',state.o2Min);
    const h=Math.floor(state.simMinutes/60),m=Math.floor(state.simMinutes%60); $('simTimeText').textContent=`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')} simulados`; $('simClockBadge').textContent=`${$('acceleratedTime')?.checked?'x120':'x1'} · ${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
  }

  function renderReference(){
    const tg=toxicGas(); const rows=[['CO',defs.co.refED,defs.co.refEC], [defs[tg].label,defs[tg].refED,defs[tg].refEC]];
    $('referenceRows').innerHTML=rows.map(([name,ed,ec])=>`<div class="reference-row"><span>${name}</span><b>ED ${ed} ppm</b><b>EC ${ec} ppm</b></div>`).join('');
  }

  function renderAlarmEditor(){
    const gases=['o2','lel','co',toxicGas()];
    $('alarmEditor').innerHTML=gases.map(g=>{
      const a=state.alarms[g], toxic=['co','h2s','ph3'].includes(g), step=defs[g].decimals===2?.01:defs[g].decimals===1?.1:1;
      return `<div class="alarm-edit-row" data-edit-gas="${g}"><div><h4>${defs[g].label}</h4><small>${defs[g].unit}</small></div><div class="alarm-inputs">
        <label>LOW<input data-k="low" type="number" step="${step}" value="${a.low}"></label>
        <label>HIGH<input data-k="high" type="number" step="${step}" value="${a.high}"></label>
        <label>STEL<input data-k="stel" type="number" step="${step}" value="${toxic?a.stel:''}" ${toxic?'':'disabled'}></label>
        <label>TWA<input data-k="twa" type="number" step="${step}" value="${toxic?a.twa:''}" ${toxic?'':'disabled'}></label>
      </div></div>`;
    }).join('');
    $$('#alarmEditor input').forEach(input=>input.addEventListener('change',()=>{
      const row=input.closest('[data-edit-gas]'),g=row.dataset.editGas,k=input.dataset.k,v=Number(input.value); if(!Number.isFinite(v))return;
      if(k==='high'&&v<=state.alarms[g].low){input.value=state.alarms[g].high; coach('Configuración no válida','HIGH debe ser mayor que LOW.');return;}
      if(k==='low'&&v>=state.alarms[g].high){input.value=state.alarms[g].low; coach('Configuración no válida','LOW debe ser menor que HIGH.');return;}
      state.alarms[g][k]=v; saveSettings();
    }));
  }

  function renderScenario(){
    $('probeMarker').style.top=state.position==='top'?'19%':state.position==='bottom'?'80%':'50%';
    $$('.position-buttons button').forEach(b=>b.classList.toggle('active',b.dataset.position===state.position));
    $$('#profileSwitcher button').forEach(b=>b.classList.toggle('active',b.dataset.profile===state.profile));
  }

  function renderQuality(){
    const q=$('qualityDot'); q.className='quality-dot'; let title='Medición en condiciones simuladas normales';
    if(state.fault==='blocked'){q.classList.add('bad');title='Entrada de sensor bloqueada: lectura potencialmente incorrecta';}
    else if(state.fault==='poisoned'){q.classList.add('bad');title='Sensor LEL afectado: posible sublectura';}
    else if(state.fault==='airflow'){q.classList.add('warn');title='Velocidad de aire alta: lectura potencialmente inestable';}
    else if(!state.bumpPassed){q.classList.add('warn');title='Prueba funcional pendiente';} else q.classList.add('good'); q.title=title;
  }

  function renderGlobal(){
    const level=overallAlarm(), pill=$('globalState'),device=$('device');
    pill.className='state-pill';device.classList.remove('alarm-low','alarm-high','bumping');
    if(!state.power){pill.classList.add('state-off');pill.textContent='EQUIPO APAGADO';}
    else if(state.bumping){pill.classList.add('safe');pill.textContent='BUMP TEST';device.classList.add('bumping');}
    else if(!state.ready){pill.classList.add('state-off');pill.textContent=state.booting?'AUTOPRUEBA':'FAS PENDIENTE';}
    else if(level==='high'){pill.classList.add('high');pill.textContent='ALARMA HIGH';device.classList.add('alarm-high');state.alarmLatch=true;beep('high');}
    else if(level==='low'){pill.classList.add('low');pill.textContent='ALARMA LOW';device.classList.add('alarm-low');beep('low');}
    else {pill.classList.add('safe');pill.textContent='MONITOREANDO';}
    $('soundIcon').textContent=state.muted?'×':'♪'; $('muteLabel').textContent=state.muted?'Silenciado':'Activo'; $('muteBtn').classList.toggle('active',state.muted); $('muteBtn').setAttribute('aria-pressed',String(state.muted));
  }

  function renderMission(){
    let title='Enciende el equipo',text='Mantén POWER para iniciar la autoprueba del detector.';
    if(state.power&&state.booting){title='Observa la autoprueba';text='El detector verifica pantalla, luces, alarma y sensores antes de medir.';}
    else if(state.power&&!state.ready){title='Decide sobre FAS';text='Haz el ajuste solo si tienes certeza de estar en aire fresco.';}
    else if(state.ready&&!state.bumpPassed){title='Realiza la prueba funcional';text='Comprueba que los sensores respondan y que las alarmas sean perceptibles.';}
    else if(state.ready&&state.bumpPassed){title='Monitorea la atmósfera';text=state.scenario==='tank'?'Compara los tres niveles del espacio: superior, medio e inferior.':scenarios[state.scenario].note;}
    $('missionTitle').textContent=title;$('missionText').textContent=text;
  }

  function render(){ renderLCD();renderExposure();renderGlobal();renderQuality();renderMission(); }

  function coach(title,text){$('coachTitle').textContent=title;$('coachText').textContent=text;}
  function addLog(title,body){
    const logs=loadLog(); logs.unshift({time:new Date().toISOString(),title,body}); if(logs.length>40)logs.length=40; localStorage.setItem(STORAGE_KEY,JSON.stringify(logs)); renderLog();
  }
  function loadLog(){try{return JSON.parse(localStorage.getItem(STORAGE_KEY)||'[]')}catch{return[]}}
  function renderLog(){const logs=loadLog(),el=$('eventLog'); if(!logs.length){el.innerHTML='<p class="empty-log">Aún no hay registros.</p>';return;} el.innerHTML=logs.map(x=>`<div class="log-entry"><b>${x.title}</b><span>${new Date(x.time).toLocaleString('es')} · ${x.body}</span></div>`).join('');}
  function saveSettings(){try{localStorage.setItem(SETTINGS_KEY,JSON.stringify({alarms:state.alarms,profile:state.profile}))}catch{}}
  function loadSettings(){try{const s=JSON.parse(localStorage.getItem(SETTINGS_KEY)||'null');if(s?.alarms)state.alarms={...state.alarms,...s.alarms};if(s?.profile)state.profile=s.profile}catch{}}

  async function powerOn(){
    if(state.power||state.booting)return;state.power=true;state.booting=true;state.ready=false;state.fasDone=false;state.bumpPassed=false;state.alarmLatch=false;state.bootToken++;const token=state.bootToken;renderGlobal();
    const steps=[['TEST','8888','Pantalla · LEDs · vibración'],['SENS','O₂ LEL CO TOX','Reconociendo sensores'],['ALARM','LOW / HIGH','Verificando setpoints'],['CAL','CHECK','Estado de calibración'],['FAS?','AIR','Confirma aire fresco']];
    for(const [st,msg,foot] of steps){if(token!==state.bootToken)return;setLcdMessage(st,msg,foot);await new Promise(r=>setTimeout(r,650));}
    if(token!==state.bootToken)return;state.booting=false;render();coach('Fresh Air Setup','Haz FAS solamente en una atmósfera que sepas que está limpia. También puedes omitirlo y continuar.');
  }
  function powerOff(){state.bootToken++;state.power=false;state.booting=false;state.ready=false;state.bumping=false;state.alarmLatch=false;render();coach('Equipo apagado','Mantén POWER para iniciar una nueva práctica.');}
  function doFAS(){
    if(!state.power||state.booting){coach('FAS no disponible','Primero enciende y espera la autoprueba.');return;}
    const actual=scenarios[state.scenario].values[state.position]; state.baselines={...actual};state.fasDone=true;state.ready=true;state.readings={o2:20.8,lel:0,co:0,h2s:0,ph3:0};
    const contaminated=state.scenario!=='clean'||Object.entries(actual).some(([g,v])=>g!=='o2'&&v>.001)||Math.abs(actual.o2-20.8)>.2;
    if(contaminated){coach('FAS realizado en atmósfera no limpia','Acabas de introducir un sesgo: el detector puede subestimar contaminantes. Reinicia y repite FAS en aire limpio para corregirlo.');addLog('FAS cuestionable',`${scenarios[state.scenario].label} · ${state.position}`);}else{coach('FAS completado','El cero quedó referenciado a aire limpio. Ahora realiza una prueba funcional.');addLog('FAS completado','Aire limpio');}
    render();
  }
  async function doBump(){
    if(!state.power||!state.ready||state.bumping){coach('BUMP no disponible','Completa encendido y FAS antes de la prueba funcional.');return;}
    state.bumping=true;render();await new Promise(r=>setTimeout(r,3400));
    const fail=state.fault==='blocked'||state.fault==='poisoned';state.bumping=false;state.bumpPassed=!fail;
    if(fail){coach('BUMP: ERROR',state.fault==='blocked'?'La respuesta fue insuficiente. Revisa obstrucción y no uses el equipo hasta corregir/verificar.':'El canal LEL no respondió correctamente. Requiere revisión/calibración antes del uso.');addLog('BUMP ERROR',state.fault);}else{coach('BUMP: PASS','Todos los canales respondieron y las alarmas fueron activadas en la simulación.');addLog('BUMP PASS',state.profile==='ph3'?'O₂/LEL/CO/PH₃':'O₂/LEL/CO/H₂S');}
    render();
  }
  function resetAlarm(){state.alarmLatch=false;coach('Alarma reconocida','RESET reconoce la alarma enclavada, pero no elimina el peligro. Si la concentración sigue alta, volverá a activarse.');render();}
  function resetRun(){
    state.simMinutes=0;state.history=[];state.peaks={co:0,h2s:0,ph3:0,lel:0};state.o2Min=20.8;state.baselines={o2:20.8,lel:0,co:0,h2s:0,ph3:0};state.readings={o2:20.8,lel:0,co:0,h2s:0,ph3:0};state.fasDone=false;state.bumpPassed=false;state.ready=false;state.alarmLatch=false;
    if(state.power&&!state.booting){coach('Nueva práctica','Repite FAS en aire limpio antes de continuar.');}render();
  }
  function restoreAlarms(){state.alarms={o2:{low:19.5,high:23},lel:{low:10,high:20},co:{low:25,high:100,stel:100,twa:25},h2s:{low:10,high:15,stel:15,twa:10},ph3:{low:.10,high:.20,stel:.20,twa:.10}};saveSettings();renderAlarmEditor();coach('Setpoints restaurados','Son valores iniciales de práctica y pueden modificarse. No equivalen automáticamente a límites ocupacionales.');}

  function tick(){
    const now=performance.now(),dt=Math.min(1.5,(now-state.lastTs)/1000);state.lastTs=now;
    if(state.power&&!state.booting){for(const g of Object.keys(defs))sensorStep(g,dt);exposureUpdate(dt);}render();
  }

  function bind(){
    let pressTimer=null;
    const startPress=()=>{clearTimeout(pressTimer);pressTimer=setTimeout(()=>state.power?powerOff():powerOn(),520)};const endPress=()=>clearTimeout(pressTimer);
    $('powerBtn').addEventListener('pointerdown',startPress);$('powerBtn').addEventListener('pointerup',endPress);$('powerBtn').addEventListener('pointerleave',endPress);$('powerBtn').addEventListener('click',()=>{if(state.power&&!state.booting&&!state.ready){state.ready=true;coach('FAS omitido','El equipo continúa sin FAS. Documenta por qué y asegúrate de que el cero sea válido.');render();}});
    const pages=['live','peak','stel','twa'];
    $('upBtn').addEventListener('click',()=>{if(!state.ready)return;let i=pages.indexOf(state.page);state.page=pages[(i-1+pages.length)%pages.length];renderLCD();});
    $('downBtn').addEventListener('click',()=>{if(!state.ready)return;let i=pages.indexOf(state.page);state.page=pages[(i+1)%pages.length];renderLCD();});
    $('fasBtn').addEventListener('click',doFAS);$('bumpBtn').addEventListener('click',doBump);$('resetAlarmBtn').addEventListener('click',resetAlarm);$('newRunBtn').addEventListener('click',resetRun);
    $('muteBtn').addEventListener('click',()=>{state.muted=!state.muted;renderGlobal();});
    $('scenarioSelect').addEventListener('change',e=>{state.scenario=e.target.value;if(state.scenario==='ph3'&&state.profile!=='ph3'){state.profile='ph3';renderAlarmEditor();renderReference();}renderScenario();coach('Escenario cambiado',scenarios[state.scenario].note);});
    $$('.position-buttons button').forEach(b=>b.addEventListener('click',()=>{state.position=b.dataset.position;renderScenario();coach('Punto de medición',`Ahora estás midiendo en el nivel ${b.textContent.toLowerCase()}. Espera la respuesta del sensor antes de interpretar.`);}));
    $$('#profileSwitcher button').forEach(b=>b.addEventListener('click',()=>{state.profile=b.dataset.profile;renderScenario();renderAlarmEditor();renderReference();saveSettings();coach('Configuración de sensores',state.profile==='ph3'?'Canal tóxico configurado como PH₃.':'Canal tóxico configurado como H₂S.');}));
    $('faultSelect').addEventListener('change',e=>{state.fault=e.target.value;renderQuality();const msgs={none:'Condición normal restablecida.',blocked:'Una entrada parcialmente bloqueada ralentiza y reduce la respuesta.',poisoned:'El canal LEL puede subleer pese a una atmósfera combustible.',airflow:'Velocidades de aire altas pueden alterar la lectura.'};coach('Condición didáctica',msgs[state.fault]);});
    $$('.tabs button').forEach(btn=>btn.addEventListener('click',()=>{$$('.tabs button').forEach(x=>x.classList.toggle('active',x===btn));$$('.tab-panel').forEach(p=>p.classList.toggle('active',p.dataset.panel===btn.dataset.tab));}));
    $('restoreAlarmsBtn').addEventListener('click',restoreAlarms);$('latchHigh').addEventListener('change',()=>renderGlobal());
    $('saveSnapshotBtn').addEventListener('click',()=>{const tg=toxicGas();addLog('Lectura guardada',`O₂ ${fmt('o2',state.readings.o2)} % · LEL ${fmt('lel',state.readings.lel)} % · CO ${fmt('co',state.readings.co)} ppm · ${defs[tg].label} ${fmt(tg,state.readings[tg])} ppm`);coach('Lectura guardada','Se añadió una instantánea al registro local de esta práctica.');});
    $('clearLogBtn').addEventListener('click',()=>{localStorage.removeItem(STORAGE_KEY);renderLog();});
    $('drawerToggle').addEventListener('click',()=>{const content=$('drawerContent'),open=content.hidden;content.hidden=!open;$('drawerToggle').setAttribute('aria-expanded',String(open));$('drawerToggle').querySelector('b').textContent=open?'−':'+';});
  }

  function init(){loadSettings();$('scenarioSelect').value=state.scenario;$('faultSelect').value=state.fault;renderScenario();renderReference();renderAlarmEditor();renderLog();bind();render();if(!intervalId)intervalId=setInterval(tick,TICK_MS);}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
