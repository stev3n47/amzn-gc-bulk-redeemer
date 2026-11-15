// ==UserScript==
// @name         Amazon Gift Card Bulk Redeemer
// @namespace    https://github.com/stev3n47/amzn-gc-bulk-redeemer
// @version      1.0.1
// @description  Paste or load a list of Amazon gift card claim codes and redeem them automatically on the redeem page.
// @author       stev3n47
// @homepageURL  https://github.com/stev3n47/amzn-gc-bulk-redeemer
// @updateURL    https://raw.githubusercontent.com/stev3n47/amzn-gc-bulk-redeemer/main/amazon-gc-bulk-redeemer.user.js
// @downloadURL  https://raw.githubusercontent.com/stev3n47/amzn-gc-bulk-redeemer/main/amazon-gc-bulk-redeemer.user.js
// @match        https://*.amazon.com/*
// @match        https://*.amazon.co.uk/*
// @match        https://*.amazon.ca/*
// @match        https://*.amazon.com.au/*
// @match        https://*.amazon.de/*
// @match        https://*.amazon.fr/*
// @match        https://*.amazon.it/*
// @match        https://*.amazon.es/*
// @match        https://*.amazon.co.jp/*
// @match        https://*.amazon.in/*
// @match        https://*.amazon.com.mx/*
// @match        https://*.amazon.com.br/*
// @match        https://*.amazon.nl/*
// @match        https://*.amazon.se/*
// @match        https://*.amazon.pl/*
// @match        https://*.amazon.com.tr/*
// @match        https://*.amazon.ae/*
// @match        https://*.amazon.sa/*
// @match        https://*.amazon.sg/*
// @match        https://*.amazon.eg/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  /* ---------------- state ---------------- */

  const LS_KEY = 'agcbr_v1';

  const defaults = () => ({
    running: false,
    paused: false,
    pauseReason: '',
    delayMs: 2500,
    collapsed: false,
    current: null,          // code submitted, awaiting result on next page load
    queue: [],              // codes still to try
    results: [],            // { code, status, msg, ts }  status: done|already|failed|review
    failsInRow: 0,
    stats: { done: 0, already: 0, failed: 0, review: 0 },
  });

  let state;
  try {
    state = JSON.parse(localStorage.getItem(LS_KEY)) || defaults();
    state = Object.assign(defaults(), state);
  } catch {
    state = defaults();
  }
  const save = () => localStorage.setItem(LS_KEY, JSON.stringify(state));

  /* ---------------- page detection ---------------- */

  const $ = (s, r = document) => r.querySelector(s);
  const formEl = () => $('#gc-redemption-form');
  const inputEl = () => $('#gc-redemption-input') || $('input[name="claimCode"]');
  const submitEl = () => $('#gc-redemption-apply-button');

  const isSignedOut = () => !!$('#ap_email');
  const hasCaptcha = () => {
    const c = $('#gc-redemption-captcha');
    return !!(c && c.children.length);
  };

  // Result of the previous POST, read from the freshly loaded page.
  function classifyResult() {
    if (hasCaptcha()) return { status: 'captcha' };
    // Success: dedicated banner with the amount in its heading
    const ok = $('#alertRedemptionSuccess');
    if (ok && ok.innerText.trim()) {
      const head = ok.querySelector('.a-alert-heading');
      const amt = (head || ok).innerText.match(/[$£€¥][\d.,]+|[\d.,]+\s?(?:USD|GBP|EUR|JPY|CAD|AUD|INR|MXN|BRL)/i);
      return { status: 'done', msg: amt ? amt[0] : (head ? head.innerText.trim() : ok.innerText.trim().split('\n')[0]) };
    }
    // Errors: redeem error box, system error, or any visible inline field errors
    const err = $('#gc-redemption-error');
    if (err && !err.classList.contains('aok-hidden') && err.innerText.trim())
      return { status: 'failed', msg: err.innerText.trim() };
    const sys = $('#gc-thankyou-alert-error');
    if (sys && !sys.classList.contains('gc-hide') && sys.innerText.trim())
      return { status: 'failed', msg: sys.innerText.trim() };
    const inlineErrs = [...document.querySelectorAll('.a-alert-inline-error')]
      .filter(e => !e.classList.contains('aok-hidden') && e.innerText.trim());
    if (inlineErrs.length)
      return { status: 'failed', msg: inlineErrs.map(e => e.innerText.trim()).join(' | ') };
    // Info alert: "already applied" and similar
    const info = $('#gc-redemption-alert');
    if (info && info.innerText.trim()) {
      const t = info.innerText.trim();
      return { status: /already/i.test(t) ? 'already' : 'done', msg: t };
    }
    return null;
  }

  /* ---------------- engine ---------------- */

  function setFieldValue(el, v) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement;
    Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function recordResult(status, msg) {
    const code = state.current;
    state.current = null;
    if (!code) return;
    state.results.push({ code, status, msg: msg || '', ts: Date.now() });
    if (status in state.stats) state.stats[status]++;
    state.failsInRow = (status === 'failed' || status === 'review') ? state.failsInRow + 1 : 0;
    save();
  }

  function submitNext() {
    if (!state.running || state.paused) return;
    const next = state.queue[0];
    if (!next) {
      state.running = false;
      save();
      render();
      return;
    }
    const input = inputEl(), btn = submitEl();
    if (!input || !btn) {
      pause('Could not find the redeem form on this page.');
      return;
    }
    state.current = next;
    state.queue = state.queue.slice(1);
    save();
    render();
    setFieldValue(input, next);
    setTimeout(() => btn.click(), 120 + Math.random() * 180); // small human-ish delay
  }

  function pause(reason) {
    state.paused = true;
    state.pauseReason = reason || '';
    save();
    render();
  }

  function resume() {
    state.paused = false;
    state.pauseReason = '';
    state.failsInRow = 0;
    save();
    submitNext();
  }

  function stop() {
    state.running = false;
    state.paused = false;
    state.pauseReason = '';
    state.current = null;
    save();
    render();
  }

  function resetAll() {
    state = defaults();
    save();
    render();
  }

  function parseCodes(text) {
    return [...new Set(
      text.split(/[\s,;]+/)
        .map(s => s.replace(/[^a-zA-Z0-9]/g, '').toUpperCase())
        .filter(s => s.length >= 12 && s.length <= 20)
    )];
  }

  /* ---------------- page-load driver ---------------- */

  // Runs once per page load. If a submission was in flight, its result
  // is now visible on this page — record it, then continue the queue.
  function drive() {
    if (!state.running) return;
    if (isSignedOut()) { pause('Signed out of Amazon. Log back in, then press Resume.'); return; }
    if (hasCaptcha()) {
      // We can't know if the in-flight code went through — put it back at the
      // front of the queue. If it did redeem, the retry comes back "already".
      if (state.current) {
        state.queue.unshift(state.current);
        state.current = null;
      }
      pause('Amazon is showing a CAPTCHA. Solve it on the page, then press Resume.');
      return;
    }
    if (state.current) {
      const res = classifyResult();
      recordResult(res ? res.status : 'review', res ? res.msg : 'Result unclear — check manually');
    }
    if (state.paused) return;
    if (state.failsInRow >= 3) {
      pause('Stopped after 3 failed attempts in a row — likely rate limiting or repeated bad codes. Wait a bit, then press Resume.');
      return;
    }
    if (!state.queue.length && !state.current) {
      state.running = false;
      save();
      render();
      return;
    }
    // Wait, then submit the next code. Page reload provides extra spacing between attempts.
    render(); // re-render now that the in-flight result has been recorded
    const wait = state.delayMs + Math.random() * 800;
    armCountdown(wait);
    setTimeout(submitNext, wait);
  }

  /* ---------------- UI ---------------- */

  const ICONS = {
    logo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9V6a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v3a2.5 2.5 0 0 0 0 5v3a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-3a2.5 2.5 0 0 0 0-5Z"/><path d="M13 5v2M13 11v2M13 17v2"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
    warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    repeat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/></svg>',
    upload: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/></svg>',
    play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.14v13.72c0 .8.87 1.3 1.56.88l10.3-6.86a1.04 1.04 0 0 0 0-1.76L9.56 4.26A1.04 1.04 0 0 0 8 5.14Z"/></svg>',
    pauseI: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>',
    stopI: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>',
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
    chev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
  };
  const icon = (name, size = 14) =>
    `<span class="ic" style="width:${size}px;height:${size}px">${ICONS[name]}</span>`;

  const CSS = `
    :host {
      all: initial;
      --bg: rgba(20, 24, 30, .92);
      --bg2: rgba(255,255,255,.045);
      --line: rgba(255,255,255,.09);
      --txt: #f2f4f6;
      --mut: #9aa7b4;
      --acc: #febd69;
      --acc2: #f3a847;
      --ok: #3fcf8e;
      --err: #ff6b6b;
      --warn: #febd69;
      --info: #7cb8ff;
      --ease-out: cubic-bezier(0.23, 1, 0.32, 1);
      --ease-inout: cubic-bezier(0.77, 0, 0.175, 1);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; }
    .ic { display: inline-flex; flex-shrink: 0; }
    .ic svg { width: 100%; height: 100%; display: block; }

    /* collapsed pill */
    .pill {
      position: fixed; right: 20px; bottom: 20px; z-index: 2147483000;
      display: flex; align-items: center; gap: 8px;
      height: 44px; padding: 0 16px 0 12px; border-radius: 999px;
      background: var(--bg); color: var(--txt);
      border: 1px solid var(--line);
      box-shadow: 0 8px 30px rgba(0,0,0,.45);
      backdrop-filter: blur(16px) saturate(160%);
      -webkit-backdrop-filter: blur(16px) saturate(160%);
      cursor: pointer; font-size: 13px; font-weight: 600; letter-spacing: .01em;
      transition: transform 160ms var(--ease-out), opacity 200ms var(--ease-out);
      opacity: 0; transform: translateY(10px) scale(.95);
    }
    .pill.vis { opacity: 1; transform: none; }
    .pill:active { transform: scale(.97); }
    .pill .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--acc); box-shadow: 0 0 10px rgba(254,189,105,.7); }
    .pill .cnt { background: var(--bg2); border: 1px solid var(--line); border-radius: 999px; padding: 1px 8px; font-size: 11px; color: var(--mut); font-variant-numeric: tabular-nums; }

    /* expanded card */
    .card {
      position: fixed; right: 20px; bottom: 20px; z-index: 2147483000;
      width: 372px; max-height: min(640px, calc(100vh - 40px));
      display: flex; flex-direction: column;
      border-radius: 16px; overflow: hidden;
      background: var(--bg); color: var(--txt);
      border: 1px solid var(--line);
      box-shadow: 0 16px 50px rgba(0,0,0,.5), 0 2px 8px rgba(0,0,0,.3);
      backdrop-filter: blur(20px) saturate(160%);
      -webkit-backdrop-filter: blur(20px) saturate(160%);
      opacity: 0; transform: translateY(12px) scale(.96);
      transition: transform 220ms var(--ease-out), opacity 200ms var(--ease-out);
    }
    .card.vis { opacity: 1; transform: none; }

    .hd { display: flex; align-items: center; gap: 10px; padding: 14px 14px 12px; border-bottom: 1px solid var(--line); }
    .hd .logo { width: 30px; height: 30px; border-radius: 9px; display: grid; place-items: center;
      background: linear-gradient(135deg, var(--acc), var(--acc2)); color: #22190a; flex-shrink: 0; }
    .hd .logo .ic { width: 17px; height: 17px; }
    .hd .tt { flex: 1; min-width: 0; }
    .hd h1 { font-size: 13.5px; font-weight: 700; letter-spacing: -.01em; line-height: 1.2; }
    .hd .sub { font-size: 11px; color: var(--mut); margin-top: 1px; }
    .hd .min { width: 30px; height: 30px; border-radius: 8px; display: grid; place-items: center;
      background: transparent; border: none; color: var(--mut); cursor: pointer; transition: background .15s, color .15s, transform 160ms var(--ease-out); }
    .hd .min:hover { background: var(--bg2); color: var(--txt); }
    .hd .min:active { transform: scale(.92); }

    .stats { display: grid; grid-template-columns: repeat(4,1fr); gap: 1px; background: var(--line); border-bottom: 1px solid var(--line); }
    .stat { background: transparent; padding: 8px 4px 7px; text-align: center; }
    .stat b { display: block; font-size: 15px; font-weight: 700; font-variant-numeric: tabular-nums; }
    .stat span { font-size: 9.5px; color: var(--mut); text-transform: uppercase; letter-spacing: .07em; }
    .stat.ok b { color: var(--ok); } .stat.er b { color: var(--err); }

    .pbar { height: 3px; background: rgba(255,255,255,.06); }
    .pbar i { display: block; height: 100%; background: linear-gradient(90deg, var(--acc2), var(--acc));
      transform-origin: left; transform: scaleX(0); transition: transform 350ms var(--ease-out); }

    .bd { overflow-y: auto; padding: 12px 14px 14px; scrollbar-width: thin; scrollbar-color: rgba(255,255,255,.15) transparent; }
    .bd::-webkit-scrollbar { width: 5px; } .bd::-webkit-scrollbar-thumb { background: rgba(255,255,255,.15); border-radius: 99px; }

    .banner { display: flex; gap: 8px; align-items: flex-start; border-radius: 10px; padding: 9px 10px;
      font-size: 12px; line-height: 1.45; margin-bottom: 10px; }
    .banner .ic { width: 15px; height: 15px; margin-top: 1px; }
    .banner.w { background: rgba(254,189,105,.1); border: 1px solid rgba(254,189,105,.3); color: #ffd9a0; }
    .banner.e { background: rgba(255,107,107,.1); border: 1px solid rgba(255,107,107,.3); color: #ffb0b0; }
    .banner.i { background: rgba(124,184,255,.1); border: 1px solid rgba(124,184,255,.28); color: #b9d7ff; }

    label.fld { display: block; font-size: 11px; font-weight: 600; color: var(--mut); text-transform: uppercase; letter-spacing: .07em; margin: 12px 0 6px; }
    textarea {
      width: 100%; min-height: 88px; resize: vertical;
      background: rgba(0,0,0,.28); border: 1px solid var(--line); border-radius: 10px;
      color: var(--txt); padding: 9px 10px; font-size: 12px; line-height: 1.55;
      font-family: ui-monospace, "SF Mono", "Cascadia Mono", Consolas, monospace;
      outline: none; transition: border-color .15s, box-shadow .15s;
    }
    textarea:focus { border-color: var(--acc); box-shadow: 0 0 0 3px rgba(254,189,105,.18); }
    textarea::placeholder { color: rgba(154,167,180,.5); }
    .help { font-size: 11px; color: var(--mut); margin-top: 6px; line-height: 1.45; }
    .help b { color: var(--acc); font-weight: 600; font-variant-numeric: tabular-nums; }

    .row { display: flex; gap: 8px; align-items: center; margin-top: 10px; }
    .numwrap { display: flex; align-items: center; gap: 7px; font-size: 12px; color: var(--mut); }
    input[type=number] {
      width: 68px; height: 32px; background: rgba(0,0,0,.28); border: 1px solid var(--line);
      border-radius: 8px; color: var(--txt); padding: 0 8px; font-size: 12px; outline: none;
      font-variant-numeric: tabular-nums; transition: border-color .15s, box-shadow .15s;
    }
    input[type=number]:focus { border-color: var(--acc); box-shadow: 0 0 0 3px rgba(254,189,105,.18); }

    .btn {
      display: inline-flex; align-items: center; justify-content: center; gap: 7px;
      height: 36px; padding: 0 15px; border-radius: 10px; border: 1px solid transparent;
      font-size: 13px; font-weight: 650; letter-spacing: .005em; cursor: pointer;
      transition: transform 160ms var(--ease-out), background .15s, opacity .15s, border-color .15s;
      user-select: none; white-space: nowrap;
    }
    .btn:active { transform: scale(.97); }
    .btn:disabled { opacity: .4; cursor: not-allowed; }
    .btn:focus-visible { outline: none; box-shadow: 0 0 0 3px rgba(254,189,105,.35); }
    .btn .ic { width: 13px; height: 13px; }
    .btn.pri { background: linear-gradient(180deg, var(--acc), var(--acc2)); color: #241a05;
      box-shadow: 0 1px 2px rgba(0,0,0,.3), inset 0 1px 0 rgba(255,255,255,.35); }
    .btn.pri:hover { filter: brightness(1.06); }
    .btn.sec { background: var(--bg2); border-color: var(--line); color: var(--txt); }
    .btn.sec:hover { background: rgba(255,255,255,.09); }
    .btn.ghost { background: transparent; color: var(--mut); padding: 0 10px; }
    .btn.ghost:hover { color: var(--txt); background: var(--bg2); }
    .btn.dng { background: rgba(255,107,107,.12); border-color: rgba(255,107,107,.3); color: #ffb0b0; }
    .btn.dng:hover { background: rgba(255,107,107,.2); }
    .btn.grow { flex: 1; }

    .queue { margin-top: 12px; border: 1px solid var(--line); border-radius: 10px; overflow: hidden; }
    .queue .qh { display: flex; justify-content: space-between; align-items: center; padding: 7px 10px;
      font-size: 10.5px; font-weight: 650; text-transform: uppercase; letter-spacing: .07em;
      color: var(--mut); border-bottom: 1px solid var(--line); background: rgba(255,255,255,.025); }
    .qlist { max-height: 190px; overflow-y: auto; scrollbar-width: thin; scrollbar-color: rgba(255,255,255,.15) transparent; }
    .qlist::-webkit-scrollbar { width: 5px; } .qlist::-webkit-scrollbar-thumb { background: rgba(255,255,255,.15); border-radius: 99px; }
    .qrow { display: flex; align-items: center; gap: 9px; padding: 7px 10px; font-size: 12px;
      border-bottom: 1px solid rgba(255,255,255,.045); }
    .qrow:last-child { border-bottom: none; }
    .qrow .code { flex: 1; font-family: ui-monospace, "SF Mono", "Cascadia Mono", Consolas, monospace;
      font-size: 11.5px; letter-spacing: .02em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .qrow.done .code { color: var(--mut); text-decoration: line-through; text-decoration-color: rgba(255,255,255,.25); }
    .qrow .msg { max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 10.5px; color: var(--mut); }
    .chip { display: inline-flex; align-items: center; gap: 5px; font-size: 10px; font-weight: 700;
      text-transform: uppercase; letter-spacing: .06em; padding: 3px 7px; border-radius: 999px; flex-shrink: 0; }
    .chip .ic { width: 10px; height: 10px; }
    .chip.p { background: var(--bg2); color: var(--mut); border: 1px solid var(--line); }
    .chip.r { background: rgba(254,189,105,.14); color: var(--acc); border: 1px solid rgba(254,189,105,.3); }
    .chip.d { background: rgba(63,207,142,.12); color: var(--ok); border: 1px solid rgba(63,207,142,.28); }
    .chip.a { background: rgba(124,184,255,.12); color: var(--info); border: 1px solid rgba(124,184,255,.28); }
    .chip.f { background: rgba(255,107,107,.12); color: var(--err); border: 1px solid rgba(255,107,107,.28); }
    .chip.v { background: rgba(255,255,255,.07); color: var(--mut); border: 1px solid var(--line); }

    .logline { font-size: 11px; color: var(--mut); margin-top: 10px; min-height: 15px; line-height: 1.4; }
    .logline b { color: var(--txt); font-weight: 600; font-variant-numeric: tabular-nums; }
    .status { display: flex; align-items: center; gap: 8px; margin-top: 10px; font-size: 12.5px; }
    .spin { width: 14px; height: 14px; border-radius: 50%; border: 2px solid rgba(254,189,105,.25);
      border-top-color: var(--acc); animation: sp 0.8s linear infinite; flex-shrink: 0; }
    @keyframes sp { to { transform: rotate(360deg); } }
    .foot { display: flex; gap: 8px; margin-top: 12px; }
    input[type=file] { display: none; }

    @media (prefers-reduced-motion: reduce) {
      * { animation-duration: .01ms !important; transition-duration: .01ms !important; }
    }
    @media (prefers-reduced-transparency: reduce) {
      .card, .pill { background: #14181e; backdrop-filter: none; -webkit-backdrop-filter: none; }
    }
  `;

  let host, shadow, countdownTimer;

  function chipFor(status) {
    switch (status) {
      case 'done':    return `<span class="chip d">${icon('check', 10)}redeemed</span>`;
      case 'already': return `<span class="chip a">${icon('repeat', 10)}already</span>`;
      case 'failed':  return `<span class="chip f">${icon('x', 10)}failed</span>`;
      case 'review':  return `<span class="chip v">${icon('warn', 10)}review</span>`;
      case 'current': return `<span class="chip r">${icon('clock', 10)}sent</span>`;
      default:        return `<span class="chip p">${icon('clock', 10)}queued</span>`;
    }
  }

  function esc(s) {
    const d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }

  function armCountdown(ms) {
    clearInterval(countdownTimer);
    const end = Date.now() + ms;
    countdownTimer = setInterval(() => {
      const el = shadow && shadow.getElementById('cdown');
      if (!el) { clearInterval(countdownTimer); return; }
      const left = Math.max(0, end - Date.now());
      el.textContent = (left / 1000).toFixed(1) + 's';
    }, 150);
  }

  function statusLine() {
    if (state.paused) return `<span>Paused — ${esc(state.pauseReason || 'waiting')}</span>`;
    if (state.running && state.current) return `<span class="spin"></span><span>Waiting for page result…</span>`;
    if (state.running) return `<span class="spin"></span><span>Next code in <b id="cdown">—</b></span>`;
    if (allDone()) return `<span>All codes processed.</span>`;
    return `<span>${state.queue.length || 0} codes queued.</span>`;
  }

  function allDone() {
    return !state.running && !state.current && !state.queue.length && state.results.length;
  }

  function totalRedeemed() {
    let sum = 0, cur = '';
    for (const r of state.results) {
      if (r.status !== 'done') continue;
      const m = (r.msg || '').match(/([$£€¥])?\s?([\d.,]+)/);
      if (!m) continue;
      if (!cur && m[1]) cur = m[1];
      // "€5,00" decimal-comma vs "$1,234.00" thousands
      const n = /,\d{2}$/.test(m[2]) ? parseFloat(m[2].replace('.', '').replace(',', '.'))
                                    : parseFloat(m[2].replace(/,/g, ''));
      if (!isNaN(n)) sum += n;
    }
    return sum > 0 ? cur + sum.toFixed(2) : '';
  }

  function rows() {
    const items = [];
    state.results.forEach(r => items.push({ code: r.code, status: r.status, msg: r.msg }));
    if (state.current) items.push({ code: state.current, status: 'current' });
    state.queue.forEach(c => items.push({ code: c, status: 'pending' }));
    if (!items.length) return '';
    const total = items.length;
    const rowsHtml = items.map((it, i) => {
      const cls = (it.status === 'done' || it.status === 'already') ? 'done' : '';
      const msg = it.msg && it.status !== 'pending' ? `<span class="msg" title="${esc(it.msg)}">${esc(it.msg)}</span>` : '';
      return `<div class="qrow ${cls}"><span style="color:var(--mut);font-size:10.5px;width:20px;flex-shrink:0;font-variant-numeric:tabular-nums">${i + 1}</span><span class="code">${esc(it.code)}</span>${msg}${chipFor(it.status)}</div>`;
    }).join('');
    return `<div class="queue"><div class="qh"><span>Queue</span><span>${total} codes</span></div><div class="qlist">${rowsHtml}</div></div>`;
  }

  function render() {
    if (!host) return;
    const s = state;
    const total = s.results.length + s.queue.length + (s.current ? 1 : 0);
    const processed = s.results.length;
    const pct = total ? Math.min(1, processed / total) : 0;

    if (s.collapsed) {
      shadow.innerHTML = `<style>${CSS}</style>
        <button class="pill" id="pill" aria-label="Expand gift card redeemer panel">
          <span class="dot"></span>Gift Cards<span class="cnt">${s.queue.length ? s.queue.length + ' left' : processed + ' done'}</span>
        </button>`;
      requestAnimationFrame(() => shadow.getElementById('pill').classList.add('vis'));
      shadow.getElementById('pill').onclick = () => { state.collapsed = false; save(); render(); };
      return;
    }

    const banner = s.paused
      ? `<div class="banner w">${icon('warn', 15)}<div>${esc(s.pauseReason || 'Paused.')}</div></div>`
      : allDone()
        ? `<div class="banner i">${icon('check', 15)}<div><b>Finished.</b> ${s.stats.done} redeemed${totalRedeemed() ? ` (~${totalRedeemed()} added)` : ''}, ${s.stats.already} already applied, ${s.stats.failed} failed.</div></div>`
        : '';

    const setup = (!s.running || s.paused) ? `
      <label class="fld" for="codes">Claim codes</label>
      <textarea id="codes" placeholder="XXXX-XXXXXX-XXXX&#10;YYYY-YYYYYY-YYYY&#10;…" spellcheck="false">${esc(s.queue.join('\n'))}</textarea>
      <div class="help" id="cnthelp">Paste codes (one per line, dashes optional) or load a file. <b id="cnt">${s.queue.length}</b> detected.</div>
      <div class="row">
        <button class="btn sec" id="load" aria-label="Load codes from a text file">${icon('upload')} Load file</button>
        <input type="file" id="file" accept=".txt,.csv,.text,text/plain,text/csv">
        <div class="numwrap" style="margin-left:auto">
          <label for="delay" style="font-size:11px">Delay</label>
          <input type="number" id="delay" min="800" max="30000" step="100" value="${s.delayMs}" aria-label="Delay between redemptions in milliseconds">
          <span style="font-size:11px">ms</span>
        </div>
      </div>` : '';

    const actions = s.paused
      ? `<button class="btn pri grow" id="resume">${icon('play')} Resume</button>
         <button class="btn sec" id="stop">${icon('stopI')} Stop</button>`
      : s.running
        ? `<button class="btn sec grow" id="pause">${icon('pauseI')} Pause</button>
           <button class="btn dng" id="stop">${icon('stopI')} Stop</button>`
        : `<button class="btn pri grow" id="start" ${s.queue.length ? '' : 'disabled'}>${icon('play')} Start redeeming</button>
           <button class="btn ghost" id="reset" title="Clear queue and results">${icon('trash')}</button>`;

    const copyBtn = s.results.length
      ? `<button class="btn sec" id="copy" style="margin-top:8px">${icon('copy')} Copy results</button>` : '';

    shadow.innerHTML = `<style>${CSS}</style>
      <div class="card" role="dialog" aria-label="Gift card bulk redeemer">
        <div class="hd">
          <div class="logo">${icon('logo', 17)}</div>
          <div class="tt"><h1>Gift Card Runner</h1><div class="sub">${hostDomain()}</div></div>
          <button class="min" id="min" aria-label="Collapse panel">${icon('chev', 15)}</button>
        </div>
        <div class="stats">
          <div class="stat"><b id="st-total">${total}</b><span>total</span></div>
          <div class="stat ok"><b id="st-done">${s.stats.done}</b><span>redeemed</span></div>
          <div class="stat er"><b id="st-fail">${s.stats.failed}</b><span>failed</span></div>
          <div class="stat"><b id="st-left">${s.queue.length + (s.current ? 1 : 0)}</b><span>left</span></div>
        </div>
        <div class="pbar"><i id="pb"></i></div>
        <div class="bd">
          ${banner}
          ${setup}
          ${rows()}
          <div class="status" id="status" aria-live="polite">${statusLine()}</div>
          <div class="logline" id="log" aria-live="polite"></div>
          <div class="foot">${actions}</div>
          ${copyBtn}
        </div>
      </div>`;

    requestAnimationFrame(() => {
      const c = shadow.querySelector('.card');
      if (c) c.classList.add('vis');
      const pb = shadow.getElementById('pb');
      if (pb) requestAnimationFrame(() => { pb.style.transform = `scaleX(${pct})`; });
    });

    wire();
  }

  function hostDomain() {
    return location.hostname.replace(/^www\./, '');
  }

  function wire() {
    const g = id => shadow.getElementById(id);
    const on = (id, ev, fn) => { const el = g(id); if (el) el.addEventListener(ev, fn); };

    on('min', 'click', () => { state.collapsed = true; save(); render(); });

    const ta = g('codes');
    if (ta) ta.addEventListener('input', () => {
      const codes = parseCodes(ta.value);
      // Codes already redeemed stay excluded; failed/review codes can be re-queued.
      const burned = new Set(state.results.filter(r => r.status === 'done' || r.status === 'already').map(r => r.code));
      state.queue = codes.filter(c => c !== state.current && !burned.has(c));
      const left = state.queue.length + (state.current ? 1 : 0);
      const total = state.results.length + left;
      const c = g('cnt'); if (c) c.textContent = state.queue.length;
      const stT = g('st-total'); if (stT) stT.textContent = total;
      const stL = g('st-left'); if (stL) stL.textContent = left;
      const st = g('status'); if (st && !state.running && !state.paused) st.innerHTML = statusLine();
      const sb = g('start'); if (sb) sb.disabled = !state.queue.length;
      save();
    });

    on('load', 'click', () => g('file').click());
    on('file', 'change', e => {
      const f = e.target.files[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = () => {
        const codes = parseCodes(String(r.result));
        const known = new Set([...state.queue, ...(state.results.map(x => x.code)), state.current]);
        const fresh = codes.filter(c => !known.has(c));
        state.queue = state.queue.concat(fresh);
        save();
        render();
        log(`${fresh.length} codes loaded (${codes.length - fresh.length} skipped as duplicates).`);
      };
      r.readAsText(f);
    });

    on('delay', 'change', e => {
      const v = Math.max(800, Math.min(30000, +e.target.value || 2500));
      state.delayMs = v; e.target.value = v; save();
    });

    on('start', 'click', () => {
      if (!state.queue.length) return;
      state.running = true; state.paused = false; state.failsInRow = 0;
      save(); render(); submitNext();
    });
    on('pause', 'click', () => pause('Paused by user.'));
    on('resume', 'click', resume);
    on('stop', 'click', stop);
    on('reset', 'click', resetAll);
    on('copy', 'click', async () => {
      const csv = ['code,status,message',
        ...state.results.map(r => `${r.code},${r.status},"${(r.msg || '').replace(/"/g, "'")}"`)].join('\n');
      try { await navigator.clipboard.writeText(csv); log('Results copied to clipboard.'); }
      catch { log('Clipboard blocked — select the queue text manually.'); }
    });
  }

  function log(msg) {
    const el = shadow && shadow.getElementById('log');
    if (el) el.innerHTML = esc(msg);
    else console.log('[gc-bulk]', msg);
  }

  /* ---------------- boot ---------------- */

  function mount() {
    if (host) return;
    host = document.createElement('div');
    host.id = 'agcbr-host';
    document.documentElement.appendChild(host);
    shadow = host.attachShadow({ mode: 'open' });
    render();
  }

  const onRedeemPage = () => !!formEl();

  if (onRedeemPage()) {
    mount();
    drive();
  } else if (state.running || state.paused) {
    // Off the redeem page while a run is active — show a slim way back.
    mount();
    const note = document.createElement('div');
    shadow.innerHTML = `<style>${CSS}</style>
      <a href="${location.origin}/gc/redeem" class="pill" style="text-decoration:none">
        <span class="dot" style="background:var(--warn)"></span>GC Runner paused — return to redeem page
        <span class="cnt">${state.queue.length} left</span>
      </a>`;
    requestAnimationFrame(() => shadow.querySelector('.pill').classList.add('vis'));
  }
})();
