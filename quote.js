"use strict";

document.addEventListener("DOMContentLoaded", async () => {
  const apiBase = window.location.protocol === "file:" ? "http://localhost:3000" : "";
  const DRAFT_KEY = "supervanQuoteDraft";
  const quoteForm = document.getElementById("quote-form");
  const message = document.getElementById("quote-message");
  const confirmButton = document.getElementById("confirm-quote");
  const shortcutButton = document.getElementById("price-confirm-shortcut");
  const vehicleGrid = document.getElementById("vehicle-grid");
  const handlingGrid = document.getElementById("handling-grid");
  const loadingGrid = document.getElementById("loading-grid");
  let whatsappBaseUrl = "";

  let draft;
  try {
    draft = JSON.parse(sessionStorage.getItem(DRAFT_KEY) || "null");
  } catch {
    draft = null;
  }

  const requiredDraftFields = ["name", "phone", "serviceType", "date", "time", "pickup", "destination", "distanceKm", "routeToken"];
  if (!draft || requiredDraftFields.some((field) => !draft[field])) {
    document.querySelector(".quote-layout").innerHTML = `
      <section class="quote-panel" style="padding:36px;text-align:center;grid-column:1/-1">
        <h2>Votre trajet n’est pas encore renseigné</h2>
        <p>Commencez par compléter le formulaire pour afficher les véhicules et calculer le prix.</p>
        <a class="btn btn-primary" href="/index.html#reservation">Renseigner mon trajet</a>
      </section>`;
    return;
  }

  const distanceKm = Number(draft.distanceKm);
  const durationMinutes = Math.max(1, Math.round(Number(draft.durationMinutes) || distanceKm * 1.4));
  if (!Number.isFinite(distanceKm) || distanceKm < 1) {
    sessionStorage.removeItem(DRAFT_KEY);
    window.location.replace("/index.html#reservation");
    return;
  }

  const euro = new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

  const formatDate = (value) => {
    const date = new Date(`${value}T12:00:00`);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "long", year: "numeric" }).format(date);
  };

  const setText = (id, value) => {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
  };

  setText("summary-pickup", draft.pickup);
  setText("summary-destination", draft.destination);
  setText("summary-date", formatDate(draft.date));
  setText("summary-time", draft.time);
  setText("summary-distance", `${distanceKm.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} km`);
  setText("summary-duration", `Environ ${durationMinutes} min`);
  setText("route-duration-price", `${durationMinutes} min`);
  setText("price-route-summary", `${distanceKm.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} km · environ ${durationMinutes} min`);
  setText("details-name", draft.name);
  setText("details-phone", draft.phone);
  setText("details-email", draft.email || "Non renseigné");
  setText("details-service", draft.serviceType);
  setText("details-notes", [draft.volume ? `Volume : ${draft.volume}` : "", draft.notes || ""].filter(Boolean).join("\n") || "Aucune information complémentaire.");

  const applyBusinessConfig = (config) => {
    const name = (config.businessName || "Hexamove").trim();
    document.querySelectorAll("[data-business-name]").forEach((element) => {
      const suffixMatch = name.match(/^(.*?)(van)$/i);
      element.textContent = suffixMatch ? suffixMatch[1] : name;
      if (suffixMatch) {
        const accent = document.createElement("span");
        accent.textContent = suffixMatch[2];
        element.appendChild(accent);
      }
    });
    if (config.phone) {
      const phoneHref = `tel:${config.phone.replace(/[^+\d]/g, "")}`;
      document.querySelectorAll("[data-business-phone]").forEach((link) => {
        link.textContent = config.phone;
        link.href = phoneHref;
      });
      document.querySelectorAll("[data-business-phone-short]").forEach((link) => {
        link.textContent = "Appeler";
        link.href = phoneHref;
      });
      document.querySelectorAll("[data-business-phone-href]").forEach((link) => {
        link.href = phoneHref;
      });
    }
    if (config.whatsappUrl) {
      whatsappBaseUrl = config.whatsappUrl;
      document.querySelectorAll(".whatsapp-link").forEach((link) => {
        link.href = config.whatsappUrl;
        link.classList.remove("is-hidden");
      });
    }
  };

  const vehicleImageMap = {
    small: "/assets/vehicles-v9/small.png",
    classic: "/assets/vehicles-v9/classic.png",
    large: "/assets/vehicles-v9/large.png",
    jumbo: "/assets/vehicles-v9/jumbo.png"
  };

  let pricing;
  try {
    const [pricingResponse, configResponse] = await Promise.all([
      fetch(`${apiBase}/api/pricing`, { headers: { Accept: "application/json" } }),
      fetch(`${apiBase}/api/config`, { headers: { Accept: "application/json" } })
    ]);
    if (!pricingResponse.ok) throw new Error("Tarifs indisponibles");
    pricing = await pricingResponse.json();
    if (configResponse.ok) applyBusinessConfig(await configResponse.json());
  } catch (error) {
    message.textContent = "Impossible de charger les tarifs. Vérifiez que le serveur est démarré puis actualisez la page.";
    message.className = "form-message error";
    confirmButton.disabled = true;
    shortcutButton.disabled = true;
    return;
  }

  const extraKilometres = Math.max(0, Math.ceil(distanceKm - pricing.includedKm));
  const vehiclePrice = (vehicle) => vehicle.basePrice + extraKilometres * vehicle.extraKmPrice;
  const priceLabel = (amount) => amount === 0 ? "Offert" : `+ ${euro.format(amount)}`;

  const recommendedVehicle = (() => {
    if (draft.volume === "Grand volume") return "jumbo";
    if (draft.volume === "Appartement T2-T3") return "large";
    if (draft.volume === "Petit volume / studio") return "classic";
    return "small";
  })();

  vehicleGrid.innerHTML = pricing.vehicles.map((vehicle) => {
    const isRecommended = vehicle.id === recommendedVehicle;
    const displayedDistance = `${distanceKm.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} km`;
    return `
      <label class="vehicle-option">
        <input type="radio" name="vehicleType" value="${vehicle.id}" ${isRecommended ? "checked" : ""} required>
        <span class="vehicle-card">
          <span class="vehicle-selected" aria-hidden="true">✓</span>
          <div class="vehicle-card-head">
            <div class="vehicle-heading">
              <span class="vehicle-tag ${vehicle.id === "classic" ? "tag-popular" : ""}">${isRecommended ? "Recommandé" : vehicle.tag}</span>
              <h3>${vehicle.name}</h3>
              <p>${vehicle.useCase}</p>
            </div>
            <div class="vehicle-price-box">
              <span class="vehicle-price">${euro.format(vehiclePrice(vehicle))}</span>
              <small>${displayedDistance}</small>
            </div>
          </div>

          <span class="vehicle-stage">
            <img src="${vehicleImageMap[vehicle.id]}" alt="Véhicule ${vehicle.name}" loading="lazy">
          </span>

          <div class="vehicle-route-metrics">
            <div><span>Distance</span><strong>${displayedDistance}</strong></div>
            <div><span>Temps estimé</span><strong>${durationMinutes} min</strong></div>
          </div>

          <div class="vehicle-spec-grid">
            <div><span>Volume</span><strong>${vehicle.capacity}</strong></div>
            <div><span>Charge</span><strong>${vehicle.payload}</strong></div>
            <div><span>Idéal pour</span><strong>${vehicle.useCase}</strong></div>
            <div><span>Tarification</span><strong>${pricing.includedKm} km inclus · ${euro.format(vehicle.extraKmPrice)}/km ensuite</strong></div>
          </div>
        </span>
      </label>`;
  }).join("");

  const handlingIcons = { none: "↗", driver: "◉", twoMovers: "2" };
  handlingGrid.innerHTML = pricing.handling.map((option, index) => `
    <label class="choice-option">
      <input type="radio" name="handlingOption" value="${option.id}" ${index === 0 ? "checked" : ""} required>
      <span class="choice-card">
        <span class="choice-icon">${handlingIcons[option.id] || "+"}</span>
        <strong>${option.name}</strong>
        <small>${option.description}</small>
        <span class="choice-price">${priceLabel(option.price)}</span>
      </span>
    </label>`).join("");

  loadingGrid.innerHTML = pricing.loadingTimes.map((option, index) => `
    <label class="choice-option">
      <input type="radio" name="loadingTime" value="${option.id}" ${index === 0 ? "checked" : ""} required>
      <span class="choice-card">
        <strong>${option.name}</strong>
        <small>${option.description}</small>
        <span class="choice-price">${priceLabel(option.price)}</span>
      </span>
    </label>`).join("");

  const findSelected = (name, list) => {
    const input = quoteForm.querySelector(`input[name="${name}"]:checked`);
    return list.find((item) => item.id === input?.value);
  };

  const updatePrice = () => {
    const vehicle = findSelected("vehicleType", pricing.vehicles);
    const handling = findSelected("handlingOption", pricing.handling);
    const loading = findSelected("loadingTime", pricing.loadingTimes);
    if (!vehicle || !handling || !loading) return;

    const calculatedVehiclePrice = vehiclePrice(vehicle);
    const total = calculatedVehiclePrice + handling.price + loading.price;
    setText("total-price", euro.format(total));
    setText("vehicle-breakdown-label", vehicle.name);
    setText("vehicle-breakdown-price", euro.format(calculatedVehiclePrice));
    setText("handling-breakdown-price", priceLabel(handling.price));
    setText("loading-breakdown-price", priceLabel(loading.price));

    const rule = extraKilometres === 0
      ? `${distanceKm.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} km : prix de départ, jusqu’à ${pricing.includedKm} km inclus.`
      : `${pricing.includedKm} km inclus + ${extraKilometres} km supplémentaire${extraKilometres > 1 ? "s" : ""} × ${euro.format(vehicle.extraKmPrice)}/km.`;
    setText("distance-rule", rule);

    if (whatsappBaseUrl) {
      try {
        const whatsappUrl = new URL(whatsappBaseUrl);
        const whatsappMessage = [
          "Bonjour, je souhaite confirmer une demande de transport.",
          `Trajet : ${draft.pickup} → ${draft.destination}`,
          `Distance : ${distanceKm.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} km`,
          `Véhicule : ${vehicle.name}`,
          `Prix estimé : ${euro.format(total)}`
        ].join("\n");
        whatsappUrl.searchParams.set("text", whatsappMessage);
        document.querySelectorAll(".whatsapp-link").forEach((link) => {
          link.href = whatsappUrl.toString();
        });
      } catch {
        // Keep the generic WhatsApp link returned by the server.
      }
    }
  };

  quoteForm.addEventListener("change", updatePrice);
  updatePrice();

  shortcutButton.addEventListener("click", () => {
    confirmButton.scrollIntoView({ behavior: "smooth", block: "center" });
    confirmButton.focus({ preventScroll: true });
  });

  const setLoading = (loading) => {
    confirmButton.disabled = loading;
    shortcutButton.disabled = loading;
    const buttonText = confirmButton.querySelector(".btn-text");
    const spinner = confirmButton.querySelector(".spinner");
    if (buttonText) buttonText.textContent = loading ? "Enregistrement…" : "Confirmer ma demande";
    if (spinner) spinner.style.display = loading ? "inline-block" : "none";
  };

  quoteForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    message.textContent = "";
    message.className = "form-message";

    if (!quoteForm.checkValidity()) {
      quoteForm.reportValidity();
      message.textContent = "Sélectionnez un véhicule et toutes les options.";
      message.className = "form-message error";
      return;
    }

    const selections = Object.fromEntries(new FormData(quoteForm).entries());
    const payload = { ...draft, ...selections };
    setLoading(true);

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(`${apiBase}/api/reservation`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message || "La demande n’a pas pu être enregistrée.");

      const selectedVehicle = pricing.vehicles.find((item) => item.id === selections.vehicleType);
      const selectedHandling = pricing.handling.find((item) => item.id === selections.handlingOption);
      const selectedLoading = pricing.loadingTimes.find((item) => item.id === selections.loadingTime);
      const finalPrice = Number(result.pricing?.totalPrice);

      setText("success-route", `${draft.pickup} → ${draft.destination}`);
      setText("success-vehicle", selectedVehicle?.name || "Véhicule sélectionné");
      setText("success-options", [selectedHandling?.name, selectedLoading?.name].filter(Boolean).join(" · ") || "Options sélectionnées");
      setText("success-price", Number.isFinite(finalPrice) ? euro.format(finalPrice) : "À confirmer");
      setText("success-text", "Votre demande complète a bien été enregistrée. Notre équipe vous contactera dans un délai d’une heure au numéro indiqué.");

      sessionStorage.removeItem(DRAFT_KEY);
      document.getElementById("success-modal").hidden = false;
      document.body.style.overflow = "hidden";
    } catch (error) {
      message.textContent = error.name === "AbortError"
        ? "Le serveur met trop de temps à répondre. Réessayez dans quelques instants."
        : error.message || "Impossible de contacter le serveur.";
      message.className = "form-message error";
      message.scrollIntoView({ behavior: "smooth", block: "center" });
    } finally {
      window.clearTimeout(timeout);
      setLoading(false);
    }
  });
});
