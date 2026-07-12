# HCOSMO — Prototype de preuve de concept

Éditeur BIM paramétrique web : dessinez librement une petite maison
(murs, dalles, poteaux, fenêtres, portes, toit, éléments électriques)
sur un plan 2D interactif, visualisez le résultat en 3D en temps réel,
et obtenez instantanément le métré complet (volume, poids, coût).
Démontre le principe fondateur d'HCOSMO : **le métré vient toujours du
modèle, jamais désynchronisé.**

## Structure du projet

```
hcosmo_prototype/
├── backend/
│   ├── main.py                  # API FastAPI (calculs BIM, tous les éléments)
│   ├── requirements.txt
│   ├── test_main.py             # tests automatisés (murs, dalles, poteaux, fenêtres)
│   ├── test_main_v3_ajouts.py   # tests automatisés (portes, toits, électricité)
│   └── venv/
└── frontend/
    ├── index.html
    ├── script.js                 # scène 3D + plan 2D + outils de dessin + calcul
    └── style.css
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
recopiées à la main dans `script.js`). Le bandeau de statut en bas à
gauche affiche alors "Mode local ⚠️" au lieu de "Backend connecté ✅".
Ce mode de secours reste un filet de sécurité pour la démo, pas un
remplacement : le backend doit être lancé en conditions normales.

## Lancer les tests automatisés

```powershell
cd backend
pytest -v
```

`pytest` détecte automatiquement `test_main.py` **et**
`test_main_v3_ajouts.py` (tout fichier `test_*.py` du dossier est pris
en compte). Tous les tests doivent afficher `PASSED`.

## Comment utiliser le prototype

1. Le plateau démarre **vide** — aucun élément par défaut.
2. Cliquez sur **"Voir le plan 2D"** pour passer en mode dessin.
3. Dans la barre d'outils du plan, choisissez un outil :
   - **▭ Dalle** / **🏠 Toit** : cliquez un premier coin, puis le coin opposé
   - **✏️ Mur** : cliquez le point de départ, puis le point d'arrivée
     (maintenir **Maj** pendant le tracé accroche l'angle à 45°)
   - **📍 Poteau** / **🔆 Point lumineux** : un seul clic à l'endroit voulu
   - **🪟 Fenêtre** / **🚪 Porte** / **🔌 Prise** / **💡 Interrupteur** :
     cliquez sur un mur déjà tracé
   - **✋ Arrêter** ou touche **Échap** : quitte le mode dessin en cours
4. Les dimensions par défaut de chaque type d'élément (matériau,
   épaisseur, hauteur...) se règlent dans le panneau de gauche, section
   **"Réglages par défaut"** — elles s'appliquent aux éléments dessinés
   **après** ce réglage, pas rétroactivement aux éléments déjà posés.
5. Chaque élément posé apparaît dans **"Éléments du projet"**, où ses
   dimensions restent modifiables individuellement (sauf les éléments
   électriques, seulement supprimables pour l'instant).
6. **💾 Exporter le projet** télécharge un fichier `.json` avec les
   paramètres et les derniers résultats calculés.
7. **🗑 Tout effacer** vide entièrement le projet (avec confirmation).
8. **🎯 Cadrer la vue** recentre automatiquement la caméra 3D sur tous
   les éléments existants.

## Fonctionnalités actuelles

- Dessin libre sur un plan 2D : murs (avec rotation), dalles, poteaux,
  fenêtres, portes, toit à deux pans, éléments électriques (prises,
  interrupteurs, points lumineux), tableau électrique (case à cocher)
- Visualisation 3D temps réel synchronisée (rotation/zoom à la souris,
  ombres portées, cadrage automatique)
- Plan 2D avec cotes, grille, aperçu en direct pendant le tracé
- Chaque élément reste éditable individuellement après sa création
  (sauf électricité, voir "Limites connues")
- Suppression en cascade : supprimer un mur supprime automatiquement
  ses fenêtres/portes/prises/interrupteurs devenus orphelins
- Duplication (bouton 📋 ou raccourci `Ctrl+D` sur l'élément sélectionné) :
  murs, dalles, poteaux et toits. Dupliquer un mur duplique aussi ses
  fenêtres/portes/éléments électriques rattachés (symétrique de la
  suppression en cascade). Fenêtres/portes/électricité ne sont pas
  duplicables individuellement (elles dépendent d'un mur hôte).
- Métré automatique complet : volume, poids, coût — par élément et
  en cumulé (fenêtres et portes déduisent le volume du mur qui les porte)
- Toit à pente réglable, avec correction de surface réelle de couverture
- Mode local de secours si le backend est indisponible (mêmes formules)
- Export JSON du projet complet
- 3 matériaux de structure (béton, brique, bois) + 3 matériaux de
  toiture (tuile, tôle, béton-terrasse)
- Suite de tests automatisés (pytest) couvrant calculs, validations et
  cas limites

## Limites connues (assumées pour ce prototype de preuve de concept)

- Le lot électrique est **symbolique** : un forfait fixe par prise/
  interrupteur/point lumineux, sans calcul réel de circuits, sections
  de câble ou disjoncteurs. À dire clairement en démo si la question
  est posée.
- Les éléments électriques ne sont pas repositionnables/redimensionnables
  après création — seulement supprimables.
- Réduire un mur après y avoir posé une porte/fenêtre ne déplace ni ne
  supprime l'ouverture : à éviter pendant la démo pour ne pas produire
  un rendu visuellement incohérent.
- Aucune validation serveur ne bloque une porte/fenêtre plus large que
  le mur qui la porte si on modifie les dimensions après coup (seul le
  clic de création initiale est contrôlé côté frontend).
- Le toit est toujours aligné sur les axes du monde (pas de rotation
  possible, contrairement aux murs).

## Pièges connus / notes pour l'équipe

- Le port du backend doit être exactement `8000` — une faute de frappe
  courante est `800` au lieu de `8000`, qui démarre sans erreur mais
  empêche le frontend de se connecter (il basculera alors en mode local).
- Toujours relancer `pytest -v` après une modification de `main.py`
  avant de considérer une fonctionnalité comme terminée.
- `calculerProjetSecours()` dans `script.js` doit rester **manuellement
  synchronisée** avec les formules de `main.py` — si vous changez une
  formule d'un côté, pensez à répercuter le même changement de l'autre,
  sinon le mode local de secours donnera des résultats différents du
  backend réel.
