// public/scripts/submit-waitlist.js
// Load with: <script src="/scripts/submit-waitlist.js" type="module" defer></script>

(() => {
  const FORM_NAME = 'waitlist';

  // Primary = Vercel API, Fallback = Netlify-style path (just in case)
  const VERIFY_URLS = ['/api/verify-turnstile', '/.netlify/functions/verify-turnstile'];
  const SAVE_URL    = '/api/waitlist';

  const TOKEN_FIELD = 'cf-turnstile-response';
  const TOKEN_FIELD_ALT = 'cf_turnstile_response';

  const form = document.forms[FORM_NAME];
  if (!form) return;

  const submitBtn = form.querySelector('button[type="submit"]');
  const originalBtnLabel = submitBtn ? submitBtn.textContent : '';
  const statusEl = makeStatusEl(form);

  // 1) Capture referral + UTM
  captureAttribution(form);

  // 2) Turnstile token gate
  if (submitBtn) submitBtn.disabled = true;
  const tokenObserver = new MutationObserver(() => {
    const hasToken = !!getToken(form);
    if (submitBtn) submitBtn.disabled = !hasToken;
  });
  tokenObserver.observe(form, { subtree: true, childList: true, attributes: true });

  // Optional Turnstile callbacks
  window.onTurnstileToken = (token) => {
    ensureTokenInputs(form, token);
    if (submitBtn) submitBtn.disabled = !token;
  };
  window.onTurnstileExpired = () => {
    ensureTokenInputs(form, '');
    if (submitBtn) submitBtn.disabled = true;
  };
  window.onTurnstileError = () => {
    if (submitBtn) submitBtn.disabled = true;
    showError('Human check failed to load. Please retry.');
  };

  // 3) Submit flow
  form.addEventListener('submit', async (e) => {
    const token = getToken(form);
    if (!token) {
      e.preventDefault();
      showError('Please complete the human check before submitting.');
      try { window.turnstile?.reset?.(); } catch {}
      return;
    }

    e.preventDefault();
    clearStatus();
    setBusy(true);

    try {
      // (a) Verify Turnstile on server (defense-in-depth)
      const ok = await verifyTurnstile(token);
      if (!ok) throw new Error('Human check could not be verified. Please try again.');

      // (b) Save to your API; if 404 then fallback to native form submit
      const saveResult = await trySaveToApi(form);
      if (saveResult === false) {
        nativeSubmit(form);
        return;
      }

      // (c) Success → redirect (prefer server referral code)
      const { code } = saveResult || {};
      const successHref =
        form.getAttribute('data-success') ||
        form.getAttribute('action') ||
        '/success.html';

      if (code && typeof code === 'string') {
        window.location.href = addOrReplaceQueryParam(successHref, 'ref', code);
      } else {
        window.location.href = successHref;
      }
    } catch (err) {
      showError(err?.message || 'Something went wrong. Please try again.');
      try { window.turnstile?.reset?.(); } catch {}
    } finally {
      setBusy(false);
    }
  });

  // ───────────────────────────────── helpers ─────────────────────────────────

  function ensureTokenInputs(f, value) {
    let input1 = f.querySelector(`input[name="${TOKEN_FIELD}"]`);
    if (!input1) {
      input1 = document.createElement('input');
      input1.type = 'hidden';
      input1.name = TOKEN_FIELD;
      f.appendChild(input1);
    }
    input1.value = value || '';

    let input2 = f.querySelector(`input[name="${TOKEN_FIELD_ALT}"]`);
    if (!input2) {
      input2 = document.createElement('input');
      input2.type = 'hidden';
      input2.name = TOKEN_FIELD_ALT;
      f.appendChild(input2);
    }
    input2.value = value || '';
  }

  function getToken(f) {
    const v1 = f.querySelector(`input[name="${TOKEN_FIELD}"]`)?.value?.trim() || '';
    const v2 = f.querySelector(`input[name="${TOKEN_FIELD_ALT}"]`)?.value?.trim() || '';
    return v1 || v2;
  }

  function serializeForm(f) {
    const data = {};
    const fd = new FormData(f);
    for (const [k, v] of fd.entries()) data[k] = typeof v === 'string' ? v.trim() : v;
    const tok = getToken(f);
    if (tok) {
      data[TOKEN_FIELD] = tok;
      data[TOKEN_FIELD_ALT] = tok;
    }
    return data;
  }

  async function verifyTurnstile(token) {
    // Try primary, then fallback
    for (const url of VERIFY_URLS) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ token }),
        });
        if (res.status === 404) continue;
        if (!res.ok) return false;
        const json = await res.json().catch(() => ({}));
        return !!json?.success;
      } catch {
        // try next
      }
    }
    return false;
  }

  async function trySaveToApi(f) {
    const body = serializeForm(f);
    try {
      const res = await fetch(SAVE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(body),
      });

      if (res.status === 404) return false; // fallback to native submit
      if (!res.ok) {
        const msg = await safeErrorMessage(res);
        throw new Error(msg || `Save failed (${res.status}).`);
      }

      const json = await res.json().catch(() => ({}));
      if (!json || json.ok !== true) return true; // treat as ok even if payload is minimal
      return json; // { ok:true, id, code? }
    } catch (e) {
      // You could choose to fallback here: `return false;`
      throw e;
    }
  }

  function nativeSubmit(f) {
    f.submit();
  }

  async function safeErrorMessage(res) {
    try { const j = await res.json(); return j?.error || j?.message || ''; }
    catch { try { const t = await res.text(); return (t || '').slice(0, 280); }
    catch { return ''; } }
  }

  function setBusy(busy) {
    if (!submitBtn) return;
    submitBtn.disabled = busy;
    submitBtn.setAttribute('aria-busy', busy ? 'true' : 'false');
    submitBtn.style.opacity = busy ? '0.85' : '';
    submitBtn.textContent = busy
      ? (submitBtn.getAttribute('data-busy-label') || 'Submitting…')
      : (originalBtnLabel || 'Submit');
  }

  function makeStatusEl(f) {
    let el = f.querySelector('[data-form-status]');
    if (!el) {
      el = document.createElement('div');
      el.setAttribute('data-form-status', '1');
      el.style.marginTop = '0.5rem';
      el.style.fontSize = '12px';
      el.style.lineHeight = '1.2';
      el.style.color = '#9aa0a6';
      const submitRow = f.querySelector('button[type="submit"]')?.closest('.grid, .flex, form') || f;
      submitRow.appendChild(el);
    }
    return el;
  }

  function clearStatus() {
    if (statusEl) {
      statusEl.style.color = '#9aa0a6';
      statusEl.textContent = '';
    }
  }

  function showError(msg) {
    if (!statusEl) return alert(msg);
    statusEl.style.color = '#ffb4b4';
    statusEl.textContent = msg;
  }

  function captureAttribution(f) {
    const url = new URL(window.location.href);
    const ref = url.searchParams.get('ref') || url.searchParams.get('r');
    const refField = document.getElementById('referral_auto');
    if (ref && refField) refField.value = ref.slice(0, 64);

    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'].forEach((k) => {
      const v = url.searchParams.get(k);
      if (!v) return;
      let input = f.querySelector(`input[name="${k}"]`);
      if (!input) {
        input = document.createElement('input');
        input.type = 'hidden';
        input.name = k;
        f.appendChild(input);
      }
      input.value = v.slice(0, 64);
    });
  }

  function addOrReplaceQueryParam(href, key, value) {
    try {
      const u = new URL(href, window.location.origin);
      u.searchParams.set(key, value);
      return u.pathname + u.search + u.hash;
    } catch {
      const u = new URL(window.location.origin + href);
      u.searchParams.set(key, value);
      return u.pathname + u.search + u.hash;
    }
  }
})();
