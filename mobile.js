(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  let syntheticPress = false;
  let initialized = false;

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

  function isPoweredOff() {
    const global = $('globalState')?.textContent?.toUpperCase() || '';
    const device = $('device');
    const lcd = $('lcd');
    return global.includes('APAGADO') || device?.classList.contains('state-offline') || lcd?.classList.contains('lcd-off');
  }

  function ensureHint() {
    const stage = document.querySelector('.instrument-stage');
    const quick = document.querySelector('.quick-actions');
    if (!stage || !quick) return null;
    let hint = $('mobilePowerHint');
    if (!hint) {
      hint = document.createElement('div');
      hint.id = 'mobilePowerHint';
      hint.className = 'mobile-power-hint';
      hint.innerHTML = '<i aria-hidden="true"></i><span>Toca POWER para encender el detector</span>';
      stage.insertBefore(hint, quick);
    }
    return hint;
  }

  function updateHint() {
    const hint = ensureHint();
    if (!hint) return;
    const off = isPoweredOff();
    hint.classList.toggle('is-on', !off);
    const text = hint.querySelector('span');
    if (text) text.textContent = off ? 'Toca POWER para encender el detector' : 'Equipo encendido · usa FAS y BUMP antes de medir';
  }

  function tapToPowerOn() {
    const button = $('powerBtn');
    if (!button || syntheticPress || !isPoweredOff()) return;

    syntheticPress = true;
    button.classList.add('power-starting');
    button.setAttribute('aria-busy', 'true');

    dispatchPointer(button, 'pointerdown');
    window.setTimeout(() => {
      dispatchPointer(button, 'pointerup');
      button.classList.remove('power-starting');
      button.removeAttribute('aria-busy');
      syntheticPress = false;
      updateHint();
    }, 620);
  }

  function bindPower() {
    const button = $('powerBtn');
    if (!button || button.dataset.mobileBound === '1') return;
    button.dataset.mobileBound = '1';

    button.addEventListener('contextmenu', (event) => event.preventDefault());
    button.addEventListener('click', () => {
      if (isPoweredOff()) tapToPowerOn();
    }, true);

    button.addEventListener('keydown', (event) => {
      if ((event.key === 'Enter' || event.key === ' ') && isPoweredOff()) {
        event.preventDefault();
        tapToPowerOn();
      }
    });
  }

  function improveMobileOrder() {
    if (!window.matchMedia('(max-width: 900px)').matches) return;
    const stage = document.querySelector('.instrument-stage');
    if (stage && !stage.dataset.mobileScrolled) {
      stage.dataset.mobileScrolled = '1';
      window.setTimeout(() => {
        if (!document.body.classList.contains('auth-locked') && window.scrollY < 30) {
          stage.scrollIntoView({ block: 'start', behavior: 'auto' });
          window.scrollBy(0, -70);
        }
      }, 120);
    }
  }

  function observeState() {
    const global = $('globalState');
    const lcd = $('lcd');
    if (!global && !lcd) return;
    const observer = new MutationObserver(updateHint);
    if (global) observer.observe(global, { childList: true, subtree: true, attributes: true });
    if (lcd) observer.observe(lcd, { attributes: true, attributeFilter: ['class'] });
  }

  function init() {
    if (initialized) return;
    initialized = true;
    bindPower();
    ensureHint();
    updateHint();
    observeState();
    improveMobileOrder();

    window.addEventListener('movida:simulator-open', () => {
      window.setTimeout(() => {
        bindPower();
        updateHint();
        improveMobileOrder();
      }, 60);
    });
    window.addEventListener('resize', updateHint, { passive: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(init, 0), { once: true });
  else setTimeout(init, 0);
})();
