(() => {
  'use strict';
  // Mobile navigation only. POWER and timer lifecycle belong to app.js.
  function init() {
    document.querySelectorAll('.practice-nav a').forEach(link => {
      link.addEventListener('click', () => {
        document.querySelectorAll('.practice-nav a').forEach(item => item.removeAttribute('aria-current'));
        link.setAttribute('aria-current', 'location');
      });
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, {once:true});
  else init();
})();
