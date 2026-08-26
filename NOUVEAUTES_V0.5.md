# Visomoot v0.5 — GPX et historique détaillé

## Création de parcours

- Le créateur de parcours continue à calculer l'itinéraire sur les routes et chemins.
- Un nouveau bouton **Enregistrer / partager en GPX** exporte le tracé calculé au format GPX.
- Un parcours déjà prêt peut également être exporté en GPX.

## Activités

Un appui sur une activité ouvre maintenant sa fiche détaillée avec :

- distance ;
- durée ;
- vitesse moyenne ;
- vitesse maximale ;
- D+ ;
- D- ;
- altitude minimale ;
- altitude maximale ;
- nombre de points GPS ;
- heure de départ et heure de fin.

Depuis cette fiche, il est possible de :

- afficher la trace complète sur la carte ;
- enregistrer la trace comme parcours réutilisable ;
- exporter la trace réelle en GPX avec altitude et horodatage ;
- effacer définitivement l'activité et ses points GPS.

## Export GPX

Le GPX est créé localement puis ouvert dans la feuille de partage Android/iOS. Sur Android, il est ainsi possible de choisir une application de fichiers, Drive, Garmin Connect ou une autre application compatible.

## Dépendances ajoutées

- expo-file-system ~57.0.5
- expo-sharing ~57.0.14

La correction Android 16 de la v0.4 (`RECEIVE_BOOT_COMPLETED` + `WAKE_LOCK`) est conservée.
