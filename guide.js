(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const TUTORIAL_SEEN_KEY = 'movida-sst-multigas-tutorial-v2';

  const steps = [
    { key:'power', title:'Enciende el detector', text:'Toca POWER una vez. Observa la autoprueba de pantalla, alarmas y sensores antes de usar el equipo.', coach:'Toca POWER y espera que termine la autoprueba.', target:'#powerBtn' },
    { key:'fas', title:'Haz FAS en aire limpio', text:'Con el escenario Aire limpio, pulsa FAS. El ajuste en aire fresco sirve para establecer el cero; no sustituye el Bump Test ni la calibración.', coach:'Pulsa FAS solamente en una atmósfera que sepas que está limpia.', target:'#fasBtn' },
    { key:'bump', title:'Comprueba la respuesta con BUMP', text:'Pulsa BUMP. La prueba funcional confirma que los sensores responden y que las alarmas se activan. Un fallo obliga a revisar el equipo antes de usarlo.', coach:'Pulsa BUMP y espera el resultado PASS.', target:'#bumpBtn' },
    { key:'tank', title:'Entra al escenario de tanque', text:'Selecciona Tanque con estratificación. En un espacio confinado una sola lectura puede ocultar una atmósfera peligrosa en otra altura.', coach:'En Ambiente elige Tanque con estratificación.', target:'#scenarioSelect' },
    { key:'top', title:'Mide la zona superior', text:'Toca Superior y espera unos segundos para dejar responder al sensor antes de interpretar.', coach:'Toca Superior y mantén la sonda allí unos segundos.', target:'.position-buttons [data-position="top"]' },
    { key:'middle', title:'Mide la zona media', text:'Toca Media. Compara O₂, %LEL, CO y el canal tóxico con la lectura superior.', coach:'Toca Media y espera la estabilización.', target:'.position-buttons [data-position="middle"]' },
    { key:'bottom', title:'Mide la zona inferior', text:'Toca Inferior. Compara los tres niveles: una atmósfera estratificada puede cambiar de forma importante con la altura.', coach:'Toca Inferior y espera la estabilización.', target:'.position-buttons [data-position="bottom"]' },
    { key:'pages', title:'Recorre PEAK, STEL y TWA', text:'Usa ▲ y ▼ para cambiar de pantalla. PEAK muestra máximos; STEL/EC resume 15 min y TWA/ED representa la exposición media de 8 h.', coach:'Usa ▲/▼ hasta visitar PEAK, STEL y TWA.', target:'#downBtn' },
    { key:'ph3', title:'Activa el canal PH₃', text:'Selecciona PH₃. El cuarto canal cambia de H₂S a fosfina y conserva alarmas configurables separadas del límite higiénico.', coach:'En Configuración de sensores toca PH₃.', target:'#profileSwitcher [data-profile="ph3"]' },
    { key:'fumigation', title:'Practica una fumigación', text:'Selecciona Fumigación de granos · PH₃ y observa cómo una misma concentración puede compararse con setpoints del detector y con la referencia ocupacional.', coach:'En Ambiente selecciona Fumigación de granos · PH₃.', target:'#scenarioSelect' },
    { key:'saved', title:'Guarda una lectura', text:'Abre Registro y pulsa Guardar lectura. Documentar la lectura, el escenario y la configuración forma parte del aprendizaje.', coach:'Abre Registro y pulsa Guardar lectura.', target:'#saveSnapshotBtn', prepare: () => activateTab('log') }
  ];

  const controls = [
    { target:'#powerBtn', title:'POWER', text:'Enciende o apaga el detector con un toque. Al encender ejecuta una autoprueba antes de quedar listo.' },
    { target:'#upBtn', title:'▲ Pantalla anterior', text:'Cuando el equipo está listo, recorre hacia atrás las pantallas LIVE, PEAK, STEL y TWA.' },
    { target:'#downBtn', title:'▼ Pantalla siguiente', text:'Recorre hacia adelante LIVE, PEAK, STEL y TWA. Sirve para consultar indicadores sin cambiar la medición.' },
    { target:'#fasBtn', title:'FAS · Fresh Air Setup', text:'Ajusta el cero en aire fresco conocido. No es una prueba funcional y no debe hacerse en una atmósfera dudosa o contaminada.' },
    { target:'#bumpBtn', title:'BUMP · Prueba funcional', text:'Expone los canales a una respuesta simulada de gas para comprobar sensores y alarmas. PASS no significa que el equipo esté calibrado para siempre.' },
    { target:'#resetAlarmBtn', title:'RESET · Reconocer alarma', text:'Reconoce una alarma enclavada. No elimina el peligro: si la concentración sigue fuera del setpoint, la alarma reaparece.' },
    { target:'#muteBtn', title:'SONIDO', text:'Activa o silencia el sonido del simulador. En trabajo real, no debe usarse el silenciamiento para ignorar una condición peligrosa.' }
  ];

  const milestones = Object.fromEntries(steps.map(step => [step.key, false]));
  const pagesSeen = new Set();
  let guided = true;
  let lastIndex = -1;
  let positionTimer = null;
  let controlIndex = 0;
  let tutorialIndex = 0;
  let simulatorOpenHandled = false;

  function currentIndex() { return steps.findIndex(step => !milestones[step.key]); }
  function completedCount() { return steps.filter(step => milestones[step.key]).length; }

  function setMilestone(key, value = true) {
    if (!(key in milestones) || milestones[key] === value) return;
    milestones[key] = value;
    sync();
  }

  function sync() {
    const card = $('guideCard');
    const coach = $('guideCoach');
    if (!card || !coach) return;

    const index = currentIndex();
    const completed = completedCount();
    const percent = Math.round((completed / steps.length) * 100);

    card.hidden = !guided;
    coach.hidden = !guided || index < 0 || !$('controlCoach')?.hidden;
    $('guidePercent').textContent = `${percent}%`;
    $('guideProgress').style.width = `${percent}%`;
    $('guideProgressBar').setAttribute('aria-valuenow', String(percent));

    $$('[data-guide-key]').forEach(item => {
      const key = item.dataset.guideKey;
      const done = !!milestones[key];
      const idx = steps.findIndex(step => step.key === key);
      const active = index === idx;
      item.classList.toggle('done', done);
      item.classList.toggle('current', active);
      const bubble = item.querySelector('i');
      if (bubble) bubble.textContent = done ? '✓' : String(idx + 1);
    });

    if (index < 0) {
      $('guideStep').textContent = 'Recorrido completado';
      $('guideTitle').textContent = 'Ahora explora libremente';
      $('guideText').textContent = 'Cambia escenarios, setpoints y fallas didácticas. Compara siempre lectura del sensor, alarma configurada y criterio ocupacional.';
      $('locateStepBtn').hidden = true;
      coach.hidden = true;
      card.classList.add('complete');
    } else {
      const step = steps[index];
      $('guideStep').textContent = `Paso ${index + 1} de ${steps.length}`;
      $('guideTitle').textContent = step.title;
      $('guideText').textContent = step.text;
      $('locateStepBtn').hidden = false;
      card.classList.remove('complete');
      $('guideCoachStep').textContent = `SIGUIENTE · PASO ${index + 1} DE ${steps.length}`;
      $('guideCoachTitle').textContent = step.title;
      $('guideCoachText').textContent = step.coach;
    }

    $('guidedToggle')?.classList.toggle('active', guided);
    $('guidedToggle')?.setAttribute('aria-pressed', String(guided));

    if (index !== lastIndex && lastIndex >= 0 && index >= 0) {
      coach.classList.remove('advance');
      requestAnimationFrame(() => coach.classList.add('advance'));
      setTimeout(() => coach.classList.remove('advance'), 850);
    }
    lastIndex = index;
  }

  function activateTab(name) {
    const button = document.querySelector(`.tabs button[data-tab="${name}"]`);
    if (button) button.click();
  }

  function locateCurrentStep() {
    const index = currentIndex();
    if (index < 0) return;
    const step = steps[index];
    step.prepare?.();
    window.setTimeout(() => {
      const target = document.querySelector(step.target);
      if (!target) return;
      target.scrollIntoView({ behavior:'smooth', block:'center' });
      target.classList.remove('coach-target');
      requestAnimationFrame(() => target.classList.add('coach-target'));
      window.setTimeout(() => target.classList.remove('coach-target'), 3000);
      try { target.focus({ preventScroll:true }); } catch {}
    }, 80);
  }

  function resetGuide() {
    Object.keys(milestones).forEach(key => milestones[key] = false);
    pagesSeen.clear();
    lastIndex = -1;
    clearTimeout(positionTimer);
    sync();
    locateCurrentStep();
  }

  function validPowerState() {
    const state = ($('globalState')?.textContent || '').toUpperCase();
    return state && !state.includes('APAGADO') && !state.includes('AUTOPRUEBA');
  }

  function handleGuidedInteractions(event) {
    const target = event.target.closest?.('button,select,input');
    if (!target) return;

    if (target.id === 'powerBtn') {
      setTimeout(() => { if (validPowerState()) setMilestone('power'); }, 3600);
      return;
    }

    if (target.id === 'fasBtn') {
      setTimeout(() => {
        const scenario = $('scenarioSelect')?.value;
        const state = ($('globalState')?.textContent || '').toUpperCase();
        if (scenario === 'clean' && !state.includes('FAS PENDIENTE') && !state.includes('APAGADO') && !state.includes('AUTOPRUEBA')) setMilestone('fas');
      }, 180);
      return;
    }

    if (target.id === 'bumpBtn') {
      setTimeout(() => {
        if (($('coachTitle')?.textContent || '').toUpperCase().includes('BUMP: PASS')) setMilestone('bump');
      }, 3650);
      return;
    }

    if (target.matches('.position-buttons button')) {
      const position = target.dataset.position;
      clearTimeout(positionTimer);
      positionTimer = setTimeout(() => {
        const scenario = $('scenarioSelect')?.value;
        const selected = document.querySelector('.position-buttons button.active')?.dataset.position;
        if (scenario === 'tank' && selected === position && ['top','middle','bottom'].includes(position)) setMilestone(position);
      }, 1800);
      return;
    }

    if (target.id === 'upBtn' || target.id === 'downBtn') {
      setTimeout(() => {
        const page = ($('lcdStatus')?.textContent || '').toUpperCase();
        if (['PEAK','STEL','TWA'].includes(page)) pagesSeen.add(page);
        if (['PEAK','STEL','TWA'].every(p => pagesSeen.has(p))) setMilestone('pages');
      }, 80);
      return;
    }

    if (target.matches('#profileSwitcher button[data-profile="ph3"]')) {
      setTimeout(() => {
        if (target.classList.contains('active')) setMilestone('ph3');
      }, 80);
      return;
    }

    if (target.id === 'saveSnapshotBtn') {
      setTimeout(() => setMilestone('saved'), 80);
    }
  }

  function handleChanges(event) {
    const target = event.target;
    if (target.id === 'scenarioSelect') {
      if (target.value === 'tank') setMilestone('tank');
      if (target.value === 'ph3') setMilestone('fumigation');
    }
  }

  function toggleGuided() {
    guided = !guided;
    document.body.classList.toggle('guided-mode', guided);
    sync();
  }

  function openControls() {
    controlIndex = 0;
    const box = $('controlCoach');
    if (!box) return;
    box.hidden = false;
    renderControlStep();
    sync();
  }

  function closeControls() {
    $('controlCoach').hidden = true;
    $$('.control-target').forEach(el => el.classList.remove('control-target'));
    sync();
  }

  function renderControlStep() {
    const step = controls[controlIndex];
    $$('.control-target').forEach(el => el.classList.remove('control-target'));
    $('controlStep').textContent = `BOTÓN ${controlIndex + 1} DE ${controls.length}`;
    $('controlTitle').textContent = step.title;
    $('controlText').textContent = step.text;
    $('controlPrev').disabled = controlIndex === 0;
    $('controlNext').textContent = controlIndex === controls.length - 1 ? 'Terminar' : 'Siguiente';
    const target = document.querySelector(step.target);
    if (target) {
      target.classList.add('control-target');
      target.scrollIntoView({ behavior:'smooth', block:'center' });
    }
  }

  function controlNext() {
    if (controlIndex >= controls.length - 1) { closeControls(); return; }
    controlIndex += 1;
    renderControlStep();
  }

  function controlPrev() {
    if (controlIndex <= 0) return;
    controlIndex -= 1;
    renderControlStep();
  }

  function renderTutorial() {
    $$('[data-tutorial-step]').forEach((page, index) => page.hidden = index !== tutorialIndex);
    $('tutorialCounter').textContent = `${tutorialIndex + 1} de 3`;
    $$('.tutorial-status i').forEach((dot, index) => dot.classList.toggle('active', index <= tutorialIndex));
    $('tutorialBackBtn').hidden = tutorialIndex === 0;
    $('tutorialNextBtn').hidden = tutorialIndex === 2;
    $('tutorialStartBtn').hidden = tutorialIndex !== 2;
  }

  function openTutorial() {
    const dialog = $('tutorialDialog');
    if (!dialog) return;
    tutorialIndex = 0;
    renderTutorial();
    if (!dialog.open) dialog.showModal();
  }

  function finishTutorial() {
    localStorage.setItem(TUTORIAL_SEEN_KEY, '1');
    $('tutorialDialog')?.close();
    guided = true;
    document.body.classList.add('guided-mode');
    sync();
    locateCurrentStep();
  }

  function filterManual() {
    const query = ($('manualSearch')?.value || '').trim().toLowerCase();
    let visible = 0;
    $$('.manual-topic').forEach(topic => {
      const show = !query || topic.textContent.toLowerCase().includes(query);
      topic.hidden = !show;
      if (show) visible += 1;
    });
    $('manualEmpty').hidden = visible > 0;
  }

  function openManual() {
    $('manualSearch').value = '';
    filterManual();
    const dialog = $('helpDialog');
    if (dialog && !dialog.open) dialog.showModal();
  }

  function onSimulatorOpen() {
    if (simulatorOpenHandled) return;
    simulatorOpenHandled = true;
    document.body.classList.toggle('guided-mode', guided);
    sync();
    setTimeout(() => {
      if (!localStorage.getItem(TUTORIAL_SEEN_KEY)) openTutorial();
    }, 320);
  }

  function bind() {
    document.addEventListener('click', handleGuidedInteractions, true);
    document.addEventListener('change', handleChanges, true);
    $('guidedToggle')?.addEventListener('click', toggleGuided);
    $('locateStepBtn')?.addEventListener('click', locateCurrentStep);
    $('guideCoachLocate')?.addEventListener('click', locateCurrentStep);
    $('resetGuideBtn')?.addEventListener('click', resetGuide);
    $('controlsBtn')?.addEventListener('click', openControls);
    $('controlClose')?.addEventListener('click', closeControls);
    $('controlPrev')?.addEventListener('click', controlPrev);
    $('controlNext')?.addEventListener('click', controlNext);
    $('helpBtn')?.addEventListener('click', openManual);
    $('manualSearch')?.addEventListener('input', filterManual);
    $('manualControlsBtn')?.addEventListener('click', () => { $('helpDialog')?.close(); openControls(); });
    $('manualTutorialBtn')?.addEventListener('click', () => { $('helpDialog')?.close(); openTutorial(); });
    $('tutorialBackBtn')?.addEventListener('click', event => { event.preventDefault(); tutorialIndex = Math.max(0, tutorialIndex - 1); renderTutorial(); });
    $('tutorialNextBtn')?.addEventListener('click', event => { event.preventDefault(); tutorialIndex = Math.min(2, tutorialIndex + 1); renderTutorial(); });
    $('tutorialStartBtn')?.addEventListener('click', event => { event.preventDefault(); finishTutorial(); });
    window.addEventListener('movida:simulator-open', () => { simulatorOpenHandled = false; onSimulatorOpen(); });
    $('newRunBtn')?.addEventListener('click', () => setTimeout(resetGuide, 30));
  }

  function init() {
    bind();
    sync();
    const app = $('appShell');
    if (app && !app.hidden && !document.body.classList.contains('auth-locked')) onSimulatorOpen();
  }

  window.MultigasGuide = { sync, locateCurrentStep, openTutorial, openManual, openControls, resetGuide };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once:true });
  else init();
})();
