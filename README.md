# RandoRadar — V1 native Android / iPhone

Base fonctionnelle d'une application outdoor de type Visorando / Komoot avec radar météo.

## Déjà inclus dans cette V1

- Application native React Native / Expo (ce n'est pas une PWA)
- Carte MapLibre Native
- Position GPS
- Modes Randonnée, Vélo route, Gravel et VTT
- Démarrage / pause / reprise / fin d'activité
- Suivi GPS en arrière-plan
- Notification Android pendant l'enregistrement
- Sauvegarde immédiate des points GPS dans SQLite
- Reprise d'une activité après réouverture de l'application
- Tracé réel affiché sur la carte
- Distance, durée, D+, altitude, vitesse et nombre de points GPS
- Fenêtre d'activité en bas de l'écran, réductible / agrandissable
- Historique local des activités
- Créateur de parcours manuel : toucher la carte pour ajouter des points
- **Annuler** retire uniquement le dernier point ; **Effacer** supprime tout le tracé en création
- Enregistrement local des parcours créés
- Radar RainViewer superposé à la carte

## Important

MapLibre et le GPS en arrière-plan utilisent du code natif : **Expo Go ne suffit pas**. Il faut créer un Development Build ou une APK.

## Installation

Node.js 22.13+ est recommandé pour Expo SDK 57.

```bash
npm install
npx expo prebuild
npx expo run:android
```

Pour iOS, il faut macOS/Xcode :

```bash
npx expo run:ios
```

## APK Android installable

Le projet est déjà configuré pour Android. Pour une distribution propre, le plus simple est d'utiliser EAS Build, ou Android Studio/Gradle après `expo prebuild`.

## Permissions GPS

L'application demande :

- localisation précise ;
- localisation en arrière-plan ;
- service de localisation au premier plan Android.

Sur Android 11+, la demande de localisation permanente peut ouvrir les réglages système. Sélectionner l'autorisation permettant l'utilisation en permanence si l'on veut que l'enregistrement continue écran verrouillé.

## Radar

Le bouton **🌧 Radar** charge la dernière image disponible depuis l'API publique RainViewer et l'affiche au-dessus de la carte.

La version publique RainViewer 2026 fournit l'historique radar récent mais plus la prévision radar future. Il faudra combiner cette couche avec une prévision Météo-France/AROME (par exemple via Open-Meteo) pour la future fonction « pluie sur mon parcours dans 30/60/120 min ».

## Carte

La V1 utilise le style de démonstration MapLibre :

`https://demotiles.maplibre.org/style.json`

Il convient pour le développement. Pour une vraie diffusion de l'application, remplacer ce style par un fournisseur de tuiles adapté ou notre propre infrastructure cartographique.

## Prochaines briques prévues

1. Routage automatique selon le sport avec Valhalla (la V1 trace actuellement des segments manuels entre les points).
2. Import/export GPX.
4. Profil altimétrique et D+/D- du parcours prévu.
5. Détection de sortie d'itinéraire et recalcul.
6. Guidage vocal.
7. Cartes/régions hors connexion avec OfflineManager MapLibre.
8. Prévisions AROME le long de l'itinéraire.
9. Alerte « pluie devant vous » selon la progression.
10. Bibliothèque de parcours, favoris, photos et partage.

## Windows : deux raccourcis fournis

- `BUILD_ANDROID.bat` : installe les dépendances, génère Android et lance l'application sur un téléphone connecté / émulateur.
- `BUILD_APK_DEBUG.bat` : construit une APK de test dans `android\\app\\build\\outputs\\apk\\debug\\app-debug.apk`.

Ces scripts nécessitent Node.js et l'environnement Android (Android Studio / SDK / JDK).

## Limite importante du suivi en arrière-plan

Écran verrouillé ou application simplement passée en arrière-plan : le service de localisation est prévu pour continuer.

En revanche, si l'utilisateur force l'arrêt de l'application, ou si certains constructeurs Android tuent explicitement son processus, le système peut interrompre le suivi. Il faudra tester les réglages d'économie de batterie sur chaque appareil cible.

## Licence radar

L'API publique RainViewer est destinée aux usages personnels, éducatifs et aux petites communautés. Pour une diffusion commerciale ou à fort trafic, il faudra valider les conditions adaptées avec le fournisseur ou choisir une autre source radar.
