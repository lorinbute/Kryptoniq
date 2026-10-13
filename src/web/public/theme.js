// FD-THEME: the theme kept on this browser, applied before the first paint (no dark flash before a light page).
// A file, not inline code: the page's CSP allows only the app's own scripts.
(function () {
  try {
    if (window.localStorage.getItem('sentiq:theme') === 'light') {
      document.documentElement.setAttribute('data-theme', 'light');
      var meta = document.querySelector('meta[name="color-scheme"]');
      if (meta) meta.setAttribute('content', 'light');
    }
  } catch (e) {
    // storage refused: the default theme
  }
})();
