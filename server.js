"use strict";

require("dotenv").config({ quiet: true });

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const cors = require("cors");
const nodemailer = require("nodemailer");

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const ROOT_DIR = __dirname;
const DATA_DIR = path.join(ROOT_DIR, "data");
const RESERVATIONS_FILE = path.join(DATA_DIR, "reservations.jsonl");
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT_MAX = 8;
const rateLimitStore = new Map();
const addressSearchCache = new Map();
const routeCache = new Map();
const TOKEN_SECRET = process.env.QUOTE_SECRET || crypto.randomBytes(32).toString("hex");
const ADDRESS_TOKEN_TTL_MS = 30 * 60 * 1000;
const ROUTE_TOKEN_TTL_MS = 4 * 60 * 60 * 1000;
const EXTERNAL_API_TIMEOUT_MS = Math.min(20000, Math.max(3000, Number(process.env.EXTERNAL_API_TIMEOUT_MS) || 10000));
const GEOCODING_API_URL = process.env.GEOCODING_API_URL || "https://photon.komoot.io/api/";
const ROUTING_API_URL = process.env.ROUTING_API_URL || "https://router.project-osrm.org/route/v1/driving";
const EXTERNAL_API_USER_AGENT = process.env.EXTERNAL_API_USER_AGENT || "Hexamove-Europe-Quote/2.0";
const DEFAULT_RESERVATION_EMAIL = "devis@hexamove.fr";
const EUROPE_COUNTRY_CODES = new Set([
  "AD", "AL", "AM", "AT", "AZ", "BA", "BE", "BG", "BY", "CH", "CY", "CZ", "DE", "DK", "EE", "ES", "FI", "FR", "GB", "GE", "GR", "HR", "HU", "IE", "IS", "IT", "LI", "LT", "LU", "LV", "MC", "MD", "ME", "MK", "MT", "NL", "NO", "PL", "PT", "RO", "RS", "RU", "SE", "SI", "SK", "SM", "TR", "UA", "VA", "XK"
]);

const PRICING = Object.freeze({
  includedKm: 10,
  vehicles: [
    { id: "small", name: "Small", tag: "Petit transport", basePrice: 60, extraKmPrice: 3.5, capacity: "3 m³", payload: "Jusqu’à 1 200 kg", useCase: "Quelques objets" },
    { id: "classic", name: "Classic", tag: "Le plus choisi", basePrice: 75, extraKmPrice: 4, capacity: "8 m³", payload: "Jusqu’à 900 kg", useCase: "Studio / petit volume" },
    { id: "large", name: "Large", tag: "Grand utilitaire", basePrice: 90, extraKmPrice: 4.5, capacity: "12 m³", payload: "Jusqu’à 1 000 kg", useCase: "Appartement T2–T3" },
    { id: "jumbo", name: "Jumbo", tag: "Volume maximal", basePrice: 120, extraKmPrice: 6, capacity: "20 m³", payload: "Jusqu’à 1 000 kg", useCase: "Grand déménagement" }
  ],
  handling: [
    { id: "none", name: "Sans manutention", description: "Transport uniquement : vous chargez et déchargez.", price: 0 },
    { id: "driver", name: "Chauffeur manutentionnaire", description: "Le chauffeur aide pour les objets manipulables par une personne.", price: 25 },
    { id: "twoMovers", name: "2 manutentionnaires", description: "Aide renforcée pour les objets lourds ou encombrants.", price: 50 }
  ],
  loadingTimes: [
    { id: "20", name: "Express · 20 min", description: "Temps cumulé chargement + déchargement", price: 0 },
    { id: "40", name: "Éco · 40 min", description: "Temps cumulé chargement + déchargement", price: 10 },
    { id: "60", name: "Confort · 1 heure", description: "Temps cumulé chargement + déchargement", price: 20 },
    { id: "120", name: "Sérénité · 2 heures", description: "Temps cumulé chargement + déchargement", price: 50 }
  ]
});

const vehicleById = new Map(PRICING.vehicles.map((item) => [item.id, item]));
const handlingById = new Map(PRICING.handling.map((item) => [item.id, item]));
const loadingById = new Map(PRICING.loadingTimes.map((item) => [item.id, item]));

const allowedServices = new Set([
  "Déménagement",
  "Livraison",
  "Meubles et électroménager",
  "Longue distance",
  "Autre"
]);
const allowedTimes = new Set(["Matin (8h-12h)", "Après-midi (12h-17h)", "Flexible"]);

const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.disable("x-powered-by");
app.set("trust proxy", 1);

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self' http://localhost:3000; frame-ancestors 'self'; base-uri 'self'; form-action 'self'");
  next();
});

if (allowedOrigins.length > 0) {
  app.use(cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      callback(new Error("Origin not allowed by CORS"));
    },
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type", "Accept"]
  }));
}

app.use(express.json({ limit: "24kb" }));
app.use(express.urlencoded({ extended: false, limit: "24kb" }));

const sendPublicFile = (filename, contentType) => (req, res) => {
  if (contentType) res.type(contentType);
  res.setHeader("Cache-Control", process.env.NODE_ENV === "production" ? "public, max-age=3600" : "no-store");
  res.sendFile(path.join(ROOT_DIR, filename));
};

app.get(["/", "/index.html"], sendPublicFile("index.html", "text/html; charset=utf-8"));
app.get(["/quote", "/quote.html"], sendPublicFile("quote.html", "text/html; charset=utf-8"));
app.get("/style.css", sendPublicFile("style.css", "text/css; charset=utf-8"));
app.get("/quote.css", sendPublicFile("quote.css", "text/css; charset=utf-8"));
app.get("/script.js", sendPublicFile("script.js", "application/javascript; charset=utf-8"));
app.get("/quote.js", sendPublicFile("quote.js", "application/javascript; charset=utf-8"));
app.get("/favicon.ico", sendPublicFile("favicon.ico", "image/x-icon"));
app.get("/favicon-16x16.png", sendPublicFile("favicon-16x16.png", "image/png"));
app.get("/favicon-32x32.png", sendPublicFile("favicon-32x32.png", "image/png"));
app.get("/favicon-48x48.png", sendPublicFile("favicon-48x48.png", "image/png"));
app.get("/apple-touch-icon.png", sendPublicFile("apple-touch-icon.png", "image/png"));
app.get("/android-chrome-192x192.png", sendPublicFile("android-chrome-192x192.png", "image/png"));
app.get("/android-chrome-512x512.png", sendPublicFile("android-chrome-512x512.png", "image/png"));
app.get("/site.webmanifest", sendPublicFile("site.webmanifest", "application/manifest+json"));
app.use("/assets", express.static(path.join(ROOT_DIR, "assets"), { maxAge: process.env.NODE_ENV === "production" ? "1h" : 0 }));

function cleanText(value, maxLength = 200) {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function isValidEmail(email) {
  return email === "" || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(email);
}

function isValidPhone(phone) {
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 8 && digits.length <= 15;
}

function isValidDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const requested = new Date(`${date}T23:59:59`);
  if (Number.isNaN(requested.getTime())) return false;
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(23, 59, 59, 999);
  return requested >= yesterday;
}


function signToken(payload, purpose) {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = crypto
    .createHmac("sha256", TOKEN_SECRET)
    .update(`${purpose}.${encoded}`)
    .digest("base64url");
  return `${encoded}.${signature}`;
}

function verifyToken(token, purpose, maxAgeMs) {
  if (typeof token !== "string" || token.length > 5000) return null;
  const [encoded, providedSignature, extra] = token.split(".");
  if (!encoded || !providedSignature || extra) return null;

  const expectedSignature = crypto
    .createHmac("sha256", TOKEN_SECRET)
    .update(`${purpose}.${encoded}`)
    .digest("base64url");

  const expectedBuffer = Buffer.from(expectedSignature, "base64url");
  const providedBuffer = Buffer.from(providedSignature, "base64url");
  if (expectedBuffer.length !== providedBuffer.length || !crypto.timingSafeEqual(expectedBuffer, providedBuffer)) return null;

  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    const issuedAt = Number(payload.issuedAt);
    if (!Number.isFinite(issuedAt) || Date.now() - issuedAt > maxAgeMs || issuedAt > Date.now() + 60_000) return null;
    return payload;
  } catch {
    return null;
  }
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), EXTERNAL_API_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        Accept: "application/json",
        "User-Agent": EXTERNAL_API_USER_AGENT,
        ...(options.headers || {})
      },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`External service returned ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeAddressSuggestion(item) {
  if (!item || typeof item !== "object") return null;
  const properties = item.properties && typeof item.properties === "object" ? item.properties : item;
  const coordinates = Array.isArray(item.geometry?.coordinates)
    ? item.geometry.coordinates
    : Array.isArray(item.coordinates)
      ? item.coordinates
      : Array.isArray(item.position)
        ? item.position
        : null;

  const longitude = Number(coordinates?.[0] ?? properties.x ?? properties.lon ?? properties.lng ?? properties.longitude);
  const latitude = Number(coordinates?.[1] ?? properties.y ?? properties.lat ?? properties.latitude);
  const countryCode = cleanText(properties.countrycode ?? properties.country_code ?? properties.countryCode ?? "", 4).toUpperCase();
  const country = cleanText(properties.country ?? properties.country_name ?? "", 100);
  const postcode = cleanText(properties.postcode ?? properties.postalcode ?? properties.zipcode ?? properties.zipCode ?? "", 16);
  const city = cleanText(properties.city ?? properties.locality ?? properties.town ?? properties.village ?? properties.municipality ?? properties.district ?? "", 100);
  const street = cleanText(properties.street ?? properties.road ?? "", 140);
  const houseNumber = cleanText(properties.housenumber ?? properties.house_number ?? properties.number ?? "", 30);
  const name = cleanText(properties.name ?? properties.label ?? "", 140);
  const streetLine = [houseNumber, street || name].filter(Boolean).join(" ");
  const generatedLabel = [streetLine, postcode, city, country].filter(Boolean).join(", ");
  const label = cleanText(properties.fulltext ?? properties.display_name ?? generatedLabel, 180);

  if (!label || !Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;
  if (longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) return null;
  if (countryCode && !EUROPE_COUNTRY_CODES.has(countryCode)) return null;
  if (!countryCode && (longitude < -25 || longitude > 45 || latitude < 34 || latitude > 72)) return null;
  return { label, postcode, city, country, countryCode, longitude, latitude };
}

function cacheSet(cache, key, value, ttlMs, maxEntries = 500) {
  if (cache.size >= maxEntries) cache.delete(cache.keys().next().value);
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

function cacheGet(cache, key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

async function searchEuropeanAddresses(query) {
  const cleanQuery = cleanText(query, 180);
  if (cleanQuery.length < 3) return [];
  const cacheKey = cleanQuery.toLocaleLowerCase("fr-FR");
  const cached = cacheGet(addressSearchCache, cacheKey);
  if (cached) return cached;

  const url = new URL(GEOCODING_API_URL);
  url.searchParams.set("q", cleanQuery);
  url.searchParams.set("limit", "8");
  url.searchParams.set("lang", "fr");
  url.searchParams.set("bbox", "-25,34,45,72");

  const data = await fetchJson(url);
  const rawItems = Array.isArray(data?.features)
    ? data.features
    : Array.isArray(data)
      ? data
      : Array.isArray(data?.results)
        ? data.results
        : [];

  const unique = new Map();
  for (const item of rawItems) {
    const normalized = normalizeAddressSuggestion(item);
    if (!normalized) continue;
    const key = `${normalized.label.toLocaleLowerCase("fr-FR")}|${normalized.longitude.toFixed(6)}|${normalized.latitude.toFixed(6)}`;
    if (!unique.has(key)) unique.set(key, normalized);
  }
  const suggestions = Array.from(unique.values()).slice(0, 8);
  cacheSet(addressSearchCache, cacheKey, suggestions, 10 * 60 * 1000);
  return suggestions;
}

async function calculateRoadRoute(start, end) {
  const cacheKey = `${start.longitude.toFixed(6)},${start.latitude.toFixed(6)};${end.longitude.toFixed(6)},${end.latitude.toFixed(6)}`;
  const cached = cacheGet(routeCache, cacheKey);
  if (cached) return cached;

  const routeUrl = `${ROUTING_API_URL}/${start.longitude},${start.latitude};${end.longitude},${end.latitude}?overview=false&steps=false&alternatives=false`;
  const data = await fetchJson(routeUrl);
  const route = Array.isArray(data?.routes) ? data.routes[0] : null;
  const distanceMeters = Number(route?.distance);
  const durationSeconds = Number(route?.duration);
  if (!route || !Number.isFinite(distanceMeters) || distanceMeters <= 0) {
    throw new Error("No drivable route returned");
  }

  const result = {
    distanceKm: Math.max(1, Number((distanceMeters / 1000).toFixed(1))),
    durationMinutes: Math.max(1, Number(((Number.isFinite(durationSeconds) ? durationSeconds : 60) / 60).toFixed(1)))
  };
  cacheSet(routeCache, cacheKey, result, 30 * 60 * 1000);
  return result;
}

function calculatePricing(distanceKm, vehicleId, handlingId, loadingTimeId) {
  const vehicle = vehicleById.get(vehicleId);
  const handling = handlingById.get(handlingId);
  const loading = loadingById.get(loadingTimeId);
  if (!vehicle || !handling || !loading) return null;
  if (!Number.isFinite(distanceKm) || distanceKm < 1 || distanceKm > 10000) return null;

  const extraKm = Math.max(0, Math.ceil(distanceKm - PRICING.includedKm));
  const vehiclePrice = Number((vehicle.basePrice + extraKm * vehicle.extraKmPrice).toFixed(2));
  const totalPrice = Number((vehiclePrice + handling.price + loading.price).toFixed(2));

  return {
    includedKm: PRICING.includedKm,
    extraKm,
    distanceKm: Number(distanceKm.toFixed(1)),
    vehicleId: vehicle.id,
    vehicleName: vehicle.name,
    basePrice: vehicle.basePrice,
    extraKmPrice: vehicle.extraKmPrice,
    vehiclePrice,
    handlingId: handling.id,
    handlingName: handling.name,
    handlingPrice: handling.price,
    loadingTimeId: loading.id,
    loadingTimeName: loading.name,
    loadingTimePrice: loading.price,
    totalPrice,
    currency: "EUR"
  };
}

function reservationRateLimit(req, res, next) {
  const now = Date.now();
  const key = req.ip || req.socket.remoteAddress || "unknown";
  const current = rateLimitStore.get(key);

  if (!current || current.resetAt <= now) {
    rateLimitStore.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return next();
  }

  if (current.count >= RATE_LIMIT_MAX) {
    const retryAfter = Math.ceil((current.resetAt - now) / 1000);
    res.setHeader("Retry-After", String(retryAfter));
    return res.status(429).json({
      success: false,
      message: "Trop de demandes ont été envoyées. Veuillez réessayer dans quelques minutes."
    });
  }

  current.count += 1;
  next();
}

setInterval(() => {
  const now = Date.now();
  for (const [key, value] of rateLimitStore.entries()) {
    if (value.resetAt <= now) rateLimitStore.delete(key);
  }
}, RATE_LIMIT_WINDOW_MS).unref();

function getReservationRecipients() {
  const configured = process.env.RESERVATION_EMAIL || process.env.OWNER_EMAIL || DEFAULT_RESERVATION_EMAIL;
  const recipients = configured
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter((email) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(email))
    .filter((email) => !email.includes("example.") && email !== "your@email.com");

  return recipients.length > 0 ? recipients : [DEFAULT_RESERVATION_EMAIL];
}

function isPlaceholderEmailConfig(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return !normalized || normalized.includes("your_") || normalized.includes("example.") || normalized.includes("votre-");
}

function emailIsConfigured() {
  return Boolean(
    getReservationRecipients().length > 0 &&
    !isPlaceholderEmailConfig(process.env.SMTP_HOST) &&
    !isPlaceholderEmailConfig(process.env.SMTP_USER) &&
    process.env.SMTP_PASS &&
    !isPlaceholderEmailConfig(process.env.SMTP_PASS)
  );
}

const SENDER_EMAIL = (process.env.SMTP_USER || "").trim();

const transporter = emailIsConfigured()
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST.trim(),
      port: Number(process.env.SMTP_PORT) || 587,
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: {
        user: SENDER_EMAIL,
        pass: process.env.SMTP_PASS
      }
    })
  : null;

async function saveReservation(reservation) {
  await fs.promises.mkdir(DATA_DIR, { recursive: true });
  await fs.promises.appendFile(
    RESERVATIONS_FILE,
    `${JSON.stringify({ ...reservation, createdAt: new Date().toISOString() })}\n`,
    { encoding: "utf8", mode: 0o600 }
  );
}

async function sendReservationEmails(reservation) {
  if (!transporter) return false;

  const price = reservation.pricing;
  const businessName = process.env.BUSINESS_NAME || "Hexamove";
  const recipients = getReservationRecipients();
  const timezone = process.env.BUSINESS_TIMEZONE || "Europe/Paris";
  const submittedDate = new Date(reservation.submittedAt);
  const submittedAt = Number.isNaN(submittedDate.getTime())
    ? reservation.submittedAt
    : submittedDate.toLocaleString("fr-FR", {
        dateStyle: "full",
        timeStyle: "short",
        timeZone: timezone
      });

  const safe = {
    id: escapeHtml(reservation.reservationId),
    submittedAt: escapeHtml(submittedAt),
    name: escapeHtml(reservation.name),
    phone: escapeHtml(reservation.phone),
    email: escapeHtml(reservation.email || "Non renseigné"),
    serviceType: escapeHtml(reservation.serviceType),
    date: escapeHtml(reservation.date),
    time: escapeHtml(reservation.time),
    pickup: escapeHtml(reservation.pickup),
    destination: escapeHtml(reservation.destination),
    distance: escapeHtml(`${price.distanceKm} km`),
    routeDuration: escapeHtml(`${reservation.durationMinutes || 0} min`),
    vehicle: escapeHtml(price.vehicleName),
    vehiclePrice: escapeHtml(`${price.vehiclePrice.toFixed(2)} €`),
    handling: escapeHtml(price.handlingName),
    handlingPrice: escapeHtml(`${price.handlingPrice.toFixed(2)} €`),
    loading: escapeHtml(price.loadingTimeName),
    loadingPrice: escapeHtml(`${price.loadingTimePrice.toFixed(2)} €`),
    total: escapeHtml(`${price.totalPrice.toFixed(2)} €`),
    volume: escapeHtml(reservation.volume || "Non renseigné"),
    notes: escapeHtml(reservation.notes || "Aucun détail")
  };

  const phoneHref = reservation.phone.replace(/[^+\d]/g, "");
  const replyEmail = reservation.email || "";

  await transporter.sendMail({
    from: `"${businessName} - Site" <${SENDER_EMAIL}>`,
    to: recipients.join(", "),
    replyTo: replyEmail || undefined,
    subject: `Nouvelle demande ${reservation.reservationId} · ${safe.total} · ${reservation.name}`,
    text: [
      `Nouvelle demande de transport — référence ${reservation.reservationId}`,
      `Reçue le : ${submittedAt}`,
      "",
      `Nom : ${reservation.name}`,
      `Téléphone : ${reservation.phone}`,
      `E-mail : ${reservation.email || "Non renseigné"}`,
      `Prestation : ${reservation.serviceType}`,
      `Départ : ${reservation.pickup}`,
      `Arrivée : ${reservation.destination}`,
      `Date / créneau : ${reservation.date} · ${reservation.time}`,
      `Distance : ${price.distanceKm} km`,
      `Durée routière estimée : ${reservation.durationMinutes || 0} min`,
      `Véhicule : ${price.vehicleName} — ${price.vehiclePrice.toFixed(2)} €`,
      `Manutention : ${price.handlingName} — ${price.handlingPrice.toFixed(2)} €`,
      `Temps réservé : ${price.loadingTimeName} — ${price.loadingTimePrice.toFixed(2)} €`,
      `Volume : ${reservation.volume || "Non renseigné"}`,
      `Informations complémentaires : ${reservation.notes || "Aucun détail"}`,
      "",
      `PRIX TOTAL ESTIMÉ : ${price.totalPrice.toFixed(2)} €`
    ].join("\n"),
    html: `
      <div style="font-family:Arial,sans-serif;max-width:760px;margin:auto;color:#17212b;background:#f5f7fa;padding:24px">
        <div style="background:#071a2f;color:#fff;padding:22px;border-radius:14px 14px 0 0">
          <div style="font-size:13px;opacity:.75">Nouvelle demande · Référence ${safe.id}</div>
          <h2 style="margin:7px 0 0;color:#fff">Nouvelle demande de transport</h2>
        </div>
        <div style="background:#fff;padding:22px;border-radius:0 0 14px 14px">
          <p style="margin-top:0;color:#687386">Reçue le ${safe.submittedAt}</p>
          <p style="padding:18px;background:#fff3e6;border-left:5px solid #ff7a00;border-radius:10px;font-size:22px"><strong>Prix total estimé : ${safe.total}</strong></p>
          <table style="width:100%;border-collapse:collapse">
            <tr><td style="padding:9px;border-bottom:1px solid #eee"><strong>Nom</strong></td><td style="padding:9px;border-bottom:1px solid #eee">${safe.name}</td></tr>
            <tr><td style="padding:9px;border-bottom:1px solid #eee"><strong>Téléphone</strong></td><td style="padding:9px;border-bottom:1px solid #eee">${safe.phone}</td></tr>
            <tr><td style="padding:9px;border-bottom:1px solid #eee"><strong>E-mail</strong></td><td style="padding:9px;border-bottom:1px solid #eee">${safe.email}</td></tr>
            <tr><td style="padding:9px;border-bottom:1px solid #eee"><strong>Prestation</strong></td><td style="padding:9px;border-bottom:1px solid #eee">${safe.serviceType}</td></tr>
            <tr><td style="padding:9px;border-bottom:1px solid #eee"><strong>Départ</strong></td><td style="padding:9px;border-bottom:1px solid #eee">${safe.pickup}</td></tr>
            <tr><td style="padding:9px;border-bottom:1px solid #eee"><strong>Arrivée</strong></td><td style="padding:9px;border-bottom:1px solid #eee">${safe.destination}</td></tr>
            <tr><td style="padding:9px;border-bottom:1px solid #eee"><strong>Date / créneau</strong></td><td style="padding:9px;border-bottom:1px solid #eee">${safe.date} · ${safe.time}</td></tr>
            <tr><td style="padding:9px;border-bottom:1px solid #eee"><strong>Distance / durée routière</strong></td><td style="padding:9px;border-bottom:1px solid #eee">${safe.distance} · ${safe.routeDuration}</td></tr>
            <tr><td style="padding:9px;border-bottom:1px solid #eee"><strong>Véhicule</strong></td><td style="padding:9px;border-bottom:1px solid #eee">${safe.vehicle} — ${safe.vehiclePrice}</td></tr>
            <tr><td style="padding:9px;border-bottom:1px solid #eee"><strong>Manutention</strong></td><td style="padding:9px;border-bottom:1px solid #eee">${safe.handling} — ${safe.handlingPrice}</td></tr>
            <tr><td style="padding:9px;border-bottom:1px solid #eee"><strong>Temps réservé</strong></td><td style="padding:9px;border-bottom:1px solid #eee">${safe.loading} — ${safe.loadingPrice}</td></tr>
            <tr><td style="padding:9px;border-bottom:1px solid #eee"><strong>Volume</strong></td><td style="padding:9px;border-bottom:1px solid #eee">${safe.volume}</td></tr>
            <tr><td style="padding:9px"><strong>Informations complémentaires</strong></td><td style="padding:9px;white-space:pre-line">${safe.notes}</td></tr>
          </table>
          <div style="margin-top:22px">
            <a href="tel:${phoneHref}" style="display:inline-block;margin:0 8px 8px 0;padding:12px 18px;background:#ff7a00;color:#fff;text-decoration:none;border-radius:9px;font-weight:bold">Appeler le client</a>
            ${replyEmail ? `<a href="mailto:${encodeURIComponent(replyEmail)}" style="display:inline-block;padding:12px 18px;background:#071a2f;color:#fff;text-decoration:none;border-radius:9px;font-weight:bold">Répondre par e-mail</a>` : ""}
          </div>
        </div>
      </div>`
  });

  if (reservation.email) {
    await transporter.sendMail({
      from: `"${businessName}" <${SENDER_EMAIL}>`,
      to: reservation.email,
      subject: `Votre demande ${reservation.reservationId} a bien été reçue`,
      text: `Bonjour ${reservation.name},\n\nVotre demande a bien été reçue.\n\nRéférence : ${reservation.reservationId}\nVéhicule : ${price.vehicleName}\nDistance : ${price.distanceKm} km\nManutention : ${price.handlingName}\nTemps : ${price.loadingTimeName}\nPrix estimé : ${price.totalPrice.toFixed(2)} €\n\nNotre équipe vous contactera au ${reservation.phone} dans un délai d’une heure pour confirmer les détails. Cette demande ne constitue pas encore une réservation définitive.\n\n${businessName}`
    });
  }

  return true;
}

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", emailConfigured: emailIsConfigured() });
});

app.get("/api/config", (req, res) => {
  const rawWhatsapp = cleanText(process.env.WHATSAPP_NUMBER || process.env.PUBLIC_PHONE || "", 30).replace(/\D/g, "");
  const whatsappText = encodeURIComponent("Bonjour, je souhaite demander un devis pour un transport.");
  res.json({
    businessName: cleanText(process.env.BUSINESS_NAME || "Hexamove", 60),
    phone: cleanText(process.env.PUBLIC_PHONE || "", 30),
    publicEmail: cleanText(process.env.PUBLIC_EMAIL || "", 120),
    serviceArea: cleanText(process.env.SERVICE_AREA || "France · Belgique · Suisse · Luxembourg · Toute l’Europe", 160),
    businessHours: cleanText(process.env.BUSINESS_HOURS || "7j/7 · 8h–17h", 80),
    whatsappUrl: rawWhatsapp ? `https://wa.me/${rawWhatsapp}?text=${whatsappText}` : ""
  });
});

app.get("/api/address-search", async (req, res) => {
  const query = cleanText(req.query.q, 180);
  if (query.length < 3) return res.json({ suggestions: [] });

  try {
    const addresses = await searchEuropeanAddresses(query);
    const suggestions = addresses.map((address) => ({
      label: address.label,
      postcode: address.postcode,
      city: address.city,
      country: address.country,
      countryCode: address.countryCode,
      addressToken: signToken({
        kind: "address",
        label: address.label,
        postcode: address.postcode,
        city: address.city,
        country: address.country,
        countryCode: address.countryCode,
        longitude: address.longitude,
        latitude: address.latitude,
        issuedAt: Date.now()
      }, "address")
    }));
    res.setHeader("Cache-Control", "no-store");
    return res.json({ suggestions });
  } catch (error) {
    console.error("Address search error:", error.message);
    return res.status(503).json({
      success: false,
      message: "Le service d’adresses européennes est temporairement indisponible."
    });
  }
});

app.post("/api/route-distance", async (req, res) => {
  const pickup = verifyToken(cleanText(req.body.pickupToken, 5000), "address", ADDRESS_TOKEN_TTL_MS);
  const destination = verifyToken(cleanText(req.body.destinationToken, 5000), "address", ADDRESS_TOKEN_TTL_MS);
  if (!pickup || !destination || pickup.kind !== "address" || destination.kind !== "address") {
    return res.status(400).json({
      success: false,
      message: "Sélectionnez deux adresses européennes proposées par le formulaire."
    });
  }

  try {
    const route = await calculateRoadRoute(pickup, destination);
    const routePayload = {
      kind: "route",
      pickup: cleanText(pickup.label, 180),
      destination: cleanText(destination.label, 180),
      distanceKm: route.distanceKm,
      durationMinutes: route.durationMinutes,
      issuedAt: Date.now()
    };
    return res.json({
      success: true,
      pickup: routePayload.pickup,
      destination: routePayload.destination,
      distanceKm: routePayload.distanceKm,
      durationMinutes: routePayload.durationMinutes,
      routeToken: signToken(routePayload, "route")
    });
  } catch (error) {
    console.error("Route calculation error:", error.message);
    return res.status(503).json({
      success: false,
      message: "Impossible de calculer un trajet routier entre ces deux adresses."
    });
  }
});

app.get("/api/pricing", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json(PRICING);
});

app.post("/api/reservation", reservationRateLimit, async (req, res) => {
  if (cleanText(req.body.website, 200)) {
    return res.status(200).json({ success: true, message: "Votre demande a bien été envoyée." });
  }

  const route = verifyToken(cleanText(req.body.routeToken, 5000), "route", ROUTE_TOKEN_TTL_MS);
  const pricing = route && route.kind === "route"
    ? calculatePricing(
        Number(route.distanceKm),
        cleanText(req.body.vehicleType, 30),
        cleanText(req.body.handlingOption, 30),
        cleanText(req.body.loadingTime, 30)
      )
    : null;

  const reservation = {
    reservationId: `SV-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`,
    submittedAt: new Date().toISOString(),
    name: cleanText(req.body.name, 80),
    phone: cleanText(req.body.phone, 30),
    email: cleanText(req.body.email, 120).toLowerCase(),
    serviceType: cleanText(req.body.serviceType, 60),
    date: cleanText(req.body.date, 10),
    time: cleanText(req.body.time, 60),
    pickup: cleanText(route?.pickup || "", 180),
    destination: cleanText(route?.destination || "", 180),
    durationMinutes: Number(route?.durationMinutes) || 0,
    volume: cleanText(req.body.volume, 80),
    notes: cleanText(req.body.notes, 1200),
    consent: cleanText(req.body.consent, 10),
    pricing
  };

  if (
    reservation.name.length < 2 ||
    !isValidPhone(reservation.phone) ||
    !isValidEmail(reservation.email) ||
    !allowedServices.has(reservation.serviceType) ||
    !isValidDate(reservation.date) ||
    !allowedTimes.has(reservation.time) ||
    reservation.pickup.length < 5 ||
    reservation.destination.length < 5 ||
    reservation.consent !== "yes" ||
    !pricing
  ) {
    return res.status(400).json({
      success: false,
      message: route
        ? "Certaines informations ou options sont manquantes ou incorrectes. Revenez au formulaire puis réessayez."
        : "Le calcul du trajet a expiré ou n’est pas valide. Revenez au formulaire et sélectionnez à nouveau les adresses."
    });
  }

  try {
    await saveReservation(reservation);
    let emailSent = false;
    try {
      emailSent = await sendReservationEmails(reservation);
    } catch (emailError) {
      console.error("Reservation saved, but email delivery failed:", emailError.message);
    }

    return res.status(201).json({
      success: true,
      emailSent,
      pricing,
      message: "Merci ! Votre demande complète a bien été enregistrée. Notre équipe vous contactera dans un délai d’une heure."
    });
  } catch (error) {
    console.error("Reservation processing error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Le serveur n’a pas pu enregistrer la demande. Veuillez réessayer."
    });
  }
});

app.use("/api", (req, res) => {
  res.status(404).json({ success: false, message: "Route API introuvable." });
});

app.use((req, res) => {
  res.status(404).type("text").send("Page introuvable");
});

app.use((error, req, res, next) => {
  console.error("Server error:", error.message);
  if (res.headersSent) return next(error);
  res.status(error.message === "Origin not allowed by CORS" ? 403 : 500).json({
    success: false,
    message: "Une erreur serveur est survenue."
  });
});

app.listen(PORT, () => {
  console.log(`Hexamove is running on http://localhost:${PORT}`);
  console.log(emailIsConfigured()
    ? `Email notifications are enabled for ${getReservationRecipients().join(", ")}.`
    : "Email is not configured: set RESERVATION_EMAIL, SMTP_HOST, SMTP_USER and SMTP_PASS in .env. Reservations will still be saved in data/reservations.jsonl.");
});
