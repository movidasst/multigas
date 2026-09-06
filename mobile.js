(() => {
  'use strict';

  /*
   * Hotfix mobile-first:
   * - elimina observadores que podían entrar en un ciclo de mutaciones y congelar la pantalla;
   * - deja el login ligero e interactivo;
   * - convierte POWER en una acción simple de un toque sin modificar la lógica técnica del simulador.
   */

  const $ = (id) => document.getElementById(id);
  let initialized = false;
  let toggling = false;

  const style = document.createElement('style');
  style.id = 'multigas-login-interaction-fix';
  style.textContent = `
    #loginGate{position:relative;z-index:1000;pointer-events:auto!important}
    #loginGate .login-atmosphere{pointer-events:none!important;z-index:0!important}
    #loginGate .login-shell{position:relative;z-index:2;pointer-events:auto!important}
    #loginGate .login-card-wrap,
    #loginGate .login-card,
    #loginGate #memberLogin,
    #loginGate .password-field{position:relative;z-index:3;pointer-events:auto!important}
    #loginGate input,
    #loginGate button,
    #loginGate label,
    #loginGate a{pointer-events:auto!important}
    #loginGate input{
      position:relative;
      z-index:5;
      touch-action:auto!important;
      -webkit-user-select:text!important;
      user-select:text!important;
      -webkit-touch-callout:default!important;
    }
  `;
  document.head.appendChild(style);

  /* Evita que el simulador esté renderizando cada 500 ms detrás del login. */
  const nativeSetInterval = window.setInterval.bind(window);
  const nativeClearInterval = window.clearInterval.bind(window);
  const deferredIntervals = [];
  let timersReleased = false;

  function authVisible() {
    const gate = $('loginGate');
    return document.body.classList.contains('auth-locked') || (!!gate && !gate.hidden);
  }

  window.setInterval = function (callback, delay, ...args) {
    if (!timersReleased && authVisible()) {
      const token = { __multigasDeferredInterval: true, cancelled: false, realId: null };
      deferredIntervals.push({ token, callback, delay, args });
      return token;
    }
    return nativeSetInterval(callback, delay, ...args);
  };

  window.clearInterval = function (id) {
    if (id && id.__multigasDeferredInterval) {
      id.cancelled = true;
      if (id.realId != null) nativeClearInterval(id.realId);
      return;
    }
    nativeClearInterval(id);
  };

  function releaseTimers() {
    if (timersReleased) return;
    timersReleased = true;
    window.setInterval = nativeSetInterval;
    window.clearInterval = nativeClearInterval;
    for (const item of deferredIntervals) {
      if (!item.token.cancelled) {
        item.token.realId = nativeSetInterval(item.callback, item.delay, ...item.args);
      }
    }
    deferredIntervals.length = 0;
  }

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

  function triggerPowerNow() {
    const button = $('powerBtn');
    if (!button || toggling) return;

    const stateText = ($('globalState')?.textContent || '').toUpperCase();
    if (stateText.includes('AUTOPRUEBA')) return;

    toggling = true;
    button.classList.add('power-starting');

    /* app.js conserva internamente 520 ms. Solo para POWER lo ejecutamos de inmediato. */
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
      }, 100);
    }
  }

  function bindPower() {
    const button = $('powerBtn');
    if (!button || button.dataset.simplePower === '1') return;
    button.dataset.simplePower = '1';
    button.addEventListener('contextmenu', (event) => event.preventDefault());
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

  function setSimpleCopy() {
    const missionText = $('missionText');
    const lcdFooter = $('lcdFooter');
    if (missionText && (($('globalState')?.textContent || '').includes('APAGADO'))) {
      missionText.textContent = 'Toca POWER para iniciar la autoprueba del detector.';
    }
    if (lcdFooter && (($('globalState')?.textContent || '').includes('APAGADO'))) {
      lcdFooter.textContent = 'Toca ● para encender';
    }
  }

  function init() {
    if (initialized) return;
    initialized = true;
    bindPower();
    setSimpleCopy();

    window.addEventListener('movida:simulator-open', () => {
      releaseTimers();
      window.setTimeout(() => {
        bindPower();
        setSimpleCopy();
      }, 0);
    });

    const app = $('appShell');
    if (app && !app.hidden && !document.body.classList.contains('auth-locked')) {
      releaseTimers();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
