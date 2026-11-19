/* Contador "Quedan X unidades" para la tienda.
 *
 * Modo global (recomendado): se pega UNA vez en toda la tienda. En cada ficha de producto
 * detecta el SKU y, si tiene un contador activo en el dashboard, lo muestra.
 *   <script src="https://TU-DASHBOARD/stock-widget.js" async></script>
 *   Opcional en el <script>:
 *     data-sku-selector="..."   dónde leer el SKU (atributo content o texto)
 *     data-insert-after="..."   después de qué elemento se coloca el contador
 *
 * Modo manual (un producto): <div data-stock-urgency data-sku="TU-SKU"></div> + el mismo <script>.
 * Si algo falla o no quedan unidades, no muestra nada.
 */
(function () {
  // Si el script está dos veces en la página (global + manual), solo actúa una.
  if (window.__stockUrgency) return;
  window.__stockUrgency = true;

  // currentScript puede ser null si lo inyecta Google Tag Manager: se busca por la URL.
  var script = document.currentScript || document.querySelector('script[src*="stock-widget.js"]');
  var origin = script && script.src ? new URL(script.src).origin : "";

  function render(el, data) {
    var n = data.quedan;
    var total = Math.max(data.inicial || n, n);
    // La barra muestra lo vendido respecto de las unidades iniciales: arranca al 50% y llega al 100%
    // cuando se vende todo (50% + la mitad del porcentaje vendido).
    var sold = total > 0 ? Math.min(1, Math.max(0, (total - n) / total)) : 0;
    var pct = 50 + sold * 50;
    var parts = String(data.texto || "¡Solo quedan {n} unidades!").split("{n}");

    el.innerHTML = "";
    el.style.cssText = "margin:40px 0;font-family:inherit";
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
    if (data.cupon) el.appendChild(coupon(data.cupon, data.cuponTexto));
    setTimeout(function () {
      bar.style.width = pct + "%";
    }, 100);
  }

  function copy(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
    return new Promise(function (resolve, reject) {
      var t = document.createElement("textarea");
      t.value = text;
      t.setAttribute("readonly", "");
      t.style.cssText = "position:fixed;top:0;left:0;opacity:0";
      document.body.appendChild(t);
      t.select();
      try {
        document.execCommand("copy") ? resolve() : reject();
      } catch (e) {
        reject(e);
      }
      document.body.removeChild(t);
    });
  }

  // Cupón: texto, código en un recuadro punteado y botón «Copiar».
  function coupon(code, label) {
    var row = document.createElement("div");
    row.style.cssText = "display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:12px;font-size:14px";
    var t = document.createElement("span");
    t.textContent = label || "Sumá un descuento extra con el cupón";
    var box = document.createElement("span");
    box.textContent = code;
    box.style.cssText = "font-weight:700;letter-spacing:.06em;border:1.5px dashed #c0392b;color:#c0392b;border-radius:6px;padding:6px 10px;user-select:all";
    var btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "Copiar";
    btn.setAttribute("aria-label", "Copiar el cupón " + code);
    btn.style.cssText = "min-height:36px;padding:6px 14px;border-radius:6px;border:0;background:#c0392b;color:#fff;font:inherit;font-weight:600;cursor:pointer";
    var live = document.createElement("span");
    live.setAttribute("aria-live", "polite");
    live.style.cssText = "position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)";
    btn.addEventListener("click", function () {
      copy(code).then(
        function () {
          btn.textContent = "¡Copiado!";
          live.textContent = "Cupón " + code + " copiado";
          setTimeout(function () {
            btn.textContent = "Copiar";
          }, 2000);
        },
        function () {
          // Sin portapapeles: se selecciona el código para copiarlo a mano.
          var r = document.createRange();
          r.selectNodeContents(box);
          var sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(r);
        },
      );
    });
    // Código y botón siempre juntos: si no entran al lado del texto, bajan los dos.
    var pair = document.createElement("span");
    pair.style.cssText = "display:inline-flex;align-items:center;gap:8px;white-space:nowrap";
    pair.appendChild(box);
    pair.appendChild(btn);
    row.appendChild(t);
    row.appendChild(pair);
    row.appendChild(live);
    return row;
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

  function attr(name) {
    return script ? script.getAttribute(name) : null;
  }

  function readSku() {
    var selectors = [attr("data-sku-selector"), '[itemprop="sku"]', ".product.attribute.sku .value", "[data-product-sku]"];
    for (var i = 0; i < selectors.length; i++) {
      if (!selectors[i]) continue;
      var el = document.querySelector(selectors[i]);
      if (!el) continue;
      var v = el.getAttribute("content") || el.getAttribute("data-product-sku") || el.textContent;
      if (v && v.trim()) return v.trim();
    }
    return null;
  }

  function placeholder() {
    var el = document.createElement("div");
    el.setAttribute("data-stock-urgency", "");
    var after = attr("data-insert-after");
    var anchor = after && document.querySelector(after);
    if (anchor) {
      anchor.parentNode.insertBefore(el, anchor.nextSibling);
      return el;
    }
    // Tema de SommierCenter: debajo de «Ver más medios de pago».
    var payment = document.querySelector(".product-info-main .pdp-actions-payment");
    if (payment) {
      payment.parentNode.insertBefore(el, payment.nextSibling);
      return el;
    }
    var price = document.querySelector(".product-info-main .product-info-price");
    if (price) {
      price.parentNode.insertBefore(el, price.nextSibling);
      return el;
    }
    var form = document.querySelector(".product-add-form");
    if (form) {
      form.parentNode.insertBefore(el, form);
      return el;
    }
    var main = document.querySelector(".product-info-main");
    if (main) {
      main.appendChild(el);
      return el;
    }
    return null;
  }

  function auto() {
    // Solo en fichas de producto (Magento pone esta clase en <body>), salvo que se indique dónde leer el SKU.
    if (!attr("data-sku-selector") && !document.body.classList.contains("catalog-product-view")) return;
    var sku = readSku();
    if (!sku || !origin) return;
    fetch(origin + "/api/public/stock-active")
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(function (data) {
        var skus = (data && data.skus) || [];
        var want = sku.toLowerCase();
        for (var i = 0; i < skus.length; i++) {
          if (String(skus[i]).toLowerCase() === want) {
            var el = placeholder();
            if (el) {
              el.setAttribute("data-sku", skus[i]);
              load(el);
            }
            return;
          }
        }
      })
      .catch(function () {});
  }

  function init() {
    var els = document.querySelectorAll("[data-stock-urgency]");
    if (els.length) {
      for (var i = 0; i < els.length; i++) load(els[i]);
    } else {
      auto();
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
