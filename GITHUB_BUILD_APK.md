# Créer l'APK avec GitHub Actions

Cette méthode ne nécessite pas Android Studio sur le PC.

1. Créer un dépôt GitHub vide.
2. Envoyer tout le contenu du dossier `RandoRadar` à la racine du dépôt, y compris le dossier caché `.github`.
3. Ouvrir le dépôt sur GitHub puis l'onglet **Actions**.
4. Ouvrir **Build Android APK**.
5. Cliquer **Run workflow** puis confirmer avec **Run workflow**.
6. Quand la compilation est terminée, ouvrir l'exécution réussie.
7. En bas de la page, dans **Artifacts**, télécharger **RandoRadar-APK**.
8. Décompresser le fichier téléchargé : il contient `app-debug.apk`.
9. Copier `app-debug.apk` sur le téléphone Android et l'installer.

Le workflow se trouve dans `.github/workflows/build-apk.yml`.
