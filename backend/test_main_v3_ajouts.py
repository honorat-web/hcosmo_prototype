# test_main_v3_ajouts.py — tests de DÉPART pour Porte, Toit, électricité
# À fusionner avec test_main.py existant, ou lancer séparément :
# pytest test_main_v3_ajouts.py -v
#
# Juste : à toi de compléter avec plus de cas limites (porte trop grande
# pour le mur, plusieurs toits, mélange complet, etc.) — ceci est le
# minimum pour vérifier que les calculs de base sont corrects.

from fastapi.testclient import TestClient
from main import app

client = TestClient(app)


def test_mur_avec_une_porte_reduit_le_volume():
    """Mur 4 x 2.5 x 0.2 (volume brut 2.0 m3) avec une porte 0.9 x 2.1m.
    Volume retiré = 0.9 x 2.1 x 0.2 (épaisseur du MUR) = 0.378 m3.
    Volume net attendu = 2.0 - 0.378 = 1.622 m3."""
    reponse = client.post("/api/calculer-projet", json={
        "murs": [{
            "id": "mur-1", "longueur": 4.0, "hauteur": 2.5, "epaisseur": 0.2,
            "materiau": "beton", "positionX": 0, "positionZ": 0, "rotationY": 0
        }],
        "dalles": [], "poteaux": [], "fenetres": [],
        "portes": [{
            "id": "porte-1", "mur_id": "mur-1", "offset": 1.0,
            "largeur": 0.9, "hauteur": 2.1
        }],
        "toits": [], "elements_electriques": [], "tableau_electrique": False
    })
    data = reponse.json()
    assert data["murs"][0]["volume_m3"] == 1.622
    assert data["murs"][0]["nb_portes"] == 1
    cout_matiere_attendu = round(1.622 * 120, 2)
    assert data["murs"][0]["cout_total_eur"] == round(cout_matiere_attendu + 280, 2)


def test_toit_plat_calcul_simple():
    """Toit plat (pente 0°) 6 x 5m en tuile : surface = 30 m2 (pas de
    correction de pente puisque cos(0) = 1)."""
    reponse = client.post("/api/calculer-projet", json={
        "murs": [], "dalles": [], "poteaux": [], "fenetres": [], "portes": [],
        "toits": [{
            "id": "toit-1", "longueur": 6.0, "largeur": 5.0,
            "pente_degres": 0, "materiau": "tuile", "positionX": 0, "positionZ": 0
        }],
        "elements_electriques": [], "tableau_electrique": False
    })
    data = reponse.json()
    assert data["toits"][0]["surface_m2"] == 30.0
    assert data["toits"][0]["cout_total_eur"] == 30.0 * 45


def test_toit_pentu_augmente_la_surface_reelle():
    """Même toit avec une pente de 30° : la surface réelle de couverture
    doit être supérieure à la surface horizontale (30 m2)."""
    reponse = client.post("/api/calculer-projet", json={
        "murs": [], "dalles": [], "poteaux": [], "fenetres": [], "portes": [],
        "toits": [{
            "id": "toit-1", "longueur": 6.0, "largeur": 5.0,
            "pente_degres": 30, "materiau": "tuile", "positionX": 0, "positionZ": 0
        }],
        "elements_electriques": [], "tableau_electrique": False
    })
    data = reponse.json()
    assert data["toits"][0]["surface_m2"] > 30.0


def test_elements_electriques_et_tableau_comptes_dans_le_total():
    """2 prises + 1 interrupteur + 1 point lumineux + tableau électrique
    doivent tous s'ajouter au coût total, sans faire planter l'API même
    sans aucun élément structurel (murs/dalles vides)."""
    reponse = client.post("/api/calculer-projet", json={
        "murs": [], "dalles": [], "poteaux": [], "fenetres": [], "portes": [], "toits": [],
        "elements_electriques": [
            {"id": "e1", "type": "prise", "positionX": 0, "positionZ": 0},
            {"id": "e2", "type": "prise", "positionX": 1, "positionZ": 0},
            {"id": "e3", "type": "interrupteur", "positionX": 0, "positionZ": 1},
            {"id": "e4", "type": "point_lumineux", "positionX": 2, "positionZ": 2},
        ],
        "tableau_electrique": True
    })
    assert reponse.status_code == 200
    data = reponse.json()
    cout_attendu = (2 * 45) + 35 + 60 + 450
    assert data["total"]["cout_total_eur"] == cout_attendu
    assert data["total"]["nb_elements_electriques"] == 4
    assert data["total"]["tableau_electrique"] is True


# ---------------------------------------------------------------
# NOUVEAU : validation croisée fenêtre/porte vs longueur du mur
# ---------------------------------------------------------------

def test_fenetre_plus_large_que_le_mur_est_rejetee():
    """Une fenêtre de 5m sur un mur de 4m n'a physiquement aucun sens :
    doit être rejetée avec un 422, pas produire un volume négatif ou
    un résultat trompeur."""
    reponse = client.post("/api/calculer-projet", json={
        "murs": [{
            "id": "mur-1", "longueur": 4.0, "hauteur": 2.5, "epaisseur": 0.2,
            "materiau": "beton", "positionX": 0, "positionZ": 0, "rotationY": 0
        }],
        "dalles": [], "poteaux": [],
        "fenetres": [{
            "id": "fen-1", "mur_id": "mur-1", "offset": 2.0,
            "largeur": 5.0, "hauteur": 1.2, "hauteur_allege": 0.9
        }],
        "portes": [], "toits": [], "elements_electriques": [], "tableau_electrique": False
    })
    assert reponse.status_code == 422
    assert "fen-1" in reponse.json()["detail"]


def test_porte_plus_large_que_le_mur_est_rejetee():
    """Même contrôle pour une porte : 3m de large sur un mur de 2m."""
    reponse = client.post("/api/calculer-projet", json={
        "murs": [{
            "id": "mur-1", "longueur": 2.0, "hauteur": 2.5, "epaisseur": 0.2,
            "materiau": "beton", "positionX": 0, "positionZ": 0, "rotationY": 0
        }],
        "dalles": [], "poteaux": [], "fenetres": [],
        "portes": [{
            "id": "porte-1", "mur_id": "mur-1", "offset": 1.0,
            "largeur": 3.0, "hauteur": 2.1
        }],
        "toits": [], "elements_electriques": [], "tableau_electrique": False
    })
    assert reponse.status_code == 422
    assert "porte-1" in reponse.json()["detail"]


def test_fenetre_de_taille_valide_toujours_acceptee():
    """Non-régression : une fenêtre plus petite que son mur doit
    continuer à passer normalement (200), pas être bloquée par erreur
    par la nouvelle validation."""
    reponse = client.post("/api/calculer-projet", json={
        "murs": [{
            "id": "mur-1", "longueur": 4.0, "hauteur": 2.5, "epaisseur": 0.2,
            "materiau": "beton", "positionX": 0, "positionZ": 0, "rotationY": 0
        }],
        "dalles": [], "poteaux": [],
        "fenetres": [{
            "id": "fen-1", "mur_id": "mur-1", "offset": 2.0,
            "largeur": 1.2, "hauteur": 1.2, "hauteur_allege": 0.9
        }],
        "portes": [], "toits": [], "elements_electriques": [], "tableau_electrique": False
    })
    assert reponse.status_code == 200


# ---------------------------------------------------------------
# NOUVEAU : toiture ardoise + rotation du toit
# ---------------------------------------------------------------

def test_toit_ardoise_prix_correct():
    """Ardoise 6 x 5m, pente 0° -> surface 30 m2, coût = 30 x 85 = 2550 €
    (matériau réel ajouté en plus de tuile/tôle/béton)."""
    reponse = client.post("/api/calculer-projet", json={
        "murs": [], "dalles": [], "poteaux": [], "fenetres": [], "portes": [],
        "toits": [{
            "id": "toit-1", "longueur": 6.0, "largeur": 5.0,
            "pente_degres": 0, "materiau": "ardoise", "positionX": 0, "positionZ": 0
        }],
        "elements_electriques": [], "tableau_electrique": False
    })
    data = reponse.json()
    assert data["toits"][0]["surface_m2"] == 30.0
    assert data["toits"][0]["cout_total_eur"] == 30.0 * 85


def test_toit_rotation_nexiste_pas_par_defaut_et_naffecte_pas_le_calcul():
    """rotationY est un champ purement géométrique/visuel : qu'il soit
    omis (défaut 0) ou renseigné à 90°, la surface et le coût doivent
    rester identiques (tourner un rectangle ne change pas son aire)."""
    base = {
        "murs": [], "dalles": [], "poteaux": [], "fenetres": [], "portes": [],
        "elements_electriques": [], "tableau_electrique": False
    }
    sans_rotation = {**base, "toits": [{
        "id": "toit-1", "longueur": 6.0, "largeur": 5.0,
        "pente_degres": 20, "materiau": "tuile", "positionX": 0, "positionZ": 0
    }]}
    avec_rotation = {**base, "toits": [{
        "id": "toit-1", "longueur": 6.0, "largeur": 5.0,
        "pente_degres": 20, "materiau": "tuile", "positionX": 0, "positionZ": 0,
        "rotationY": 1.5708  # ~90°
    }]}
    data_sans = client.post("/api/calculer-projet", json=sans_rotation).json()
    data_avec = client.post("/api/calculer-projet", json=avec_rotation).json()
    assert data_sans["toits"][0]["surface_m2"] == data_avec["toits"][0]["surface_m2"]
    assert data_sans["toits"][0]["cout_total_eur"] == data_avec["toits"][0]["cout_total_eur"]

