// assets/font-swap.js
// Applies the non-blocking Google Fonts <link media="print"> trick without an
// inline onload="" attribute, so script-src can drop 'unsafe-inline'.
(function () {
  var links = document.querySelectorAll('link[rel="stylesheet"][media="print"]');
  for (var i = 0; i < links.length; i++) {
    (function (link) {
      if (link.sheet) {
        link.media = 'all';
        return;
      }
      link.addEventListener('load', function () {
        link.media = 'all';
      });
    })(links[i]);
  }
})();
