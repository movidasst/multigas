// Business-behavior regression tests. Isolated DOM doubles; no authentication or network calls.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
function fixture(){
  const elements=new Map(),events=[],pending=[],stored=new Map();
  function element(id){
    if(elements.has(id))return elements.get(id);
    const classes=new Set();
    const el={textContent:'',innerHTML:'',hidden:false,value:'',disabled:false,checked:false,options:[{}],style:{},dataset:{},children:[],
      classList:{add(...x){x.forEach(v=>classes.add(v));},remove(...x){x.forEach(v=>classes.delete(v));},contains(x){return classes.has(x);},toggle(x,on){on??=!classes.has(x);on?classes.add(x):classes.delete(x);}},
      setAttribute(k,v){this[k]=v;},addEventListener(){},querySelector(sel){return element(id+sel);},replaceChildren(...x){this.children=x;},append(...x){this.children.push(...x);}};
    elements.set(id,el);return el;
  }
  const document={readyState:'loading',hidden:false,body:element('body'),getElementById:element,querySelector:element,querySelectorAll(){return[];},createElement(){return element('new'+elements.size);},addEventListener(){}};
  const ctx={document,console,performance:{now:()=>0},Date,Math,Number,JSON,Set,CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}},navigator:{},localStorage:{getItem:k=>stored.get(k)||null,setItem:(k,v)=>stored.set(k,v)},setTimeout:fn=>{pending.push(fn);return pending.length;},setInterval(){},clearTimeout(){}};
  ctx.window={dispatchEvent:e=>events.push(e),addEventListener(){}};
  let code=fs.readFileSync(require('node:path').join(__dirname,'../app.js'),'utf8');
  code=code.replace("  if(document.readyState==='loading')", "  window.testAPI={state,exposureUpdate,rollingAverage,twa8,powerOn,powerOff,doFAS,doBump,resetRun,alarmFor,renderLCD,loadSettings};\n  if(document.readyState==='loading')");
  vm.runInNewContext(code,ctx);
  return {...ctx.window.testAPI,element,events,pending,stored,flush:async()=>{while(pending.length){pending.shift()();await Promise.resolve();}}};
}
test('autoprueba se completa una vez y notifica al recorrido',async()=>{const f=fixture();const start=f.powerOn();await f.flush();await start;assert.equal(f.state.booting,false);assert.equal(f.state.power,true);assert.equal(f.state.ready,false);assert.equal(f.events.filter(e=>e.detail.action==='power').length,1);});
test('FAS contaminado queda identificado y no valida la prueba funcional',()=>{const f=fixture();f.state.power=true;f.state.scenario='tank';f.state.position='bottom';f.doFAS();assert.equal(f.state.fasContaminated,true);assert.equal(f.state.bumpPassed,false);assert.equal(f.events.at(-1).detail.clean,false);});
test('BUMP cancelado al apagar nunca termina en PASS',async()=>{const f=fixture();f.state.power=f.state.ready=true;const bump=f.doBump();f.powerOff();await f.flush();await bump;assert.equal(f.state.bumpPassed,false);assert.equal(f.state.bumping,false);assert.equal(f.events.some(e=>e.detail.action==='bump'),false);});
test('reinicio durante BUMP cancela el resultado anterior',async()=>{const f=fixture();f.state.power=f.state.ready=true;const bump=f.doBump();f.resetRun();await f.flush();await bump;assert.equal(f.state.bumpPassed,false);assert.equal(f.state.ready,false);assert.equal(f.state.scenario,'clean');assert.equal(f.state.history.length,0);});
test('BUMP falla con canal LEL afectado',async()=>{const f=fixture();f.state.power=f.state.ready=true;f.state.fault='poisoned';const bump=f.doBump();await f.flush();await bump;assert.equal(f.state.bumpPassed,false);assert.equal(f.element('coachTitle').textContent,'BUMP: ERROR');});
test('BUMP normal concluye PASS',async()=>{const f=fixture();f.state.power=f.state.ready=true;const bump=f.doBump();await f.flush();await bump;assert.equal(f.state.bumpPassed,true);assert.equal(f.events.at(-1).detail.passed,true);});
test('TWA integra también el primer intervalo: 60 ppm por 8 h = 60 ppm',()=>{const f=fixture();f.state.power=f.state.ready=true;f.state.readings.co=60;f.exposureUpdate(480*60);assert.equal(f.twa8('co'),60);assert.equal(f.rollingAverage('co',15),60);});
test('STEL recorta intervalos que atraviesan la ventana de 15 minutos',()=>{const f=fixture();f.state.power=f.state.ready=true;f.state.readings.co=20;f.exposureUpdate(10*60);f.state.readings.co=80;f.exposureUpdate(10*60);assert.equal(f.rollingAverage('co',15),60);assert.equal(f.twa8('co'),1000/480);});
test('STEL parcial mantiene divisor 15; TWA no cambia con poda del historial',()=>{const f=fixture();f.state.power=f.state.ready=true;f.state.readings.co=30;f.exposureUpdate(5*60);assert.equal(f.rollingAverage('co',15),10);f.exposureUpdate(500*60);assert.equal(f.twa8('co'),30*505/480);assert.equal(f.state.history.length,1);});
test('espera de sensor usa segundos reales, no reloj acelerado',()=>{const f=fixture();f.state.power=f.state.ready=f.state.bumpPassed=true;f.state.scenario='tank';f.element('acceleratedTime').checked=true;f.exposureUpdate(1);assert.equal(f.state.simMinutes,2);assert.equal(f.events.some(e=>e.detail.action==='sample'),false);f.exposureUpdate(14);assert.equal(f.events.at(-1).detail.action,'sample');});
test('pantallas PEAK y STEL muestran valores propios y guiones en canales no aplicables',()=>{const f=fixture();f.state.power=f.state.ready=true;f.state.readings.co=7;f.state.peaks.co=90;f.state.page='peak';f.renderLCD();assert.equal(f.element('valCO').textContent,'90');f.state.page='stel';f.renderLCD();assert.equal(f.element('valCO').textContent,'0');assert.equal(f.element('valO2').textContent,'--');});
test('alarmas persistidas inválidas se descartan',()=>{const f=fixture();f.stored.set('movida-sst-multigas-settings-v1',JSON.stringify({profile:'unknown',alarms:{co:{low:-5,high:2,twa:0,stel:3}}}));f.loadSettings();assert.equal(f.state.profile,'standard');assert.equal(f.state.alarms.co.low,25);});
test('un sensor no instalado no acumula exposición',()=>{const f=fixture();f.state.power=f.state.ready=true;f.state.readings.ph3=10;f.exposureUpdate(60);assert.equal(f.twa8('ph3'),0);assert.equal(f.rollingAverage('ph3',15),0);assert.equal(f.state.peaks.ph3,0);});
