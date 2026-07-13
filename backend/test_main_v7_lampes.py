# test_main_v7_lampes.py — catégories de lampes pour les points lumineux
# pytest test_main_v7_lampes.py -v

from fastapi.testclient import TestClient
from main import app

client = TestClient(app)


def _projet_avec_lampe(categorie=None):
    lampe = {"id": "l1", "type": "point_lumineux", "positionX": 0, "positionZ": 0}
    if categorie is not None:
        lampe["categorie_lampe"] = categorie
    return {
        "murs": [], "dalles": [], "poteaux": [], "fenetres": [], "portes": [],
        "toits": [], "tableau_electrique": False,
        "elements_electriques": [lampe],
    }


def test_point_lumineux_sans_categorie_reste_a_60_euros():
    """Non-régression : un point lumineux envoyé SANS categorie_lampe
    (anciennes requêtes/tests) doit continuer à coûter 60€ pile, comme
    avant l'introduction des catégories."""
    reponse = client.post("/api/calculer-projet", json=_projet_avec_lampe())
    assert reponse.status_code == 200
    data = reponse.json()
    assert data["elements_electriques"][0]["cout_eur"] == 60
    assert data["elements_electriques"][0]["categorie_lampe"] == "plafonnier"


def test_prix_par_categorie_de_lampe():
    """Chaque catégorie de lampe a son propre forfait fourniture+pose."""
    prix_attendus = {"ampoule": 25, "plafonnier": 60, "suspension": 90, "spot": 45}
    for categorie, prix in prix_attendus.items():
        reponse = client.post("/api/calculer-projet", json=_projet_avec_lampe(categorie))
        data = reponse.json()
        assert data["elements_electriques"][0]["cout_eur"] == prix, categorie
        assert data["elements_electriques"][0]["categorie_lampe"] == categorie


def test_categorie_lampe_inconnue_retombe_sur_plafonnier():
    """Une catégorie non reconnue (bug d'intégration, valeur obsolète)
    ne doit pas planter l'API -- elle retombe sur le prix plafonnier."""
    reponse = client.post("/api/calculer-projet", json=_projet_avec_lampe("neon-vintage"))
    assert reponse.status_code == 200
    assert reponse.json()["elements_electriques"][0]["cout_eur"] == 60


def test_categorie_lampe_absente_pour_prise_et_interrupteur():
    """Une prise ou un interrupteur ne doit jamais afficher de
    categorie_lampe (ça n'a de sens que pour un point lumineux)."""
    reponse = client.post("/api/calculer-projet", json={
        "murs": [], "dalles": [], "poteaux": [], "fenetres": [], "portes": [],
        "toits": [], "tableau_electrique": False,
        "elements_electriques": [
            {"id": "p1", "type": "prise", "positionX": 0, "positionZ": 0},
            {"id": "i1", "type": "interrupteur", "positionX": 0, "positionZ": 0},
        ],
    })
    data = reponse.json()
    assert data["elements_electriques"][0]["categorie_lampe"] is None
    assert data["elements_electriques"][1]["categorie_lampe"] is None
    assert data["elements_electriques"][0]["cout_eur"] == 45
    assert data["elements_electriques"][1]["cout_eur"] == 35


def test_total_reflete_bien_le_prix_de_la_categorie():
    """Le coût total du projet doit refléter le prix de la catégorie
    choisie, pas le forfait générique point_lumineux (60€) par défaut."""
    reponse = client.post("/api/calculer-projet", json=_projet_avec_lampe("suspension"))
    data = reponse.json()
    assert data["total"]["cout_total_eur"] == 90
