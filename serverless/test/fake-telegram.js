// Brauzerda Telegram.WebApp o'rnini bosuvchi (faqat mahalliy sinov uchun).
(function () {
  const user = window.__TG_USER || { id: 5001, username: 'mijoz1', first_name: 'Ali', language_code: 'uz' };
  const WebApp = {
    initData: 'test', initDataUnsafe: { user }, ready() {}, expand() {},
    requestContact(cb) { fetch('/__call/contact', { method: 'POST', body: JSON.stringify({ user }) }).then(() => cb(true)); },
    Serverless: {
      call(name, params, cb) {
        fetch('/__call/' + name, { method: 'POST', body: JSON.stringify({ params, user }) }).then((r) => r.json())
          .then((d) => (d.err ? cb(d.err) : cb(null, d.result)), (e) => cb({ message: String(e), type: 'NETWORK' }));
      },
    },
  };
  Object.defineProperty(window, 'Telegram', { value: { WebApp }, writable: false });
})();
