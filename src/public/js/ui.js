'use strict';

/* Site-wide chrome shared by every page: theme toggle, mobile nav, scroll
   progress, back-to-top, password show/hide, and a themed confirm dialog
   (exposed as window.confirmDialog for the dashboard's Remove action).
   Vanilla JS, no dependencies. */

(function () {
  var root = document.documentElement;

  // ---- Theme toggle -------------------------------------------------------

  var SUN = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><line x1="12" y1="2" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="2" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="22" y2="12"/><line x1="4.9" y1="4.9" x2="7" y2="7"/><line x1="17" y1="17" x2="19.1" y2="19.1"/><line x1="4.9" y1="19.1" x2="7" y2="17"/><line x1="17" y1="7" x2="19.1" y2="4.9"/></svg>';
  var MOON = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';

  function effectiveTheme() {
    var stored = null;
    try { stored = localStorage.getItem('theme'); } catch (e) {}
    if (stored === 'light' || stored === 'dark') return stored;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  var themeBtn = document.getElementById('theme-toggle');
  function paintThemeBtn() {
    if (!themeBtn) return;
    var cur = effectiveTheme();
    // Show the icon of the theme you'll switch TO.
    themeBtn.innerHTML = cur === 'dark' ? SUN : MOON;
    themeBtn.setAttribute('aria-label', cur === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
  }
  if (themeBtn) {
    paintThemeBtn();
    themeBtn.addEventListener('click', function () {
      var next = effectiveTheme() === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      try { localStorage.setItem('theme', next); } catch (e) {}
      paintThemeBtn();
    });
    // Track OS changes only while the user hasn't chosen explicitly.
    if (window.matchMedia) {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () {
        var stored = null;
        try { stored = localStorage.getItem('theme'); } catch (e) {}
        if (stored !== 'light' && stored !== 'dark') paintThemeBtn();
      });
    }
  }

  // ---- Mobile nav ---------------------------------------------------------

  var navToggle = document.getElementById('nav-toggle');
  var navLinks = document.getElementById('primary-nav');
  if (navToggle && navLinks) {
    navToggle.addEventListener('click', function () {
      var open = navLinks.classList.toggle('open');
      navToggle.setAttribute('aria-expanded', String(open));
      navToggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    });
    // Close when a link is chosen.
    navLinks.addEventListener('click', function (e) {
      if (e.target.closest('a')) {
        navLinks.classList.remove('open');
        navToggle.setAttribute('aria-expanded', 'false');
      }
    });
  }

  // ---- Scroll progress + back to top --------------------------------------

  var bar = document.getElementById('scroll-progress');
  var toTop = document.getElementById('to-top');
  function onScroll() {
    var doc = document.documentElement;
    var scrolled = doc.scrollTop || document.body.scrollTop;
    var height = doc.scrollHeight - doc.clientHeight;
    var pct = height > 0 ? (scrolled / height) * 100 : 0;
    if (bar) bar.style.width = pct + '%';
    if (toTop) {
      if (scrolled > 320) toTop.removeAttribute('hidden');
      else toTop.setAttribute('hidden', '');
    }
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  onScroll();
  if (toTop) {
    toTop.addEventListener('click', function () {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  // ---- Password show / hide ----------------------------------------------

  var EYE = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>';
  var EYE_OFF = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.9 17.9A10.4 10.4 0 0 1 12 19C5 19 1 12 1 12a19 19 0 0 1 5.1-5.9M9.9 4.2A10.4 10.4 0 0 1 12 4c7 0 11 8 11 8a19 19 0 0 1-2.3 3.3M1 1l22 22"/></svg>';
  var toggles = document.querySelectorAll('.pw-toggle');
  toggles.forEach(function (btn) {
    var input = document.getElementById(btn.getAttribute('data-target'));
    if (!input) return;
    btn.innerHTML = EYE;
    btn.setAttribute('aria-label', 'Show password');
    btn.addEventListener('click', function () {
      var show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.innerHTML = show ? EYE_OFF : EYE;
      btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    });
  });

  // ---- Confirm dialog (themed) -------------------------------------------

  window.confirmDialog = function (opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');

      var box = document.createElement('div');
      box.className = 'modal-box';

      var h = document.createElement('h2');
      h.className = 'modal-title';
      h.textContent = opts.title || 'Are you sure?';

      var p = document.createElement('p');
      p.className = 'modal-message';
      p.textContent = opts.message || '';

      var actions = document.createElement('div');
      actions.className = 'modal-actions';

      var cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'btn btn-ghost';
      cancel.textContent = opts.cancelLabel || 'Cancel';

      var confirm = document.createElement('button');
      confirm.type = 'button';
      confirm.className = 'btn ' + (opts.danger ? 'btn-danger-solid' : 'btn-primary');
      confirm.textContent = opts.confirmLabel || 'Confirm';

      actions.appendChild(cancel);
      actions.appendChild(confirm);
      box.appendChild(h);
      if (opts.message) box.appendChild(p);
      box.appendChild(actions);
      overlay.appendChild(box);
      document.body.appendChild(overlay);

      var prevFocus = document.activeElement;
      confirm.focus();

      function close(result) {
        document.removeEventListener('keydown', onKey);
        overlay.remove();
        if (prevFocus && prevFocus.focus) prevFocus.focus();
        resolve(result);
      }
      function onKey(e) {
        if (e.key === 'Escape') close(false);
        if (e.key === 'Tab') {
          // simple focus trap between the two buttons
          e.preventDefault();
          (document.activeElement === confirm ? cancel : confirm).focus();
        }
      }
      cancel.addEventListener('click', function () { close(false); });
      confirm.addEventListener('click', function () { close(true); });
      overlay.addEventListener('click', function (e) { if (e.target === overlay) close(false); });
      document.addEventListener('keydown', onKey);
    });
  };
})();
