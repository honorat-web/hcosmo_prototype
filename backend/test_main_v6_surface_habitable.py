# test_main_v6_surface_habitable.py — surface habitable = somme des dalles
# pytest test_main_v6_surface_habitable.py -v

from fastapi.testclient import TestClient
from main import app

client = TestClient(app)


def test_surface_habitable_somme_les_dalles():
    """La surface habitable doit être la somme des surfaces (longueur x
    largeur) de toutes les dalles, indépendamment des murs/toits/soubassements."""
    reponse = client.post("/api/calculer-projet", json={
        "murs": [], "poteaux": [], "fenetres": [], "portes": [], "toits": [],
        "elements_electriques": [], "tableau_electrique": False,
        "dalles": [
            {"id": "d1", "longueur": 4.0, "largeur": 3.0, "epaisseur": 0.15, "materiau": "beton", "positionX": 0, "positionZ": 0},
            {"id": "d2", "longueur": 2.0, "largeur": 2.0, "epaisseur": 0.15, "materiau": "beton", "positionX": 5, "positionZ": 0},
        ],
    })
    assert reponse.status_code == 200
    data = reponse.json()
    assert data["dalles"][0]["surface_m2"] == 12.0
    assert data["dalles"][1]["surface_m2"] == 4.0
    assert data["total"]["surface_habitable_m2"] == 16.0


def test_surface_habitable_zero_sans_dalle():
    """Un projet sans dalle (que des murs, par exemple) doit renvoyer
    une surface habitable à 0, pas planter."""
    reponse = client.post("/api/calculer-projet", json={
        "murs": [{
            "id": "mur-1", "longueur": 4.0, "hauteur": 2.5, "epaisseur": 0.2,
            "materiau": "beton", "positionX": 0, "positionZ": 0, "rotationY": 0
        }],
        "dalles": [], "poteaux": [], "fenetres": [], "portes": [], "toits": [],
        "elements_electriques": [], "tableau_electrique": False,
    })
    assert reponse.status_code == 200
    assert reponse.json()["total"]["surface_habitable_m2"] == 0
