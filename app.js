(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  let memoryLog=[];
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
    peaks:{co:0,h2s:0,ph3:0,lel:0}, o2Min:20.8, simMinutes:0, history:[], alarmLatch:false, bumping:false, exposureStarted:false, sampleSeconds:0, fasContaminated:false, exposureArea:{co:0,h2s:0,ph3:0}, lastTs:performance.now(), bootToken:0,
    alarms: JSON.parse(JSON.stringify({ o2:{low:19.5,high:23}, lel:{low:10,high:20}, co:{low:25,high:100,stel:100,twa:25}, h2s:{low:10,high:15,stel:15,twa:10}, ph3:{low:.10,high:.20,stel:.20,twa:.10} }))
  };

  const emit = (action, detail = {}) => window.dispatchEvent(new CustomEvent('multigas:action', {detail:{action,...detail}}));
  const positionLabel = () => ({top:'superior',middle:'media',bottom:'inferior'}[state.position]);
  const analysisGas = () => $('exposureGas')?.value === 'co' ? 'co' : toxicGas();
  const setText=(id,value)=>{if($(id).textContent!==value)$(id).textContent=value;};
  const sampleWait = () => state.fault === 'blocked' ? 45 : 15;
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
    const sample={start:state.simMinutes-dtMin,end:state.simMinutes,co:state.readings.co,h2s:0,ph3:0};sample[toxicGas()]=state.readings[toxicGas()];
    state.history.push(sample);
    for(const gas of ['co',toxicGas()]) state.exposureArea[gas] += sample[gas]*dtMin;
    while(state.history.length && state.history[0].end <= state.simMinutes-15) state.history.shift();
    state.sampleSeconds += dtSec;
    if(state.sampleSeconds >= sampleWait()) emit('sample', {scenario:state.scenario,position:state.position,verified:state.bumpPassed&&!state.fasContaminated&&state.fault==='none'});
    state.peaks.co = Math.max(state.peaks.co,state.readings.co); state.peaks[toxicGas()]=Math.max(state.peaks[toxicGas()],state.readings[toxicGas()]); state.peaks.lel=Math.max(state.peaks.lel,state.readings.lel);
    state.o2Min = Math.min(state.o2Min,state.readings.o2);
    state.exposureStarted = true;
  }

  function rollingAverage(gas, windowMin){
    const start = Math.max(0,state.simMinutes-windowMin);
    return state.history.reduce((area,row) => area + row[gas]*Math.max(0,Math.min(row.end,state.simMinutes)-Math.max(row.start,start)),0)/windowMin;
  }
  function twa8(gas){ return state.exposureArea[gas]/480; }

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
    if(state.muted||document.body.classList.contains('auth-locked')||level==='none'||Date.now()-lastBeepAt<900) return; lastBeepAt=Date.now();
    try{
      audioCtx ||= new (window.AudioContext||window.webkitAudioContext)();
      if(audioCtx.state==='suspended')audioCtx.resume().catch(()=>{});
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
    if(!state.power){ lcd.classList.add('lcd-off'); setLcdMessage('OFF','POWER','Toca ● para encender'); return; }
    lcd.classList.remove('lcd-off');
    if(state.booting) return;
    if(state.bumping){ setLcdMessage('BUMP','GAS TEST','Verificando respuesta de sensores…'); return; }
    if(!state.ready){ setLcdMessage('READY?','FAS','Realiza o confirma ajuste en aire fresco'); return; }
    showLive(); $('lcdStatus').textContent=state.page==='live'?'LIVE':state.page.toUpperCase();
    const tg=toxicGas(); $('toxicName').textContent=defs[tg].label;
    const displayValue = gas => {
      if(state.page==='peak') return gas==='o2'?state.o2Min:state.peaks[gas];
      if(state.page==='stel'||state.page==='twa') return ['co','h2s','ph3'].includes(gas)?(state.page==='stel'?rollingAverage(gas,15):twa8(gas)):NaN;
      return state.readings[gas];
    };
    for(const [id,gas] of [['valO2','o2'],['valLEL','lel'],['valCO','co'],['valToxic',tg]]) $(id).textContent=fmt(gas,displayValue(gas));
    for(const [cellGas,gas] of [['o2','o2'],['lel','lel'],['co','co'],['toxic',tg]]){
      const cell=document.querySelector(`.gas-cell[data-gas="${cellGas}"]`), em=cell.querySelector('em'), a=alarmFor(gas,state.readings[gas]); cell.classList.toggle('warn',a.level==='low'); cell.classList.toggle('danger',a.level==='high'); em.textContent=a.label ? `${a.label} · ACTUAL` : '';
    }
    const footers={peak:'Máximos de gases · mínimo de O₂',stel:'Media 15 min · solo canales tóxicos',twa:'Acumulado / 8 h · solo tóxicos'};
    $('lcdFooter').textContent=footers[state.page]||`${scenarios[state.scenario].label} · zona ${positionLabel()}`;
  }

  function renderExposure(){
    const tg=analysisGas(), st=rollingAverage(tg,15), tw=twa8(tg);
    $('exposureGas').options[0].textContent=defs[toxicGas()].label+' · canal instalado';
    $('exposureExplanation').textContent=state.simMinutes<15?'STEL parcial: aún no se completan 15 minutos simulados. TWA: exposición acumulada dividida entre 8 h.':'STEL: últimos 15 min simulados. TWA: exposición acumulada desde el inicio, dividida entre 8 h.';
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
      const row=input.closest('[data-edit-gas]'),g=row.dataset.editGas,k=input.dataset.k,v=Number(input.value); if(!input.value.trim()||!Number.isFinite(v)||v<0||v>defs[g].range[1]||((k==='stel'||k==='twa')&&v===0)){input.value=state.alarms[g][k];coach('Valor fuera de rango',`Introduce un valor válido entre 0 y ${defs[g].range[1]} ${defs[g].unit}; STEL y TWA deben ser mayores que cero.`);return;}
      if(k==='high'&&v<=state.alarms[g].low){input.value=state.alarms[g].high; coach('Configuración no válida','HIGH debe ser mayor que LOW.');return;}
      if(k==='low'&&v>=state.alarms[g].high){input.value=state.alarms[g].low; coach('Configuración no válida','LOW debe ser menor que HIGH.');return;}
      state.alarms[g][k]=v; saveSettings();
    }));
  }

  function renderScenario(){
    $('probeMarker').style.top=state.position==='top'?'19%':state.position==='bottom'?'80%':'50%';
    $$('.position-buttons button').forEach(b=>{b.classList.toggle('active',b.dataset.position===state.position);b.setAttribute('aria-pressed',String(b.dataset.position===state.position));});
    $$('#profileSwitcher button').forEach(b=>{b.classList.toggle('active',b.dataset.profile===state.profile);b.setAttribute('aria-pressed',String(b.dataset.profile===state.profile));});
  }

  function renderQuality(){
    const q=$('qualityDot'); q.className='quality-dot'; let title='Medición en condiciones simuladas normales';
    if(state.fault==='blocked'){q.classList.add('bad');title='Entrada de sensor bloqueada: lectura potencialmente incorrecta';}
    else if(state.fault==='poisoned'){q.classList.add('bad');title='Sensor LEL afectado: posible sublectura';}
    else if(state.fault==='airflow'){q.classList.add('warn');title='Velocidad de aire alta: lectura potencialmente inestable';}
    else if(state.fasContaminated){q.classList.add('bad');title='FAS en aire contaminado: lecturas sesgadas';}
    else if(!state.bumpPassed){q.classList.add('warn');title='Prueba funcional pendiente';} else q.classList.add('good'); q.title=title;$('qualityText').textContent=title;
  }

  function renderGlobal(){
    const level=overallAlarm(), pill=$('globalState'),device=$('device');
    pill.className='state-pill';device.classList.remove('alarm-low','alarm-high','bumping');
    if(!state.power){pill.classList.add('state-off');pill.textContent='EQUIPO APAGADO';}
    else if(state.bumping){beep('high');pill.classList.add('safe');pill.textContent='BUMP TEST';device.classList.add('bumping');}
    else if(!state.ready){pill.classList.add('state-off');pill.textContent=state.booting?'AUTOPRUEBA':'FAS PENDIENTE';}
    else if(level==='high'){pill.classList.add('high');pill.textContent='ALARMA HIGH';device.classList.add('alarm-high');state.alarmLatch=true;beep('high');}
    else if(level==='low'){pill.classList.add('low');pill.textContent='ALARMA LOW';device.classList.add('alarm-low');beep('low');}
    else {pill.classList.add('safe');pill.textContent='MONITOREANDO';}
    $('soundIcon').textContent=state.muted?'×':'♪'; $('muteLabel').textContent=state.muted?'Silenciado':'Activo'; $('muteBtn').classList.toggle('active',state.muted); $('muteBtn').setAttribute('aria-pressed',String(state.muted));
    $('powerBtn').setAttribute('aria-label',state.power?'Apagar detector':'Encender detector');
    $('fasBtn').disabled=!state.power||state.booting||state.bumping;
    $('bumpBtn').disabled=!state.ready||state.bumping;
    $('upBtn').disabled=$('downBtn').disabled=!state.ready||state.bumping;
    $('saveSnapshotBtn').disabled=!state.ready||state.bumping;
    $('skipFasBtn').hidden=!state.power||state.booting||state.ready;
    $('scenarioSelect').disabled=$('faultSelect').disabled=state.bumping;
    $$('#profileSwitcher button').forEach(b=>b.disabled=state.bumping);
    renderOperation(level);
  }

  function renderOperation(level){
    let message='Toca POWER para comenzar.', tone='';
    if(state.booting) message='Autoprueba en curso: espera la comprobación de sensores.';
    else if(state.bumping) message='BUMP en curso: respuesta a gas de prueba y señales de alarma simuladas.';
    else if(state.power&&!state.ready) message='¿Estás en aire limpio? Realiza FAS o usa la opción para omitirlo.';
    else if(state.ready){
      if(level!=='none'){message='Alarma activa. Reconocerla o silenciarla no elimina el peligro.';tone='danger';}
      else if(state.fasContaminated){message='FAS contaminado: las lecturas tienen sesgo. Repite en aire limpio.';tone='danger';}
      else if(!state.bumpPassed){message='Prueba funcional pendiente o fallida. Realiza BUMP y comprueba el resultado.';tone='warning';}
      else if(state.fault!=='none'){message='Falla didáctica activa: interpreta las lecturas con precaución.';tone='warning';}
      else if(state.sampleSeconds<sampleWait()) message=`Sensor respondiendo · espera ${Math.ceil(sampleWait()-state.sampleSeconds)} s didácticos en esta zona.`;
      else message='Tiempo didáctico de respuesta cumplido. Compara los canales; sin alarma no significa autorización de ingreso.';
    }
    const box=$('operationFeedback');
    if(box.textContent!==message) box.textContent=message;
    box.className=`operation-feedback ${tone}`;
  }

  function renderMission(){
    let title='Enciende el equipo',text='Toca POWER para iniciar la autoprueba del detector.';
    if(state.power&&state.booting){title='Observa la autoprueba';text='El detector verifica pantalla, luces, alarma y sensores antes de medir.';}
    else if(state.power&&!state.ready){title='Decide sobre FAS';text='Haz el ajuste solo si tienes certeza de estar en aire fresco.';}
    else if(state.ready&&!state.bumpPassed){title='Realiza la prueba funcional';text='Comprueba que los sensores respondan y que las alarmas sean perceptibles.';}
    else if(state.ready&&state.bumpPassed){title='Monitorea la atmósfera';text=state.scenario==='tank'?'Compara los tres niveles del espacio: superior, medio e inferior.':scenarios[state.scenario].note;}
    setText('missionTitle',title);setText('missionText',text);
  }

  function render(){ renderLCD();renderExposure();renderGlobal();renderQuality();renderMission(); }

  function coach(title,text){$('coachTitle').textContent=title;$('coachText').textContent=text;}
  function addLog(title,body){
    const logs=loadLog(); logs.unshift({time:new Date().toISOString(),title,body}); if(logs.length>40)logs.length=40;memoryLog=logs;
    try{localStorage.setItem(STORAGE_KEY,JSON.stringify(logs));}catch{}
    renderLog();
  }
  function loadLog(){try{const logs=JSON.parse(localStorage.getItem(STORAGE_KEY)||'null');return Array.isArray(logs)?logs.filter(x=>x&&typeof x.title==='string'&&typeof x.body==='string'):memoryLog;}catch{return memoryLog;}}
  function renderLog(){
    const logs=loadLog(),el=$('eventLog');el.replaceChildren();
    if(!logs.length){const empty=document.createElement('p');empty.className='empty-log';empty.textContent='Aún no hay registros.';el.append(empty);return;}
    logs.forEach(x=>{const row=document.createElement('div'),title=document.createElement('b'),body=document.createElement('span');row.className='log-entry';title.textContent=x.title;body.textContent=`${new Date(x.time).toLocaleString('es')} · ${x.body}`;row.append(title,body);el.append(row);});
  }
  function saveSettings(){try{localStorage.setItem(SETTINGS_KEY,JSON.stringify({alarms:state.alarms,profile:state.profile}))}catch{}}
  function loadSettings(){
    try{
      const saved=JSON.parse(localStorage.getItem(SETTINGS_KEY)||'null');
      if(['standard','ph3'].includes(saved?.profile))state.profile=saved.profile;
      for(const gas of Object.keys(state.alarms)){
        const candidate=saved?.alarms?.[gas];if(!candidate)continue;
        const merged={...state.alarms[gas],...candidate};
        if(Object.keys(state.alarms[gas]).every(key=>Number.isFinite(merged[key])&&merged[key]>=0&&merged[key]<=defs[gas].range[1]&&(!['stel','twa'].includes(key)||merged[key]>0))&&merged.low<merged.high)state.alarms[gas]=merged;
      }
    }catch{}
  }


  async function powerOn(){
    if(state.power||state.booting)return;state.power=true;state.booting=true;$('lcd').classList.remove('lcd-off');state.ready=false;state.fasDone=false;state.bumpPassed=false;state.alarmLatch=false;state.bootToken++;const token=state.bootToken;render();
    const steps=[['TEST','8888','Pantalla · LEDs · vibración'],['SENS','O₂ LEL CO TOX','Reconociendo sensores'],['ALARM','LOW / HIGH','Verificando setpoints'],['CAL','CHECK','Estado de calibración'],['FAS?','AIR','Confirma aire fresco']];
    for(const [st,msg,foot] of steps){if(token!==state.bootToken)return;setLcdMessage(st,msg,foot);if(st==='TEST')beep('high');await new Promise(r=>setTimeout(r,650));}
    if(token!==state.bootToken)return;state.booting=false;render();emit('power');coach('Fresh Air Setup','Haz FAS solamente en una atmósfera que sepas que está limpia. También puedes omitirlo y continuar.');
  }
  function powerOff(){state.bootToken++;emit('power-off');state.power=false;state.booting=false;state.ready=false;state.bumping=false;state.alarmLatch=false;render();coach('Equipo apagado','Toca POWER para iniciar una nueva práctica.');}
  function doFAS(){
    if(!state.power||state.booting||state.bumping){coach('FAS no disponible','Primero enciende y espera la autoprueba.');return;}
    const actual=scenarios[state.scenario].values[state.position]; state.baselines={...actual};state.fasDone=true;state.ready=true;state.readings={o2:20.8,lel:0,co:0,h2s:0,ph3:0};
    const contaminated=state.scenario!=='clean'||Object.entries(actual).some(([g,v])=>g!=='o2'&&v>.001)||Math.abs(actual.o2-20.8)>.2;
    state.fasContaminated=contaminated;state.sampleSeconds=0;state.bumpPassed=false;emit('fas',{clean:!contaminated});
    if(contaminated){coach('FAS realizado en atmósfera no limpia','Acabas de introducir un sesgo: el detector puede subestimar contaminantes. Reinicia y repite FAS en aire limpio para corregirlo.');addLog('FAS cuestionable',`${scenarios[state.scenario].label} · ${state.position}`);}else{coach('FAS completado','El cero quedó referenciado a aire limpio. Ahora realiza una prueba funcional.');addLog('FAS completado','Aire limpio');}
    render();
  }
  async function doBump(){
    if(!state.power||!state.ready||state.bumping){coach('BUMP no disponible','Completa encendido y FAS antes de la prueba funcional.');return;}
    state.bumping=true;state.bumpPassed=false;state.sampleSeconds=0;const token=++state.bootToken;render();await new Promise(r=>setTimeout(r,3400));
    if(token!==state.bootToken||!state.power)return;
    const fail=state.fault==='blocked'||state.fault==='poisoned';state.bumping=false;state.bumpPassed=!fail;state.readings={...state.baselines};emit('bump',{passed:!fail});
    if(fail){coach('BUMP: ERROR',state.fault==='blocked'?'La respuesta fue insuficiente. Revisa obstrucción y no uses el equipo hasta corregir/verificar.':'El canal LEL no respondió correctamente. Requiere revisión/calibración antes del uso.');addLog('BUMP ERROR',state.fault);}else{coach('BUMP: PASS','Todos los canales respondieron y las alarmas fueron activadas en la simulación.');addLog('BUMP PASS',state.profile==='ph3'?'O₂/LEL/CO/PH₃':'O₂/LEL/CO/H₂S');}
    render();
  }
  function resetExposure(){
    state.simMinutes=0;state.history=[];state.exposureArea={co:0,h2s:0,ph3:0};state.peaks={co:0,h2s:0,ph3:0,lel:0};state.o2Min=state.readings.o2;state.sampleSeconds=0;state.alarmLatch=false;state.page='live';
  }
  function resetAlarm(){state.alarmLatch=false;coach('Alarma reconocida','RESET reconoce la alarma enclavada, pero no elimina el peligro. Si la concentración sigue alta, volverá a activarse.');render();}
  function resetRun(){
    state.bootToken++;state.booting=false;state.bumping=false;state.sampleSeconds=0;state.exposureStarted=false;state.fasContaminated=false;state.exposureArea={co:0,h2s:0,ph3:0};state.page='live';state.scenario='clean';state.position='middle';state.fault='none';$('scenarioSelect').value='clean';$('faultSelect').value='none';renderScenario();emit('reset');
    state.simMinutes=0;state.history=[];state.peaks={co:0,h2s:0,ph3:0,lel:0};state.o2Min=20.8;state.baselines={o2:20.8,lel:0,co:0,h2s:0,ph3:0};state.readings={o2:20.8,lel:0,co:0,h2s:0,ph3:0};state.fasDone=false;state.bumpPassed=false;state.ready=false;state.alarmLatch=false;
    if(state.power&&!state.booting){emit('power');coach('Nueva práctica','Repite FAS en aire limpio antes de continuar.');}render();
  }
  function restoreAlarms(){state.alarms={o2:{low:19.5,high:23},lel:{low:10,high:20},co:{low:25,high:100,stel:100,twa:25},h2s:{low:10,high:15,stel:15,twa:10},ph3:{low:.10,high:.20,stel:.20,twa:.10}};saveSettings();renderAlarmEditor();coach('Setpoints restaurados','Son valores iniciales de práctica y pueden modificarse. No equivalen automáticamente a límites ocupacionales.');}

  function tick(){
    const now=performance.now(),dt=Math.min(1.5,(now-state.lastTs)/1000);state.lastTs=now;
    if(document.body.classList.contains('auth-locked')||document.hidden)return;
    if(state.power&&!state.booting){for(const g of Object.keys(defs))sensorStep(g,dt);exposureUpdate(dt);}render();
  }

  function bind(){
    $('powerBtn').addEventListener('click',()=>{state.power?powerOff():powerOn();});
    $('skipFasBtn').addEventListener('click',()=>{if(!state.power||state.booting||state.ready)return;state.ready=true;state.sampleSeconds=0;coach('FAS omitido','Continúas sin ajuste de cero. La guía requiere practicar FAS en aire limpio.');render();});
    $('exposureGas').addEventListener('change',renderExposure);
    const pages=['live','peak','stel','twa'];
    $('upBtn').addEventListener('click',()=>{if(!state.ready)return;let i=pages.indexOf(state.page);state.page=pages[(i-1+pages.length)%pages.length];renderLCD();emit('page',{page:state.page});});
    $('downBtn').addEventListener('click',()=>{if(!state.ready)return;let i=pages.indexOf(state.page);state.page=pages[(i+1)%pages.length];renderLCD();emit('page',{page:state.page});});
    $('fasBtn').addEventListener('click',doFAS);$('bumpBtn').addEventListener('click',doBump);$('resetAlarmBtn').addEventListener('click',resetAlarm);$('newRunBtn').addEventListener('click',resetRun);
    $('muteBtn').addEventListener('click',()=>{state.muted=!state.muted;renderGlobal();});
    $('scenarioSelect').addEventListener('change',e=>{state.scenario=e.target.value;state.sampleSeconds=0;if(state.scenario==='ph3'&&state.profile!=='ph3'){state.profile='ph3';resetExposure();state.bumpPassed=false;emit('profile',{profile:'ph3'});renderAlarmEditor();renderReference();}emit('scenario',{scenario:state.scenario});renderScenario();coach('Escenario cambiado',scenarios[state.scenario].note);});
    $$('.position-buttons button').forEach(b=>b.addEventListener('click',()=>{state.position=b.dataset.position;state.sampleSeconds=0;renderScenario();coach('Punto de medición',`Ahora estás midiendo en el nivel ${b.textContent.toLowerCase()}. Espera la respuesta del sensor antes de interpretar.`);}));
    $$('#profileSwitcher button').forEach(b=>b.addEventListener('click',()=>{if(state.profile===b.dataset.profile)return;state.profile=b.dataset.profile;resetExposure();state.bumpPassed=false;state.sampleSeconds=0;emit('profile',{profile:state.profile});renderScenario();renderAlarmEditor();renderReference();saveSettings();coach('Configuración de sensores',state.profile==='ph3'?'Canal PH₃ instalado. Se reinició la exposición. Repite BUMP.':'Canal H₂S instalado. Se reinició la exposición. Repite BUMP.');}));
    $('faultSelect').addEventListener('change',e=>{state.fault=e.target.value;state.bumpPassed=false;state.sampleSeconds=0;renderQuality();const msgs={none:'Condición normal restablecida.',blocked:'Una entrada parcialmente bloqueada ralentiza y reduce la respuesta.',poisoned:'El canal LEL puede subleer pese a una atmósfera combustible.',airflow:'Velocidades de aire altas pueden alterar la lectura.'};coach('Condición didáctica',msgs[state.fault]);});
    const tabs=$$('.tabs button');
    tabs.forEach((btn,index)=>{
      btn.id=`tab-${btn.dataset.tab}`;btn.setAttribute('role','tab');btn.setAttribute('aria-controls',`panel-${btn.dataset.tab}`);
      const select=()=>{tabs.forEach(x=>{const active=x===btn;x.classList.toggle('active',active);x.setAttribute('aria-selected',String(active));x.tabIndex=active?0:-1;});$$('.tab-panel').forEach(p=>{p.classList.toggle('active',p.dataset.panel===btn.dataset.tab);});};
      btn.addEventListener('click',select);
      btn.addEventListener('keydown',event=>{let i=index;if(event.key==='ArrowRight')i=(index+1)%tabs.length;else if(event.key==='ArrowLeft')i=(index+tabs.length-1)%tabs.length;else if(event.key==='Home')i=0;else if(event.key==='End')i=tabs.length-1;else return;event.preventDefault();tabs[i].click();tabs[i].focus();});
    });
    $$('.tab-panel').forEach(p=>{p.id=`panel-${p.dataset.panel}`;p.setAttribute('role','tabpanel');p.setAttribute('aria-labelledby',`tab-${p.dataset.panel}`);});tabs[0].click();
    $('restoreAlarmsBtn').addEventListener('click',restoreAlarms);$('latchHigh').addEventListener('change',()=>renderGlobal());
    $('saveSnapshotBtn').addEventListener('click',()=>{if(!state.ready||state.bumping)return;const tg=toxicGas();addLog('Lectura guardada',`${scenarios[state.scenario].label} · zona ${positionLabel()} · ${state.simMinutes.toFixed(1)} min simulados · BUMP ${state.bumpPassed?'PASS':'pendiente/fallido'} · falla ${state.fault} · O₂ ${fmt('o2',state.readings.o2)} % · LEL ${fmt('lel',state.readings.lel)} % · CO ${fmt('co',state.readings.co)} ppm · ${defs[tg].label} ${fmt(tg,state.readings[tg])} ppm`);coach('Lectura guardada','Se añadió una instantánea con escenario, altura, tiempo y estado de verificación.');emit('saved');});
    $('clearLogBtn').addEventListener('click',()=>{memoryLog=[];try{localStorage.removeItem(STORAGE_KEY);}catch{}renderLog();});
    $('drawerToggle').addEventListener('click',()=>{const content=$('drawerContent'),open=content.hidden;content.hidden=!open;$('drawerToggle').setAttribute('aria-expanded',String(open));$('drawerToggle').querySelector('b').textContent=open?'−':'+';});
  }

  function init(){loadSettings();$('scenarioSelect').value=state.scenario;$('faultSelect').value=state.fault;renderScenario();renderReference();renderAlarmEditor();renderLog();bind();render();const start=()=>{state.lastTs=performance.now();if(!intervalId)intervalId=setInterval(tick,TICK_MS);};window.addEventListener('movida:simulator-open',start);if(!document.body.classList.contains('auth-locked'))start();}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
