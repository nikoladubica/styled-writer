/* Styled Writer — localStorage persistence.
   Everything lives in this browser only. */
window.Store = (() => {
  const DOCS_KEY = 'styledWriter.docs';
  const CURRENT_KEY = 'styledWriter.current';
  const PREFS_KEY = 'styledWriter.prefs';

  function read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  function write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (err) {
      console.warn('[Styled Writer] could not save:', err);
      return false;
    }
  }

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  return {
    newDoc() {
      const now = Date.now();
      return { id: uid(), text: '', caret: 0, created: now, updated: now };
    },
    allDocs() {
      const docs = read(DOCS_KEY, []);
      return Array.isArray(docs) ? docs : [];
    },
    saveDocs: (docs) => write(DOCS_KEY, docs),
    currentId: () => read(CURRENT_KEY, null),
    setCurrentId: (id) => write(CURRENT_KEY, id),
    prefs: () => ({ sound: true, lamp: true, ...read(PREFS_KEY, {}) }),
    savePrefs: (prefs) => write(PREFS_KEY, prefs),

    titleOf(text) {
      const line = (text || '').split('\n').find((l) => l.trim()) || '';
      const t = line.trim();
      return t ? (t.length > 48 ? t.slice(0, 47) + '…' : t) : 'Untitled';
    },
    wordsOf(text) {
      const m = (text || '').trim().match(/\S+/g);
      return m ? m.length : 0;
    },
  };
})();
