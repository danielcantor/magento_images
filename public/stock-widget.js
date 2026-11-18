/* Contador "Quedan X unidades" para la tienda.
 * Uso:
 *   <div data-stock-urgency data-sku="TU-SKU"></div>
 *   <script src="https://TU-DASHBOARD/stock-widget.js" async></script>
 * Si algo falla o no quedan unidades, no muestra nada.
 */
(function () {
  var script = document.currentScript;
  var origin = script && script.src ? new URL(script.src).origin : "";

  function render(el, data) {
    var n = data.quedan;
    var total = Math.max(data.inicial || n, n);
    var pct = total > 0 ? Math.round(((total - n) / total) * 100) : 0;
    var parts = String(data.texto || "¡Solo quedan {n} unidades!").split("{n}");

    el.innerHTML = "";
    el.style.cssText = "margin:16px 0;font-family:inherit";
    var p = document.createElement("p");
    p.style.cssText = "margin:0 0 6px;font-weight:600;color:#c0392b";
    p.appendChild(document.createTextNode("🔥 " + parts[0]));
    var b = document.createElement("b");
    b.textContent = String(n);
    p.appendChild(b);
    p.appendChild(document.createTextNode(parts.slice(1).join(String(n))));

    var track = document.createElement("div");
    track.style.cssText = "background:#eee;border-radius:6px;height:10px;overflow:hidden";
    var bar = document.createElement("div");
    bar.style.cssText = "height:100%;width:0;background:#e74c3c;transition:width .8s";
    track.appendChild(bar);

    el.appendChild(p);
    el.appendChild(track);
    setTimeout(function () {
      bar.style.width = Math.max(pct, 8) + "%";
    }, 100);
  }

  function load(el) {
    var sku = el.getAttribute("data-sku");
    var base = el.getAttribute("data-endpoint") || origin;
    if (!sku || !base) return;
    el.style.display = "none";
    fetch(base + "/api/public/stock/" + encodeURIComponent(sku))
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(function (data) {
        if (!data || !data.visible || !(data.quedan > 0)) return;
        render(el, data);
        el.style.display = "";
      })
      .catch(function () {});
  }

  function init() {
    var els = document.querySelectorAll("[data-stock-urgency]");
    for (var i = 0; i < els.length; i++) load(els[i]);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
