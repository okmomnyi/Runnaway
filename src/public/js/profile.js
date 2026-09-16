'use strict';

/* Profile page: "Import from CV". Uploads a resume, asks the server to extract
   structured fields (via the AI), and fills the form for review. Nothing is
   saved until the user presses Save. Vanilla JS, no dependencies. */

(function () {
  var fileInput = document.getElementById('cv-file');
  var fileName = document.getElementById('cv-file-name');
  var importBtn = document.getElementById('cv-import-btn');
  var msg = document.getElementById('cv-import-msg');
  var form = document.getElementById('profile-form');
  if (!fileInput || !importBtn || !form) return;

  var FIELDS = [
    'full_name', 'phone', 'contact_email', 'university',
    'certifications', 'focus_summary', 'skills', 'cloud_infra', 'recent_activity',
  ];

  function setMsg(text, kind) {
    msg.textContent = text || '';
    msg.className = 'cv-import-msg' + (kind ? ' cv-msg-' + kind : '');
  }

  fileInput.addEventListener('change', function () {
    var f = fileInput.files && fileInput.files[0];
    fileName.textContent = f ? f.name : 'No file chosen';
    importBtn.disabled = !f;
    setMsg('');
  });

  importBtn.addEventListener('click', function () {
    var f = fileInput.files && fileInput.files[0];
    if (!f) return;

    var original = importBtn.textContent;
    importBtn.disabled = true;
    importBtn.innerHTML = '<span class="spinner" aria-hidden="true"></span> Reading CV…';
    setMsg('Extracting details from your CV. This can take a few seconds.', 'info');

    var data = new FormData();
    data.append('cv', f);

    fetch('/profile/import-cv', { method: 'POST', body: data, credentials: 'same-origin' })
      .then(function (res) {
        return res.json().then(function (body) {
          if (!res.ok) throw new Error(body && body.error ? body.error : 'Import failed.');
          return body;
        });
      })
      .then(function (body) {
        var fields = (body && body.fields) || {};
        var filled = 0;
        FIELDS.forEach(function (key) {
          var val = fields[key];
          if (val == null || String(val).trim() === '') return;
          var input = form.querySelector('[name="' + key + '"]');
          if (!input) return;
          input.value = String(val).trim();
          input.classList.add('field-filled');
          setTimeout(function () { input.classList.remove('field-filled'); }, 2500);
          filled += 1;
        });
        if (filled > 0) {
          setMsg('Imported ' + filled + ' field' + (filled === 1 ? '' : 's') + ' from your CV. Review them and press Save profile.', 'ok');
        } else {
          setMsg('No details could be read from that CV. Try a different file or fill the form manually.', 'info');
        }
      })
      .catch(function (err) {
        setMsg(err.message || 'Could not import that CV.', 'error');
      })
      .finally(function () {
        importBtn.disabled = false;
        importBtn.textContent = original;
      });
  });
})();
