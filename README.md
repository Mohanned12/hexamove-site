# Hexamove v11 — Notifications e-mail complètes


Ce projet contient un site complet en français pour les demandes de transport en France et en Europe.

## Fonctionnement

1. Le client saisit ses coordonnées et choisit deux adresses européennes dans les propositions.
2. Le serveur calcule automatiquement la distance routière et le temps estimé.
3. Le client choisit le véhicule, la manutention et le temps de chargement/déchargement.
4. Le prix est recalculé côté serveur.
5. Une confirmation en français s’affiche avec le récapitulatif et le message indiquant que l’équipe contactera le client dans l’heure.

## Installation Windows

Installez Node.js 18 ou une version plus récente, puis ouvrez PowerShell dans le dossier du projet :

```powershell
npm install
Copy-Item .env.example .env
npm start
```

Ouvrez ensuite :

```text
http://localhost:3000
```

Pour arrêter le serveur :

```text
Ctrl + C
```

## Configuration

Ouvrez `.env` et modifiez au minimum :

```env
BUSINESS_NAME=Hexamove
PUBLIC_PHONE=+33 7 46 73 86 56
PUBLIC_EMAIL=Contact@hexamove.fr
WHATSAPP_NUMBER=33746738656

Le bouton WhatsApp flottant utilise ce numéro. Saisissez uniquement l’indicatif pays et les chiffres, sans `+`, espaces ou tirets.
SERVICE_AREA=France · Belgique · Suisse · Luxembourg · Toute l’Europe
BUSINESS_HOURS=7j/7 · 8h–17h
```

Générez une clé secrète :

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Copiez la valeur dans `.env` :

```env
QUOTE_SECRET=votre_cle_longue_et_secrete
```

## Réception des demandes par e-mail

Toutes les nouvelles demandes peuvent être envoyées à :

```env
RESERVATION_EMAIL=devis@hexamove.fr
```

Cette valeur se trouve dans `.env`. Pour changer l'adresse destinataire plus tard, modifiez uniquement `RESERVATION_EMAIL`, puis redémarrez le serveur.

Configurez ensuite le compte Gmail qui enverra les notifications :

```env
GMAIL_USER=votre-compte-gmail@gmail.com
GMAIL_APP_PASSWORD=votre_mot_de_passe_application_google
```

`RESERVATION_EMAIL` est l'adresse qui **reçoit** les demandes. `GMAIL_USER` est le compte qui **envoie** les messages. Ils peuvent être identiques ou différents.

Utilisez un mot de passe d'application Google, jamais le mot de passe normal du compte Gmail. Après chaque modification de `.env`, arrêtez et relancez le serveur avec `npm start`.

Chaque e-mail reçu contient notamment :

- la référence et l'heure de la demande ;
- le nom, le téléphone et l'e-mail du client ;
- le type de prestation ;
- les adresses de départ et d'arrivée ;
- la date et le créneau ;
- la distance et la durée routière estimée ;
- le véhicule, la manutention et le temps réservé ;
- le détail des prix et le total estimé ;
- le volume et les informations complémentaires ;
- un bouton permettant d'appeler le client directement.

Vous pouvez envoyer vers plusieurs adresses en les séparant par des virgules :

```env
RESERVATION_EMAIL=adresse1@gmail.com,adresse2@gmail.com
```

## Adresses et distance en Europe

La configuration par défaut utilise :

```env
GEOCODING_API_URL=https://photon.komoot.io/api/
ROUTING_API_URL=https://router.project-osrm.org/route/v1/driving
```

Les adresses proposées sont limitées aux pays européens pris en charge par le projet. La distance est calculée côté serveur et protégée par un jeton signé afin que le client ne puisse pas modifier librement le nombre de kilomètres.

Les services publics de démonstration peuvent limiter les requêtes. Pour un site avec beaucoup de trafic, utilisez une instance privée ou un fournisseur professionnel compatible.

## Images des véhicules

Les images se trouvent dans :

```text
assets/vehicles/
```

Fichiers :

```text
small.png
classic.png
large.png
jumbo.png
```

## Vérification

```powershell
npm run check
npm audit
```

## API locale

```text
GET  /api/health
GET  /api/config
GET  /api/address-search?q=adresse
POST /api/route-distance
GET  /api/pricing
POST /api/reservation
```


## Nouveautés v9

- Nouvelle présentation premium des quatre véhicules, inspirée de la maquette validée.
- Photos de véhicules plus réalistes et homogènes.
- Distance et durée estimée affichées dans chaque carte.
- Tableau clair pour le volume, la charge, le besoin conseillé et la tarification.
- Carte de prix fixe avec trajet, options et durée.
- Mise en page responsive pour ordinateur, tablette et téléphone.


## Nouveautés v11

- Adresse de réception configurable avec `RESERVATION_EMAIL`.
- Adresse par défaut : `devis@hexamove.fr`.
- E-mail professionnel complet avec toutes les informations de la demande.
- Référence unique pour chaque demande.
- Version texte ajoutée pour garantir la lisibilité dans tous les services de messagerie.
- Boutons pour appeler le client ou lui répondre par e-mail.
- Compatibilité maintenue avec l'ancien paramètre `OWNER_EMAIL`.
