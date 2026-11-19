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
 *   El modo manual NO muestra el cupón (pensado para la home); para mostrarlo: data-cupon="si".
 *   Analytics (dataLayer):
 *     - ver_contador: una vez por página cuando la mitad del contador entra en pantalla
 *       { item_name, item_id, quedan, coupon (vacío si no se muestra), placement: "ficha" | "manual" }
 *     - copiar_cupon: { item_name, item_id, coupon, copy_method: "boton" | "seleccion_manual", placement }
 *   item_name sale del título de la ficha o de data-name="…" en el <div>.
 *   En la ficha (modo global) el cupón se muestra siempre que el contador tenga uno.
 * Listados (categorías, buscador, carruseles): el mismo script agrega una versión compacta del
 *   contador en cada card de un producto con contador activo, entre el nombre y las estrellas.
 *   Sin cupón. Para desactivarlo: data-cards="off" en el <script>. Analytics: placement "listado".
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

    var card = el.getAttribute("data-variant") === "card";
    el.innerHTML = "";
    el.style.cssText = card ? "margin:6px 0 8px;font-family:inherit" : "margin:40px 0;font-family:inherit";
    var p = document.createElement("p");
    p.style.cssText = card ? "margin:0 0 4px;font-weight:600;font-size:12.5px;line-height:1.3;color:#c0392b" : "margin:0 0 6px;font-weight:600;color:#c0392b";
    p.appendChild(document.createTextNode("🔥 " + parts[0]));
    var b = document.createElement("b");
    b.textContent = String(n);
    p.appendChild(b);
    p.appendChild(document.createTextNode(parts.slice(1).join(String(n))));

    var track = document.createElement("div");
    track.style.cssText = "background:#eee;border-radius:6px;overflow:hidden;height:" + (card ? "6px" : "10px");
    var bar = document.createElement("div");
    bar.style.cssText = "height:100%;width:0;background:#e74c3c;transition:width .8s";
    track.appendChild(bar);

    el.appendChild(p);
    el.appendChild(track);
    var product = { sku: data.sku, name: productName(el), placement: el.getAttribute("data-placement") || "manual" };
    var showCoupon = !!(data.cupon && wantsCoupon(el));
    if (showCoupon) el.appendChild(coupon(data.cupon, data.cuponTexto, product));
    trackView(el, product, n, showCoupon ? data.cupon : "");
    setTimeout(function () {
      bar.style.width = pct + "%";
    }, 100);
  }

  function wantsCoupon(el) {
    var v = (el.getAttribute("data-cupon") || "").toLowerCase();
    return v === "si" || v === "sí" || v === "true" || v === "1";
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

  var ICON_COPY =
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/></svg>';
  var ICON_DONE =
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

  // Cupón: texto y el código en un recuadro punteado que es el botón de copiar (con ícono).
  // Nombre del producto para analytics: data-name del contador, si no el título de la ficha.
  function productName(el) {
    var n = el.getAttribute("data-name");
    if (n) return n.trim();
    var h = document.querySelector(".product-info-main .page-title .base") || document.querySelector(".page-title .base") || document.querySelector("h1");
    return h ? h.textContent.trim() : "";
  }

  function push(obj) {
    try {
      window.dataLayer = window.dataLayer || [];
      window.dataLayer.push(obj);
    } catch (e) {
      /* analytics nunca rompe el contador */
    }
  }

  // Evento para Google Tag Manager / GA4 cada vez que alguien copia el cupón.
  function track(code, product, method) {
    push({
      event: "copiar_cupon",
      item_name: product.name || "",
      item_id: product.sku || "",
      coupon: code,
      copy_method: method,
      placement: product.placement,
    });
  }

  // Una vez por contador y página, cuando al menos la mitad entra en pantalla.
  function trackView(el, product, quedan, code) {
    if (el.__stockViewSent) return;
    var send = function () {
      if (el.__stockViewSent) return;
      el.__stockViewSent = true;
      push({
        event: "ver_contador",
        item_name: product.name || "",
        item_id: product.sku || "",
        quedan: quedan,
        coupon: code,
        placement: product.placement,
      });
    };
    if (!("IntersectionObserver" in window)) return send();
    var io = new IntersectionObserver(
      function (entries) {
        for (var i = 0; i < entries.length; i++) {
          if (entries[i].isIntersecting) {
            io.disconnect();
            send();
            return;
          }
        }
      },
      { threshold: 0.5 },
    );
    io.observe(el);
  }

  function coupon(code, label, product) {
    var row = document.createElement("div");
    row.style.cssText = "display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:12px;font-size:14px";
    var t = document.createElement("span");
    t.textContent = label || "Sumá un descuento extra con el cupón";

    var btn = document.createElement("button");
    btn.type = "button";
    btn.title = "Copiar cupón";
    btn.setAttribute("aria-label", "Copiar el cupón " + code);
    btn.style.cssText =
      "display:inline-flex;align-items:center;gap:10px;min-height:40px;padding:6px 10px 6px 12px;border:1.5px dashed #c0392b;" +
      "border-radius:6px;background:#fff;color:#c0392b;font:inherit;font-weight:700;letter-spacing:.06em;cursor:pointer";
    var txt = document.createElement("span");
    txt.textContent = code;
    var icon = document.createElement("span");
    icon.style.cssText = "display:inline-flex;padding-left:10px;border-left:1px solid rgba(192,57,43,.35)";
    icon.innerHTML = ICON_COPY;
    btn.appendChild(txt);
    btn.appendChild(icon);

    var done = document.createElement("span");
    done.setAttribute("aria-live", "polite");
    done.style.cssText = "font-size:13px;font-weight:600;color:#1e7b34";

    var timer;
    btn.addEventListener("click", function () {
      copy(code).then(
        function () {
          track(code, product, "boton");
          icon.innerHTML = ICON_DONE;
          done.textContent = "¡Copiado!";
          clearTimeout(timer);
          timer = setTimeout(function () {
            icon.innerHTML = ICON_COPY;
            done.textContent = "";
          }, 2000);
        },
        function () {
          track(code, product, "seleccion_manual");
          // Sin portapapeles: se selecciona el código para copiarlo a mano.
          var r = document.createRange();
          r.selectNodeContents(txt);
          var sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(r);
        },
      );
    });

    // Recuadro y aviso juntos: si no entran al lado del texto, bajan los dos.
    var pair = document.createElement("span");
    pair.style.cssText = "display:inline-flex;align-items:center;gap:10px;white-space:nowrap";
    pair.appendChild(btn);
    pair.appendChild(done);
    row.appendChild(t);
    row.appendChild(pair);
    return row;
  }

  var stockCache = {};
  function stockOf(base, sku) {
    var k = base + "|" + sku.toLowerCase();
    if (!stockCache[k]) {
      stockCache[k] = fetch(base + "/api/public/stock/" + encodeURIComponent(sku))
        .then(function (r) {
          return r.ok ? r.json() : null;
        })
        .catch(function () {
          return null;
        });
    }
    return stockCache[k];
  }

  var activePromise;
  function activeList() {
    if (!activePromise) {
      activePromise = fetch(origin + "/api/public/stock-active")
        .then(function (r) {
          return r.ok ? r.json() : null;
        })
        .then(function (d) {
          var items = (d && d.items) || ((d && d.skus) || []).map(function (s) {
            return { sku: s, id: null };
          });
          var bySku = {}, byId = {};
          for (var i = 0; i < items.length; i++) {
            bySku[String(items[i].sku).toLowerCase()] = items[i].sku;
            if (items[i].id) byId[String(items[i].id)] = items[i].sku;
          }
          return { count: items.length, bySku: bySku, byId: byId };
        })
        .catch(function () {
          return { count: 0, bySku: {}, byId: {} };
        });
    }
    return activePromise;
  }

  function load(el) {
    var sku = el.getAttribute("data-sku");
    var base = el.getAttribute("data-endpoint") || origin;
    if (!sku || !base) return;
    el.style.display = "none";
    stockOf(base, sku)
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
    activeList().then(function (active) {
      var match = active.bySku[sku.toLowerCase()];
      if (!match) return;
      var el = placeholder();
      if (!el) return;
      el.setAttribute("data-sku", match);
      el.setAttribute("data-cupon", "si");
      el.setAttribute("data-placement", "ficha");
      load(el);
    });
  }

  // ---------- Cards de listados ----------

  function cardSku(card, active) {
    var s = card.querySelector("[data-product-sku]");
    if (s) {
      var bySku = active.bySku[String(s.getAttribute("data-product-sku")).toLowerCase()];
      if (bySku) return bySku;
    }
    var idEl = card.querySelector("[data-product-id]");
    var id = idEl ? idEl.getAttribute("data-product-id") : null;
    if (!id) {
      var pb = card.querySelector('[data-price-box^="product-id-"]');
      id = pb ? pb.getAttribute("data-price-box").replace("product-id-", "") : null;
    }
    return id ? active.byId[id] || null : null;
  }

  function cards() {
    if (attr("data-cards") === "off" || !origin) return;
    activeList().then(function (active) {
      if (!active.count) return;
      var list = document.querySelectorAll(".product-item:not([data-stock-card])");
      for (var i = 0; i < list.length; i++) {
        var card = list[i];
        card.setAttribute("data-stock-card", "");
        var sku = cardSku(card, active);
        if (!sku) continue;
        var nameEl = card.querySelector(".product-item-name");
        if (!nameEl) continue;
        var el = document.createElement("div");
        el.setAttribute("data-stock-urgency", "");
        el.setAttribute("data-sku", sku);
        el.setAttribute("data-variant", "card");
        el.setAttribute("data-placement", "listado");
        el.setAttribute("data-name", nameEl.textContent.trim());
        // Entre el nombre y las estrellas; sin estrellas, justo debajo del nombre.
        // Tema SommierCenter: .product-rating envuelve la nota («4.7») y las estrellas.
        var stars = card.querySelector(".product-item-details .product-rating") || card.querySelector(".product-reviews-summary");
        var after = nameEl.closest(".name-box") || nameEl;
        if (stars && stars.parentNode) stars.parentNode.insertBefore(el, stars);
        else after.parentNode.insertBefore(el, after.nextSibling);
        load(el);
      }
    });
  }

  // Listados que se cargan después (filtros por AJAX, carruseles, «ver más»).
  function watchCards() {
    if (attr("data-cards") === "off" || !window.MutationObserver) return;
    var t;
    new MutationObserver(function () {
      clearTimeout(t);
      t = setTimeout(cards, 300);
    }).observe(document.body, { childList: true, subtree: true });
  }

  function init() {
    var els = document.querySelectorAll("[data-stock-urgency]");
    if (els.length) {
      for (var i = 0; i < els.length; i++) load(els[i]);
    } else {
      auto();
    }
    cards();
    watchCards();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
