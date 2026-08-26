# Visomoot 0.3.0 — correction démarrage GPS Android

Cette version modifie le démarrage d'une activité pour éviter le plantage natif observé sur Android/Xiaomi.

## Changements

- une seule source GPS est utilisée pour l'enregistrement : `expo-location` + tâche de fond ;
- suppression du suivi de localisation interne MapLibre (`UserLocation` / `trackUserLocation`) pendant l'activité afin d'éviter deux gestionnaires GPS concurrents ;
- la position est dessinée par Visomoot sous forme de point bleu à partir des points GPS enregistrés ;
- la caméra suit ce point pendant l'activité ;
- MapLibre Android utilise `TextureView` pour privilégier la stabilité sur certains appareils ;
- ajout d'un bouton rond **GPS** permettant de recentrer immédiatement la carte sur la position courante ;
- mise à jour `expo-location` vers la version recommandée pour Expo 57 et React Native vers 0.86.2 ;
- MapLibre est fixé à 11.3.6 pour éviter de dépendre de la toute dernière publication pendant le diagnostic ;
- si le service GPS ne peut pas démarrer, l'activité créée est refermée proprement au lieu de rester bloquée comme « en cours ».

## Test conseillé

1. Installer l'APK neuf.
2. Autoriser la localisation précise puis la localisation en permanence.
3. Appuyer sur GPS et vérifier que la carte se centre.
4. Démarrer une activité et attendre 30 secondes.
5. Verrouiller l'écran quelques minutes puis rouvrir Visomoot.
6. Vérifier que les points GPS, le temps et la distance ont continué.

Si Android affiche encore « Visomoot s'arrête systématiquement », ouvrir **Voir le résumé** dans la fenêtre de crash et conserver les premières lignes : elles permettront d'identifier le composant natif exact qui provoque l'arrêt.
