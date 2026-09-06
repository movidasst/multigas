(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  let initialized = false;
  let toggling = false;

  function dispatchPointer(target, type) {
    try {
      target.dispatchEvent(new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerType: 'touch',
        isPrimary: true
      }));
    } catch {
      target.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }));
    }
  }

  function isBooting() {
    return ($('globalState')?.textContent || '').toUpperCase().includes('AUTOPRUEBA');
  }

  function isOff() {
    return ($('globalState')?.textContent || '').toUpperCase().includes('APAGADO');
  }

  function triggerPowerNow() {
    const button = $('powerBtn');
    if (!button || toggling || isBooting()) return;

    toggling = true;
    button.classList.add('power-starting');

    // app.js todavía conserva la lógica interna de pulsación prolongada.
    // Para la interfaz pública la convertimos en una acción inmediata de un toque:
    // interceptamos exclusivamente su temporizador de 520 ms y lo ejecutamos al instante.
    const realSetTimeout = window.setTimeout;
    try {
      window.setTimeout = function (fn, delay, ...args) {
        if (Number(delay) === 520) {
          fn(...args);
          return 0;
        }
        return realSetTimeout(fn, delay, ...args);
      };
      dispatchPointer(button, 'pointerdown');
      dispatchPointer(button, 'pointerup');
    } finally {
      window.setTimeout = realSetTimeout;
      realSetTimeout(() => {
        button.classList.remove('power-starting');
        toggling = false;
        fixPowerCopy();
      }, 90);
    }
  }

  function bindPower() {
    const button = $('powerBtn');
    if (!button || button.dataset.simplePower === '1') return;
    button.dataset.simplePower = '1';
    button.addEventListener('contextmenu', (event) => event.preventDefault());

    // Captura el click antes del listener antiguo de app.js.
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      triggerPowerNow();
    }, true);

    button.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      triggerPowerNow();
    }, true);
  }

  function fixPowerCopy() {
    const off = isOff();
    const missionTitle = $('missionTitle');
    const missionText = $('missionText');
    const lcdFooter = $('lcdFooter');
    const coachText = $('coachText');

    if (off) {
      if (missionTitle) missionTitle.textContent = 'Enciende el equipo';
      if (missionText) missionText.textContent = 'Toca POWER para iniciar la autoprueba del detector.';
      if (lcdFooter) lcdFooter.textContent = 'Toca ● para encender';
      if (coachText && /mant[eé]n|power/i.test(coachText.textContent || '')) {
        coachText.textContent = 'Toca POWER para iniciar una nueva práctica.';
      }
    }
  }

  function ensureHint() {
    const stage = document.querySelector('.instrument-stage');
    const quick = document.querySelector('.quick-actions');
    if (!stage || !quick) return;
    let hint = $('mobilePowerHint');
    if (!hint) {
      hint = document.createElement('div');
      hint.id = 'mobilePowerHint';
      hint.className = 'mobile-power-hint';
      hint.innerHTML = '<i aria-hidden="true"></i><span></span>';
      stage.insertBefore(hint, quick);
    }
    const span = hint.querySelector('span');
    const off = isOff();
    hint.classList.toggle('is-on', !off);
    if (span) span.textContent = off ? 'Toca POWER para encender' : 'Equipo encendido · continúa con FAS y BUMP';
  }

  function improveMobileOrder() {
    if (!window.matchMedia('(max-width: 900px)').matches) return;
    const stage = document.querySelector('.instrument-stage');
    if (!stage || stage.dataset.mobileScrolled === '1') return;
    stage.dataset.mobileScrolled = '1';
    window.setTimeout(() => {
      if (!document.body.classList.contains('auth-locked') && window.scrollY < 30) {
        stage.scrollIntoView({ block: 'start', behavior: 'auto' });
        window.scrollBy(0, -70);
      }
    }, 120);
  }

  function observe() {
    const nodes = [$('globalState'), $('lcdFooter'), $('missionText'), $('coachText')].filter(Boolean);
    if (!nodes.length) return;
    const observer = new MutationObserver(() => {
      fixPowerCopy();
      ensureHint();
    });
    nodes.forEach((node) => observer.observe(node, { childList: true, subtree: true, characterData: true }));
  }

  function init() {
    if (initialized) return;
    initialized = true;
    bindPower();
    fixPowerCopy();
    ensureHint();
    observe();
    improveMobileOrder();

    window.addEventListener('movida:simulator-open', () => {
      window.setTimeout(() => {
        bindPower();
        fixPowerCopy();
        ensureHint();
        improveMobileOrder();
      }, 40);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
