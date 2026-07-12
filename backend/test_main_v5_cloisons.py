# test_main_v5_cloisons.py — tests des cloisons non porteuses
# pytest test_main_v5_cloisons.py -v

from fastapi.testclient import TestClient
from main import app

client = TestClient(app)


def _projet_de_base(murs):
    return {
        "murs": murs, "dalles": [], "poteaux": [], "fenetres": [], "portes": [],
        "toits": [], "elements_electriques": [], "tableau_electrique": False
    }


def test_mur_porteur_par_defaut():
    """Non-régression : un mur envoyé SANS le champ 'porteur' doit être
    traité comme porteur=True par défaut -- les requêtes existantes
    (avant cette fonctionnalité) ne doivent rien changer à leur résultat."""
    reponse = client.post("/api/calculer-projet", json=_projet_de_base([{
        "id": "mur-1", "longueur": 4.0, "hauteur": 2.5, "epaisseur": 0.2,
        "materiau": "beton", "positionX": 0, "positionZ": 0, "rotationY": 0
    }]))
    assert reponse.status_code == 200
    data = reponse.json()
    assert data["murs"][0]["porteur"] is True
    assert len(data["soubassements"]) == 1


def test_cloison_ne_genere_pas_de_soubassement():
    """Une cloison (porteur=False) ne doit produire AUCUN soubassement --
    contrairement à un mur porteur classique."""
    reponse = client.post("/api/calculer-projet", json=_projet_de_base([{
        "id": "cloison-1", "longueur": 3.0, "hauteur": 2.5, "epaisseur": 0.08,
        "materiau": "placo", "positionX": 0, "positionZ": 0, "rotationY": 0,
        "porteur": False
    }]))
    assert reponse.status_code == 200
    data = reponse.json()
    assert data["murs"][0]["porteur"] is False
    assert data["soubassements"] == []


def test_cloison_placo_dimensions_correctes():
    """Cloison 3 x 2.5 x 0.08 en placo -> volume = 0.6 m3,
    poids = 0.6 x 700 = 420 kg, coût = 0.6 x 180 = 108 €."""
    reponse = client.post("/api/calculer-projet", json=_projet_de_base([{
        "id": "cloison-1", "longueur": 3.0, "hauteur": 2.5, "epaisseur": 0.08,
        "materiau": "placo", "positionX": 0, "positionZ": 0, "rotationY": 0,
        "porteur": False
    }]))
    data = reponse.json()
    cloison = data["murs"][0]
    assert cloison["volume_m3"] == 0.6
    assert cloison["poids_kg"] == 420.0
    assert cloison["cout_total_eur"] == 108.0


def test_melange_mur_porteur_et_cloison_un_seul_soubassement():
    """Avec 1 mur porteur + 1 cloison, un seul soubassement doit être
    généré (celui du mur porteur) -- pas deux, pas zéro."""
    reponse = client.post("/api/calculer-projet", json=_projet_de_base([
        {"id": "mur-1", "longueur": 4.0, "hauteur": 2.5, "epaisseur": 0.2,
         "materiau": "beton", "positionX": 0, "positionZ": 0, "rotationY": 0,
         "porteur": True},
        {"id": "cloison-1", "longueur": 3.0, "hauteur": 2.5, "epaisseur": 0.08,
         "materiau": "placo", "positionX": 2, "positionZ": 0, "rotationY": 1.57,
         "porteur": False},
    ]))
    assert reponse.status_code == 200
    data = reponse.json()
    assert len(data["murs"]) == 2
    assert len(data["soubassements"]) == 1
    assert data["soubassements"][0]["mur_id"] == "mur-1"


def test_total_exclut_le_soubassement_de_la_cloison():
    """Le coût total doit inclure la cloison elle-même (matière), mais
    PAS de soubassement pour elle -- vérifie que la somme totale est
    cohérente avec ce qui a réellement été généré."""
    reponse = client.post("/api/calculer-projet", json=_projet_de_base([{
        "id": "cloison-1", "longueur": 3.0, "hauteur": 2.5, "epaisseur": 0.08,
        "materiau": "placo", "positionX": 0, "positionZ": 0, "rotationY": 0,
        "porteur": False
    }]))
    data = reponse.json()
    assert data["total"]["cout_total_eur"] == data["murs"][0]["cout_total_eur"]
