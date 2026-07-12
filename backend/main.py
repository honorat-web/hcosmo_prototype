# backend/main.py — v3 : ajout Porte, Toit, et lot électrique simplifié
#
# NOTE IMPORTANTE POUR L'ÉQUIPE :
# Le module électrique ci-dessous est volontairement SYMBOLIQUE : on compte
# des points (prises, interrupteurs, luminaires) avec un forfait de coût
# chacun. Ce n'est PAS un vrai calcul de circuits/disjoncteurs/sections de
# câble — ce serait un métier à part entière. On l'assume et on le dit
# clairement en démo : "notre BIM intègre déjà les lots techniques, la
# vraie ingénierie électrique viendra dans une phase ultérieure".

import math
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import List, Optional

app = FastAPI(title="HCOSMO Backend - Prototype v3")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def racine():
    return {"message": "Backend HCOSMO en ligne."}


@app.get("/api/ping")
def ping():
    return {"status": "ok", "service": "hcosmo-backend", "version": "v3-maison-electricite"}


# ---------------------------------------------------------------
# Matériaux structure (identique à v2)
# ---------------------------------------------------------------
MATERIAUX = {
    "beton":  {"densite_kg_m3": 2400, "prix_eur_m3": 120, "couleur_hex": 0x9a9a9a},
    "brique": {"densite_kg_m3": 1800, "prix_eur_m3": 90,  "couleur_hex": 0xb5651d},
    "bois":   {"densite_kg_m3": 500,  "prix_eur_m3": 250, "couleur_hex": 0x8b5a2b},
}

PRIX_FENETRE_EUR = 350

# --- NOUVEAU : soubassement (fondation) automatique ---
# Chaque mur génère automatiquement un soubassement en béton, sans que
# l'utilisateur ait à le créer ou l'éditer séparément. Il est DÉRIVÉ du
# mur à chaque calcul (voir calculer_projet ci-dessous) : s'il bouge,
# tourne ou change de longueur, son soubassement suit automatiquement,
# sans code de synchronisation à part -- ce n'est pas stocké comme un
# élément indépendant.
HAUTEUR_SOUBASSEMENT_M = 0.4     # hauteur fixe, réaliste pour une fondation simple
DEBORD_SOUBASSEMENT_M = 0.1      # la semelle déborde de 0.1m de CHAQUE côté du mur
MATERIAU_SOUBASSEMENT = "beton"  # toujours béton, quel que soit le matériau du mur

# --- NOUVEAU : porte ---
# Forfait fourniture + pose d'une porte intérieure standard (huisserie incluse).
PRIX_PORTE_EUR = 280

# --- NOUVEAU : matériaux de toiture ---
# Le toit se chiffre au m² de couverture réelle (pas au m³ comme un mur),
# c'est l'usage du métier : on parle de "prix au m² de couverture".
MATERIAUX_TOIT = {
    "tuile": {"prix_eur_m2": 45, "poids_kg_m2": 40},
    "tole":  {"prix_eur_m2": 25, "poids_kg_m2": 12},
    "beton": {"prix_eur_m2": 60, "poids_kg_m2": 300},  # toit-terrasse
}

# --- NOUVEAU : lot électrique (forfaits fourniture + pose, valeurs indicatives) ---
ELECTRICITE_PRIX_EUR = {
    "prise": 45,
    "interrupteur": 35,
    "point_lumineux": 60,
}
PRIX_TABLEAU_ELECTRIQUE_EUR = 450  # un seul par projet, forfait


# ---------------------------------------------------------------
# Modèles existants (v2, inchangés)
# ---------------------------------------------------------------

# --- NOUVEAU : matériau des cloisons non porteuses ---
# Une cloison type placo (plaques de plâtre sur ossature métallique,
# avec son isolant) : dense volume mais léger au m3 réel comparé au
# béton, et un prix au m3 qui reste un forfait fourniture+pose simplifié.
MATERIAUX["placo"] = {"densite_kg_m3": 700, "prix_eur_m3": 180, "couleur_hex": 0xe8e4da}


class Mur(BaseModel):
    id: str
    longueur: float = Field(gt=0, le=50)
    hauteur: float = Field(gt=0, le=20)
    epaisseur: float = Field(gt=0, le=2)
    materiau: str
    positionX: float = 0
    positionZ: float = 0
    rotationY: float = 0
    # NOUVEAU : distingue un mur PORTEUR (structurel, génère un
    # soubassement automatique) d'une CLOISON non porteuse (pas de
    # fondation propre -- elle repose simplement sur la dalle déjà
    # coulée). Par défaut True pour ne rien changer aux murs existants.
    porteur: bool = True


class Dalle(BaseModel):
    id: str
    longueur: float = Field(gt=0, le=30)
    largeur: float = Field(gt=0, le=30)
    epaisseur: float = Field(gt=0, le=0.5)
    materiau: str
    positionX: float = 0
    positionZ: float = 0


class Poteau(BaseModel):
    id: str
    cote: float = Field(gt=0, le=2)
    hauteur: float = Field(gt=0, le=10)
    materiau: str
    positionX: float = 0
    positionZ: float = 0


class Fenetre(BaseModel):
    id: str
    mur_id: str
    offset: float = Field(ge=0)
    largeur: float = Field(gt=0, le=10)
    hauteur: float = Field(gt=0, le=5)
    hauteur_allege: float = Field(ge=0, le=10)


# ---------------------------------------------------------------
# NOUVEAUX modèles — Binôme A (maison complète)
# ---------------------------------------------------------------

class Porte(BaseModel):
    """Même logique que Fenetre : appartient à un mur, réduit son volume.
    Contrairement à la fenêtre, une porte part toujours du sol
    (pas de hauteur_allege)."""
    id: str
    mur_id: str
    offset: float = Field(ge=0)         # distance depuis le début du mur, en m
    largeur: float = Field(gt=0, le=3)
    hauteur: float = Field(gt=0, le=3)


class Toit(BaseModel):
    """Toit rectangulaire simple au-dessus d'une emprise longueur x largeur,
    avec une pente en degrés (0 = toit plat/terrasse)."""
    id: str
    longueur: float = Field(gt=0, le=50)
    largeur: float = Field(gt=0, le=30)
    pente_degres: float = Field(ge=0, le=60)
    materiau: str                        # "tuile" | "tole" | "beton"
    positionX: float = 0
    positionZ: float = 0


# ---------------------------------------------------------------
# NOUVEAUX modèles — Binôme B (électricité simplifiée)
# ---------------------------------------------------------------

class ElementElectrique(BaseModel):
    """Un point électrique symbolique : prise, interrupteur ou point
    lumineux. mur_id est optionnel (un point lumineux au plafond n'est
    rattaché à aucun mur)."""
    id: str
    type: str                            # "prise" | "interrupteur" | "point_lumineux"
    mur_id: Optional[str] = None
    positionX: float = 0
    positionZ: float = 0


# ---------------------------------------------------------------
# Projet global — étendu avec les nouvelles listes
# ---------------------------------------------------------------

class ProjetParametres(BaseModel):
    murs: List[Mur] = []
    dalles: List[Dalle] = []
    poteaux: List[Poteau] = []
    fenetres: List[Fenetre] = []
    portes: List[Porte] = []                          # NOUVEAU
    toits: List[Toit] = []                             # NOUVEAU
    elements_electriques: List[ElementElectrique] = []  # NOUVEAU
    tableau_electrique: bool = False                    # NOUVEAU — un seul par projet


# ---------------------------------------------------------------
# Calcul
# ---------------------------------------------------------------

@app.post("/api/calculer-projet")
def calculer_projet(params: ProjetParametres):
    # NOUVEAU : validation croisée. Pydantic valide chaque champ
    # individuellement (ex: largeur > 0), mais ne peut pas facilement
    # vérifier qu'une fenêtre n'est pas plus large que le mur qui la
    # porte -- ça dépend d'un AUTRE objet de la requête. On fait donc
    # ce contrôle manuellement, avant tout calcul.
    murs_par_id = {mur.id: mur for mur in params.murs}

    for fenetre in params.fenetres:
        mur = murs_par_id.get(fenetre.mur_id)
        if mur and fenetre.largeur > mur.longueur:
            raise HTTPException(
                status_code=422,
                detail=(
                    f"La fenêtre {fenetre.id} (largeur {fenetre.largeur}m) "
                    f"est plus large que le mur {mur.id} ({mur.longueur}m)."
                ),
            )

    for porte in params.portes:
        mur = murs_par_id.get(porte.mur_id)
        if mur and porte.largeur > mur.longueur:
            raise HTTPException(
                status_code=422,
                detail=(
                    f"La porte {porte.id} (largeur {porte.largeur}m) "
                    f"est plus large que le mur {mur.id} ({mur.longueur}m)."
                ),
            )

    total_volume = 0.0
    total_poids = 0.0
    total_cout = 0.0

    # --- Murs (soustraction fenêtres ET portes) ---
    resultats_murs = []
    for mur in params.murs:
        materiau_info = MATERIAUX.get(mur.materiau, MATERIAUX["beton"])

        fenetres_du_mur = [f for f in params.fenetres if f.mur_id == mur.id]
        portes_du_mur = [p for p in params.portes if p.mur_id == mur.id]  # NOUVEAU

        volume_brut = mur.longueur * mur.hauteur * mur.epaisseur
        volume_fenetres = sum(f.largeur * f.hauteur * mur.epaisseur for f in fenetres_du_mur)
        volume_portes = sum(p.largeur * p.hauteur * mur.epaisseur for p in portes_du_mur)  # NOUVEAU
        volume_net = max(0.0, volume_brut - volume_fenetres - volume_portes)

        poids = volume_net * materiau_info["densite_kg_m3"]
        cout_matiere = volume_net * materiau_info["prix_eur_m3"]
        cout_fenetres = len(fenetres_du_mur) * PRIX_FENETRE_EUR
        cout_portes = len(portes_du_mur) * PRIX_PORTE_EUR  # NOUVEAU
        cout_total = cout_matiere + cout_fenetres + cout_portes

        resultats_murs.append({
            "id": mur.id,
            "volume_m3": round(volume_net, 3),
            "poids_kg": round(poids, 1),
            "cout_total_eur": round(cout_total, 2),
            "nb_fenetres": len(fenetres_du_mur),
            "nb_portes": len(portes_du_mur),  # NOUVEAU
            "porteur": mur.porteur,  # NOUVEAU -- le frontend s'en sert pour l'étiquette "Mur"/"Cloison"
            "couleur_hex": materiau_info["couleur_hex"],
        })
        total_volume += volume_net
        total_poids += poids
        total_cout += cout_total

    # --- NOUVEAU : soubassements, un par mur PORTEUR, entièrement DÉRIVÉS ---
    # Pas de boucle sur une liste fournie par le frontend : on parcourt
    # params.murs (la même liste que ci-dessus) et on calcule un
    # soubassement pour chacun, à la volée. C'est ce qui garantit que le
    # soubassement suit le mur sans jamais pouvoir désynchroniser.
    # NOUVEAU : une cloison (porteur=False) n'a PAS de soubassement --
    # dans la réalité, une cloison intérieure repose sur la dalle déjà
    # coulée, elle ne nécessite pas sa propre fondation.
    resultats_soubassements = []
    materiau_soubassement_info = MATERIAUX[MATERIAU_SOUBASSEMENT]
    for mur in params.murs:
        if not mur.porteur:
            continue
        epaisseur_soubassement = mur.epaisseur + 2 * DEBORD_SOUBASSEMENT_M
        volume = mur.longueur * HAUTEUR_SOUBASSEMENT_M * epaisseur_soubassement
        poids = volume * materiau_soubassement_info["densite_kg_m3"]
        cout = volume * materiau_soubassement_info["prix_eur_m3"]

        resultats_soubassements.append({
            "id": mur.id,        # même id que son mur : relation 1-pour-1
            "mur_id": mur.id,
            "epaisseur_m": round(epaisseur_soubassement, 3),
            "hauteur_m": HAUTEUR_SOUBASSEMENT_M,
            "volume_m3": round(volume, 3),
            "poids_kg": round(poids, 1),
            "cout_total_eur": round(cout, 2),
            "couleur_hex": materiau_soubassement_info["couleur_hex"],
        })
        total_volume += volume
        total_poids += poids
        total_cout += cout

    # --- Dalles (inchangé) ---
    resultats_dalles = []
    for dalle in params.dalles:
        materiau_info = MATERIAUX.get(dalle.materiau, MATERIAUX["beton"])
        volume = dalle.longueur * dalle.largeur * dalle.epaisseur
        poids = volume * materiau_info["densite_kg_m3"]
        cout = volume * materiau_info["prix_eur_m3"]
        resultats_dalles.append({
            "id": dalle.id, "volume_m3": round(volume, 3),
            "poids_kg": round(poids, 1), "cout_total_eur": round(cout, 2),
            "couleur_hex": materiau_info["couleur_hex"],
        })
        total_volume += volume
        total_poids += poids
        total_cout += cout

    # --- Poteaux (inchangé) ---
    resultats_poteaux = []
    for poteau in params.poteaux:
        materiau_info = MATERIAUX.get(poteau.materiau, MATERIAUX["beton"])
        volume = poteau.cote * poteau.cote * poteau.hauteur
        poids = volume * materiau_info["densite_kg_m3"]
        cout = volume * materiau_info["prix_eur_m3"]
        resultats_poteaux.append({
            "id": poteau.id, "volume_m3": round(volume, 3),
            "poids_kg": round(poids, 1), "cout_total_eur": round(cout, 2),
            "couleur_hex": materiau_info["couleur_hex"],
        })
        total_volume += volume
        total_poids += poids
        total_cout += cout

    # --- NOUVEAU : Toits ---
    resultats_toits = []
    for toit in params.toits:
        materiau_info = MATERIAUX_TOIT.get(toit.materiau, MATERIAUX_TOIT["tuile"])
        surface_horizontale = toit.longueur * toit.largeur
        # La pente augmente la surface réelle de couverture par rapport à
        # la surface "vue du dessus" : facteur = 1 / cos(angle).
        facteur_pente = 1 / math.cos(math.radians(toit.pente_degres))
        surface_reelle = surface_horizontale * facteur_pente

        poids = surface_reelle * materiau_info["poids_kg_m2"]
        cout = surface_reelle * materiau_info["prix_eur_m2"]

        resultats_toits.append({
            "id": toit.id,
            "surface_m2": round(surface_reelle, 2),
            "poids_kg": round(poids, 1),
            "cout_total_eur": round(cout, 2),
        })
        # Un toit compte dans le poids total, mais pas dans "volume" (unité différente, m² pas m3)
        total_poids += poids
        total_cout += cout

    # --- NOUVEAU : lot électrique ---
    resultats_electricite = []
    for elt in params.elements_electriques:
        prix = ELECTRICITE_PRIX_EUR.get(elt.type, 0)
        resultats_electricite.append({
            "id": elt.id, "type": elt.type, "cout_eur": prix,
        })
        total_cout += prix

    if params.tableau_electrique:
        total_cout += PRIX_TABLEAU_ELECTRIQUE_EUR

    return {
        "murs": resultats_murs,
        "soubassements": resultats_soubassements,    # NOUVEAU
        "dalles": resultats_dalles,
        "poteaux": resultats_poteaux,
        "toits": resultats_toits,                    # NOUVEAU
        "elements_electriques": resultats_electricite,  # NOUVEAU
        "total": {
            "volume_m3": round(total_volume, 3),
            "poids_kg": round(total_poids, 1),
            "cout_total_eur": round(total_cout, 2),
            "nb_murs": len(params.murs),
            "nb_dalles": len(params.dalles),
            "nb_poteaux": len(params.poteaux),
            "nb_fenetres": len(params.fenetres),
            "nb_portes": len(params.portes),                        # NOUVEAU
            "nb_toits": len(params.toits),                          # NOUVEAU
            "nb_elements_electriques": len(params.elements_electriques),  # NOUVEAU
            "tableau_electrique": params.tableau_electrique,          # NOUVEAU
        },
    }
