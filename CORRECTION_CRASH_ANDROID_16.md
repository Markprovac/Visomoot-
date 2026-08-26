# Correction crash GPS Android 16 — Visomoot 0.4.0

Le crash observé au premier point GPS venait d'un job persistant Expo TaskManager lancé sans la permission Android `RECEIVE_BOOT_COMPLETED`.

Erreur typique :

`Requested job cannot be persisted without holding android.permission.RECEIVE_BOOT_COMPLETED permission`

La version 0.4.0 ajoute explicitement dans `app.json` :

- `android.permission.RECEIVE_BOOT_COMPLETED`
- `android.permission.WAKE_LOCK`

Après modification d'une permission native, il faut reconstruire complètement l'APK. Une simple mise à jour JavaScript ne suffit pas.
