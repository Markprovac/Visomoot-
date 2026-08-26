# Visomoot — V0.2 native Android / iPhone

Application outdoor personnelle inspirée de Komoot, avec carte topo, création d'itinéraires et météo sur le parcours.

## V0.2 — déjà inclus

- Application native React Native / Expo, sans Capacitor et sans dossier `www`
- Carte MapLibre Native avec fond OpenTopoMap / OpenStreetMap
- Position GPS et suivi de l'utilisateur pendant l'activité
- Randonnée, vélo route, gravel et VTT
- Enregistrement GPS en arrière-plan avec service Android au premier plan
- Points GPS sauvegardés immédiatement en SQLite
- Reprise d'une activité inachevée après réouverture de l'application
- Tracé réel, distance, durée, D+, altitude et vitesse
- Historique local des activités
- Radar RainViewer sur la carte

## Nouveau : création de parcours automatique

Le bouton **Créer** n'assemble plus simplement des lignes droites.

1. Touchez la carte pour poser le départ.
2. Touchez ensuite l'arrivée et éventuellement des étapes intermédiaires.
3. Visomoot demande à Valhalla de calculer le trajet sur le réseau OpenStreetMap.
4. Le profil dépend du sport : marche/sentiers, vélo route, gravel ou VTT.
5. **Annuler** retire la dernière étape et recalcule le parcours.
6. **Effacer** supprime tout le parcours en cours de création.
7. **Enregistrer** conserve le tracé dans SQLite et l'associe à l'activité suivante.

Le routage utilise actuellement le serveur public de démonstration Valhalla de FOSSGIS. Il faut donc une connexion réseau pour créer/recalculer un parcours et respecter son usage raisonnable. Pour une application personnelle, cette solution est adaptée aux tests et à un usage modéré.

## Nouveau : pluie prévue sur le parcours

Dès qu'un itinéraire est calculé, Visomoot échantillonne les positions futures le long du tracé toutes les 15 minutes de progression estimée.

Il interroge Open-Meteo en 15 minutes. En France et en Europe centrale, le service peut exploiter notamment les modèles haute résolution disponibles localement, dont AROME.

Exemple d'alerte affichée :

`🌧 pluie prévue dans 45 min, à 8.1 km devant toi (0.7 mm/15 min).`

Pendant une activité, la prévision est recalculée périodiquement à partir de la progression GPS. Un point bleu météo est également placé sur le parcours à l'endroit de la première pluie détectée.

## Correction importante MapLibre

MapLibre React Native v11 fonctionne uniquement avec la nouvelle architecture React Native. La configuration conserve donc :

`"newArchEnabled": true`

La caméra utilise directement `trackUserLocation="course"`. L'ancien appel impératif `setCamera()` n'est plus utilisé car l'API v11 l'a remplacé et cela pouvait provoquer une erreur au lancement du suivi.

## Installation Android

Node.js 22+ recommandé.

```bash
npm install
npx expo prebuild
npx expo run:android
```

Pour construire l'APK de debug après le prebuild :

```bash
cd android
gradlew assembleDebug
```

APK : `android/app/build/outputs/apk/debug/app-debug.apk`

## GPS en arrière-plan

Visomoot demande la localisation précise et la localisation en arrière-plan et lance un service Android de localisation pendant une activité.

- écran éteint : suivi prévu pour continuer ;
- application en arrière-plan : suivi prévu pour continuer ;
- application retirée des apps récentes : le service Android est configuré pour ne pas s'arrêter volontairement ;
- **Forcer l'arrêt** depuis les réglages Android : Android arrête obligatoirement l'application et aucun logiciel ne peut contourner ce comportement ;
- certains constructeurs peuvent aussi tuer agressivement les applications si l'optimisation batterie n'est pas désactivée.

## Services externes

- Carte : OpenTopoMap / OpenStreetMap
- Routage : Valhalla / données OpenStreetMap
- Prévision sur le parcours : Open-Meteo
- Radar : RainViewer

Le projet ne contient pas de clé API payante.
