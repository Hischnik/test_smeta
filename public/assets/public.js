const printButton = document.getElementById('print-btn');
if (printButton) {
  printButton.addEventListener('click', () => window.print());
}

if (new URLSearchParams(location.search).get('print') === '1') {
  window.addEventListener('load', () => window.print());
}
