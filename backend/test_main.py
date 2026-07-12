# test_main.py — v2 (projet composé de listes d'éléments)
# pip install pytest httpx --break-system-packages   (ou via requirements.txt)
# pytest -v

from fastapi.testclient import TestClient
from main import app

client = TestClient(app)


def test_ping_repond():
    reponse = client.get("/api/ping")
    assert reponse.status_code == 200
    assert reponse.json()["status"] == "ok"


def test_projet_vide_renvoie_totaux_a_zero():
    """Un projet sans aucun élément (état de départ, plateau vide) doit
    répondre 200 avec des totaux à zéro, pas planter."""
    reponse = client.post("/api/calculer-projet", json={
        "murs": [], "dalles": [], "poteaux": [], "fenetres": []
    })
    assert reponse.status_code == 200
    data = reponse.json()
    assert data["total"]["volume_m3"] == 0
    assert data["total"]["nb_murs"] == 0


def test_un_mur_seul_sans_fenetre():
    """Mur 4 x 2.5 x 0.2 en béton -> volume = 2.0 m3, coût = 240 €
    (mêmes valeurs de référence que la v1)."""
    reponse = client.post("/api/calculer-projet", json={
        "murs": [{
            "id": "mur-1", "longueur": 4.0, "hauteur": 2.5, "epaisseur": 0.2,
            "materiau": "beton", "positionX": 0, "positionZ": 0, "rotationY": 0
        }],
        "dalles": [], "poteaux": [], "fenetres": []
    })
    data = reponse.json()
    assert data["murs"][0]["volume_m3"] == 2.0
    assert data["murs"][0]["cout_total_eur"] == 240.0
    assert data["murs"][0]["nb_fenetres"] == 0


def test_mur_avec_une_fenetre_reduit_le_volume():
    """Même mur que ci-dessus, avec une fenêtre 1.2 x 1.2m.
    Volume retiré = 1.2 x 1.2 x 0.2 (épaisseur du MUR) = 0.288 m3.
    Volume net attendu = 2.0 - 0.288 = 1.712 m3."""
    reponse = client.post("/api/calculer-projet", json={
        "murs": [{
            "id": "mur-1", "longueur": 4.0, "hauteur": 2.5, "epaisseur": 0.2,
            "materiau": "beton", "positionX": 0, "positionZ": 0, "rotationY": 0
        }],
        "dalles": [], "poteaux": [],
        "fenetres": [{
            "id": "fen-1", "mur_id": "mur-1", "offset": 2.0,
            "largeur": 1.2, "hauteur": 1.2, "hauteur_allege": 0.9
        }]
    })
    data = reponse.json()
    assert data["murs"][0]["volume_m3"] == 1.712
    assert data["murs"][0]["nb_fenetres"] == 1
    # Le coût doit inclure le forfait fenêtre (350€) en plus de la matière
    cout_matiere_attendu = round(1.712 * 120, 2)
    assert data["murs"][0]["cout_total_eur"] == round(cout_matiere_attendu + 350, 2)


def test_fenetre_avec_mur_id_inconnu_est_ignoree_proprement():
    """Si une fenêtre référence un mur_id qui n'existe pas dans la liste
    des murs (bug d'intégration frontend, ou mur supprimé entre-temps),
    l'API ne doit pas planter -- elle ignore simplement cette fenêtre."""
    reponse = client.post("/api/calculer-projet", json={
        "murs": [{
            "id": "mur-1", "longueur": 4.0, "hauteur": 2.5, "epaisseur": 0.2,
            "materiau": "beton", "positionX": 0, "positionZ": 0, "rotationY": 0
        }],
        "dalles": [], "poteaux": [],
        "fenetres": [{
            "id": "fen-1", "mur_id": "mur-inexistant", "offset": 1.0,
            "largeur": 1.0, "hauteur": 1.0, "hauteur_allege": 0.9
        }]
    })
    assert reponse.status_code == 200
    data = reponse.json()
    # Le mur-1 n'a aucune fenêtre valide associée -> volume plein, pas réduit
    assert data["murs"][0]["nb_fenetres"] == 0
    assert data["murs"][0]["volume_m3"] == 2.0


def test_plusieurs_murs_sont_tous_calcules():
    """Deux murs distincts doivent chacun apparaître dans la réponse,
    avec le total qui est bien la somme des deux."""
    reponse = client.post("/api/calculer-projet", json={
        "murs": [
            {"id": "mur-1", "longueur": 4.0, "hauteur": 2.5, "epaisseur": 0.2,
             "materiau": "beton", "positionX": 0, "positionZ": 0, "rotationY": 0},
            {"id": "mur-2", "longueur": 3.0, "hauteur": 2.5, "epaisseur": 0.2,
             "materiau": "beton", "positionX": 5, "positionZ": 0, "rotationY": 1.57},
        ],
        "dalles": [], "poteaux": [], "fenetres": []
    })
    data = reponse.json()
    assert len(data["murs"]) == 2
    assert data["total"]["nb_murs"] == 2
    volume_attendu = data["murs"][0]["volume_m3"] + data["murs"][1]["volume_m3"]
    assert data["total"]["volume_m3"] == round(volume_attendu, 3)


def test_dimensions_negatives_toujours_rejetees():
    """La validation Pydantic doit continuer à rejeter les dimensions
    invalides, même dans la structure en listes."""
    reponse = client.post("/api/calculer-projet", json={
        "murs": [{
            "id": "mur-1", "longueur": -4.0, "hauteur": 2.5, "epaisseur": 0.2,
            "materiau": "beton", "positionX": 0, "positionZ": 0, "rotationY": 0
        }],
        "dalles": [], "poteaux": [], "fenetres": []
    })
    assert reponse.status_code == 422


def test_dalle_et_poteau_seuls():
    """Vérifie que dalles et poteaux fonctionnent aussi en l'absence de
    tout mur (cas d'un utilisateur qui commence par poser une dalle)."""
    reponse = client.post("/api/calculer-projet", json={
        "murs": [],
        "dalles": [{
            "id": "dalle-1", "longueur": 4.0, "largeur": 3.0, "epaisseur": 0.15,
            "materiau": "beton", "positionX": 0, "positionZ": 0
        }],
        "poteaux": [{
            "id": "pot-1", "cote": 0.3, "hauteur": 2.5,
            "materiau": "beton", "positionX": 1, "positionZ": 1
        }],
        "fenetres": []
    })
    data = reponse.json()
    assert data["dalles"][0]["volume_m3"] == 1.8
    assert data["poteaux"][0]["volume_m3"] == 0.225