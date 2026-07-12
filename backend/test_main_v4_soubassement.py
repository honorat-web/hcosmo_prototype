# test_main_v4_soubassement.py — tests du soubassement automatique
# pytest test_main_v4_soubassement.py -v

from fastapi.testclient import TestClient
from main import app

client = TestClient(app)


def _projet_un_mur():
    """Mur 4 x 2.5 x 0.2 en béton, seul dans le projet -- cas de
    référence facile à vérifier à la main."""
    return {
        "murs": [{
            "id": "mur-1", "longueur": 4.0, "hauteur": 2.5, "epaisseur": 0.2,
            "materiau": "beton", "positionX": 0, "positionZ": 0, "rotationY": 0
        }],
        "dalles": [], "poteaux": [], "fenetres": [], "portes": [], "toits": [],
        "elements_electriques": [], "tableau_electrique": False
    }


def test_soubassement_genere_automatiquement_par_mur():
    """Un mur seul doit produire exactement 1 soubassement, sans que le
    frontend ait besoin d'en envoyer un explicitement."""
    reponse = client.post("/api/calculer-projet", json=_projet_un_mur())
    assert reponse.status_code == 200
    data = reponse.json()
    assert len(data["soubassements"]) == 1
    assert data["soubassements"][0]["mur_id"] == "mur-1"


def test_soubassement_dimensions_correctes():
    """Mur épaisseur 0.2 -> soubassement épaisseur = 0.2 + 2*0.1 = 0.4.
    Volume = longueur(4) x hauteur_fixe(0.4) x épaisseur(0.4) = 0.64 m3.
    Coût béton = 0.64 x 120 = 76.8 €."""
    reponse = client.post("/api/calculer-projet", json=_projet_un_mur())
    data = reponse.json()
    soub = data["soubassements"][0]
    assert soub["epaisseur_m"] == 0.4
    assert soub["hauteur_m"] == 0.4
    assert soub["volume_m3"] == 0.64
    assert soub["cout_total_eur"] == 76.8


def test_soubassement_toujours_en_beton_meme_si_mur_en_bois():
    """Un mur en bois doit quand même avoir un soubassement en BÉTON
    (les fondations ne sont jamais en bois dans ce modèle)."""
    projet = _projet_un_mur()
    projet["murs"][0]["materiau"] = "bois"
    reponse = client.post("/api/calculer-projet", json=projet)
    data = reponse.json()
    # Même dimensions qu'avant (le soubassement dépend de l'épaisseur du
    # mur, pas de son matériau) -> même volume, mais coût béton, pas bois.
    assert data["soubassements"][0]["volume_m3"] == 0.64
    assert data["soubassements"][0]["cout_total_eur"] == 76.8  # prix béton, pas bois


def test_soubassement_suit_le_mur_si_position_changee():
    """Si le mur est déplacé/tourné (simulateur de l'action 'transformer'),
    le soubassement recalculé doit changer en conséquence -- puisqu'il est
    dérivé, pas stocké, il ne peut pas rester à l'ancienne position."""
    projet = _projet_un_mur()
    projet["murs"][0]["longueur"] = 6.0  # mur allongé
    reponse = client.post("/api/calculer-projet", json=projet)
    data = reponse.json()
    # volume = 6 x 0.4 x 0.4 = 0.96 m3, différent du cas de référence (0.64)
    assert data["soubassements"][0]["volume_m3"] == 0.96


def test_pas_de_mur_pas_de_soubassement():
    """Un projet sans mur ne doit produire aucun soubassement, pas une
    erreur ni une liste avec des valeurs par défaut absurdes."""
    reponse = client.post("/api/calculer-projet", json={
        "murs": [], "dalles": [], "poteaux": [], "fenetres": [], "portes": [],
        "toits": [], "elements_electriques": [], "tableau_electrique": False
    })
    assert reponse.status_code == 200
    assert reponse.json()["soubassements"] == []


def test_total_inclut_le_cout_des_soubassements():
    """Le coût total du projet doit inclure celui des soubassements, pas
    seulement celui du mur -- sinon le métré affiché en démo serait
    incomplet par rapport à ce qui est réellement construit en 3D."""
    reponse = client.post("/api/calculer-projet", json=_projet_un_mur())
    data = reponse.json()
    cout_mur = data["murs"][0]["cout_total_eur"]
    cout_soubassement = data["soubassements"][0]["cout_total_eur"]
    assert data["total"]["cout_total_eur"] == round(cout_mur + cout_soubassement, 2)


def test_deux_murs_donnent_deux_soubassements():
    """Vérifie que la génération automatique passe bien à l'échelle avec
    plusieurs murs, pas seulement le cas à un seul mur."""
    projet = _projet_un_mur()
    projet["murs"].append({
        "id": "mur-2", "longueur": 3.0, "hauteur": 2.5, "epaisseur": 0.2,
        "materiau": "brique", "positionX": 5, "positionZ": 0, "rotationY": 1.57
    })
    reponse = client.post("/api/calculer-projet", json=projet)
    data = reponse.json()
    assert len(data["soubassements"]) == 2
    ids_soubassements = {s["mur_id"] for s in data["soubassements"]}
    assert ids_soubassements == {"mur-1", "mur-2"}
