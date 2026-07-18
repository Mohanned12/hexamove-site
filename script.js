"use strict";

document.documentElement.classList.add("js");

document.addEventListener("DOMContentLoaded", () => {
  const apiBase = window.location.protocol === "file:" ? "http://localhost:3000" : "";
  const form = document.getElementById("reservation-form");
  const submitButton = document.getElementById("submit-btn");
  const formMessage = document.getElementById("form-message");
  const notes = document.getElementById("notes");
  const notesCount = document.getElementById("notes-count");
  const dateInput = document.getElementById("date");
  const pickupInput = document.getElementById("pickup");
  const destinationInput = document.getElementById("destination");
  const distanceInput = document.getElementById("distanceKm");
  const durationInput = document.getElementById("durationMinutes");
  const routeTokenInput = document.getElementById("routeToken");
  const distancePreview = document.getElementById("distance-preview");
  const distanceValue = document.getElementById("distance-value");
  const menuToggle = document.querySelector(".menu-toggle");
  const navigation = document.querySelector(".nav-links");
  const DRAFT_KEY = "supervanQuoteDraft";
  const selectedAddresses = { pickup: null, destination: null };
  let routeRequestController = null;

  const localDateString = (date = new Date()) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  if (dateInput) dateInput.min = localDateString();
  const year = document.getElementById("current-year");
  if (year) year.textContent = String(new Date().getFullYear());

  if (menuToggle && navigation) {
    const closeMenu = () => {
      menuToggle.setAttribute("aria-expanded", "false");
      navigation.classList.remove("is-open");
      document.body.classList.remove("menu-open");
    };

    menuToggle.addEventListener("click", () => {
      const willOpen = menuToggle.getAttribute("aria-expanded") !== "true";
      menuToggle.setAttribute("aria-expanded", String(willOpen));
      navigation.classList.toggle("is-open", willOpen);
      document.body.classList.toggle("menu-open", willOpen);
    });

    navigation.querySelectorAll("a").forEach((link) => link.addEventListener("click", closeMenu));
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeMenu();
    });
  }

  const revealElements = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    const observer = new IntersectionObserver((entries, currentObserver) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          currentObserver.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -40px" });
    revealElements.forEach((element) => observer.observe(element));
  } else {
    revealElements.forEach((element) => element.classList.add("is-visible"));
  }

  document.querySelectorAll("[data-service]").forEach((link) => {
    link.addEventListener("click", () => {
      const service = link.getAttribute("data-service");
      const select = document.getElementById("serviceType");
      if (select && service) select.value = service;
    });
  });

  const updateNotesCount = () => {
    if (notes && notesCount) notesCount.textContent = String(notes.value.length);
  };
  if (notes) notes.addEventListener("input", updateNotesCount);

  const setText = (selector, value) => {
    if (!value) return;
    document.querySelectorAll(selector).forEach((element) => { element.textContent = value; });
  };

  const applyBusinessConfig = (config) => {
    const name = config.businessName || "Hexamove";
    document.querySelectorAll("[data-business-name]").forEach((element) => {
      const cleanName = name.trim();
      const parts = cleanName.split(/\s+/);
      let firstPart = "";
      let accentPart = "";

      if (/van$/i.test(cleanName) && cleanName.length > 3) {
        firstPart = cleanName.slice(0, -3);
        accentPart = cleanName.slice(-3);
      } else if (parts.length > 1) {
        accentPart = parts.pop();
        firstPart = `${parts.join(" ")} `;
      } else {
        const midpoint = Math.max(1, Math.ceil(cleanName.length / 2));
        firstPart = cleanName.slice(0, midpoint);
        accentPart = cleanName.slice(midpoint);
      }

      element.textContent = firstPart;
      const accent = document.createElement("span");
      accent.textContent = accentPart;
      element.appendChild(accent);
    });
    setText("[data-business-name-text]", name);
    setText("[data-business-area]", config.serviceArea);
    setText("[data-business-hours]", config.businessHours);

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
    } else {
      document.querySelectorAll("[data-business-phone], [data-business-phone-short], [data-business-phone-href]").forEach((link) => {
        link.removeAttribute("href");
        link.setAttribute("aria-disabled", "true");
      });
    }

    if (config.publicEmail) {
      document.querySelectorAll("[data-business-email]").forEach((link) => {
        link.textContent = config.publicEmail;
        link.href = `mailto:${config.publicEmail}`;
      });
    } else {
      document.querySelectorAll("[data-business-email]").forEach((link) => {
        link.textContent = "Contact par formulaire";
        link.removeAttribute("href");
      });
    }

    if (config.whatsappUrl) {
      document.querySelectorAll(".whatsapp-link").forEach((link) => {
        link.href = config.whatsappUrl;
        link.classList.remove("is-hidden");
      });
    }
  };

  fetch(`${apiBase}/api/config`, { headers: { Accept: "application/json" } })
    .then((response) => response.ok ? response.json() : Promise.reject(new Error("Config unavailable")))
    .then(applyBusinessConfig)
    .catch(() => {});

  if (!form || !submitButton || !formMessage || !pickupInput || !destinationInput || !distanceInput || !durationInput || !routeTokenInput) return;

  const setDistanceState = (state, text) => {
    if (distancePreview) distancePreview.dataset.state = state;
    if (distanceValue) distanceValue.textContent = text;
  };

  const clearCalculatedRoute = () => {
    distanceInput.value = "";
    durationInput.value = "";
    routeTokenInput.value = "";
    setDistanceState("idle", "Choisissez les deux adresses");
  };

  const showMessage = (type, message) => {
    formMessage.textContent = message;
    formMessage.className = `form-message ${type}`;
    formMessage.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  const hideSuggestions = (input, list) => {
    list.hidden = true;
    list.innerHTML = "";
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
  };

  const calculateRoute = async () => {
    if (!selectedAddresses.pickup || !selectedAddresses.destination) return false;

    if (routeRequestController) routeRequestController.abort();
    routeRequestController = new AbortController();
    const timeout = window.setTimeout(() => routeRequestController.abort(), 15000);
    setDistanceState("loading", "Calcul de la distance…");

    try {
      const response = await fetch(`${apiBase}/api/route-distance`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          pickupToken: selectedAddresses.pickup.addressToken,
          destinationToken: selectedAddresses.destination.addressToken
        }),
        signal: routeRequestController.signal
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message || "La distance n’a pas pu être calculée.");

      pickupInput.value = result.pickup;
      destinationInput.value = result.destination;
      distanceInput.value = String(result.distanceKm);
      durationInput.value = String(Math.max(1, Math.round(result.durationMinutes)));
      routeTokenInput.value = result.routeToken;
      pickupInput.dataset.verified = "true";
      destinationInput.dataset.verified = "true";
      setDistanceState("success", `${result.distanceKm.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} km · environ ${Math.max(1, Math.round(result.durationMinutes))} min`);
      return true;
    } catch (error) {
      clearCalculatedRoute();
      setDistanceState("error", error.name === "AbortError" ? "Calcul trop long, réessayez" : (error.message || "Distance indisponible"));
      return false;
    } finally {
      window.clearTimeout(timeout);
      routeRequestController = null;
    }
  };

  const setupAddressAutocomplete = (input, type) => {
    const list = document.getElementById(`${input.id}-suggestions`);
    if (!list) return;
    let debounceTimer = null;
    let searchController = null;
    let activeIndex = -1;
    let renderedSuggestions = [];

    const selectSuggestion = async (suggestion) => {
      selectedAddresses[type] = suggestion;
      input.value = suggestion.label;
      input.dataset.verified = "true";
      hideSuggestions(input, list);
      clearCalculatedRoute();
      if (selectedAddresses.pickup && selectedAddresses.destination) await calculateRoute();
    };

    const renderSuggestions = (suggestions) => {
      renderedSuggestions = suggestions;
      activeIndex = -1;
      list.innerHTML = "";
      if (!suggestions.length) {
        list.innerHTML = '<div class="address-empty">Aucune adresse européenne trouvée.</div>';
        list.hidden = false;
        input.setAttribute("aria-expanded", "true");
        return;
      }

      suggestions.forEach((suggestion, index) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "address-suggestion";
        button.id = `${input.id}-suggestion-${index}`;
        button.setAttribute("role", "option");
        const title = document.createElement("strong");
        title.textContent = suggestion.label;
        const meta = document.createElement("small");
        meta.textContent = [suggestion.postcode, suggestion.city, suggestion.country].filter(Boolean).join(" · ");
        button.append(title, meta);
        button.addEventListener("mousedown", (event) => event.preventDefault());
        button.addEventListener("click", () => selectSuggestion(suggestion));
        list.appendChild(button);
      });
      list.hidden = false;
      input.setAttribute("aria-expanded", "true");
    };

    const runSearch = async () => {
      const query = input.value.trim();
      if (query.length < 3) {
        hideSuggestions(input, list);
        return;
      }

      if (searchController) searchController.abort();
      searchController = new AbortController();
      list.innerHTML = '<div class="address-empty">Recherche…</div>';
      list.hidden = false;
      input.setAttribute("aria-expanded", "true");

      try {
        const response = await fetch(`${apiBase}/api/address-search?q=${encodeURIComponent(query)}`, {
          headers: { Accept: "application/json" },
          signal: searchController.signal
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.message || "Recherche indisponible");
        renderSuggestions(Array.isArray(result.suggestions) ? result.suggestions : []);
      } catch (error) {
        if (error.name !== "AbortError") {
          list.innerHTML = '<div class="address-empty">Service d’adresses temporairement indisponible.</div>';
        }
      }
    };

    input.addEventListener("input", () => {
      selectedAddresses[type] = null;
      input.dataset.verified = "false";
      clearCalculatedRoute();
      window.clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(runSearch, 280);
    });

    input.addEventListener("focus", () => {
      if (renderedSuggestions.length && input.value.trim().length >= 3) {
        list.hidden = false;
        input.setAttribute("aria-expanded", "true");
      }
    });

    input.addEventListener("keydown", (event) => {
      const options = Array.from(list.querySelectorAll(".address-suggestion"));
      if (!options.length || list.hidden) return;
      if (event.key === "ArrowDown") {
        event.preventDefault();
        activeIndex = (activeIndex + 1) % options.length;
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        activeIndex = (activeIndex - 1 + options.length) % options.length;
      } else if (event.key === "Enter" && activeIndex >= 0) {
        event.preventDefault();
        options[activeIndex].click();
        return;
      } else if (event.key === "Escape") {
        hideSuggestions(input, list);
        return;
      } else {
        return;
      }
      options.forEach((option, index) => option.classList.toggle("is-active", index === activeIndex));
      input.setAttribute("aria-activedescendant", options[activeIndex].id);
      options[activeIndex].scrollIntoView({ block: "nearest" });
    });

    input.addEventListener("blur", () => {
      window.setTimeout(() => hideSuggestions(input, list), 120);
    });
  };

  setupAddressAutocomplete(pickupInput, "pickup");
  setupAddressAutocomplete(destinationInput, "destination");

  try {
    const savedDraft = JSON.parse(sessionStorage.getItem(DRAFT_KEY) || "null");
    if (savedDraft && typeof savedDraft === "object") {
      for (const [name, value] of Object.entries(savedDraft)) {
        const field = form.elements.namedItem(name);
        if (!field) continue;
        if (field.type === "checkbox") field.checked = value === "yes" || value === true;
        else field.value = String(value ?? "");
      }
      if (savedDraft.routeToken && Number(savedDraft.distanceKm) > 0) {
        pickupInput.dataset.verified = "true";
        destinationInput.dataset.verified = "true";
        setDistanceState("success", `${Number(savedDraft.distanceKm).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} km · environ ${Math.max(1, Math.round(Number(savedDraft.durationMinutes) || 0))} min`);
      }
      updateNotesCount();
    }
  } catch {
    sessionStorage.removeItem(DRAFT_KEY);
  }

  document.addEventListener("click", (event) => {
    document.querySelectorAll(".address-suggestions").forEach((list) => {
      if (!list.parentElement.contains(event.target)) {
        const input = list.parentElement.querySelector("input");
        if (input) hideSuggestions(input, list);
      }
    });
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    formMessage.className = "form-message";
    formMessage.textContent = "";

    if (!form.checkValidity()) {
      form.reportValidity();
      showMessage("error", "Veuillez compléter correctement tous les champs obligatoires.");
      return;
    }

    if (!routeTokenInput.value || !distanceInput.value) {
      if (!selectedAddresses.pickup || !selectedAddresses.destination) {
        showMessage("error", "Sélectionnez les deux adresses européennes dans les propositions affichées.");
        return;
      }
      const routeCalculated = await calculateRoute();
      if (!routeCalculated) {
        showMessage("error", "La distance n’a pas pu être calculée. Vérifiez les deux adresses puis réessayez.");
        return;
      }
    }

    const data = Object.fromEntries(new FormData(form).entries());
    const distance = Number(data.distanceKm);
    if (!Number.isFinite(distance) || distance < 1 || !data.routeToken) {
      showMessage("error", "La distance automatique n’est pas disponible. Sélectionnez à nouveau les deux adresses.");
      return;
    }
    data.distanceKm = distance;

    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(data));
    submitButton.disabled = true;
    const text = submitButton.querySelector(".btn-text");
    if (text) text.textContent = "Chargement des tarifs…";
    window.location.assign("/quote.html");
  });
});
