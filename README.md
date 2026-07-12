# HCOSMO — Prototype de preuve de concept

Éditeur BIM paramétrique web, façon petit IDE (interface type VS Code) :
dessinez librement une maison complète (murs porteurs, cloisons,
soubassements automatiques, dalles, poteaux, fenêtres, portes, toit,
éléments électriques) sur un plan 2D interactif, visualisez le résultat
en 3D en temps réel, et obtenez instantanément le métré complet
(volume, poids, coût, surface habitable). Démontre le principe
fondateur d'HCOSMO : **le métré vient toujours du modèle, jamais
désynchronisé.**

Le script de démo minute par minute pour la présentation du 15 juillet
se trouve dans `SCRIPT_DEMO_15_JUILLET.md` à la racine du dépôt.

## Structure du projet

```
hcosmo_prototype/
├── backend/
│   ├── main.py                        # API FastAPI (calculs BIM, tous les éléments)
│   ├── requirements.txt
│   ├── test_main.py                   # tests v2 : murs, dalles, poteaux, fenêtres
│   ├── test_main_v3_ajouts.py         # tests v3 : portes, toits, électricité, ardoise
│   ├── test_main_v4_soubassement.py   # tests v4 : soubassement automatique
│   ├── test_main_v5_cloisons.py       # tests v5 : murs porteurs vs cloisons
│   ├── test_main_v6_surface_habitable.py  # tests v6 : surface habitable
│   └── venv/
├── frontend/
│   ├── index.html                     # logos HCOSMO intégrés en base64 (voir plus bas)
│   ├── script.js                      # scène 3D + plan 2D + outils de dessin + calcul
│   ├── style.css
│   └── assets/
│       └── favicon.png                # seul fichier image encore externe
└── SCRIPT_DEMO_15_JUILLET.md
```

## Lancer le projet

### 1. Backend

```powershell
cd backend
venv\Scripts\Activate.ps1        # macOS/Linux : source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

Vérifier que ça fonctionne : ouvrir `http://localhost:8000/api/ping`
dans un navigateur, doit afficher un message JSON.

Documentation interactive de l'API : `http://localhost:8000/docs`

### 2. Frontend

Ouvrir `frontend/index.html` avec l'extension VS Code **Live Server**
(clic droit sur le fichier → "Open with Live Server").

⚠️ Le backend n'est **plus strictement obligatoire** pour faire une
démo : si le backend est injoignable, le frontend bascule
automatiquement sur un **calcul de secours en local** (mêmes formules,
recopiées à la main dans `script.js`). Le message de statut
correspondant est actuellement **masqué visuellement** (`display: none`
dans `style.css`, pour ne pas gêner la vue pendant la démo) — la
logique reste active en arrière-plan, seules les alertes de validation
continuent de s'afficher.

## Lancer les tests automatisés

```powershell
cd backend
pytest -v
```

`pytest` détecte automatiquement tous les fichiers `test_*.py` du
dossier (`test_main.py`, `test_main_v3_ajouts.py`,
`test_main_v4_soubassement.py`, `test_main_v5_cloisons.py`,
`test_main_v6_surface_habitable.py`). Tous les tests doivent afficher
`PASSED`.

## Écran d'accueil — choix du domaine

Au chargement, un écran présente **5 domaines** possibles pour HCOSMO,
dans un souci de transparence envers les investisseurs (montrer la
vision complète sans survendre ce qui n'est pas prêt) :

| Domaine | État |
|---|---|
| 🏗️ BTP (Bâtiment et Travaux Publics) | **Disponible** — c'est le prototype actuel |
| ⚙️ Mécanique / CAO | 🔒 Aperçu d'interface uniquement |
| 🔋 Électronique | 🔒 Aperçu d'interface uniquement |
| 📊 Modélisation 3D | 🔒 Aperçu d'interface uniquement |
| 🔥 Énergétique | 🔒 Aperçu d'interface uniquement |

Cliquer sur un domaine verrouillé ouvre un **écran plein format non
fonctionnel**, avec un bandeau jaune permanent "🔒 APERÇU — Interface
non fonctionnelle" impossible à manquer :
- La barre d'outils du haut est cliquable (chaque bouton déclenche une
  alerte explicite "aperçu, pas encore fonctionnel"), plutôt que
  simplement désactivée — pour que l'écran ne semble pas mort.
- Le panneau de réglages contient de vrais champs texte, cliquables et
  modifiables, chacun marqué d'une étiquette **"aperçu"** — la valeur
  tapée reste locale au champ, n'est jamais envoyée ni recalculée.
- Le texte de vision (repris du cahier des charges) reste affiché au
  centre.

Rien dans cet écran ne doit jamais donner l'impression qu'un calcul
réel a lieu — c'est la limite à ne pas franchir, y compris si la
pression du jour J pousse à vouloir "rendre ça plus vivant".
"← Retour à l'accueil" ramène à l'écran de choix.

⚠️ Le contenu du domaine **Électronique** reste volontairement
générique : le cahier des charges HCOSMO ne le détaille pas encore. Si
la question est posée en démo, le dire franchement plutôt que
d'improviser des fonctionnalités.

## Comment utiliser le prototype

### Barre supérieure

- **Logo** (cliquable) : retour à l'écran d'accueil
- **↶ / ↷** : annuler / rétablir (`Ctrl+Z` / `Ctrl+Y`)
- **🆕 Nouveau projet** : ouvre une confirmation avant de vider le plateau
- **Voir le plan 2D** : bascule entre la vue 3D et le plan avec cotes et grille
- **🎯 Cadrer** : recentre la caméra 3D sur tous les éléments existants
- **🤖 IA** : ouvre le panneau assistant IA — **fonctionnalité à venir**,
  affichée pour montrer la vision, jamais présentée comme fonctionnelle
- **❓ Aide** : ouvre une modale d'aide rapide (comprend la liste des
  raccourcis clavier)

### Raccourcis clavier

| Raccourci | Action |
|---|---|
| `Ctrl+Z` | Annuler |
| `Ctrl+Y` (ou `Ctrl+Maj+Z`) | Rétablir |
| `Ctrl+D` | Duplique l'élément sélectionné (mur, dalle, poteau, toit) |
| `Maj` maintenue en traçant un mur | Accroche l'angle à 45° |
| `Échap` | Quitte l'outil de dessin en cours / ferme la fenêtre ouverte |
| `Entrée` | Valide le nom dans "Nouveau projet" |

### Outils de dessin (barre du haut)

| Outil | Action |
|---|---|
| ▭ Dalle / 🏠 Toit | clic sur un premier coin, puis le coin opposé |
| ✏️ Mur | clic point de départ, puis point d'arrivée (**Maj** = accroche 45°) |
| 🧱 Cloison | même geste que le mur, mais élément **non porteur** (voir plus bas) |
| 📍 Poteau / 🔆 Point lumineux | un seul clic |
| 🪟 Fenêtre / 🚪 Porte / 🔌 Prise / 💡 Interrupteur | clic sur un mur déjà tracé |
| ✋ Arrêter | quitte le mode dessin en cours (aussi : touche **Échap**) |

### Mur porteur vs Cloison

Chaque mur peut être marqué **porteur** (par défaut) ou **cloison**
(non porteur) :
- Un mur **porteur** génère automatiquement un **soubassement**
  (fondation), sans aucune action de l'utilisateur — le soubassement
  suit le mur s'il est déplacé, redimensionné ou tourné, car il n'est
  jamais stocké séparément : il est recalculé à chaque fois côté
  backend à partir des dimensions actuelles du mur.
- Une **cloison** ne génère **aucun** soubassement (une cloison
  intérieure repose sur la dalle déjà coulée dans la réalité).

### Réglages par défaut (panneau ⚙️)

Cette section du panneau latéral contient aussi le bouton
**"🏡 Charger la maison exemple"** (déplacé ici depuis la version
précédente, pour qu'il ne s'affiche plus au-dessus de tous les
onglets). Les réglages de dimensions par défaut (hauteur, épaisseur,
matériau...) s'appliquent aux **nouveaux** éléments dessinés après ce
réglage, pas rétroactivement à ce qui existe déjà.

### Éléments du projet (panneau 📋)

Chaque élément posé reste éditable individuellement (dimensions,
matériau, position). **Duplication** : bouton 📋 ou raccourci `Ctrl+D`
sur l'élément sélectionné — murs, dalles, poteaux et toits seulement.
Dupliquer un mur duplique aussi ses fenêtres/portes/éléments
électriques rattachés (symétrique de la suppression en cascade).
Les éléments électriques sont pour l'instant seulement supprimables,
pas encore modifiables après création.

### Export / Réinitialisation (panneau 📊)

- **💾 Exporter le projet (JSON)** : télécharge un fichier avec les
  paramètres actuels et les derniers résultats calculés
- **🗑 Tout effacer** : vide le projet (avec confirmation)

## Fonctionnalités actuelles

- Dessin libre sur un plan 2D avec accroche à 45°, aperçu en direct
- Grille du plan 2D **adaptative** : couvre toute la zone de
  construction disponible (largeur et hauteur réelles de la fenêtre),
  recalculée à l'ouverture du plan et à chaque redimensionnement —
  plus de zone vide sur les côtés
- Distinction **mur porteur / cloison**, avec soubassement automatique
  dérivé uniquement pour les murs porteurs
- Suppression en cascade : supprimer un mur supprime automatiquement
  ses fenêtres/portes/prises/interrupteurs devenus orphelins
- Sélection bidirectionnelle scène 3D ↔ liste du panneau (raycasting +
  surbrillance synchronisée dans les deux sens)
- Transformations par saisie de champs : déplacement (position X/Z),
  rotation (en degrés, convertie en radians pour Three.js), et boutons
  de symétrie/miroir sur certains éléments
- **Duplication** (bouton 📋 ou raccourci `Ctrl+D`) : murs, dalles,
  poteaux et toits. Dupliquer un mur duplique aussi ses
  fenêtres/portes/éléments électriques rattachés. Fenêtres, portes et
  éléments électriques ne sont pas duplicables individuellement — ils
  suivent uniquement la duplication de leur mur hôte.
- Historique annuler/rétablir (`Ctrl+Z` / `Ctrl+Y`), capture l'état
  complet du projet à chaque recalcul (donc une duplication en cascade
  s'annule bien en un seul geste)
- Visualisation 3D temps réel (ombres portées, cadrage automatique,
  limites de caméra)
- Plan 2D avec cotes et grille adaptative
- Métré automatique complet : volume, poids, coût, **surface
  habitable totale** (somme des surfaces de dalles)
- Toit à pente réglable et orientable (rotation), 4 matériaux de
  couverture (tuile, tôle, ardoise, béton-terrasse)
- 4 matériaux de structure : béton, brique, bois, placo (cloisons)
- Validation croisée porte/fenêtre vs longueur du mur porteur (rejetée
  avec un message clair si incohérente), côté client ET serveur
- Mode local de secours si le backend est indisponible
- Export JSON du projet complet
- Écran d'accueil à 5 domaines, avec aperçu plein format non
  fonctionnel pour les 4 domaines verrouillés (voir plus haut)
- Identité visuelle HCOSMO : logo complet sur l'écran d'accueil, icône
  seule dans la barre du haut (façon VS Code), les deux intégrées
  directement dans `index.html` en base64 — aucune dépendance à un
  chemin de fichier externe pour les logos (seul le favicon reste un
  fichier séparé dans `assets/`). Filet de sécurité intégré : si une
  image ne charge pas, un texte de secours stylé s'affiche à la place,
  jamais l'icône "image cassée" du navigateur.
- Palette de couleurs reprise du logo (indigo/violet sur fond marine)
- Écran d'accueil défilable si le contenu dépasse la hauteur de la fenêtre
- Modales : Nouveau projet, Aide (avec raccourcis clavier)
- Suite de tests automatisés (pytest)

## Limites connues (assumées pour ce prototype de preuve de concept)

- Le lot électrique reste **symbolique** (forfait par point, pas de
  vrai calcul de circuits/sections de câble) — à préciser en démo si
  la question est posée
- Les éléments électriques ne sont pas encore éditables après création
  (seulement supprimables)
- Réduire un mur après y avoir posé une porte/fenêtre ne déplace ni ne
  supprime l'ouverture : à éviter pendant la démo pour ne pas produire
  un rendu visuellement incohérent
- Aucune validation serveur ne bloque une porte/fenêtre plus large que
  le mur qui la porte si on modifie les dimensions après coup (seul le
  clic de création initiale est contrôlé côté frontend)
- Le panneau assistant IA est un aperçu de la vision, non fonctionnel
- 4 des 5 domaines de l'écran d'accueil ouvrent un aperçu d'interface
  non fonctionnel ("bientôt disponible")
- Le domaine Électronique n'a pas de contenu détaillé dans le cahier
  des charges — son aperçu reste volontairement générique

## Pièges connus / notes pour l'équipe

- Le port du backend doit être exactement `8000` — une faute de frappe
  courante est `800` au lieu de `8000`, qui démarre sans erreur mais
  empêche le frontend de se connecter (il basculera alors en mode local).
- Toujours relancer `pytest -v` après une modification de `main.py`
  avant de considérer une fonctionnalité comme terminée.
- `calculerProjetSecours()` dans `script.js` doit rester **manuellement
  synchronisée** avec les formules de `main.py`, **y compris la
  logique de soubassement automatique** (dérivée, pas stockée) — c'est
  le point le plus facile à désynchroniser par erreur lors d'une
  fusion de code entre binômes.
- Après toute fusion de code entre binômes, repasser rapidement la
  liste "Fonctionnalités actuelles" ci-dessus avant de considérer le
  prototype stable.
- Note de nommage CSS : la classe `.bouton-miroir` est réutilisée pour
  plusieurs actions (`dupliquer`, `miroir-x`, `miroir-z`), pas
  seulement le miroir malgré son nom — historique de développement, à
  garder en tête si vous retouchez ce style un jour.
- Si un logo ne s'affiche pas malgré tout : les deux logos principaux
  sont encodés en base64 directement dans `index.html` (aucun fichier
  externe), donc un logo cassé à ce stade viendrait d'un fichier
  `index.html` corrompu ou remplacé par une ancienne version — pas
  d'un problème de chemin. Seul `assets/favicon.png` reste un fichier
  à part.
