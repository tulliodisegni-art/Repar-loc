# Répar'Loc – Suivi des réparations

Appli web installable (PWA) qui réunit locataire, propriétaire et professionnel dans un dossier par réparation : signalement, accord du propriétaire, rendez-vous, compte rendu.

- **Démo** : données fictives, les trois rôles sur un même téléphone, sauvegarde dans le navigateur.
- **Vrai compte** : connexion e-mail + mot de passe (Supabase, même projet que Jobello). Les tables `rl_*` sont protégées par RLS : chacun ne voit que ses logements et dossiers. Conversations séparées : locataire ↔ propriétaire (`lp`) et propriétaire ↔ professionnel (`pp`). Le locataire est relié à son logement, le professionnel à son propriétaire, par un code d'invitation à usage unique.

## Installer
Ouvrir https://tulliodisegni-art.github.io/Repar-loc/ dans Safari (iPhone) → Partager → « Sur l'écran d'accueil ».

## Développement
`src/reparloc.html` est l'appli (le même fichier sert aussi de page Claude). `web/` contient le service worker, le manifeste, les icônes et la bibliothèque Supabase.
`python scripts/build.py` construit `_site/`, publié par GitHub Pages à chaque push sur `main`.
Le schéma Supabase est appliqué par les migrations `reparloc_schema`, `reparloc_revoke_anon` et `reparloc_pro_release` du projet Supabase.
