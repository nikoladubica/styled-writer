/* Styled Writer — main app.

   How it works:
   - A hidden <textarea> is the source of truth. It handles typing, IME,
     paste, undo/redo and arrow keys natively.
   - #text mirrors its value, with an invisible marker span at the caret.
   - The paper is translated so the caret line always sits on the "typing
     line" just above the platen: new lines push the page up.
   - Every frame, the lamp glides toward the marker and the room light
     follows it.
*/
(() => {
  const $ = (s) => document.querySelector(s);
  const body = document.body;
  const input = $('#input');
  const stage = $('#stage');
  const paper = $('#paper');
  const textEl = $('#text');
  const lampEl = $('#lamp');
  const lightEl = $('#light');
  const ui = {
    title: $('#docTitle'),
    words: $('#wordCount'),
    saveState: $('#saveState'),
    pages: $('#btnPages'),
    new: $('#btnNew'),
    save: $('#btnSave'),
    sound: $('#btnSound'),
    lamp: $('#btnLamp'),
    drawer: $('#drawer'),
    scrim: $('#scrim'),
    closeDrawer: $('#btnCloseDrawer'),
    list: $('#docList'),
    empty: $('#docEmpty'),
    toast: $('#toast'),
  };

  const BELL_CHARS = 7;       // ring the bell this many characters before the right margin
  const LINE_RATIO = 0.68;    // typing line position, as a fraction of viewport height

  /* ---------------- State ---------------- */

  let docs = Store.allDocs();
  let doc = null;
  let prefs = Store.prefs();
  let caretEl = null;
  let strikeNext = false;     // animate the char just typed
  let readOffset = 0;         // > 0 while scrolling back through the page
  let bellLineTop = null;     // line on which the bell already rang
  let saveTimer = null;
  let typingTimer = null;

  /* ---------------- Rendering ---------------- */

  function makeCaret() {
    const el = document.createElement('span');
    el.className = 'caret-mark';
    el.textContent = '​';
    return el;
  }

  function render() {
    const v = input.value;
    const s = input.selectionStart;
    const e = input.selectionEnd;
    const frag = document.createDocumentFragment();
    caretEl = makeCaret();

    if (s !== e) {
      const mark = document.createElement('mark');
      mark.textContent = v.slice(s, e);
      frag.append(v.slice(0, s));
      if (input.selectionDirection === 'backward') frag.append(caretEl, mark);
      else frag.append(mark, caretEl);
      frag.append(v.slice(e));
    } else if (strikeNext && s > 0 && /\S/.test(v[s - 1])) {
      const hit = document.createElement('span');
      hit.className = 'strike';
      hit.textContent = v[s - 1];
      frag.append(v.slice(0, s - 1), hit, caretEl, v.slice(s));
    } else {
      frag.append(v.slice(0, s), caretEl, v.slice(s));
    }

    if (!v) {
      const ph = document.createElement('span');
      ph.className = 'placeholder';
      ph.textContent = 'Start typing…';
      frag.append(ph);
    }

    strikeNext = false;
    textEl.replaceChildren(frag);
    layout();
  }

  let renderQueued = false;
  function queueRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => {
      renderQueued = false;
      render();
    });
  }

  function viewportHeight() {
    return window.visualViewport ? window.visualViewport.height : window.innerHeight;
  }

  function typingLineY() {
    return Math.round(viewportHeight() * LINE_RATIO);
  }

  // Move the paper so the caret's line rests on the typing line.
  function layout() {
    if (!caretEl) return;
    const lineY = typingLineY();
    const caretBottom = caretEl.offsetTop + caretEl.offsetHeight;
    const base = lineY - caretBottom - 6;

    const textBottom = textEl.offsetTop + textEl.offsetHeight;
    const maxOff = Math.max(0, 90 - base);                   // paper top can come down to here
    const minOff = Math.min(0, lineY - 10 - base - textBottom); // ...and text end can rise to the line
    readOffset = Math.min(maxOff, Math.max(minOff, readOffset));

    paper.style.transform = `translate3d(-50%, ${Math.round(base + readOffset)}px, 0)`;
  }

  /* ---------------- Lamp (cursor + light) ---------------- */

  const lamp = { x: 0, y: 0, h: 24, ready: false, flicker: 1 };

  function tick() {
    if (caretEl && caretEl.isConnected) {
      const r = caretEl.getBoundingClientRect();
      const tx = r.left;
      const ty = r.top;
      if (!lamp.ready) {
        lamp.x = tx;
        lamp.y = ty;
        lamp.ready = true;
      }
      lamp.x += (tx - lamp.x) * 0.32;
      lamp.y += (ty - lamp.y) * 0.32;
      lamp.h = r.height || lamp.h;

      lampEl.style.transform = `translate3d(${lamp.x}px, ${lamp.y}px, 0)`;
      lampEl.style.setProperty('--h', `${lamp.h}px`);
      input.style.transform = `translate3d(${lamp.x}px, ${lamp.y}px, 0)`;

      // a warm bulb never burns perfectly steady
      lamp.flicker += (0.96 + Math.random() * 0.06 - lamp.flicker) * 0.08;

      const vw = window.innerWidth;
      const vh = viewportHeight();
      const reading = readOffset !== 0;
      const pr = paper.getBoundingClientRect();
      const paperCx = pr.left + pr.width / 2;
      const radius = Math.max(220, Math.min(400, vw * 0.36)) * lamp.flicker * (reading ? 1.35 : 1);

      // the pool of light sits a little above the caret, pulled toward the page centre,
      // so the lines you just wrote are lit too
      const cx = reading ? paperCx : lamp.x * 0.7 + paperCx * 0.3;
      const cy = reading ? vh * 0.45 : lamp.y - radius * 0.22;

      lightEl.style.setProperty('--x', `${cx.toFixed(1)}px`);
      lightEl.style.setProperty('--y', `${cy.toFixed(1)}px`);
      lightEl.style.setProperty('--r', `${radius.toFixed(1)}px`);
    }
    requestAnimationFrame(tick);
  }

  // width of one typed character in the current font size
  function measureCh() {
    const probe = document.createElement('span');
    probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre';
    probe.textContent = 'mmmmmmmmmm';
    paper.append(probe);
    const w = probe.getBoundingClientRect().width / 10;
    probe.remove();
    return w || 10;
  }

  function ringBellIfNearMargin() {
    if (!caretEl) return;
    const textRect = textEl.getBoundingClientRect();
    const caretRect = caretEl.getBoundingClientRect();
    const chWidth = measureCh();
    const remaining = (textRect.right - caretRect.left) / chWidth;
    const lineTop = caretEl.offsetTop;
    if (remaining <= BELL_CHARS && bellLineTop !== lineTop) {
      bellLineTop = lineTop;
      Sound.bell();
    }
  }

  /* ---------------- Typing ---------------- */

  function markTyping() {
    body.classList.add('typing');
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => body.classList.remove('typing'), 900);
  }

  input.addEventListener('keydown', (e) => {
    Sound.init(); // audio needs a user gesture to start

    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 's') {
      e.preventDefault();
      saveNow(true);
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      openDrawer();
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      // execCommand keeps native undo working; fall back if unsupported
      if (!document.execCommand || !document.execCommand('insertText', false, '    ')) {
        input.setRangeText('    ', input.selectionStart, input.selectionEnd, 'end');
        input.dispatchEvent(new InputEvent('input', { inputType: 'insertText', data: '    ' }));
      }
      return;
    }
    queueRender(); // arrows, home/end, etc.
  });

  input.addEventListener('input', (e) => {
    const type = e.inputType || '';
    readOffset = 0;
    markTyping();

    if (type === 'insertLineBreak' || type === 'insertParagraph') {
      Sound.carriageReturn();
      bellLineTop = null;
    } else if (type.startsWith('delete')) {
      Sound.backspace();
    } else if (type === 'insertText' || type === 'insertCompositionText' || type === 'insertReplacementText') {
      if (e.data === ' ') Sound.space();
      else Sound.key();
      strikeNext = e.data && e.data.length === 1;
    } else if (type === 'insertFromPaste' || type === 'insertFromDrop') {
      Sound.carriageReturn();
    } else {
      Sound.key();
    }

    render();
    if (type.startsWith('insertText')) ringBellIfNearMargin();
    scheduleSave();
  });

  input.addEventListener('keyup', queueRender);
  input.addEventListener('select', queueRender);
  document.addEventListener('selectionchange', () => {
    if (document.activeElement === input) queueRender();
  });

  input.addEventListener('focus', () => body.classList.remove('unfocused'));
  input.addEventListener('blur', () => body.classList.add('unfocused'));

  /* ---------------- Mouse / touch on the page ---------------- */

  // Find the text index under a screen point.
  function indexFromPoint(x, y) {
    let node = null;
    let offset = 0;
    if (document.caretPositionFromPoint) {
      const p = document.caretPositionFromPoint(x, y);
      if (p) { node = p.offsetNode; offset = p.offset; }
    } else if (document.caretRangeFromPoint) {
      const r = document.caretRangeFromPoint(x, y);
      if (r) { node = r.startContainer; offset = r.startOffset; }
    }
    if (!node || !textEl.contains(node)) return null;

    // If we landed on an element, turn it into "the text node at child #offset".
    if (node.nodeType !== Node.TEXT_NODE) {
      const child = node.childNodes[offset];
      if (!child) return input.value.length;
      node = child;
      offset = 0;
    }

    let idx = 0;
    const walker = document.createTreeWalker(textEl, NodeFilter.SHOW_TEXT);
    for (let t = walker.nextNode(); t; t = walker.nextNode()) {
      const skip = t.parentNode === caretEl || t.parentNode.classList?.contains('placeholder');
      if (t === node || t.contains?.(node)) return idx + (skip ? 0 : offset);
      if (!skip) idx += t.length;
    }
    return idx;
  }

  function focusAt(x, y) {
    const idx = indexFromPoint(x, y);
    input.focus({ preventScroll: true });
    if (idx != null) {
      input.setSelectionRange(idx, idx);
      queueRender();
    }
  }

  stage.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault(); // keep focus in the textarea
    Sound.init();
    focusAt(e.clientX, e.clientY);
  });

  // scroll back through what you've written
  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    paper.classList.add('no-anim');
    readOffset -= e.deltaY;
    layout();
    clearTimeout(stage._wheelT);
    stage._wheelT = setTimeout(() => paper.classList.remove('no-anim'), 120);
  }, { passive: false });

  let touch = null;
  stage.addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    touch = { y: t.clientY, x: t.clientX, moved: false };
    paper.classList.add('no-anim');
  }, { passive: true });

  stage.addEventListener('touchmove', (e) => {
    if (!touch) return;
    const t = e.touches[0];
    const dy = t.clientY - touch.y;
    if (Math.abs(dy) > 4) touch.moved = true;
    touch.y = t.clientY;
    readOffset += dy;
    layout();
  }, { passive: true });

  stage.addEventListener('touchend', (e) => {
    paper.classList.remove('no-anim');
    if (touch && !touch.moved) {
      e.preventDefault();
      Sound.init();
      focusAt(touch.x, touch.y);
    }
    touch = null;
  });

  /* ---------------- Documents ---------------- */

  function updateMeta() {
    const text = input.value;
    ui.title.textContent = Store.titleOf(text);
    const w = Store.wordsOf(text);
    ui.words.textContent = `${w} word${w === 1 ? '' : 's'}`;
    document.title = text.trim() ? `${Store.titleOf(text)} — Styled Writer` : 'Styled Writer';
  }

  function persist() {
    doc.text = input.value;
    doc.caret = input.selectionEnd;
    const i = docs.findIndex((d) => d.id === doc.id);

    if (!doc.text.trim()) {
      // blank sheets aren't worth keeping
      if (i !== -1) docs.splice(i, 1);
    } else {
      doc.updated = Date.now();
      if (i === -1) docs.push(doc);
      else docs[i] = doc;
    }
    const ok = Store.saveDocs(docs);
    Store.setCurrentId(doc.id);
    return ok;
  }

  function fmtTime(ts) {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function scheduleSave() {
    updateMeta();
    ui.saveState.textContent = 'typing…';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveNow(false), 700);
  }

  function saveNow(announce) {
    clearTimeout(saveTimer);
    const ok = persist();
    if (!ok) {
      ui.saveState.textContent = 'not saved!';
      toast('Could not save — browser storage is full or blocked.');
      return;
    }
    ui.saveState.textContent = doc.text.trim() ? `saved ${fmtTime(doc.updated)}` : '—';
    if (announce) toast(doc.text.trim() ? 'Saved to this browser.' : 'Nothing to save on a blank sheet.');
    if (ui.drawer.classList.contains('open')) renderList();
  }

  function openDoc(d, { sound = true } = {}) {
    if (doc) persist();
    doc = d;
    input.value = d.text || '';
    const c = Math.min(d.caret ?? input.value.length, input.value.length);
    input.setSelectionRange(c, c);
    readOffset = 0;
    bellLineTop = null;
    Store.setCurrentId(d.id);
    updateMeta();
    ui.saveState.textContent = d.text?.trim() ? `saved ${fmtTime(d.updated)}` : '—';
    render();
    if (sound) Sound.feed();
    input.focus({ preventScroll: true });
  }

  function newDoc() {
    Sound.init();
    openDoc(Store.newDoc());
    toast('Fresh sheet fed.');
  }

  /* ---------------- Drawer ---------------- */

  function renderList() {
    const sorted = [...docs].sort((a, b) => b.updated - a.updated);
    ui.list.replaceChildren();
    ui.empty.hidden = sorted.length > 0;

    for (const d of sorted) {
      const li = document.createElement('li');
      if (d.id === doc.id) li.classList.add('current');
      li.tabIndex = 0;

      const info = document.createElement('div');
      info.className = 'info';
      const title = document.createElement('span');
      title.className = 'title';
      title.textContent = Store.titleOf(d.text);
      const sub = document.createElement('span');
      sub.className = 'sub';
      const date = new Date(d.updated).toLocaleString([], {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
      });
      const w = Store.wordsOf(d.text);
      sub.textContent = `${date} · ${w} word${w === 1 ? '' : 's'}`;
      info.append(title, sub);

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'del';
      del.textContent = 'delete';
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!del.classList.contains('confirm')) {
          del.classList.add('confirm');
          del.textContent = 'sure?';
          setTimeout(() => {
            del.classList.remove('confirm');
            del.textContent = 'delete';
          }, 2500);
          return;
        }
        deleteDoc(d.id);
      });

      const open = () => {
        if (d.id !== doc.id) openDoc(d);
        closeDrawer();
      };
      li.addEventListener('click', open);
      li.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && e.target === li) open();
      });

      li.append(info, del);
      ui.list.append(li);
    }
  }

  function deleteDoc(id) {
    docs = docs.filter((d) => d.id !== id);
    Store.saveDocs(docs);
    if (doc.id === id) {
      doc = null; // don't persist the deleted one on switch
      openDoc(Store.newDoc(), { sound: false });
    }
    renderList();
    toast('Page deleted.');
  }

  function openDrawer() {
    saveNow(false);
    renderList();
    ui.scrim.hidden = false;
    ui.drawer.classList.add('open');
    ui.drawer.setAttribute('aria-hidden', 'false');
    (ui.list.querySelector('li') || ui.closeDrawer).focus();
  }

  function closeDrawer() {
    ui.scrim.hidden = true;
    ui.drawer.classList.remove('open');
    ui.drawer.setAttribute('aria-hidden', 'true');
    input.focus({ preventScroll: true });
  }

  ui.drawer.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeDrawer();
    }
  });
  ui.scrim.addEventListener('click', closeDrawer);
  ui.closeDrawer.addEventListener('click', closeDrawer);

  /* ---------------- Toolbar ---------------- */

  function applyPrefs() {
    Sound.enabled = prefs.sound;
    ui.sound.setAttribute('aria-pressed', String(prefs.sound));
    body.classList.toggle('lamp-on', prefs.lamp);
    ui.lamp.setAttribute('aria-pressed', String(prefs.lamp));
  }

  // toolbar buttons shouldn't steal focus from the typewriter
  for (const btn of [ui.new, ui.save, ui.sound, ui.lamp]) {
    btn.addEventListener('mousedown', (e) => e.preventDefault());
  }

  ui.pages.addEventListener('click', openDrawer);
  ui.new.addEventListener('click', newDoc);
  ui.save.addEventListener('click', () => saveNow(true));
  ui.sound.addEventListener('click', () => {
    prefs.sound = !prefs.sound;
    Store.savePrefs(prefs);
    applyPrefs();
    if (prefs.sound) { Sound.init(); Sound.bell(); }
  });
  ui.lamp.addEventListener('click', () => {
    prefs.lamp = !prefs.lamp;
    Store.savePrefs(prefs);
    applyPrefs();
  });

  // bring the toolbar back when the mouse moves
  let hoverTimer = null;
  window.addEventListener('mousemove', () => {
    body.classList.add('ui-hover');
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => body.classList.remove('ui-hover'), 1500);
  });

  let toastTimer = null;
  function toast(msg) {
    ui.toast.textContent = msg;
    ui.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => ui.toast.classList.remove('show'), 1800);
  }

  /* ---------------- Boot ---------------- */

  window.addEventListener('resize', layout);
  window.visualViewport?.addEventListener('resize', layout);
  window.addEventListener('beforeunload', () => doc && persist());
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && doc) persist();
  });

  applyPrefs();
  const startId = Store.currentId();
  const start = docs.find((d) => d.id === startId) || Store.newDoc();
  openDoc(start, { sound: false });

  // re-measure once the typewriter font has arrived
  if (document.fonts?.ready) document.fonts.ready.then(() => { render(); });

  requestAnimationFrame(tick);
})();
