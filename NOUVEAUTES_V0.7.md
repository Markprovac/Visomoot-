# Visomoot v0.7 — Import GPX

Cette version repart de la v0.6 et conserve toutes ses fonctions.

## Nouveau : importer un GPX

- Nouveau bouton **📥 GPX** dans les actions principales de la carte.
- Ouvre le sélecteur de fichiers Android/iOS et accepte un fichier `.gpx` du téléphone, de Drive ou d'un fournisseur de fichiers disponible sur l'appareil.
- Lit les traces GPX (`trkpt`), les routes GPX (`rtept`) et, en dernier recours, une suite de waypoints (`wpt`).
- Récupère le nom du parcours quand il existe dans le fichier.
- Affiche immédiatement la trace sur la carte et zoome automatiquement dessus.
- Calcule la distance et, lorsque le GPX contient des altitudes, le D+ et le D- à l'import.
- Enregistre automatiquement le tracé comme parcours Visomoot réutilisable.
- Le parcours importé peut être utilisé pour démarrer une activité et bénéficie de la météo prévue le long du parcours.
- L'export GPX déjà présent en v0.6 reste inchangé.

## Dépendance ajoutée

`expo-document-picker` est utilisé pour sélectionner un fichier GPX avec le sélecteur natif du téléphone.

Un nouvel APK doit être reconstruit après `npm install` / `npx expo prebuild`.
