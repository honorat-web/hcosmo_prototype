// ============================================================
// SCÈNE 3D — initialisée via le module dédié.
// ============================================================

const conteneurViewport = document.getElementById('zone-viewport');
const scene3D = HCOSMO.createScene3D(conteneurViewport);
const scene = scene3D.scene;
const camera = scene3D.camera;
const renderer = scene3D.renderer;
const controls = scene3D.controls;
const groupeElements = scene3D.groupElements;
const groupeSoubassements = scene3D.groupFoundations;
scene3D.setTransformCallback(() => {});

function viderGroupeElements() {
  while (groupeElements.children.length > 0) {
    const objet = groupeElements.children.pop();
    objet.traverse(enfant => {
      if (enfant.isMesh) {
        enfant.geometry.dispose();
        if (Array.isArray(enfant.material)) {
          enfant.material.forEach(mat => mat.dispose());
        } else if (enfant.material) {
          enfant.material.dispose();
        }
      }
    });
    groupeElements.remove(objet);
  }
}

function viderGroupeSoubassements() {
  while (groupeSoubassements.children.length > 0) {
    const mesh = groupeSoubassements.children.pop();
    mesh.geometry.dispose();
    if (Array.isArray(mesh.material)) {
      mesh.material.forEach(mat => mat.dispose());
    } else if (mesh.material) {
      mesh.material.dispose();
    }
    groupeSoubassements.remove(mesh);
  }
}

function redimensionnerViewport() {
  scene3D.resize();
}

window.addEventListener('resize', () => {
  redimensionnerViewport();
  redimensionnerPlan2D(); // recalcule aussi la grille du plan 2D si elle est visible
});

// ============================================================
// ÉTAT DU PROJET — des LISTES, pas des objets uniques. Le plateau
// démarre vide : c'est à l'utilisateur d'ajouter chaque élément.
// ============================================================

const etat = HCOSMO.createProjectState();
const generateurId = HCOSMO.createIdGenerator(1);

function genererId(prefixe) {
  return `${prefixe}-${generateurId()}`;
}

// ============================================================
// GÉOMÉTRIE UTILITAIRE — direction et point de départ d'un mur,
// nécessaires pour placer les fenêtres correctement dessus.
// ============================================================

function directionMur(mur) {
  return { dx: Math.cos(mur.rotationY), dz: -Math.sin(mur.rotationY) };
}

function pointDebutMur(mur) {
  const d = directionMur(mur);
  return {
    x: mur.positionX - d.dx * mur.longueur / 2,
    z: mur.positionZ - d.dz * mur.longueur / 2,
  };
}

// Projette un point (monde, en mètres) sur l'axe d'un mur : renvoie la
// distance le long du mur depuis son début (offset) et la distance
// perpendiculaire au mur (pour savoir si le point est "sur" le mur).
function projeterSurMur(mur, point) {
  const d = directionMur(mur);
  const debut = pointDebutMur(mur);
  const vx = point.x - debut.x;
  const vz = point.z - debut.z;
  const offset = vx * d.dx + vz * d.dz;
  const perpX = vx - offset * d.dx;
  const perpZ = vz - offset * d.dz;
  return { offset, distancePerp: Math.sqrt(perpX * perpX + perpZ * perpZ) };
}

// Trouve le mur le plus proche d'un point cliqué, dans une tolérance
// donnée (en mètres) -- utilisé par l'outil "Fenêtre".
function trouverMurProche(point, tolerance = 0.6) {
  let meilleur = null;
  let meilleureDistance = Infinity;
  for (const mur of etat.murs) {
    const { offset, distancePerp } = projeterSurMur(mur, point);
    if (offset >= 0 && offset <= mur.longueur && distancePerp < meilleureDistance && distancePerp <= tolerance) {
      meilleur = mur;
      meilleureDistance = distancePerp;
    }
  }
  return meilleur;
}

// ============================================================
// TEXTURES PROCÉDURALES (nouveau)
// ============================================================
// Pas d'image téléchargée : chaque texture est dessinée dans un
// <canvas> caché puis convertie en THREE.CanvasTexture. Volontairement
// procédural plutôt que téléchargé depuis un CDN : zéro dépendance
// réseau pendant la démo live (pas de risque qu'une image ne charge
// pas au mauvais moment), zéro poids de fichier, et un rendu
// suffisamment convaincant pour un prototype de preuve de concept.

// Cache : chaque motif de base n'est dessiné qu'UNE SEULE fois, même
// si 10 murs en béton sont créés -- on réutilise (via .clone(), voir
// appliquerTexture) le même canvas source pour tous.
const cacheTexturesBase = {};

function creerTextureBase(nomMateriau, dessinerFn, taille = 256) {
  if (cacheTexturesBase[nomMateriau]) return cacheTexturesBase[nomMateriau];

  const canvas = document.createElement('canvas');
  canvas.width = taille;
  canvas.height = taille;
  dessinerFn(canvas.getContext('2d'), taille);

  const texture = new THREE.CanvasTexture(canvas);
  cacheTexturesBase[nomMateriau] = texture;
  return texture;
}

function dessinerTextureBeton(ctx, taille) {
  ctx.fillStyle = '#9a9a9a';
  ctx.fillRect(0, 0, taille, taille);
  // Grain irrégulier : beaucoup de petits points gris clair/foncé,
  // pour casser l'aspect "plastique" d'une couleur plate.
  for (let i = 0; i < 1400; i++) {
    const gris = 110 + Math.floor(Math.random() * 70);
    ctx.fillStyle = `rgba(${gris},${gris},${gris},0.5)`;
    ctx.beginPath();
    ctx.arc(Math.random() * taille, Math.random() * taille, Math.random() * 1.6, 0, Math.PI * 2);
    ctx.fill();
  }
}

function dessinerTextureBrique(ctx, taille) {
  ctx.fillStyle = '#7a4a2e'; // couleur des joints de mortier, visible entre les briques
  ctx.fillRect(0, 0, taille, taille);
  const hauteurRangee = taille / 6;
  const largeurBrique = taille / 3;
  const joint = 3;
  for (let rangee = 0; rangee < 6; rangee++) {
    // Rangées décalées d'une demi-brique une fois sur deux : l'appareillage
    // classique qui évite que les joints verticaux s'alignent d'une rangée à l'autre.
    const decalage = (rangee % 2 === 0) ? 0 : largeurBrique / 2;
    for (let x = -largeurBrique; x < taille + largeurBrique; x += largeurBrique) {
      const teinte = 90 + Math.floor(Math.random() * 25); // léger bruit de teinte, brique par brique
      ctx.fillStyle = `rgb(${teinte + 90},${teinte},${teinte - 60})`;
      ctx.fillRect(x + decalage + joint / 2, rangee * hauteurRangee + joint / 2,
                   largeurBrique - joint, hauteurRangee - joint);
    }
  }
}

function dessinerTextureBois(ctx, taille) {
  ctx.fillStyle = '#8b5a2b';
  ctx.fillRect(0, 0, taille, taille);
  // Veinage horizontal : bandes légèrement ondulées, teinte variable,
  // pour évoquer les fibres du bois sans dessiner un vrai motif complexe.
  for (let i = 0; i < 20; i++) {
    const y = (i / 20) * taille;
    const brun = 70 + Math.floor(Math.random() * 40);
    ctx.strokeStyle = `rgba(${brun + 20},${brun - 10},${brun - 45},0.55)`;
    ctx.lineWidth = 2 + Math.random() * 3;
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x <= taille; x += 16) {
      ctx.lineTo(x, y + Math.sin(x / 22 + i) * 4);
    }
    ctx.stroke();
  }
}

function dessinerTextureTuile(ctx, taille) {
  ctx.fillStyle = '#7a2a20'; // fond visible dans les creux entre tuiles
  ctx.fillRect(0, 0, taille, taille);
  const hauteurRangee = taille / 5;
  const largeurTuile = taille / 4;
  for (let rangee = 0; rangee < 5; rangee++) {
    const decalage = (rangee % 2 === 0) ? 0 : largeurTuile / 2;
    for (let x = -largeurTuile; x < taille + largeurTuile; x += largeurTuile) {
      ctx.fillStyle = '#b33a2e';
      // Chaque tuile = un demi-cercle, pour l'aspect "écailles" superposées
      ctx.beginPath();
      ctx.arc(x + decalage + largeurTuile / 2, rangee * hauteurRangee, largeurTuile / 2, 0, Math.PI);
      ctx.fill();
    }
  }
}

function dessinerTextureTole(ctx, taille) {
  ctx.fillStyle = '#8c8c96';
  ctx.fillRect(0, 0, taille, taille);
  // Nervures verticales alternées clair/sombre : l'ondulation typique
  // d'une tôle, simulée en 2D par un simple dégradé de bandes.
  const largeurNervure = taille / 16;
  for (let x = 0; x < taille; x += largeurNervure) {
    const paire = Math.floor(x / largeurNervure) % 2 === 0;
    ctx.fillStyle = paire ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.18)';
    ctx.fillRect(x, 0, largeurNervure / 2, taille);
  }
}

// NOUVEAU — Cloison (plaque de plâtre) : presque plate, juste de très
// légères lignes de jointoiement verticales tous les 1.2m (largeur
// standard d'une plaque de placo), pour éviter que les cloisons
// affichent par erreur le grain rugueux du béton.
function dessinerTexturePlaco(ctx, taille) {
  ctx.fillStyle = '#e8e4da';
  ctx.fillRect(0, 0, taille, taille);
  const largeurPlaque = taille / 3; // ~1.2m de plaque standard à l'échelle de la texture
  ctx.strokeStyle = 'rgba(0,0,0,0.08)';
  ctx.lineWidth = 1;
  for (let x = 0; x <= taille; x += largeurPlaque) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, taille);
    ctx.stroke();
  }
}

// NOUVEAU — Ardoise : plaques rectangulaires sombres à reflets bleutés,
// posées "en écailles" comme la tuile mais avec un rendu plus plat et
// anguleux (l'ardoise ne bombe pas comme une tuile en terre cuite).
function dessinerTextureArdoise(ctx, taille) {
  ctx.fillStyle = '#2b3038'; // joints, gris-bleu très sombre
  ctx.fillRect(0, 0, taille, taille);
  const hauteurRangee = taille / 7;
  const largeurPlaque = taille / 5;
  const joint = 2;
  for (let rangee = 0; rangee < 7; rangee++) {
    const decalage = (rangee % 2 === 0) ? 0 : largeurPlaque / 2;
    for (let x = -largeurPlaque; x < taille + largeurPlaque; x += largeurPlaque) {
      // Bruit de teinte plaque par plaque : l'ardoise naturelle n'est
      // jamais parfaitement uniforme, du gris-ardoise au bleu-nuit.
      const gris = 45 + Math.floor(Math.random() * 25);
      const teinteBleue = 6 + Math.floor(Math.random() * 10);
      ctx.fillStyle = `rgb(${gris},${gris + 2},${gris + teinteBleue})`;
      ctx.fillRect(x + decalage + joint / 2, rangee * hauteurRangee + joint / 2,
                   largeurPlaque - joint, hauteurRangee - joint);
    }
  }
}

// Un seul point d'entrée pour les 6 fonctions creerMesh* ci-dessous :
// associe un nom de matériau (structure OU toiture) à sa texture.
const GENERATEURS_TEXTURE = {
  beton: dessinerTextureBeton,
  brique: dessinerTextureBrique,
  bois: dessinerTextureBois,
  tuile: dessinerTextureTuile,
  tole: dessinerTextureTole,
  ardoise: dessinerTextureArdoise, // NOUVEAU
  placo: dessinerTexturePlaco,
};

// Applique la texture d'un matériau à un THREE.MeshStandardMaterial,
// avec une répétition proportionnelle aux dimensions réelles (en
// mètres) de l'élément -- pour qu'un mur de 8m affiche deux fois plus
// de motifs qu'un mur de 4m, plutôt qu'un même motif étiré.
function appliquerTexture(materiau, nomMateriau, largeurMetres, hauteurMetres) {
  const dessinerFn = GENERATEURS_TEXTURE[nomMateriau] || GENERATEURS_TEXTURE.beton;
  // .clone() : chaque mesh a besoin de SON PROPRE réglage de répétition
  // (un mur de 3m et un mur de 8m ne répètent pas le motif pareil), mais
  // tous les clones partagent la même image de base déjà dessinée --
  // aucun nouveau <canvas> n'est créé au-delà des 5 motifs de départ.
  const texture = creerTextureBase(nomMateriau, dessinerFn).clone();
  texture.needsUpdate = true;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(Math.max(1, largeurMetres), Math.max(1, hauteurMetres));
  materiau.map = texture;
  materiau.color.set(0xffffff); // laisse la texture porter la couleur, pas de teinte en plus
  materiau.needsUpdate = true;
}

// ============================================================
// CRÉATION DES MESHES 3D
// ============================================================

function creerMeshMur(mur, couleurHex) {
  const geometrie = new THREE.BoxGeometry(mur.longueur, mur.hauteur, mur.epaisseur);
  const materiau = new THREE.MeshStandardMaterial({ color: couleurHex });
  appliquerTexture(materiau, mur.materiau, mur.longueur, mur.hauteur);
  const mesh = new THREE.Mesh(geometrie, materiau);
  mesh.position.set(mur.positionX, mur.hauteur / 2, mur.positionZ);
  mesh.rotation.y = mur.rotationY;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function creerMeshDalle(dalle, couleurHex) {
  const geometrie = new THREE.BoxGeometry(dalle.longueur, dalle.epaisseur, dalle.largeur);
  const materiau = new THREE.MeshStandardMaterial({ color: couleurHex });
  appliquerTexture(materiau, dalle.materiau, dalle.longueur, dalle.largeur);
  const mesh = new THREE.Mesh(geometrie, materiau);
  mesh.position.set(dalle.positionX, dalle.epaisseur / 2, dalle.positionZ);
  mesh.receiveShadow = true;
  return mesh;
}

function creerMeshPoteau(poteau, couleurHex) {
  const geometrie = new THREE.BoxGeometry(poteau.cote, poteau.hauteur, poteau.cote);
  const materiau = new THREE.MeshStandardMaterial({ color: couleurHex });
  appliquerTexture(materiau, poteau.materiau, poteau.cote, poteau.hauteur);
  const mesh = new THREE.Mesh(geometrie, materiau);
  mesh.position.set(poteau.positionX, poteau.hauteur / 2, poteau.positionZ);
  mesh.castShadow = true;
  return mesh;
}

// La fenêtre a besoin de connaître SON mur pour se positionner dessus
// (elle n'a pas ses propres positionX/positionZ, seulement un offset
// le long du mur).
//
// NOUVEAU — structure en 3 parties, comme une vraie fenêtre :
//   - un CADRE (dormant) fixe, en PVC/aluminium clair, qui reste dans le mur
//   - un VANTAIL (partie vitrée) qui pivote autour d'un côté (charnière)
//     quand fenetre.ouvert === true -- exactement comme une fenêtre à la
//     française s'ouvre en tournant sur ses gonds verticaux
//   - une POIGNÉE (petite tige métallique) fixée sur le vantail, du côté
//     opposé à la charnière
// Le pivot est fait avec un THREE.Group : on positionne le GROUPE sur la
// charnière (le bord du vantail), puis le vantail est dessiné DÉCALÉ à
// l'intérieur du groupe -- c'est ce qui permet une vraie rotation autour
// du bord plutôt qu'autour du centre.
function creerMeshFenetre(fenetre, mur) {
  if (!mur) return null; // mur supprimé entre-temps, on ignore silencieusement
  const d = directionMur(mur);
  const debut = pointDebutMur(mur);
  const centreX = debut.x + d.dx * fenetre.offset;
  const centreZ = debut.z + d.dz * fenetre.offset;
  const epaisseurCadre = mur.epaisseur * 1.05;

  const groupe = new THREE.Group();
  groupe.position.set(centreX, fenetre.hauteur_allege + fenetre.hauteur / 2, centreZ);
  groupe.rotation.y = mur.rotationY;

  // --- Cadre (dormant) : PVC blanc, matériau réel très courant en
  // menuiserie extérieure aujourd'hui (bien plus que le bois ou l'alu
  // sur des fenêtres standard) ---
  const materiauCadre = new THREE.MeshStandardMaterial({ color: 0xf2f2f0, roughness: 0.4 });
  const cadre = new THREE.Mesh(
    new THREE.BoxGeometry(fenetre.largeur, fenetre.hauteur, epaisseurCadre),
    materiauCadre
  );
  groupe.add(cadre);

  // --- Vantail (partie vitrée qui s'ouvre) : légèrement plus petit que
  // le cadre (feuillure visible), en verre semi-transparent bleuté --
  // c'est la vraie teinte du verre standard vu par la tranche/reflet. ---
  const largeurVantail = fenetre.largeur * 0.88;
  const hauteurVantail = fenetre.hauteur * 0.88;
  const materiauVerre = new THREE.MeshStandardMaterial({
    color: 0x8ecae6,
    transparent: true,
    opacity: 0.5,
    roughness: 0.1,
    metalness: 0.1,
  });
  const pivotVantail = new THREE.Group();
  // Charnière sur le bord GAUCHE du vantail (dans le repère du cadre) :
  // le groupe pivot est positionné là, et le vantail est dessiné décalé
  // vers la droite à l'intérieur -- c'est ce décalage qui crée l'effet
  // de rotation "autour du bord" plutôt qu'autour du centre.
  pivotVantail.position.set(-fenetre.largeur / 2 + 0.02, 0, 0);
  const vantail = new THREE.Mesh(
    new THREE.BoxGeometry(largeurVantail, hauteurVantail, epaisseurCadre * 0.5),
    materiauVerre
  );
  vantail.position.set(largeurVantail / 2, 0, 0);
  pivotVantail.add(vantail);

  // --- Poignée : tige métallique horizontale, sur le bord opposé à la
  // charnière (donc côté droit du vantail) -- position et proportions
  // realistes d'une poignée de fenêtre standard (~12cm). ---
  const materiauMetal = new THREE.MeshStandardMaterial({ color: 0xc0c0c0, metalness: 0.8, roughness: 0.3 });
  const poignee = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.12, 8), materiauMetal);
  poignee.rotation.z = Math.PI / 2; // couché à l'horizontale
  poignee.position.set(largeurVantail - 0.08, 0, epaisseurCadre * 0.3);
  pivotVantail.add(poignee);

  // Angle d'ouverture : une fenêtre à la française s'ouvre largement
  // (contrairement à une porte, elle n'a pas besoin de rester praticable
  // pour marcher au travers) -- on va jusqu'à ~100° pour que l'effet
  // "ouvert" soit visible sans ambiguïté même sous un angle de caméra
  // peu favorable pendant la démo.
  pivotVantail.rotation.y = fenetre.ouvert ? THREE.MathUtils.degToRad(100) : 0;

  groupe.add(pivotVantail);
  groupe.castShadow = true;
  groupe.traverse(obj => { if (obj.isMesh) obj.castShadow = true; });
  return groupe;
}

// NOUVEAU — Porte : même principe en 3 parties (cadre + vantail + poignée)
// que la fenêtre, mais le vantail est opaque (bois plein) et part du sol.
function creerMeshPorte(porte, mur) {
  if (!mur) return null;
  const d = directionMur(mur);
  const debut = pointDebutMur(mur);
  const centreX = debut.x + d.dx * porte.offset;
  const centreZ = debut.z + d.dz * porte.offset;
  const epaisseurCadre = mur.epaisseur * 1.05;

  const groupe = new THREE.Group();
  groupe.position.set(centreX, porte.hauteur / 2, centreZ);
  groupe.rotation.y = mur.rotationY;

  // --- Cadre (huisserie) : bois clair, légèrement plus large que le
  // vantail, comme une vraie huisserie qui dépasse du vantail posé dedans ---
  const materiauCadre = new THREE.MeshStandardMaterial({ color: 0xd8c39a, roughness: 0.7 });
  appliquerTexture(materiauCadre, 'bois', porte.largeur, porte.hauteur);
  const cadre = new THREE.Mesh(
    new THREE.BoxGeometry(porte.largeur, porte.hauteur, epaisseurCadre),
    materiauCadre
  );
  groupe.add(cadre);

  // --- Vantail : bois plein (chêne foncé, matériau réel très courant
  // en porte intérieure/entrée) ---
  const largeurVantail = porte.largeur * 0.92;
  const hauteurVantail = porte.hauteur * 0.96;
  const materiauVantail = new THREE.MeshStandardMaterial({ color: 0x5c3a21, roughness: 0.6 });
  appliquerTexture(materiauVantail, 'bois', largeurVantail, hauteurVantail);
  const pivotVantail = new THREE.Group();
  pivotVantail.position.set(-porte.largeur / 2 + 0.03, -porte.hauteur * 0.02, 0);
  const vantail = new THREE.Mesh(
    new THREE.BoxGeometry(largeurVantail, hauteurVantail, epaisseurCadre * 0.6),
    materiauVantail
  );
  vantail.position.set(largeurVantail / 2, 0, 0);
  pivotVantail.add(vantail);

  // --- Poignée : bec-de-cane horizontal, hauteur réaliste ~1m depuis le
  // bas de la porte (norme usuelle 95-105cm), côté opposé à la charnière ---
  const materiauMetal = new THREE.MeshStandardMaterial({ color: 0xb08d57, metalness: 0.75, roughness: 0.25 }); // laiton brossé, très courant sur porte intérieure
  const poignee = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.14, 8), materiauMetal);
  poignee.rotation.z = Math.PI / 2;
  poignee.position.set(largeurVantail - 0.1, -porte.hauteur / 2 + 1.0, epaisseurCadre * 0.35);
  pivotVantail.add(poignee);
  // Plaque de propreté (rosace) derrière la poignée, petit détail qui
  // évite que le bec-de-cane ait l'air de flotter devant le bois
  const rosace = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.01, 16), materiauMetal);
  rosace.rotation.x = Math.PI / 2;
  rosace.position.set(largeurVantail - 0.1, -porte.hauteur / 2 + 1.0, epaisseurCadre * 0.31);
  pivotVantail.add(rosace);

  // Porte : ouverture plus modeste que la fenêtre (~80°), suffisante
  // pour lire clairement "ouvert" sans que le vantail ne traverse le mur
  // voisin dans les configurations d'angle serré.
  pivotVantail.rotation.y = porte.ouvert ? THREE.MathUtils.degToRad(80) : 0;

  groupe.add(pivotVantail);
  groupe.traverse(obj => { if (obj.isMesh) obj.castShadow = true; });
  return groupe;
}

// NOUVEAU — Toit à deux pans (forme "maison") au-dessus d'une emprise
// rectangulaire. On construit un triangle en coupe (pignon), qu'on extrude
// sur la longueur. Simplification assumée du prototype : pas de rotation
// (comme les dalles), le toit est toujours aligné sur les axes du monde.
const COULEURS_TOIT = { tuile: 0xb33a2e, tole: 0x8c8c96, ardoise: 0x363c46, beton: 0x9a9a9a };

function creerMeshToit(toit) {
  const demiLargeur = toit.largeur / 2;
  const hauteurFaitage = demiLargeur * Math.tan(THREE.MathUtils.degToRad(toit.pente_degres));

  const forme = new THREE.Shape();
  forme.moveTo(-demiLargeur, 0);
  forme.lineTo(0, Math.max(0.05, hauteurFaitage)); // min 0.05 pour éviter un toit plat épaisseur 0
  forme.lineTo(demiLargeur, 0);
  forme.lineTo(-demiLargeur, 0);

  const geometrie = new THREE.ExtrudeGeometry(forme, { depth: toit.longueur, bevelEnabled: false });
  geometrie.translate(0, 0, -toit.longueur / 2); // centre le toit sur sa position

  const materiau = new THREE.MeshStandardMaterial({
    color: COULEURS_TOIT[toit.materiau] || COULEURS_TOIT.tuile,
    side: THREE.DoubleSide,
  });
  appliquerTexture(materiau, toit.materiau, toit.longueur, toit.largeur);
  const mesh = new THREE.Mesh(geometrie, materiau);
  // hauteur_support = hauteur à laquelle repose le toit (sommet des murs porteurs)
  mesh.position.set(toit.positionX, toit.hauteur_support, toit.positionZ);
  mesh.rotation.y = toit.rotationY || 0; // NOUVEAU -- le toit peut désormais s'orienter comme un mur
  mesh.castShadow = true;
  return mesh;
}

// NOUVEAU — Éléments électriques avec des formes réalistes :
// - Prise / interrupteur : une plaque murale plate, MONTÉE EN SAILLIE
//   sur la face du mur (pas au centre de son épaisseur comme avant --
//   c'était le bug signalé : l'appareil semblait "dans" le mur au lieu
//   d'être dessus).
// - Point lumineux : 4 formes possibles selon sa categorie_lampe.
const COULEURS_ELECTRICITE = { prise: 0xffcc00, interrupteur: 0xffffff, point_lumineux: 0xfff59d };

// Vecteur perpendiculaire à la longueur du mur (sa "normale"), dans le
// plan horizontal -- sert à sortir un appareil de la face du mur au
// lieu de le laisser au centre de son épaisseur. Même convention de
// rotation que directionMur (voir coinsMurPixels) : tourner (dx,dz)
// de 90° donne (-dz, dx).
function normaleMur(mur) {
  const d = directionMur(mur);
  return { nx: -d.dz, nz: d.dx };
}

function creerMeshPrise(mur, centreX, centreZ, hauteur) {
  const n = normaleMur(mur);
  const epaisseurPlaque = 0.012;
  const decalage = mur.epaisseur / 2 + epaisseurPlaque / 2; // juste au ras de la face du mur, pas dedans

  const groupe = new THREE.Group();
  groupe.position.set(centreX + n.nx * decalage, hauteur, centreZ + n.nz * decalage);
  groupe.rotation.y = mur.rotationY;

  const materiauPlaque = new THREE.MeshStandardMaterial({ color: 0xf1ede4, roughness: 0.5 });
  const plaque = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, epaisseurPlaque), materiauPlaque);
  groupe.add(plaque);

  // 2 alvéoles rondes (simplification d'une vraie prise française, qui
  // a aussi une terre centrale -- suffisant pour la lisibilité à
  // l'échelle du prototype)
  const materiauTrou = new THREE.MeshStandardMaterial({ color: 0x2a2a2a });
  [-0.015, 0.015].forEach(dx => {
    const trou = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.006, 12), materiauTrou);
    trou.rotation.x = Math.PI / 2; // couche le cylindre pour que son axe sorte de la plaque
    trou.position.set(dx, 0, epaisseurPlaque / 2);
    groupe.add(trou);
  });

  return groupe;
}

function creerMeshInterrupteur(mur, centreX, centreZ, hauteur) {
  const n = normaleMur(mur);
  const epaisseurPlaque = 0.012;
  const decalage = mur.epaisseur / 2 + epaisseurPlaque / 2;

  const groupe = new THREE.Group();
  groupe.position.set(centreX + n.nx * decalage, hauteur, centreZ + n.nz * decalage);
  groupe.rotation.y = mur.rotationY;

  const materiauPlaque = new THREE.MeshStandardMaterial({ color: 0xf1ede4, roughness: 0.5 });
  const plaque = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, epaisseurPlaque), materiauPlaque);
  groupe.add(plaque);

  // Bascule (le petit rectangle qu'on appuie) : légèrement en saillie
  // devant la plaque, blanche pour trancher visuellement sur l'ivoire.
  const materiauBascule = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 });
  const bascule = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.045, 0.01), materiauBascule);
  bascule.position.set(0, 0, epaisseurPlaque / 2 + 0.005);
  groupe.add(bascule);

  return groupe;
}

// NOUVEAU — un point lumineux prend une forme différente selon sa
// categorie_lampe, pour laisser un vrai choix visuel à l'utilisateur
// plutôt qu'un unique marqueur générique.
function creerMeshLampe(element) {
  const categorie = element.categorie_lampe || 'plafonnier';
  const groupe = new THREE.Group();
  groupe.position.set(element.positionX, element.hauteur, element.positionZ);

  const materiauMetal = new THREE.MeshStandardMaterial({ color: 0xc0c0c0, metalness: 0.6, roughness: 0.4 });
  const materiauAmpoule = new THREE.MeshStandardMaterial({ color: 0xfff3c4, emissive: 0xfff3c4, emissiveIntensity: 0.7 });
  const materiauAbatJour = new THREE.MeshStandardMaterial({ color: 0xe8e0d0, roughness: 0.6, side: THREE.DoubleSide });

  if (categorie === 'ampoule') {
    // Ampoule nue au bout d'un fil : la plus sommaire des 4 formes,
    // typique d'un local technique ou d'un chantier pas fini.
    const fil = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.15, 6), materiauMetal);
    fil.position.y = 0.075;
    groupe.add(fil);
    groupe.add(new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 12), materiauAmpoule));

  } else if (categorie === 'suspension') {
    // Suspension : abat-jour conique qui pend au bout d'un câble --
    // décalée SOUS le plafond, contrairement au plafonnier plaqué dessus.
    const chute = 0.4;
    const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, chute, 6), materiauMetal);
    cable.position.y = -chute / 2;
    groupe.add(cable);
    // openEnded=true : pas de fond fermé au cône, pour voir l'ampoule
    // "dans" l'abat-jour plutôt qu'un cône plein sans lumière visible.
    const abatJour = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.12, 20, 1, true), materiauAbatJour);
    abatJour.position.y = -chute;
    groupe.add(abatJour);
    const ampoule = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 10), materiauAmpoule);
    ampoule.position.y = -chute + 0.025;
    groupe.add(ampoule);

  } else if (categorie === 'spot') {
    // Spot encastré : quasi affleurant au plafond, juste une collerette
    // fine qui dépasse -- look "faux plafond avec spots" très courant.
    const collerette = new THREE.Mesh(
      new THREE.CylinderGeometry(0.055, 0.055, 0.015, 20),
      new THREE.MeshStandardMaterial({ color: 0xffffff })
    );
    groupe.add(collerette);
    const ampoule = new THREE.Mesh(new THREE.SphereGeometry(0.02, 10, 10), materiauAmpoule);
    ampoule.position.y = -0.015;
    groupe.add(ampoule);

  } else {
    // 'plafonnier' (par défaut) : disque plaqué directement contre le plafond.
    groupe.add(new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.05, 20), materiauAbatJour));
    const ampoule = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 10), materiauAmpoule);
    ampoule.position.y = -0.03;
    groupe.add(ampoule);
  }

  return groupe;
}

function creerMeshElementElectrique(element, mur) {
  if (element.type === 'prise' || element.type === 'interrupteur') {
    if (!mur) return null; // mur supprimé entre-temps
    const d = directionMur(mur);
    const debut = pointDebutMur(mur);
    const centreX = debut.x + d.dx * element.offset;
    const centreZ = debut.z + d.dz * element.offset;
    return element.type === 'prise'
      ? creerMeshPrise(mur, centreX, centreZ, element.hauteur)
      : creerMeshInterrupteur(mur, centreX, centreZ, element.hauteur);
  }
  // point_lumineux : posé librement (plafond), forme selon categorie_lampe
  return creerMeshLampe(element);
}

// NOUVEAU — Soubassement : dérivé du mur, jamais stocké séparément.
// Prend directement le mur (positionX/positionZ/rotationY/longueur en
// cours) + le résultat de calcul (dimensions/couleur), donc reflète
// toujours l'état ACTUEL du mur, même après une transformation.
function creerMeshSoubassement(soubassement, mur) {
  if (!mur) return null; // mur supprimé entre-temps, on ignore silencieusement

  const geometrie = new THREE.BoxGeometry(mur.longueur, soubassement.hauteur_m, soubassement.epaisseur_m);
  const materiau = new THREE.MeshStandardMaterial({ color: soubassement.couleur_hex });
  appliquerTexture(materiau, 'beton', mur.longueur, soubassement.hauteur_m);
  const mesh = new THREE.Mesh(geometrie, materiau);

  // Le soubassement descend SOUS le niveau y=0 (le bas de la dalle) :
  // son sommet touche y=0, sa base est en dessous -- comme une vraie
  // fondation enterrée.
  mesh.position.set(mur.positionX, -soubassement.hauteur_m / 2, mur.positionZ);
  mesh.rotation.y = mur.rotationY;
  mesh.receiveShadow = true;
  return mesh;
}

// Reconstruit entièrement la scène 3D à partir de l'état actuel + des
// couleurs renvoyées par le backend (ou le calcul de secours).
function reconstruireScene3D(resultat) {
  viderGroupeElements();
  viderGroupeSoubassements();


  const couleurParId = {};
  for (const m of [...resultat.murs, ...resultat.dalles, ...resultat.poteaux]) {
    couleurParId[m.id] = m.couleur_hex;
  }

  for (const dalle of etat.dalles) {
    const mesh = creerMeshDalle(dalle, couleurParId[dalle.id] || 0x9a9a9a);
    mesh.userData = { type: 'dalles', id: dalle.id };
    groupeElements.add(mesh);
  }
  for (const poteau of etat.poteaux) {
    const mesh = creerMeshPoteau(poteau, couleurParId[poteau.id] || 0x9a9a9a);
    mesh.userData = { type: 'poteaux', id: poteau.id };
    groupeElements.add(mesh);
  }
  for (const mur of etat.murs) {
    const mesh = creerMeshMur(mur, couleurParId[mur.id] || 0x9a9a9a);
    mesh.userData = { type: 'murs', id: mur.id };
    groupeElements.add(mesh);
  }
  // NOUVEAU — Soubassements : entièrement dérivés de resultat.soubassements
  // (renvoyé par le backend), jamais lus depuis `etat` puisqu'ils n'y
  // sont pas stockés. Ajoutés à groupeSoubassements, PAS groupeElements
  // -> non sélectionnables au clic (voir la définition du groupe).
  for (const soubassement of resultat.soubassements || []) {
    const mur = etat.murs.find(m => m.id === soubassement.mur_id);
    const meshSoubassement = creerMeshSoubassement(soubassement, mur);
    if (meshSoubassement) groupeSoubassements.add(meshSoubassement);
  }
  for (const fenetre of etat.fenetres) {
    const mur = etat.murs.find(m => m.id === fenetre.mur_id);
    const meshFenetre = creerMeshFenetre(fenetre, mur);
    if (meshFenetre) {
      meshFenetre.userData = { type: 'fenetres', id: fenetre.id };
      groupeElements.add(meshFenetre);
    }
  }
  for (const porte of etat.portes) {
    const mur = etat.murs.find(m => m.id === porte.mur_id);
    const meshPorte = creerMeshPorte(porte, mur);
    if (meshPorte) {
      meshPorte.userData = { type: 'portes', id: porte.id };
      groupeElements.add(meshPorte);
    }
  }
  for (const toit of etat.toits) {
    const mesh = creerMeshToit(toit);
    mesh.userData = { type: 'toits', id: toit.id };
    groupeElements.add(mesh);
  }
  for (const element of etat.elements_electriques) {
    const mur = element.mur_id ? etat.murs.find(m => m.id === element.mur_id) : null;
    const meshElement = creerMeshElementElectrique(element, mur);
    if (meshElement) {
      meshElement.userData = { type: 'elements_electriques', id: element.id };
      groupeElements.add(meshElement);
    }
  }

  // La reconstruction efface tous les meshes -- si un élément était
  // sélectionné, son ancien mesh n'existe plus. On réapplique la
  // surbrillance sur le NOUVEAU mesh correspondant, pour que la
  // sélection survive à un recalcul (ex: on modifie un champ de
  // l'élément sélectionné, il ne doit pas se désélectionner tout seul).
  appliquerSurbrillanceSelection();
}

// ============================================================
// CONNEXION AU BACKEND + CALCUL (avec debounce + plan B local)
// ============================================================

const statutDiv = document.getElementById('statut');

// Vérifie qu'aucune porte/fenêtre n'est plus large que le mur qui la
// porte. Fait CÔTÉ CLIENT, avant tout appel réseau ou calcul local --
// réagit instantanément. Le backend refait le même contrôle de son
// côté (voir main.py) comme filet de sécurité si ce contrôle client
// était contourné (ex: appel direct à l'API via /docs).
function trouverIncoherence() {
  for (const fenetre of etat.fenetres) {
    const mur = etat.murs.find(m => m.id === fenetre.mur_id);
    if (mur && fenetre.largeur > mur.longueur) {
      return `Une fenêtre (${fenetre.largeur.toFixed(1)}m) est plus large que le mur qui la porte (${mur.longueur.toFixed(1)}m).`;
    }
  }
  for (const porte of etat.portes) {
    const mur = etat.murs.find(m => m.id === porte.mur_id);
    if (mur && porte.largeur > mur.longueur) {
      return `Une porte (${porte.largeur.toFixed(1)}m) est plus large que le mur qui la porte (${mur.longueur.toFixed(1)}m).`;
    }
  }
  return null;
}

fetch('http://localhost:8000/api/ping')
  .then(r => r.json())
  .then(() => {
    statutDiv.textContent = 'Backend connecté ✅';
    statutDiv.style.background = 'rgba(0,128,0,0.7)';
  })
  .catch(() => {
    statutDiv.textContent = 'Backend NON connecté ❌ (mode local actif)';
    statutDiv.style.background = 'rgba(180,0,0,0.7)';
  });

const MATERIAUX_SECOURS = {
  beton:  { densite_kg_m3: 2400, prix_eur_m3: 120, couleur_hex: 0x9a9a9a },
  brique: { densite_kg_m3: 1800, prix_eur_m3: 90,  couleur_hex: 0xb5651d },
  bois:   { densite_kg_m3: 500,  prix_eur_m3: 250, couleur_hex: 0x8b5a2b },
  placo:  { densite_kg_m3: 700,  prix_eur_m3: 180, couleur_hex: 0xe8e4da }, // NOUVEAU -- cloisons
};
const PRIX_FENETRE_SECOURS = 350;
const PRIX_PORTE_SECOURS = 280; // NOUVEAU
const MATERIAUX_TOIT_SECOURS = { // NOUVEAU
  tuile:   { prix_eur_m2: 45, poids_kg_m2: 40 },
  tole:    { prix_eur_m2: 25, poids_kg_m2: 12 },
  ardoise: { prix_eur_m2: 85, poids_kg_m2: 35 }, // NOUVEAU -- doit rester en miroir avec main.py
  beton:   { prix_eur_m2: 60, poids_kg_m2: 300 },
};
const ELECTRICITE_PRIX_SECOURS = { prise: 45, interrupteur: 35, point_lumineux: 60 }; // NOUVEAU
// NOUVEAU — prix par catégorie de lampe, miroir exact de PRIX_LAMPE_EUR
// côté backend (main.py) -- à resynchroniser si l'un des deux change.
const PRIX_LAMPE_SECOURS = { ampoule: 25, plafonnier: 60, suspension: 90, spot: 45 };
const PRIX_TABLEAU_ELECTRIQUE_SECOURS = 450; // NOUVEAU

// NOUVEAU — Soubassement automatique : mêmes constantes que main.py
// (HAUTEUR_SOUBASSEMENT_M, DEBORD_SOUBASSEMENT_M, MATERIAU_SOUBASSEMENT).
const HAUTEUR_SOUBASSEMENT_M_SECOURS = 0.4;
const DEBORD_SOUBASSEMENT_M_SECOURS = 0.1;

// Calcul de secours : mêmes formules que le backend (main.py), tenu à
// jour manuellement en miroir. Sert de plan B si le backend est down.
function calculerProjetSecours() {
  const resultatsMurs = etat.murs.map(mur => {
    const info = MATERIAUX_SECOURS[mur.materiau] || MATERIAUX_SECOURS.beton;
    const fenetresDuMur = etat.fenetres.filter(f => f.mur_id === mur.id);
    const portesDuMur = etat.portes.filter(p => p.mur_id === mur.id); // NOUVEAU
    const volumeBrut = mur.longueur * mur.hauteur * mur.epaisseur;
    const volumeFenetres = fenetresDuMur.reduce((s, f) => s + f.largeur * f.hauteur * mur.epaisseur, 0);
    const volumePortes = portesDuMur.reduce((s, p) => s + p.largeur * p.hauteur * mur.epaisseur, 0); // NOUVEAU
    const volumeNet = Math.max(0, volumeBrut - volumeFenetres - volumePortes);
    const cout = volumeNet * info.prix_eur_m3
      + fenetresDuMur.length * PRIX_FENETRE_SECOURS
      + portesDuMur.length * PRIX_PORTE_SECOURS; // NOUVEAU
    return {
      id: mur.id,
      volume_m3: Math.round(volumeNet * 1000) / 1000,
      poids_kg: Math.round(volumeNet * info.densite_kg_m3 * 10) / 10,
      cout_total_eur: Math.round(cout * 100) / 100,
      nb_fenetres: fenetresDuMur.length,
      nb_portes: portesDuMur.length, // NOUVEAU
      porteur: mur.porteur !== false, // NOUVEAU -- par défaut true, comme côté backend
      couleur_hex: info.couleur_hex,
    };
  });

  // NOUVEAU — Soubassements dérivés (mode secours) : même logique que
  // le backend (main.py) -- un par mur PORTEUR seulement (une cloison
  // n'a pas de fondation propre), jamais lu depuis `etat`.
  const resultatsSoubassements = etat.murs
    .filter(mur => mur.porteur !== false)
    .map(mur => {
    const info = MATERIAUX_SECOURS.beton; // toujours béton, quel que soit le matériau du mur
    const epaisseurSoubassement = mur.epaisseur + 2 * DEBORD_SOUBASSEMENT_M_SECOURS;
    const volume = mur.longueur * HAUTEUR_SOUBASSEMENT_M_SECOURS * epaisseurSoubassement;
    return {
      id: mur.id,
      mur_id: mur.id,
      epaisseur_m: Math.round(epaisseurSoubassement * 1000) / 1000,
      hauteur_m: HAUTEUR_SOUBASSEMENT_M_SECOURS,
      volume_m3: Math.round(volume * 1000) / 1000,
      poids_kg: Math.round(volume * info.densite_kg_m3 * 10) / 10,
      cout_total_eur: Math.round(volume * info.prix_eur_m3 * 100) / 100,
      couleur_hex: info.couleur_hex,
    };
  });

  const resultatsDalles = etat.dalles.map(dalle => {
    const info = MATERIAUX_SECOURS[dalle.materiau] || MATERIAUX_SECOURS.beton;
    const surface = dalle.longueur * dalle.largeur; // NOUVEAU
    const volume = surface * dalle.epaisseur;
    return {
      id: dalle.id,
      volume_m3: Math.round(volume * 1000) / 1000,
      surface_m2: Math.round(surface * 100) / 100, // NOUVEAU
      poids_kg: Math.round(volume * info.densite_kg_m3 * 10) / 10,
      cout_total_eur: Math.round(volume * info.prix_eur_m3 * 100) / 100,
      couleur_hex: info.couleur_hex,
    };
  });

  const resultatsPoteaux = etat.poteaux.map(poteau => {
    const info = MATERIAUX_SECOURS[poteau.materiau] || MATERIAUX_SECOURS.beton;
    const volume = poteau.cote * poteau.cote * poteau.hauteur;
    return {
      id: poteau.id,
      volume_m3: Math.round(volume * 1000) / 1000,
      poids_kg: Math.round(volume * info.densite_kg_m3 * 10) / 10,
      cout_total_eur: Math.round(volume * info.prix_eur_m3 * 100) / 100,
      couleur_hex: info.couleur_hex,
    };
  });

  // NOUVEAU — toits (calcul au m², avec correction de pente)
  const resultatsToits = etat.toits.map(toit => {
    const info = MATERIAUX_TOIT_SECOURS[toit.materiau] || MATERIAUX_TOIT_SECOURS.tuile;
    const surfaceHorizontale = toit.longueur * toit.largeur;
    const facteurPente = 1 / Math.cos(THREE.MathUtils.degToRad(toit.pente_degres));
    const surfaceReelle = surfaceHorizontale * facteurPente;
    return {
      id: toit.id,
      surface_m2: Math.round(surfaceReelle * 100) / 100,
      poids_kg: Math.round(surfaceReelle * info.poids_kg_m2 * 10) / 10,
      cout_total_eur: Math.round(surfaceReelle * info.prix_eur_m2 * 100) / 100,
    };
  });

  // NOUVEAU — lot électrique (le point_lumineux dépend de sa categorie_lampe)
  const resultatsElectricite = etat.elements_electriques.map(e => {
    const cout = e.type === 'point_lumineux'
      ? (PRIX_LAMPE_SECOURS[e.categorie_lampe] ?? PRIX_LAMPE_SECOURS.plafonnier)
      : (ELECTRICITE_PRIX_SECOURS[e.type] || 0);
    return {
      id: e.id, type: e.type, cout_eur: cout,
      categorie_lampe: e.type === 'point_lumineux' ? (e.categorie_lampe || 'plafonnier') : null,
    };
  });

  const tousLesResultats = [...resultatsMurs, ...resultatsDalles, ...resultatsPoteaux, ...resultatsSoubassements];
  const coutStructure = tousLesResultats.reduce((s, r) => s + r.cout_total_eur, 0);
  const coutToits = resultatsToits.reduce((s, r) => s + r.cout_total_eur, 0); // NOUVEAU
  const coutElectricite = resultatsElectricite.reduce((s, r) => s + r.cout_eur, 0)
    + (etat.tableau_electrique ? PRIX_TABLEAU_ELECTRIQUE_SECOURS : 0); // NOUVEAU
  const poidsToits = resultatsToits.reduce((s, r) => s + r.poids_kg, 0); // NOUVEAU
  const surfaceHabitable = resultatsDalles.reduce((s, r) => s + r.surface_m2, 0); // NOUVEAU

  return {
    murs: resultatsMurs,
    soubassements: resultatsSoubassements, // NOUVEAU
    dalles: resultatsDalles,
    poteaux: resultatsPoteaux,
    toits: resultatsToits, // NOUVEAU
    elements_electriques: resultatsElectricite, // NOUVEAU
    total: {
      volume_m3: Math.round(tousLesResultats.reduce((s, r) => s + r.volume_m3, 0) * 1000) / 1000,
      surface_habitable_m2: Math.round(surfaceHabitable * 100) / 100, // NOUVEAU
      poids_kg: Math.round((tousLesResultats.reduce((s, r) => s + r.poids_kg, 0) + poidsToits) * 10) / 10,
      cout_total_eur: Math.round((coutStructure + coutToits + coutElectricite) * 100) / 100,
      nb_murs: etat.murs.length,
      nb_dalles: etat.dalles.length,
      nb_poteaux: etat.poteaux.length,
      nb_fenetres: etat.fenetres.length,
      nb_portes: etat.portes.length, // NOUVEAU
      nb_toits: etat.toits.length, // NOUVEAU
      nb_elements_electriques: etat.elements_electriques.length, // NOUVEAU
      tableau_electrique: etat.tableau_electrique, // NOUVEAU
    },
  };
}

function formaterEuros(valeur) {
  return new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(valeur);
}

let dernierResultat = null;
let compteurRequete = 0;
let cadrerApresRecalcul = false;

// ============================================================
// HISTORIQUE — Annuler / Rétablir (Ctrl+Z / Ctrl+Y)
// ============================================================
// Principe : `historique` est une liste de "photos" de `etat`, dans
// l'ordre chronologique. `indexHistorique` pointe sur la photo
// actuellement affichée. Annuler = reculer le curseur d'un cran et
// restaurer cette photo ; Rétablir = avancer d'un cran. Toute NOUVELLE
// action après un Annuler efface les photos "du futur" qui ne sont
// plus valables (comportement standard d'un historique d'éditeur).
//
// La capture se fait automatiquement à la fin de appliquerResultat()
// (voir plus bas) -- PAS besoin d'ajouter un appel manuel à chaque
// endroit du code qui modifie `etat` (dessin d'un mur, suppression,
// édition d'un champ, ouverture de fichier, etc.) puisque tous ces
// chemins finissent par appeler recalculerProjet() -> appliquerResultat().
let historique = [];
let indexHistorique = -1;
let restaurationEnCours = false; // évite qu'un Annuler/Rétablir ne s'auto-enregistre comme une nouvelle action
const HISTORIQUE_LIMITE = 100; // évite une fuite mémoire sur une très longue session

function cloneEtat(source) {
  // JSON.stringify/parse suffit : `etat` ne contient que des tableaux
  // d'objets avec des champs primitifs (nombres, texte, booléen) --
  // pas de fonctions, dates ou références circulaires à préserver.
  return JSON.parse(JSON.stringify(source));
}

function enregistrerHistoriqueSiChange() {
  if (restaurationEnCours) return; // on ne réenregistre pas l'état qu'on vient de restaurer

  const photoActuelle = cloneEtat(etat);
  const derniere = historique[indexHistorique];
  if (derniere && JSON.stringify(photoActuelle) === JSON.stringify(derniere)) {
    return; // rien n'a réellement changé (ex: recalcul déclenché sans modification)
  }

  // Toute action après un Annuler efface les entrées "du futur"
  historique = historique.slice(0, indexHistorique + 1);
  historique.push(photoActuelle);
  indexHistorique = historique.length - 1;

  if (historique.length > HISTORIQUE_LIMITE) {
    historique.shift();
    indexHistorique--;
  }
  mettreAJourBoutonsHistorique();
}

function mettreAJourBoutonsHistorique() {
  const boutonAnnuler = document.getElementById('bouton-annuler');
  const boutonRefaire = document.getElementById('bouton-refaire');
  if (boutonAnnuler) boutonAnnuler.disabled = indexHistorique <= 0;
  if (boutonRefaire) boutonRefaire.disabled = indexHistorique >= historique.length - 1;
}

function restaurerDepuisHistorique() {
  restaurationEnCours = true;
  const photo = cloneEtat(historique[indexHistorique]);
  etat.murs = photo.murs;
  etat.dalles = photo.dalles;
  etat.poteaux = photo.poteaux;
  etat.fenetres = photo.fenetres;
  etat.portes = photo.portes;
  etat.toits = photo.toits;
  etat.elements_electriques = photo.elements_electriques;
  etat.tableau_electrique = photo.tableau_electrique;

  definirModeDessin(null); // annule un tracé en cours, évite un état incohérent après restauration

  // Recalcul IMMÉDIAT (pas le debounce habituel) : un Ctrl+Z doit se
  // sentir instantané, pas attendre 120ms comme un glissement de slider.
  recalculerProjetImmediat().then(() => {
    restaurationEnCours = false;
    mettreAJourBoutonsHistorique();
  });
}

function annulerAction() {
  if (indexHistorique <= 0) return; // rien à annuler avant la première photo
  indexHistorique--;
  restaurerDepuisHistorique();
}

function refaireAction() {
  if (indexHistorique >= historique.length - 1) return; // déjà à la dernière action connue
  indexHistorique++;
  restaurerDepuisHistorique();
}

document.addEventListener('keydown', (evt) => {
  // Ne pas intercepter Ctrl+Z pendant la saisie dans un champ texte :
  // on laisse le navigateur gérer l'annulation NATIVE du champ
  // (ex: annuler la dernière frappe dans "Nom du projet"), plutôt que
  // de déclencher l'annulation globale du PROJET par erreur.
  const cible = document.activeElement;
  if (cible && (cible.tagName === 'INPUT' || cible.tagName === 'TEXTAREA')) return;

  const ctrlOuCmd = evt.ctrlKey || evt.metaKey;
  if (!ctrlOuCmd) return;

  if (evt.key.toLowerCase() === 'z' && !evt.shiftKey) {
    evt.preventDefault();
    annulerAction();
  } else if (evt.key.toLowerCase() === 'y' || (evt.key.toLowerCase() === 'z' && evt.shiftKey)) {
    evt.preventDefault();
    refaireAction();
  } else if (evt.key.toLowerCase() === 'd') {
    // Ctrl+D duplique l'élément SÉLECTIONNÉ (celui qu'on a cliqué en 3D
    // ou dans la liste -- voir elementSelectionne, mis à jour par
    // selectionnerElement). preventDefault() est indispensable ici :
    // sans lui, le navigateur ouvre sa propre boîte "Ajouter un favori".
    evt.preventDefault();
    if (elementSelectionne) {
      dupliquerElement(elementSelectionne.type, elementSelectionne.id);
    }
  }
});

function appliquerResultat(resultat, viaSecours) {
  reconstruireScene3D(resultat);
  rafraichirListeElements(resultat);

  const nb = resultat.total;
  document.getElementById('res-nb').textContent =
    `${nb.nb_murs} mur${nb.nb_murs > 1 ? 's' : ''} · ${nb.nb_dalles} dalle${nb.nb_dalles > 1 ? 's' : ''} · ${nb.nb_poteaux} poteau${nb.nb_poteaux > 1 ? 'x' : ''} · ${nb.nb_fenetres} fenêtre${nb.nb_fenetres > 1 ? 's' : ''} · ${nb.nb_portes} porte${nb.nb_portes > 1 ? 's' : ''} · ${nb.nb_toits} toit${nb.nb_toits > 1 ? 's' : ''} · ${nb.nb_elements_electriques} élec.`;
  document.getElementById('res-volume').textContent = resultat.total.volume_m3;
  document.getElementById('res-surface').textContent = resultat.total.surface_habitable_m2;
  document.getElementById('res-poids').textContent = resultat.total.poids_kg;

  const elementCout = document.getElementById('res-cout');
  elementCout.textContent = formaterEuros(resultat.total.cout_total_eur);
  elementCout.classList.remove('flash-maj');
  void elementCout.offsetWidth;
  elementCout.classList.add('flash-maj');

  dessinerPlan2D();
  dernierResultat = resultat;

  if (cadrerApresRecalcul) {
    cadrerVue();
    cadrerApresRecalcul = false;
  }

  enregistrerHistoriqueSiChange(); // NOUVEAU — capture cette photo dans l'historique

  if (viaSecours) {
    statutDiv.textContent = 'Mode local ⚠️ (backend indisponible)';
    statutDiv.style.background = 'rgba(200,120,0,0.75)';
  } else {
    statutDiv.textContent = 'Backend connecté ✅';
    statutDiv.style.background = 'rgba(0,128,0,0.7)';
  }
}

async function recalculerProjetImmediat() {
  const idRequete = ++compteurRequete;

  // Contrôle client, avant tout calcul réseau ou local. Si un problème
  // est détecté ici, on prévient l'utilisateur et on s'arrête -- sans
  // jamais tomber dans le mode secours, qui masquerait le problème.
  const messageIncoherence = trouverIncoherence();
  if (messageIncoherence) {
    statutDiv.textContent = 'Configuration invalide ⚠️';
    statutDiv.style.background = 'rgba(200,120,0,0.75)';
    alert(`Configuration invalide :\n${messageIncoherence}\n\nAjustez la largeur de l'élément ou la longueur du mur concerné.`);
    return;
  }

  try {
    const reponse = await fetch('http://localhost:8000/api/calculer-projet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(etat),
    });

    // NOUVEAU : une erreur 422 est une erreur de VALIDATION DES DONNÉES,
    // pas une panne réseau -- il ne faut surtout pas basculer sur le
    // calcul de secours dans ce cas, car celui-ci ne fait pas cette
    // validation et masquerait silencieusement le problème. On ne
    // devrait normalement jamais arriver ici puisque trouverIncoherence()
    // fait le même contrôle juste avant : ce cas ne se produit que si
    // les deux contrôles divergent (bug ou contournement du contrôle
    // client), d'où l'intérêt de le garder comme filet de sécurité.
    if (reponse.status === 422) {
      const erreur = await reponse.json();
      if (idRequete !== compteurRequete) return;
      statutDiv.textContent = 'Configuration invalide ⚠️';
      statutDiv.style.background = 'rgba(200,120,0,0.75)';
      alert(`Le serveur a refusé ce calcul :\n${erreur.detail || 'données invalides.'}`);
      return;
    }

    if (!reponse.ok) throw new Error(`Statut ${reponse.status}`);
    const resultat = await reponse.json();
    if (idRequete !== compteurRequete) return;
    appliquerResultat(resultat, false);
  } catch (erreur) {
    if (idRequete !== compteurRequete) return;
    console.error('Backend indisponible, bascule sur le calcul local :', erreur);
    appliquerResultat(calculerProjetSecours(), true);
  }
}

let minuteurDebounce = null;
function recalculerProjet() {
  synchroniserSelectionEtat();
  clearTimeout(minuteurDebounce);
  minuteurDebounce = setTimeout(recalculerProjetImmediat, 120);
}

// ============================================================
// LISTE DES ÉLÉMENTS (panneau latéral) — chaque ligne est un mini-
// formulaire lié à un élément précis (data-type / data-id / data-champ).
// Les champs numériques utilisent l'événement "change" (pas "input")
// pour ne reconstruire la liste qu'une fois l'utilisateur a fini de
// taper, sinon la reconstruction lui volerait le focus à chaque frappe.
// ============================================================

function optionsMateriau(valeurActuelle) {
  return ['beton', 'brique', 'bois'].map(m =>
    `<option value="${m}" ${m === valeurActuelle ? 'selected' : ''}>${m.charAt(0).toUpperCase() + m.slice(1)}</option>`
  ).join('');
}

// NOUVEAU — variante pour les murs/cloisons uniquement : ajoute "placo",
// qui n'a de sens que pour une cloison (une dalle ou un poteau en placo
// n'existe pas dans la réalité, inutile de le proposer partout).
function optionsMateriauMur(valeurActuelle) {
  return ['beton', 'brique', 'bois', 'placo'].map(m =>
    `<option value="${m}" ${m === valeurActuelle ? 'selected' : ''}>${m.charAt(0).toUpperCase() + m.slice(1)}</option>`
  ).join('');
}

function rafraichirListeElements(resultat) {
  const conteneur = document.getElementById('liste-elements');
  const total = etat.murs.length + etat.dalles.length + etat.poteaux.length + etat.fenetres.length
    + etat.portes.length + etat.toits.length + etat.elements_electriques.length; // NOUVEAU

  if (total === 0) {
    conteneur.innerHTML = '<p class="liste-vide">Aucun élément pour l\'instant.</p>';
    return;
  }

  const resMurs = Object.fromEntries(resultat.murs.map(r => [r.id, r]));
  const resDalles = Object.fromEntries(resultat.dalles.map(r => [r.id, r]));
  const resPoteaux = Object.fromEntries(resultat.poteaux.map(r => [r.id, r]));

  let html = '';

  etat.murs.forEach((mur, i) => {
    const r = resMurs[mur.id] || { volume_m3: '—', cout_total_eur: '—' };
    const estCloison = mur.porteur === false;
    html += `
      <div class="ligne-element" data-type="murs" data-id="${mur.id}">
        <div class="entete-element">
          <span class="nom-element">${estCloison ? 'Cloison' : 'Mur'} ${i + 1}</span>
          <span class="valeurs-element">${r.volume_m3} m³ · ${r.cout_total_eur} €</span>
          <button class="bouton-supprimer" data-action="supprimer" data-type="murs" data-id="${mur.id}">✕</button>
        </div>
        <div class="ligne-champs-element">
          <label>Longueur<input type="number" step="0.1" min="0.2" max="50" value="${mur.longueur}" data-type="murs" data-id="${mur.id}" data-champ="longueur"></label>
          <label>Hauteur<input type="number" step="0.1" min="0.5" max="20" value="${mur.hauteur}" data-type="murs" data-id="${mur.id}" data-champ="hauteur"></label>
          <label>Épaisseur<input type="number" step="0.01" min="0.05" max="2" value="${mur.epaisseur}" data-type="murs" data-id="${mur.id}" data-champ="epaisseur"></label>
          <label>Matériau<select data-type="murs" data-id="${mur.id}" data-champ="materiau">${optionsMateriauMur(mur.materiau)}</select></label>
          <label>Position X<input type="number" step="0.1" value="${mur.positionX}" data-type="murs" data-id="${mur.id}" data-champ="positionX"></label>
          <label>Position Z<input type="number" step="0.1" value="${mur.positionZ}" data-type="murs" data-id="${mur.id}" data-champ="positionZ"></label>
          <label>Rotation (°)<input type="number" step="1" value="${THREE.MathUtils.radToDeg(mur.rotationY).toFixed(1)}" data-type="murs" data-id="${mur.id}" data-champ="rotationY_deg"></label>
        </div>
        <div class="ligne-transformations">
          <button class="bouton-miroir" data-action="dupliquer" data-type="murs" data-id="${mur.id}">📋 Dupliquer</button>
          <button class="bouton-miroir" data-action="miroir-x" data-type="murs" data-id="${mur.id}">🪞 Miroir X</button>
          <button class="bouton-miroir" data-action="miroir-z" data-type="murs" data-id="${mur.id}">🪞 Miroir Z</button>
        </div>
      </div>`;
  });

  etat.dalles.forEach((dalle, i) => {
    const r = resDalles[dalle.id] || { volume_m3: '—', cout_total_eur: '—' };
    html += `
      <div class="ligne-element" data-type="dalles" data-id="${dalle.id}">
        <div class="entete-element">
          <span class="nom-element">Dalle ${i + 1}</span>
          <span class="valeurs-element">${r.volume_m3} m³ · ${r.cout_total_eur} €</span>
          <button class="bouton-supprimer" data-action="supprimer" data-type="dalles" data-id="${dalle.id}">✕</button>
        </div>
        <div class="ligne-champs-element">
          <label>Longueur<input type="number" step="0.1" min="0.2" max="30" value="${dalle.longueur}" data-type="dalles" data-id="${dalle.id}" data-champ="longueur"></label>
          <label>Largeur<input type="number" step="0.1" min="0.2" max="30" value="${dalle.largeur}" data-type="dalles" data-id="${dalle.id}" data-champ="largeur"></label>
          <label>Épaisseur<input type="number" step="0.01" min="0.05" max="0.5" value="${dalle.epaisseur}" data-type="dalles" data-id="${dalle.id}" data-champ="epaisseur"></label>
          <label>Matériau<select data-type="dalles" data-id="${dalle.id}" data-champ="materiau">${optionsMateriau(dalle.materiau)}</select></label>
          <label>Position X<input type="number" step="0.1" value="${dalle.positionX}" data-type="dalles" data-id="${dalle.id}" data-champ="positionX"></label>
          <label>Position Z<input type="number" step="0.1" value="${dalle.positionZ}" data-type="dalles" data-id="${dalle.id}" data-champ="positionZ"></label>
        </div>
        <div class="ligne-transformations">
          <button class="bouton-miroir" data-action="dupliquer" data-type="dalles" data-id="${dalle.id}">📋 Dupliquer</button>
          <button class="bouton-miroir" data-action="miroir-x" data-type="dalles" data-id="${dalle.id}">🪞 Miroir X</button>
          <button class="bouton-miroir" data-action="miroir-z" data-type="dalles" data-id="${dalle.id}">🪞 Miroir Z</button>
        </div>
      </div>`;
  });

  etat.poteaux.forEach((poteau, i) => {
    const r = resPoteaux[poteau.id] || { volume_m3: '—', cout_total_eur: '—' };
    html += `
      <div class="ligne-element" data-type="poteaux" data-id="${poteau.id}">
        <div class="entete-element">
          <span class="nom-element">Poteau ${i + 1}</span>
          <span class="valeurs-element">${r.volume_m3} m³ · ${r.cout_total_eur} €</span>
          <button class="bouton-supprimer" data-action="supprimer" data-type="poteaux" data-id="${poteau.id}">✕</button>
        </div>
        <div class="ligne-champs-element">
          <label>Côté<input type="number" step="0.01" min="0.05" max="2" value="${poteau.cote}" data-type="poteaux" data-id="${poteau.id}" data-champ="cote"></label>
          <label>Hauteur<input type="number" step="0.1" min="0.5" max="10" value="${poteau.hauteur}" data-type="poteaux" data-id="${poteau.id}" data-champ="hauteur"></label>
          <label>Matériau<select data-type="poteaux" data-id="${poteau.id}" data-champ="materiau">${optionsMateriau(poteau.materiau)}</select></label>
          <label>Position X<input type="number" step="0.1" value="${poteau.positionX}" data-type="poteaux" data-id="${poteau.id}" data-champ="positionX"></label>
          <label>Position Z<input type="number" step="0.1" value="${poteau.positionZ}" data-type="poteaux" data-id="${poteau.id}" data-champ="positionZ"></label>
        </div>
        <div class="ligne-transformations">
          <button class="bouton-miroir" data-action="dupliquer" data-type="poteaux" data-id="${poteau.id}">📋 Dupliquer</button>
          <button class="bouton-miroir" data-action="miroir-x" data-type="poteaux" data-id="${poteau.id}">🪞 Miroir X</button>
          <button class="bouton-miroir" data-action="miroir-z" data-type="poteaux" data-id="${poteau.id}">🪞 Miroir Z</button>
        </div>
      </div>`;
  });

  etat.fenetres.forEach((fenetre, i) => {
    const murParent = etat.murs.find(m => m.id === fenetre.mur_id);
    const numeroMurParent = murParent ? etat.murs.indexOf(murParent) + 1 : '?';
    html += `
      <div class="ligne-element" data-type="fenetres" data-id="${fenetre.id}">
        <div class="entete-element">
          <span class="nom-element">Fenêtre ${i + 1} (mur ${numeroMurParent})</span>
          <button class="bouton-supprimer" data-action="supprimer" data-type="fenetres" data-id="${fenetre.id}">✕</button>
        </div>
        <div class="ligne-champs-element">
          <label>Largeur<input type="number" step="0.1" min="0.4" max="10" value="${fenetre.largeur}" data-type="fenetres" data-id="${fenetre.id}" data-champ="largeur"></label>
          <label>Hauteur<input type="number" step="0.1" min="0.4" max="5" value="${fenetre.hauteur}" data-type="fenetres" data-id="${fenetre.id}" data-champ="hauteur"></label>
          <label>Appui<input type="number" step="0.1" min="0" max="10" value="${fenetre.hauteur_allege}" data-type="fenetres" data-id="${fenetre.id}" data-champ="hauteur_allege"></label>
          <label>Position sur mur<input type="number" step="0.1" min="0" value="${fenetre.offset}" data-type="fenetres" data-id="${fenetre.id}" data-champ="offset"></label>
        </div>
        <div class="ligne-transformations">
          <button class="bouton-miroir" data-action="basculer-ouverture" data-type="fenetres" data-id="${fenetre.id}">${fenetre.ouvert ? '🔓 Ouverte — Fermer' : '🔒 Fermée — Ouvrir'}</button>
        </div>
      </div>`;
  });

  // NOUVEAU — Portes
  etat.portes.forEach((porte, i) => {
    const murParent = etat.murs.find(m => m.id === porte.mur_id);
    const numeroMurParent = murParent ? etat.murs.indexOf(murParent) + 1 : '?';
    html += `
      <div class="ligne-element" data-type="portes" data-id="${porte.id}">
        <div class="entete-element">
          <span class="nom-element">Porte ${i + 1} (mur ${numeroMurParent})</span>
          <button class="bouton-supprimer" data-action="supprimer" data-type="portes" data-id="${porte.id}">✕</button>
        </div>
        <div class="ligne-champs-element">
          <label>Largeur<input type="number" step="0.1" min="0.6" max="3" value="${porte.largeur}" data-type="portes" data-id="${porte.id}" data-champ="largeur"></label>
          <label>Hauteur<input type="number" step="0.1" min="1.8" max="3" value="${porte.hauteur}" data-type="portes" data-id="${porte.id}" data-champ="hauteur"></label>
          <label>Position sur mur<input type="number" step="0.1" min="0" value="${porte.offset}" data-type="portes" data-id="${porte.id}" data-champ="offset"></label>
        </div>
        <div class="ligne-transformations">
          <button class="bouton-miroir" data-action="basculer-ouverture" data-type="portes" data-id="${porte.id}">${porte.ouvert ? '🔓 Ouverte — Fermer' : '🔒 Fermée — Ouvrir'}</button>
        </div>
      </div>`;
  });

  // NOUVEAU — Toits
  const resToits = Object.fromEntries((resultat.toits || []).map(r => [r.id, r]));
  etat.toits.forEach((toit, i) => {
    const r = resToits[toit.id] || { surface_m2: '—', cout_total_eur: '—' };
    html += `
      <div class="ligne-element" data-type="toits" data-id="${toit.id}">
        <div class="entete-element">
          <span class="nom-element">Toit ${i + 1}</span>
          <span class="valeurs-element">${r.surface_m2} m² · ${r.cout_total_eur} €</span>
          <button class="bouton-supprimer" data-action="supprimer" data-type="toits" data-id="${toit.id}">✕</button>
        </div>
        <div class="ligne-champs-element">
          <label>Longueur<input type="number" step="0.1" min="1" max="50" value="${toit.longueur}" data-type="toits" data-id="${toit.id}" data-champ="longueur"></label>
          <label>Largeur<input type="number" step="0.1" min="1" max="30" value="${toit.largeur}" data-type="toits" data-id="${toit.id}" data-champ="largeur"></label>
          <label>Pente (°)<input type="number" step="1" min="0" max="60" value="${toit.pente_degres}" data-type="toits" data-id="${toit.id}" data-champ="pente_degres"></label>
          <label>Rotation (°)<input type="number" step="1" value="${THREE.MathUtils.radToDeg(toit.rotationY || 0).toFixed(1)}" data-type="toits" data-id="${toit.id}" data-champ="rotationY_deg"></label>
          <label>Matériau<select data-type="toits" data-id="${toit.id}" data-champ="materiau">
            <option value="tuile" ${toit.materiau === 'tuile' ? 'selected' : ''}>Tuile terre cuite</option>
            <option value="ardoise" ${toit.materiau === 'ardoise' ? 'selected' : ''}>Ardoise naturelle</option>
            <option value="tole" ${toit.materiau === 'tole' ? 'selected' : ''}>Bac acier / tôle</option>
            <option value="beton" ${toit.materiau === 'beton' ? 'selected' : ''}>Béton (toit-terrasse)</option>
          </select></label>
          <label>Position X<input type="number" step="0.1" value="${toit.positionX}" data-type="toits" data-id="${toit.id}" data-champ="positionX"></label>
          <label>Position Z<input type="number" step="0.1" value="${toit.positionZ}" data-type="toits" data-id="${toit.id}" data-champ="positionZ"></label>
        </div>
        <div class="ligne-transformations">
          <button class="bouton-miroir" data-action="dupliquer" data-type="toits" data-id="${toit.id}">📋 Dupliquer</button>
          <button class="bouton-miroir" data-action="miroir-x" data-type="toits" data-id="${toit.id}">🪞 Miroir X</button>
          <button class="bouton-miroir" data-action="miroir-z" data-type="toits" data-id="${toit.id}">🪞 Miroir Z</button>
        </div>
      </div>`;
  });

  // NOUVEAU — Éléments électriques
  const nomsElectrique = { prise: 'Prise', interrupteur: 'Interrupteur', point_lumineux: 'Point lumineux' };
  const nomsLampe = { ampoule: 'Ampoule nue', plafonnier: 'Plafonnier', suspension: 'Suspension', spot: 'Spot encastré' };
  etat.elements_electriques.forEach((element, i) => {
    const libelleCategorie = element.type === 'point_lumineux'
      ? (nomsLampe[element.categorie_lampe] || 'Plafonnier')
      : '';
    html += `
      <div class="ligne-element" data-type="elements_electriques" data-id="${element.id}">
        <div class="entete-element">
          <span class="nom-element">${nomsElectrique[element.type] || element.type} ${i + 1}</span>
          ${libelleCategorie ? `<span class="valeurs-element">${libelleCategorie}</span>` : ''}
          <button class="bouton-supprimer" data-action="supprimer" data-type="elements_electriques" data-id="${element.id}">✕</button>
        </div>
      </div>`;
  });

  conteneur.innerHTML = html;
}

// ============================================================
// TRANSFORMATIONS — SYMÉTRIE / MIROIR
// ============================================================

// Ramène un angle dans l'intervalle [-π, π] : purement cosmétique, pour
// éviter d'afficher "410°" au lieu de "50°" après plusieurs miroirs.
function normaliserAngle(angle) {
  const deuxPi = Math.PI * 2;
  angle = ((angle % deuxPi) + deuxPi) % deuxPi;
  if (angle > Math.PI) angle -= deuxPi;
  return angle;
}

// Applique une réflexion à un élément par rapport à l'axe X ou Z.
// Pour les murs (seuls éléments orientés dans ce modèle), on corrige
// aussi la rotation avec la formule de réflexion :
//   miroir X (positionX -> -positionX) : rotationY' = π - rotationY
//   miroir Z (positionZ -> -positionZ) : rotationY' = -rotationY
// Dalles/poteaux/toits n'ont pas de champ rotation dans ce modèle
// (boîtes toujours alignées sur les axes) : on se contente d'inverser
// leur position.
function appliquerMiroir(type, id, axe) {
  const objet = etat[type].find(o => o.id === id);
  if (!objet) return;

  if (axe === 'x') {
    objet.positionX = -objet.positionX;
    if (type === 'murs') {
      objet.rotationY = normaliserAngle(Math.PI - objet.rotationY);
    }
  } else if (axe === 'z') {
    objet.positionZ = -objet.positionZ;
    if (type === 'murs') {
      objet.rotationY = normaliserAngle(-objet.rotationY);
    }
  }
  recalculerProjet();
}

// Délégation d'événements pour les boutons miroir de toutes les lignes.
document.getElementById('liste-elements').addEventListener('click', (evt) => {
  const bouton = evt.target.closest('[data-action="miroir-x"], [data-action="miroir-z"]');
  if (!bouton) return;
  const axe = bouton.dataset.action === 'miroir-x' ? 'x' : 'z';
  appliquerMiroir(bouton.dataset.type, bouton.dataset.id, axe);
});

// ============================================================
// TRANSFORMATIONS — DUPLICATION
// ============================================================

// Décalage appliqué au clone pour qu'il ne soit jamais exactement
// superposé à l'original (sinon invisible en 3D tant qu'on ne l'a pas
// déplacé à la main).
const DECALAGE_DUPLICATION = 1; // mètres

// Seuls les types avec positionX/positionZ propres se dupliquent
// proprement avec ce code. Fenêtres/portes/électricité utilisent un
// "offset" le long d'un mur_id -- les dupliquer demanderait une autre
// logique (sur quel mur ? à quel offset ?), volontairement pas encore
// traitée. Ctrl+D et le bouton 📋 sont tous les deux limités à cette liste.
const TYPES_DUPLICABLES = ['murs', 'dalles', 'poteaux', 'toits'];

// Le préfixe d'id dépend du type ET, pour les murs, du champ "porteur" :
// une cloison dupliquée doit rester une cloison (préfixe "cloison"),
// pas redevenir un mur porteur par erreur. Reprend les mêmes préfixes
// que ceux déjà utilisés à la création (voir lireDefautsMur, etc.).
function prefixeDuplication(type, objet) {
  if (type === 'murs') return objet.porteur === false ? 'cloison' : 'mur';
  return { dalles: 'dalle', poteaux: 'poteau', toits: 'toit' }[type] || type;
}

function dupliquerElement(type, id) {
  if (!TYPES_DUPLICABLES.includes(type)) return; // filet de sécurité, voir TYPES_DUPLICABLES
  const original = etat[type].find(o => o.id === id);
  if (!original) return;

  // Copie superficielle : suffisant ici, tous les champs de murs/
  // dalles/poteaux/toits sont des valeurs simples (nombres, chaînes),
  // jamais des objets imbriqués -- pas de risque de référence partagée
  // avec l'original.
  const copie = { ...original };
  copie.id = genererId(prefixeDuplication(type, original));
  copie.positionX += DECALAGE_DUPLICATION;
  copie.positionZ += DECALAGE_DUPLICATION;

  etat[type].push(copie);

  // NOUVEAU — dupliquer un mur duplique aussi ce qu'il porte (fenêtres,
  // portes, éléments électriques rattachés). Symétrique de la
  // suppression en cascade déjà en place plus bas (voir le listener
  // "supprimer"). Sans ça, le clone serait un mur nu, visuellement
  // incohérent avec l'original -- gênant sur une maison où 3-4 murs se
  // ressemblent, exactement le cas d'usage que "Dupliquer" doit servir.
  // Chaque enfant cloné garde le MÊME offset (position le long du mur)
  // : logique, puisque le mur cloné a la même longueur que l'original.
  if (type === 'murs') {
    etat.fenetres
      .filter(f => f.mur_id === original.id)
      .forEach(f => etat.fenetres.push({ ...f, id: genererId('fenetre'), mur_id: copie.id }));

    etat.portes
      .filter(p => p.mur_id === original.id)
      .forEach(p => etat.portes.push({ ...p, id: genererId('porte'), mur_id: copie.id }));

    etat.elements_electriques
      .filter(e => e.mur_id === original.id)
      .forEach(e => etat.elements_electriques.push({ ...e, id: genererId(e.type), mur_id: copie.id }));
  }

  // Sélectionne directement le clone : confort immédiat, l'utilisateur
  // voit ce qu'il vient de créer et peut l'ajuster tout de suite.
  elementSelectionne = { type, id: copie.id };

  recalculerProjet();
}

// Délégation d'événements pour le bouton "Dupliquer" de toutes les lignes.
document.getElementById('liste-elements').addEventListener('click', (evt) => {
  const bouton = evt.target.closest('[data-action="dupliquer"]');
  if (!bouton) return;
  dupliquerElement(bouton.dataset.type, bouton.dataset.id);
});

// NOUVEAU — Bouton "Ouvrir/Fermer" d'une fenêtre ou d'une porte : bascule
// simplement un booléen sur l'objet, le rendu 3D (voir creerMeshFenetre/
// creerMeshPorte) fait pivoter le vantail en conséquence au recalcul
// suivant. Ce champ n'existe PAS côté backend (Pydantic l'ignore
// silencieusement s'il est envoyé) -- c'est un état purement visuel, qui
// n'a aucune incidence sur le métré.
document.getElementById('liste-elements').addEventListener('click', (evt) => {
  const bouton = evt.target.closest('[data-action="basculer-ouverture"]');
  if (!bouton) return;
  const { type, id } = bouton.dataset;
  const objet = etat[type].find(o => o.id === id);
  if (!objet) return;
  objet.ouvert = !objet.ouvert;
  recalculerProjet();
});

// Délégation d'événements : un seul listener pour tous les champs de
// toutes les lignes (plus robuste que d'en attacher un par ligne à
// chaque reconstruction, et évite les fuites de listeners orphelins).
document.getElementById('liste-elements').addEventListener('change', (evt) => {
  const cible = evt.target;
  const { type, id, champ } = cible.dataset;
  if (!type || !id || !champ) return;
  const objet = etat[type].find(o => o.id === id);
  if (!objet) return;

  if (champ === 'materiau') {
    objet.materiau = cible.value;
  } else if (champ === 'rotationY_deg') {
    // Le champ affiché est en DEGRÉS (plus intuitif pour un humain),
    // mais le modèle stocke rotationY en RADIANS -- c'est ce
    // qu'attend mesh.rotation.y côté Three.js. On convertit à la
    // volée au moment de la saisie, sans jamais stocker de degrés
    // dans etat (une seule unité de vérité dans les données).
    objet.rotationY = THREE.MathUtils.degToRad(parseFloat(cible.value));
  } else {
    objet[champ] = parseFloat(cible.value);
  }
  recalculerProjet();
});

document.getElementById('liste-elements').addEventListener('click', (evt) => {
  const cible = evt.target.closest('[data-action="supprimer"]');
  if (!cible) return;
  const { type, id } = cible.dataset;
  etat[type] = etat[type].filter(o => o.id !== id);
  // Suppression en cascade : si on supprime un mur, ses fenêtres/portes/
  // éléments électriques n'ont plus de sens (orphelins) -> on les supprime aussi.
  if (type === 'murs') {
    etat.fenetres = etat.fenetres.filter(f => f.mur_id !== id);
    etat.portes = etat.portes.filter(p => p.mur_id !== id); // NOUVEAU
    etat.elements_electriques = etat.elements_electriques.filter(e => e.mur_id !== id); // NOUVEAU
  }
  recalculerProjet();
});

// ============================================================
// OUTILS DE DESSIN SUR LE PLAN 2D
// ============================================================

let modeDessin = null;       // null | 'dalle' | 'mur' | 'cloison' | 'poteau' | 'fenetre'
let modeTransformation = null; // null | 'move' | 'rotate'
let pointDepart = null;      // 1er clic pour dalle/mur
let dernierePositionSouris = null;
let shiftEnfoncee = false;
let transformationEnCours = null;
let pointDepartTransformation = null;
let objetTransformation = null;
let transformationAxe = null;

function synchroniserTransformDepuisMesh(mesh) {
  if (!elementSelectionne || !mesh) return;
  const objet = etat[elementSelectionne.type]?.find(item => item.id === elementSelectionne.id);
  if (!objet) return;
  objet.positionX = Number(mesh.position.x.toFixed(3));
  objet.positionZ = Number(mesh.position.z.toFixed(3));
  objet.rotationY = Number(mesh.rotation.y.toFixed(3));
}

scene3D.setTransformCallback(synchroniserTransformDepuisMesh);

function mettreAJourInstructionTransformation() {
  if (!modeTransformation) return;
  const axe = transformationAxe ? transformationAxe.toUpperCase() : 'libre';
  document.getElementById('instruction-dessin').textContent = modeTransformation === 'move'
    ? `Sélectionnez un objet puis glissez-le dans la vue 3D pour le déplacer. Axe : ${axe} • Maj = précision.`
    : `Sélectionnez un objet puis glissez la souris pour le tourner. Maj = précision.`;
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Shift') shiftEnfoncee = true;
  if (modeTransformation && ['x', 'z'].includes(e.key.toLowerCase())) {
    transformationAxe = e.key.toLowerCase();
    mettreAJourInstructionTransformation();
  }
  if (e.key === 'Escape') {
    definirModeDessin(null); // quitte réellement l'outil actif, pas juste le tracé en cours
  }
});
document.addEventListener('keyup', (e) => {
  if (e.key === 'Shift') shiftEnfoncee = false;
  if (modeTransformation && ['x', 'z'].includes(e.key.toLowerCase())) {
    transformationAxe = null;
    mettreAJourInstructionTransformation();
  }
});

function lireDefautsMur() {
  return {
    hauteur: parseFloat(document.getElementById('def-mur-hauteur').value),
    epaisseur: parseFloat(document.getElementById('def-mur-epaisseur').value),
    materiau: document.getElementById('def-mur-materiau').value,
  };
}
// NOUVEAU — Cloison : reprend la hauteur des murs (même hauteur sous
// plafond), matériau toujours "placo" (pas de choix au moment du
// dessin, modifiable ensuite dans la liste des éléments si besoin).
function lireDefautsCloison() {
  return {
    hauteur: parseFloat(document.getElementById('def-mur-hauteur').value),
    epaisseur: parseFloat(document.getElementById('def-cloison-epaisseur').value),
    materiau: 'placo',
  };
}
function lireDefautsDalle() {
  return {
    epaisseur: parseFloat(document.getElementById('def-dalle-epaisseur').value),
    materiau: document.getElementById('def-dalle-materiau').value,
  };
}
function lireDefautsPoteau() {
  return {
    cote: parseFloat(document.getElementById('def-poteau-cote').value),
    hauteur: parseFloat(document.getElementById('def-poteau-hauteur').value),
    materiau: document.getElementById('def-poteau-materiau').value,
  };
}
function lireDefautsFenetre() {
  return {
    largeur: parseFloat(document.getElementById('def-fenetre-largeur').value),
    hauteur: parseFloat(document.getElementById('def-fenetre-hauteur').value),
    hauteur_allege: parseFloat(document.getElementById('def-fenetre-allege').value),
  };
}
// NOUVEAU
function lireDefautsPorte() {
  return {
    largeur: parseFloat(document.getElementById('def-porte-largeur').value),
    hauteur: parseFloat(document.getElementById('def-porte-hauteur').value),
  };
}
// NOUVEAU
function lireDefautsToit() {
  return {
    pente_degres: parseFloat(document.getElementById('def-toit-pente').value),
    materiau: document.getElementById('def-toit-materiau').value,
    hauteur_support: parseFloat(document.getElementById('def-toit-hauteur-support').value),
  };
}
// NOUVEAU — hauteurs de pose fixes, réalistes pour une installation domestique
const HAUTEUR_PRISE = 0.3;
const HAUTEUR_INTERRUPTEUR = 1.1;
function lireHauteurPointLumineux() {
  return parseFloat(document.getElementById('def-toit-hauteur-support').value); // même hauteur que le plafond
}
// NOUVEAU — catégorie de lampe appliquée aux prochains points lumineux dessinés
function lireCategorieLampe() {
  return document.getElementById('def-lampe-categorie').value;
}

function definirModeDessin(nouveauMode) {
  modeDessin = nouveauMode || null;
  modeTransformation = null;
  pointDepart = null;
  dernierePositionSouris = null;
  transformationEnCours = null;
  pointDepartTransformation = null;
  objetTransformation = null;
  transformationAxe = null;
  controls.enabled = true;
  scene3D.setTransformVisibility(false);

  document.querySelectorAll('.outil-dessin').forEach(bouton => {
    const estActif = bouton.dataset.mode === (modeDessin || '') || bouton.dataset.transform === modeTransformation;
    bouton.classList.toggle('actif', estActif);
  });

  // NOUVEAU — en 2D, on stylise le SVG pendant le dessin.
  document.getElementById('svg-plan').classList.toggle('mode-dessin-actif', !!modeDessin);

  const messages = {
    dalle: 'Cliquez (2 clics) pour la dalle : coin 1 puis coin opposé.',
    mur: "Cliquez (2 clics) pour le mur : départ puis arrivée. (Maj = accroche à 45°)",
    poteau: 'Cliquez pour poser le poteau.',
    fenetre: 'Cliquez sur un mur existant pour y placer une fenêtre.',
    porte: 'Cliquez sur un mur existant pour y placer une porte.',
    toit: 'Cliquez (2 clics) pour le toit : coin 1 puis coin opposé.',
    prise: 'Cliquez sur un mur existant pour y placer une prise.',
    interrupteur: 'Cliquez sur un mur existant pour y placer un interrupteur.',
    point_lumineux: 'Cliquez pour poser le point lumineux (au plafond).',
  };

  document.getElementById('instruction-dessin').textContent =
    messages[modeDessin] || 'Choisissez un outil ci-dessus.';

  // NOUVEAU — uniquement si le plan 2D est visible : évite d'entraîner
  // le recalcul visuel quand on travaille en 3D.
  const vue2d = document.getElementById('vue-2d');
  if (vue2d && !vue2d.classList.contains('cachee')) {
    dessinerPlan2D();
  }
}

document.querySelectorAll('.outil-dessin').forEach(bouton => {
  bouton.addEventListener('click', () => {
    // NOTE UX : on conserve le workflow actuel de création sur le plan 2D.
    // La demande "construction directe en 3D" implique une refonte des
    // handlers de création (raycast + mapping clic 3D -> x/z) et sort donc
    // du périmètre de ce changement minime.

    if (bouton.dataset.transform) {
      modeTransformation = bouton.dataset.transform;
      modeDessin = null;
      transformationEnCours = null;
      pointDepartTransformation = null;
      objetTransformation = null;
      transformationAxe = null;
      controls.enabled = true;
      document.querySelectorAll('.outil-dessin').forEach(btn => {
        const estActif = btn.dataset.transform === modeTransformation || btn.dataset.mode === (modeDessin || '');
        btn.classList.toggle('actif', estActif);
      });
      mettreAJourInstructionTransformation();
      mettreAJourGizmoTransformation();
      return;
    }

    definirModeDessin(bouton.dataset.mode);

    // NOTE UX : ne plus forcer l'affichage du plan 2D au moment où l'utilisateur
    // choisit un outil. (Les outils de création actuels restent basés sur le
    // SVG plan, mais au moins la vue ne “bascule” plus automatiquement.)
    // Si le plan 2D est masqué, l'utilisateur décidera quand le réafficher.
    // (Voir bouton "toggle-vue".)
    if (bouton.dataset.mode) {
      // volontairement vide
    }
  });
});

// ============================================================
// NOUVEAU — ACCROCHAGE À LA GRILLE
// ============================================================
// Le pas d'accrochage (0.5m) est appliqué en coordonnées MONDE, pas en
// pixels écran -- il fonctionne donc de façon identique quelle que
// soit la zone actuellement visible à l'écran, et reste valable même
// pour un point très éloigné de l'origine (la grille "logique" n'a pas
// de limite, contrairement à ce qui est affiché à l'écran).
const PAS_GRILLE_ACCROCHAGE_M = 0.5;

function accrocherALaGrille(position) {
  return {
    x: Math.round(position.x / PAS_GRILLE_ACCROCHAGE_M) * PAS_GRILLE_ACCROCHAGE_M,
    z: Math.round(position.z / PAS_GRILLE_ACCROCHAGE_M) * PAS_GRILLE_ACCROCHAGE_M,
  };
}

// Outils qui s'accrochent à un mur EXISTANT plutôt qu'à une position
// libre : pour ceux-là, on garde la position brute du clic. Un
// pré-accrochage à la grille fausserait la détection du mur le plus
// proche (trouverMurProche) et le calcul de l'offset le long du mur.
const OUTILS_ATTACHES_AU_MUR = ['fenetre', 'porte', 'prise', 'interrupteur'];

function pointSourisVersMonde(evt) {
  const svg = document.getElementById('svg-plan');
  const point = svg.createSVGPoint();
  point.x = evt.clientX;
  point.y = evt.clientY;
  const pointSVG = point.matrixTransform(svg.getScreenCTM().inverse());
  let position = {
    x: (pointSVG.x - PLAN_ORIGINE_X) / PLAN_ECHELLE,
    z: (pointSVG.y - PLAN_ORIGINE_Y) / PLAN_ECHELLE,
  };

  // NOUVEAU — Accrochage à la grille, avant l'accroche à 45° : on veut
  // que l'angle (si Maj est enfoncée) se calcule à partir d'un point de
  // départ déjà propre, pas d'une position brute imprécise au pixel près.
  if (!OUTILS_ATTACHES_AU_MUR.includes(modeDessin)) {
    position = accrocherALaGrille(position);
  }

  // Accrochage 45° pendant le tracé du mur (2e clic), si Maj est enfoncée.
  if (shiftEnfoncee && modeDessin === 'mur' && pointDepart) {
    const dx = position.x - pointDepart.x;
    const dz = position.z - pointDepart.z;
    const longueur = Math.sqrt(dx * dx + dz * dz);
    const angleAccroche = Math.round(Math.atan2(dz, dx) / (Math.PI / 4)) * (Math.PI / 4);
    position = {
      x: pointDepart.x + Math.cos(angleAccroche) * longueur,
      z: pointDepart.z + Math.sin(angleAccroche) * longueur,
    };
  }
  return position;
}

document.getElementById('svg-plan').addEventListener('click', (evt) => {
  if (!modeDessin) return;
  const position = pointSourisVersMonde(evt);

  if (modeDessin === 'poteau') {
    const d = lireDefautsPoteau();
    etat.poteaux.push({
      id: genererId('poteau'),
      cote: d.cote, hauteur: d.hauteur, materiau: d.materiau,
      positionX: position.x, positionZ: position.z,
    });
    recalculerProjet();
    return;
  }

  if (modeDessin === 'fenetre') {
    const mur = trouverMurProche(position);
    if (!mur) {
      alert('Cliquez plus près d\'un mur existant pour y placer une fenêtre.');
      return;
    }
    const d = lireDefautsFenetre();
    if (mur.longueur < d.largeur) {
      alert('Ce mur est trop court pour une fenêtre de cette largeur.');
      return;
    }
    const { offset } = projeterSurMur(mur, position);
    const offsetBorne = Math.max(d.largeur / 2, Math.min(mur.longueur - d.largeur / 2, offset));
    etat.fenetres.push({
      id: genererId('fenetre'),
      mur_id: mur.id,
      offset: offsetBorne,
      largeur: d.largeur, hauteur: d.hauteur, hauteur_allege: d.hauteur_allege,
    });
    recalculerProjet();
    return;
  }

  if (modeDessin === 'dalle') {
    if (!pointDepart) { pointDepart = position; return; }
    const d = lireDefautsDalle();
    const longueur = Math.abs(position.x - pointDepart.x);
    const largeur = Math.abs(position.z - pointDepart.z);
    if (longueur < 0.3 || largeur < 0.3) { pointDepart = null; return; }
    etat.dalles.push({
      id: genererId('dalle'),
      longueur: Math.min(30, longueur), largeur: Math.min(30, largeur),
      epaisseur: d.epaisseur, materiau: d.materiau,
      positionX: (pointDepart.x + position.x) / 2,
      positionZ: (pointDepart.z + position.z) / 2,
    });
    pointDepart = null;
    recalculerProjet();
    return;
  }

  // NOUVEAU — Porte : même logique que fenêtre (clic sur un mur)
  if (modeDessin === 'porte') {
    const mur = trouverMurProche(position);
    if (!mur) {
      alert('Cliquez plus près d\'un mur existant pour y placer une porte.');
      return;
    }
    const d = lireDefautsPorte();
    if (mur.longueur < d.largeur) {
      alert('Ce mur est trop court pour une porte de cette largeur.');
      return;
    }
    const { offset } = projeterSurMur(mur, position);
    const offsetBorne = Math.max(d.largeur / 2, Math.min(mur.longueur - d.largeur / 2, offset));
    etat.portes.push({
      id: genererId('porte'),
      mur_id: mur.id,
      offset: offsetBorne,
      largeur: d.largeur, hauteur: d.hauteur,
    });
    recalculerProjet();
    return;
  }

  // NOUVEAU — Prise / interrupteur : clic sur un mur, hauteur fixe
  if (modeDessin === 'prise' || modeDessin === 'interrupteur') {
    const mur = trouverMurProche(position);
    if (!mur) {
      alert('Cliquez plus près d\'un mur existant.');
      return;
    }
    const { offset } = projeterSurMur(mur, position);
    etat.elements_electriques.push({
      id: genererId(modeDessin),
      type: modeDessin,
      mur_id: mur.id,
      offset: Math.max(0, Math.min(mur.longueur, offset)),
      hauteur: modeDessin === 'prise' ? HAUTEUR_PRISE : HAUTEUR_INTERRUPTEUR,
      positionX: 0, positionZ: 0,
    });
    recalculerProjet();
    return;
  }

  // NOUVEAU — Point lumineux : clic libre sur le plateau, posé au plafond
  if (modeDessin === 'point_lumineux') {
    etat.elements_electriques.push({
      id: genererId('point_lumineux'),
      type: 'point_lumineux',
      mur_id: null,
      offset: 0,
      hauteur: lireHauteurPointLumineux(),
      categorie_lampe: lireCategorieLampe(), // NOUVEAU
      positionX: position.x, positionZ: position.z,
    });
    recalculerProjet();
    return;
  }

  // NOUVEAU — Toit : même logique 2 clics que la dalle
  if (modeDessin === 'toit') {
    if (!pointDepart) { pointDepart = position; return; }
    const d = lireDefautsToit();
    const longueur = Math.abs(position.x - pointDepart.x);
    const largeur = Math.abs(position.z - pointDepart.z);
    if (longueur < 1 || largeur < 1) { pointDepart = null; return; }
    etat.toits.push({
      id: genererId('toit'),
      longueur: Math.min(50, longueur), largeur: Math.min(30, largeur),
      pente_degres: d.pente_degres, materiau: d.materiau, hauteur_support: d.hauteur_support,
      positionX: (pointDepart.x + position.x) / 2,
      positionZ: (pointDepart.z + position.z) / 2,
      rotationY: 0, // NOUVEAU -- ajustable ensuite dans la liste des éléments, comme un mur
    });
    pointDepart = null;
    recalculerProjet();
    return;
  }

  if (modeDessin === 'mur') {
    if (!pointDepart) { pointDepart = position; return; }
    const dx = position.x - pointDepart.x;
    const dz = position.z - pointDepart.z;
    const longueur = Math.sqrt(dx * dx + dz * dz);
    if (longueur < 0.2) { return; }
    const d = lireDefautsMur();
    etat.murs.push({
      id: genererId('mur'),
      longueur: Math.min(50, longueur), hauteur: d.hauteur, epaisseur: d.epaisseur, materiau: d.materiau,
      positionX: (pointDepart.x + position.x) / 2,
      positionZ: (pointDepart.z + position.z) / 2,
      rotationY: Math.atan2(-dz, dx),
      porteur: true,
    });
    pointDepart = null;
    recalculerProjet();
    return;
  }

  // NOUVEAU — Cloison : exactement le même geste en 2 clics que le mur,
  // mais stockée avec porteur:false (pas de soubassement généré) et les
  // réglages par défaut de cloison (épaisseur fine, matériau placo).
  if (modeDessin === 'cloison') {
    if (!pointDepart) { pointDepart = position; return; }
    const dx = position.x - pointDepart.x;
    const dz = position.z - pointDepart.z;
    const longueur = Math.sqrt(dx * dx + dz * dz);
    if (longueur < 0.2) { return; }
    const d = lireDefautsCloison();
    etat.murs.push({
      id: genererId('cloison'),
      longueur: Math.min(50, longueur), hauteur: d.hauteur, epaisseur: d.epaisseur, materiau: d.materiau,
      positionX: (pointDepart.x + position.x) / 2,
      positionZ: (pointDepart.z + position.z) / 2,
      rotationY: Math.atan2(-dz, dx),
      porteur: false,
    });
    pointDepart = null;
    recalculerProjet();
    return;
  }
});

document.getElementById('svg-plan').addEventListener('mousemove', (evt) => {
  if (!modeDessin || !pointDepart) return;
  dernierePositionSouris = pointSourisVersMonde(evt);
  dessinerPlan2D();
});

// ============================================================
// VUE 2D — PLAN AVEC COTES
// ============================================================

const PLAN_MARGE = 50;
const PLAN_PORTEE_METRES = 20;

// NOUVEAU — PLAN_ZONE_X/Y (au lieu d'un unique PLAN_ZONE carré) : la
// grille couvrait avant une zone fixe 300x300, centrée dans un viewBox
// carré 400x400. Comme la zone de construction réelle (#vue-2d) est
// rectangulaire (large écran), le SVG carré était mis à l'échelle avec
// "meet" (comportement par défaut) et laissait des bandes vides à
// gauche/droite -- la grille ne couvrait pas tout l'espace. Ces deux
// valeurs sont maintenant recalculées à chaque redimensionnement (voir
// redimensionnerPlan2D) pour correspondre exactement à la largeur et
// la hauteur réelles du conteneur, sans distorsion : l'échelle
// (PLAN_ECHELLE, pixels par mètre) reste fixe, seule la zone visible
// s'agrandit.
let PLAN_ZONE_X = 300;
let PLAN_ZONE_Y = 300;
const PLAN_ECHELLE = PLAN_ZONE_X / PLAN_PORTEE_METRES; // pixels par mètre, fixé une fois pour toutes
let PLAN_ORIGINE_X = PLAN_MARGE + PLAN_ZONE_X / 2;
let PLAN_ORIGINE_Y = PLAN_MARGE + PLAN_ZONE_Y / 2;

// Recalcule la taille du plan 2D pour qu'il remplisse exactement
// #vue-2d, quelle que soit la forme de la fenêtre. À appeler avant
// tout dessinerPlan2D() si la fenêtre a pu changer de taille depuis le
// dernier calcul (ouverture du plan, redimensionnement de la fenêtre,
// panneau IA qui apparaît/disparaît...).
function redimensionnerPlan2D() {
  const conteneur = document.getElementById('vue-2d');
  const largeur = conteneur.clientWidth;
  const hauteur = conteneur.clientHeight;
  if (largeur === 0 || hauteur === 0) return; // pas visible actuellement, on ignore (voir #vue-2d.cachee)

  document.getElementById('svg-plan').setAttribute('viewBox', `0 0 ${largeur} ${hauteur}`);
  PLAN_ZONE_X = largeur - 2 * PLAN_MARGE;
  PLAN_ZONE_Y = hauteur - 2 * PLAN_MARGE;
  PLAN_ORIGINE_X = PLAN_MARGE + PLAN_ZONE_X / 2;
  PLAN_ORIGINE_Y = PLAN_MARGE + PLAN_ZONE_Y / 2;
}

function mondeVersPixel(x, z) {
  return { x: PLAN_ORIGINE_X + x * PLAN_ECHELLE, y: PLAN_ORIGINE_Y + z * PLAN_ECHELLE };
}

function coinsMurPixels(mur) {
  const demiL = mur.longueur / 2;
  const demiE = mur.epaisseur / 2;
  const coinsLocaux = [
    { x: -demiL, z: -demiE }, { x: demiL, z: -demiE },
    { x: demiL, z: demiE }, { x: -demiL, z: demiE },
  ];
  const cosT = Math.cos(mur.rotationY);
  const sinT = Math.sin(mur.rotationY);
  return coinsLocaux.map(c => {
    const xMonde = c.x * cosT + c.z * sinT + mur.positionX;
    const zMonde = -c.x * sinT + c.z * cosT + mur.positionZ;
    return mondeVersPixel(xMonde, zMonde);
  });
}

// NOUVEAU — Version générique de coinsMurPixels, pour tout rectangle
// centré+tourné (utilisée par le toit maintenant qu'il est orientable,
// comme un mur). Le mur garde sa propre fonction ci-dessus pour ne pas
// risquer de régression sur du code déjà fiable en démo.
function coinsRectanglePixels(centreX, centreZ, longueur, largeur, rotationY) {
  const demiL = longueur / 2;
  const demiP = largeur / 2;
  const coinsLocaux = [
    { x: -demiL, z: -demiP }, { x: demiL, z: -demiP },
    { x: demiL, z: demiP }, { x: -demiL, z: demiP },
  ];
  const cosT = Math.cos(rotationY);
  const sinT = Math.sin(rotationY);
  return coinsLocaux.map(c => {
    const xMonde = c.x * cosT + c.z * sinT + centreX;
    const zMonde = -c.x * sinT + c.z * cosT + centreZ;
    return mondeVersPixel(xMonde, zMonde);
  });
}

// NOUVEAU — Portée FIXE de la grille dessinée, volontairement plus
// grande que ce qui tient à l'écran (au lieu d'un nombre de lignes
// recalculé pour s'arrêter pile au bord du conteneur). Le SVG découpe
// (clip) automatiquement tout ce qui sort du viewBox : ça ne coûte
// rien de plus que quelques lignes de dessin en trop, et ça garantit
// qu'il n'y a jamais de bord de grille visible artificiellement à
// l'intérieur de la zone affichée -- quelle que soit la taille de la
// fenêtre, et prêt pour un futur zoom/déplacement de la vue.
const PORTEE_GRILLE_VISUELLE_M = 50; // grille dessinée de -50m à +50m autour de l'origine

function genererGrilleSVG() {
  let lignes = '';
  // Lignes verticales : une par mètre, sur toute la portée large
  for (let m = -PORTEE_GRILLE_VISUELLE_M; m <= PORTEE_GRILLE_VISUELLE_M; m++) {
    const { x: px } = mondeVersPixel(m, 0);
    const yHaut = PLAN_ORIGINE_Y - PORTEE_GRILLE_VISUELLE_M * PLAN_ECHELLE;
    const yBas = PLAN_ORIGINE_Y + PORTEE_GRILLE_VISUELLE_M * PLAN_ECHELLE;
    lignes += `<line x1="${px}" y1="${yHaut}" x2="${px}" y2="${yBas}" />`;
  }
  // Lignes horizontales : une par mètre, sur toute la portée large
  for (let m = -PORTEE_GRILLE_VISUELLE_M; m <= PORTEE_GRILLE_VISUELLE_M; m++) {
    const { y: py } = mondeVersPixel(0, m);
    const xGauche = PLAN_ORIGINE_X - PORTEE_GRILLE_VISUELLE_M * PLAN_ECHELLE;
    const xDroite = PLAN_ORIGINE_X + PORTEE_GRILLE_VISUELLE_M * PLAN_ECHELLE;
    lignes += `<line x1="${xGauche}" y1="${py}" x2="${xDroite}" y2="${py}" />`;
  }
  return lignes;
}

function dessinerApercu() {
  if (!pointDepart || !dernierePositionSouris) return '';
  const depart = mondeVersPixel(pointDepart.x, pointDepart.z);
  const actuel = mondeVersPixel(dernierePositionSouris.x, dernierePositionSouris.z);

  if (modeDessin === 'dalle' || modeDessin === 'toit') {
    const x = Math.min(depart.x, actuel.x), y = Math.min(depart.y, actuel.y);
    const largeur = Math.abs(actuel.x - depart.x), hauteur = Math.abs(actuel.y - depart.y);
    const couleur = modeDessin === 'toit' ? '#b33a2e' : '#2266cc';
    return `<rect x="${x}" y="${y}" width="${largeur}" height="${hauteur}" fill="${couleur}22" stroke="${couleur}" stroke-width="1.5" stroke-dasharray="6,4" />`;
  }

  const dx = dernierePositionSouris.x - pointDepart.x;
  const dz = dernierePositionSouris.z - pointDepart.z;
  const longueur = Math.sqrt(dx * dx + dz * dz).toFixed(2);
  return `
    <line x1="${depart.x}" y1="${depart.y}" x2="${actuel.x}" y2="${actuel.y}" stroke="#2266cc" stroke-width="2" stroke-dasharray="6,4" />
    <circle cx="${depart.x}" cy="${depart.y}" r="4" fill="#2266cc" />
    <text x="${(depart.x + actuel.x) / 2}" y="${(depart.y + actuel.y) / 2 - 8}" font-size="11" fill="#2266cc" text-anchor="middle">${longueur} m</text>
  `;
}

function dessinerPlan2D() {
  const svg = document.getElementById('svg-plan');
  let html = `<g stroke="#ddd" stroke-width="1">${genererGrilleSVG()}</g>`;

 etat.dalles.forEach((dalle, i) => {
    const coin = mondeVersPixel(dalle.positionX - dalle.longueur / 2, dalle.positionZ - dalle.largeur / 2);
    const l = dalle.longueur * PLAN_ECHELLE, p = dalle.largeur * PLAN_ECHELLE;
    const selectionnee = elementSelectionne && elementSelectionne.type === 'dalles' && elementSelectionne.id === dalle.id;
    html += `<g data-glissable="1" data-type="dalles" data-id="${dalle.id}" class="forme-glissable">
      <rect x="${coin.x}" y="${coin.y}" width="${l}" height="${p}" fill="#cfcfcf" stroke="${selectionnee ? '#ffcc00' : '#555'}" stroke-width="${selectionnee ? 3 : 1.5}" />
      <text x="${coin.x + l / 2}" y="${coin.y + p / 2}" font-size="11" text-anchor="middle" fill="#444">Dalle ${i + 1}</text>
    </g>`;
  });

 etat.murs.forEach((mur, i) => {
    const coins = coinsMurPixels(mur);
    const points = coins.map(c => `${c.x},${c.y}`).join(' ');
    const centre = mondeVersPixel(mur.positionX, mur.positionZ);
    const estCloison = mur.porteur === false;
    const couleur = estCloison ? '#d8d3c4' : '#8b5a2b';
    const prefixe = estCloison ? 'C' : 'M';
    const selectionne = elementSelectionne && elementSelectionne.type === 'murs' && elementSelectionne.id === mur.id;
    html += `<g data-glissable="1" data-type="murs" data-id="${mur.id}" class="forme-glissable">
      <polygon points="${points}" fill="${couleur}" stroke="${selectionne ? '#ffcc00' : '#333'}" stroke-width="${selectionne ? 3 : 1}" />
      <text x="${centre.x}" y="${centre.y - 8}" font-size="10" text-anchor="middle" fill="#333">${prefixe}${i + 1} (${mur.longueur.toFixed(1)}m)</text>
    </g>`;
  });

  etat.poteaux.forEach((poteau) => {
    const coin = mondeVersPixel(poteau.positionX - poteau.cote / 2, poteau.positionZ - poteau.cote / 2);
    const cote = poteau.cote * PLAN_ECHELLE;
    const selectionne = elementSelectionne && elementSelectionne.type === 'poteaux' && elementSelectionne.id === poteau.id;
    html += `<rect data-glissable="1" data-type="poteaux" data-id="${poteau.id}" class="forme-glissable" x="${coin.x}" y="${coin.y}" width="${cote}" height="${cote}" fill="#555" stroke="${selectionne ? '#ffcc00' : '#222'}" stroke-width="${selectionne ? 3 : 1}" />`;
  });

  etat.toits.forEach((toit, i) => {
    const coins = coinsRectanglePixels(toit.positionX, toit.positionZ, toit.longueur, toit.largeur, toit.rotationY || 0);
    const points = coins.map(c => `${c.x},${c.y}`).join(' ');
    const centre = mondeVersPixel(toit.positionX, toit.positionZ);
    const selectionne = elementSelectionne && elementSelectionne.type === 'toits' && elementSelectionne.id === toit.id;
    html += `<g data-glissable="1" data-type="toits" data-id="${toit.id}" class="forme-glissable">
      <polygon points="${points}" fill="none" stroke="${selectionne ? '#ffcc00' : '#b33a2e'}" stroke-width="${selectionne ? 3 : 1.5}" stroke-dasharray="4,3" />
      <text x="${centre.x}" y="${centre.y}" font-size="10" text-anchor="middle" fill="#b33a2e">Toit ${i + 1}</text>
    </g>`;
  });

  // NOUVEAU — Portes (trait marron, plus épais qu'une fenêtre)
  etat.portes.forEach((porte) => {
    const mur = etat.murs.find(m => m.id === porte.mur_id);
    if (!mur) return;
    const d = directionMur(mur);
    const debut = pointDebutMur(mur);
    const centreMondeX = debut.x + d.dx * porte.offset;
    const centreMondeZ = debut.z + d.dz * porte.offset;
    const demiL = porte.largeur / 2;
    const p1 = mondeVersPixel(centreMondeX - d.dx * demiL, centreMondeZ - d.dz * demiL);
    const p2 = mondeVersPixel(centreMondeX + d.dx * demiL, centreMondeZ + d.dz * demiL);
    html += `<line x1="${p1.x}" y1="${p1.y}" x2="${p2.x}" y2="${p2.y}" stroke="#6b4423" stroke-width="5" stroke-linecap="round" />`;
  });

  // NOUVEAU — Toits (contour pointillé rouge au-dessus du plan, orientable)
  etat.toits.forEach((toit, i) => {
    const coins = coinsRectanglePixels(toit.positionX, toit.positionZ, toit.longueur, toit.largeur, toit.rotationY || 0);
    const points = coins.map(c => `${c.x},${c.y}`).join(' ');
    const centre = mondeVersPixel(toit.positionX, toit.positionZ);
    html += `<polygon points="${points}" fill="none" stroke="#b33a2e" stroke-width="1.5" stroke-dasharray="4,3" />
      <text x="${centre.x}" y="${centre.y}" font-size="10" text-anchor="middle" fill="#b33a2e">Toit ${i + 1}</text>`;
  });

  // NOUVEAU — Éléments électriques (petits points jaunes)
  etat.elements_electriques.forEach((element) => {
    let x, z;
    if (element.mur_id) {
      const mur = etat.murs.find(m => m.id === element.mur_id);
      if (!mur) return;
      const d = directionMur(mur);
      const debut = pointDebutMur(mur);
      x = debut.x + d.dx * element.offset;
      z = debut.z + d.dz * element.offset;
    } else {
      x = element.positionX;
      z = element.positionZ;
    }
    const px = mondeVersPixel(x, z);
    html += `<circle cx="${px.x}" cy="${px.y}" r="4" fill="#ffcc00" stroke="#333" stroke-width="1" />`;
  });

  html += dessinerPoignees();
  html += dessinerApercu();
  svg.innerHTML = html;
}

// ============================================================
// NOUVEAU — OUTILS PARTAGÉS 2D / 3D : type d'éléments déplaçables,
// conversion repère local <-> monde, redimensionnement, rotation.
// Les mêmes fonctions servent au plan 2D (SVG) et à la vue 3D
// (Three.js) : le monde partage les mêmes axes X/Z dans les deux
// vues, seule la façon de lire la position de la souris diffère.
// ============================================================
const TYPES_DEPLACABLES = ['dalles', 'murs', 'poteaux', 'toits'];

// Passe un point du repère LOCAL d'un élément (centré sur lui, tourné
// de rotationY) vers le repère MONDE -- même formule que dans
// coinsMurPixels / coinsRectanglePixels, extraite ici pour être
// réutilisable par les poignées 2D et les manipulateurs 3D.
function pointLocalVersMonde(centreX, centreZ, rotationY, localX, localZ) {
  const cosT = Math.cos(rotationY), sinT = Math.sin(rotationY);
  return {
    x: localX * cosT + localZ * sinT + centreX,
    z: -localX * sinT + localZ * cosT + centreZ,
  };
}

// Demi-dimensions + rotation d'un élément, quel que soit son type --
// dalles et poteaux n'ont pas de rotation dans ce modèle (toujours 0).
function infosTailleElement(type, objet) {
  if (type === 'murs') return { demiLong: objet.longueur / 2, demiLarg: objet.epaisseur / 2, rotation: objet.rotationY || 0 };
  if (type === 'dalles') return { demiLong: objet.longueur / 2, demiLarg: objet.largeur / 2, rotation: 0 };
  if (type === 'toits') return { demiLong: objet.longueur / 2, demiLarg: objet.largeur / 2, rotation: objet.rotationY || 0 };
  if (type === 'poteaux') return { demiLong: objet.cote / 2, demiLarg: objet.cote / 2, rotation: 0 };
  return null;
}

const TAILLE_MIN_M = 0.2; // évite un élément de taille nulle/négative en tirant la poignée

// Redimensionne un élément à partir d'une position souris en
// coordonnées MONDE (X/Z) : on repasse cette position dans le repère
// local de l'élément (selon sa rotation actuelle) ; sa distance à
// l'origine locale sur chaque axe donne la nouvelle demi-taille.
// NOTE -- le redimensionnement est symétrique autour du centre (pas
// ancré sur le coin opposé comme dans certains logiciels de dessin) :
// plus simple à calculer, suffisant pour ce prototype.
function redimensionnerElement(type, id, mondePos) {
  const objet = etat[type].find(o => o.id === id);
  if (!objet) return;
  const rotation = objet.rotationY || 0;
  const dx = mondePos.x - objet.positionX;
  const dz = mondePos.z - objet.positionZ;
  const cosT = Math.cos(rotation), sinT = Math.sin(rotation);
  const localX = dx * cosT - dz * sinT;
  const localZ = dx * sinT + dz * cosT;

  if (type === 'poteaux') {
    objet.cote = Math.max(TAILLE_MIN_M, 2 * Math.max(Math.abs(localX), Math.abs(localZ)));
    return;
  }
  if (type === 'murs') {
    objet.longueur = Math.max(TAILLE_MIN_M, 2 * Math.abs(localX));
    objet.epaisseur = Math.max(TAILLE_MIN_M, 2 * Math.abs(localZ));
    return;
  }
  objet.longueur = Math.max(TAILLE_MIN_M, 2 * Math.abs(localX)); // dalles et toits
  objet.largeur = Math.max(TAILLE_MIN_M, 2 * Math.abs(localZ));
}

// Oriente un élément (murs / toits uniquement) pour que son axe
// pointe vers la position souris -- même formule atan2(-dz, dx) déjà
// utilisée ailleurs pour orienter un mur tracé au clic.
function orienterElement(type, id, mondePos) {
  const objet = etat[type].find(o => o.id === id);
  if (!objet) return;
  const dx = mondePos.x - objet.positionX;
  const dz = mondePos.z - objet.positionZ;
  objet.rotationY = normaliserAngle(Math.atan2(-dz, dx));
}

// ============================================================
// NOUVEAU — GLISSER / REDIMENSIONNER / TOURNER SUR LE PLAN 2D
// ============================================================
let glissement = null;          // { type, id, decalageX, decalageZ } | null
let redimensionnement = null;   // { type, id } | null
let rotationEnCours = null;     // { type, id } | null

function pointEcranVersMondeBrut(evt) {
  const svg = document.getElementById('svg-plan');
  const point = svg.createSVGPoint();
  point.x = evt.clientX;
  point.y = evt.clientY;
  const pointSVG = point.matrixTransform(svg.getScreenCTM().inverse());
  return {
    x: (pointSVG.x - PLAN_ORIGINE_X) / PLAN_ECHELLE,
    z: (pointSVG.y - PLAN_ORIGINE_Y) / PLAN_ECHELLE,
  };
}

document.getElementById('svg-plan').addEventListener('mousedown', (evt) => {
  if (modeDessin) return; // un outil de dessin actif passe toujours devant

  const poigneeRotation = evt.target.closest('[data-poignee="rotation"]');
  if (poigneeRotation) {
    evt.preventDefault();
    rotationEnCours = { type: poigneeRotation.dataset.type, id: poigneeRotation.dataset.id };
    document.getElementById('svg-plan').classList.add('rotation-active');
    return;
  }

  const poigneeRedim = evt.target.closest('[data-poignee="redimensionner"]');
  if (poigneeRedim) {
    evt.preventDefault();
    redimensionnement = { type: poigneeRedim.dataset.type, id: poigneeRedim.dataset.id };
    document.getElementById('svg-plan').classList.add('redimensionnement-actif');
    return;
  }

  const cible = evt.target.closest('[data-glissable="1"]');
  if (!cible) return;

  const type = cible.dataset.type;
  const id = cible.dataset.id;
  const objet = etat[type].find(o => o.id === id);
  if (!objet) return;

  evt.preventDefault();

  const depart = pointEcranVersMondeBrut(evt);
  glissement = {
    type, id,
    decalageX: objet.positionX - depart.x,
    decalageZ: objet.positionZ - depart.z,
  };

  if (!(elementSelectionne && elementSelectionne.type === type && elementSelectionne.id === id)) {
    selectionner(type, id);
  }

  document.getElementById('svg-plan').classList.add('glissement-actif');
});

window.addEventListener('mousemove', (evt) => {
  if (!glissement && !redimensionnement && !rotationEnCours) return;

  if (glissement) {
    const objet = etat[glissement.type].find(o => o.id === glissement.id);
    if (!objet) { glissement = null; return; }
    const brut = pointEcranVersMondeBrut(evt);
    const nouvelle = accrocherALaGrille({ x: brut.x + glissement.decalageX, z: brut.z + glissement.decalageZ });
    objet.positionX = nouvelle.x;
    objet.positionZ = nouvelle.z;
  } else if (redimensionnement) {
    redimensionnerElement(redimensionnement.type, redimensionnement.id, pointEcranVersMondeBrut(evt));
  } else if (rotationEnCours) {
    orienterElement(rotationEnCours.type, rotationEnCours.id, pointEcranVersMondeBrut(evt));
  }

  dessinerPlan2D();
  recalculerProjet();
});

window.addEventListener('mouseup', () => {
  if (!glissement && !redimensionnement && !rotationEnCours) return;
  glissement = null;
  redimensionnement = null;
  rotationEnCours = null;
  document.getElementById('svg-plan').classList.remove('glissement-actif', 'redimensionnement-actif', 'rotation-active');
});

// Dessine les poignées (coin de redimensionnement + poignée de
// rotation) autour de l'élément sélectionné, si son type le permet.
function dessinerPoignees() {
  if (modeDessin || !elementSelectionne) return '';
  const { type, id } = elementSelectionne;
  if (!TYPES_DEPLACABLES.includes(type)) return '';
  const objet = etat[type].find(o => o.id === id);
  if (!objet) return '';
  const infos = infosTailleElement(type, objet);
  if (!infos) return '';

  let html = '';

  const coin = pointLocalVersMonde(objet.positionX, objet.positionZ, infos.rotation, infos.demiLong, infos.demiLarg);
  const pxCoin = mondeVersPixel(coin.x, coin.z);
  html += `<rect data-poignee="redimensionner" data-type="${type}" data-id="${id}" class="poignee-redimensionner"
    x="${pxCoin.x - 6}" y="${pxCoin.y - 6}" width="12" height="12" />`;

  if (type === 'murs' || type === 'toits') {
    const DECALAGE_POIGNEE_ROTATION_M = 0.8;
    const pointRotation = pointLocalVersMonde(objet.positionX, objet.positionZ, infos.rotation, 0, -(infos.demiLarg + DECALAGE_POIGNEE_ROTATION_M));
    const pxRotation = mondeVersPixel(pointRotation.x, pointRotation.z);
    const centre = mondeVersPixel(objet.positionX, objet.positionZ);
    html += `<line x1="${centre.x}" y1="${centre.y}" x2="${pxRotation.x}" y2="${pxRotation.y}" stroke="#ffcc00" stroke-width="1" stroke-dasharray="3,3" />
      <circle data-poignee="rotation" data-type="${type}" data-id="${id}" class="poignee-rotation" cx="${pxRotation.x}" cy="${pxRotation.y}" r="7" />`;
  }

  return html;
}

// ============================================================
// BASCULE 3D / 2D
// ============================================================

document.getElementById('toggle-vue').addEventListener('click', () => {
  const vue2d = document.getElementById('vue-2d');
  const bouton = document.getElementById('toggle-vue');
  if (vue2d.classList.contains('cachee')) {
    vue2d.classList.remove('cachee');
    redimensionnerPlan2D(); // le conteneur vient de devenir visible, sa taille n'était pas connue avant
    dessinerPlan2D();
    bouton.textContent = 'Revenir à la vue 3D';
  } else {
    vue2d.classList.add('cachee');
    bouton.textContent = 'Voir le plan 2D';
  }
});

// ============================================================
// CADRER LA VUE — recentre la caméra sur tous les éléments existants
// ============================================================

function cadrerVue() {
  if (groupeElements.children.length === 0) return; // rien à cadrer
  const boite = new THREE.Box3().setFromObject(groupeElements);
  const centre = boite.getCenter(new THREE.Vector3());
  const taille = boite.getSize(new THREE.Vector3());
  const rayon = Math.max(taille.x, taille.y, taille.z, 1);
  const distance = (rayon / Math.tan((camera.fov * Math.PI) / 360)) * 1.6;
  const direction = new THREE.Vector3().subVectors(camera.position, controls.target).normalize();
  camera.position.copy(centre).addScaledVector(direction, distance);
  controls.target.copy(centre);
  controls.update();
}
document.getElementById('cadrer-vue').addEventListener('click', cadrerVue);

// ============================================================
// SÉLECTION BIDIRECTIONNELLE — scène 3D ↔ liste d'éléments
// ============================================================
// Un seul état de sélection, partagé par les deux directions :
// - clic sur un mesh dans la scène 3D -> met à jour elementSelectionne
// - clic sur une ligne dans le panneau -> met à jour elementSelectionne
// Dans les deux cas, la MÊME fonction (selectionner) applique ensuite
// la surbrillance des deux côtés à la fois. Ça évite d'avoir deux
// logiques différentes à maintenir en synchronisation manuellement.

let elementSelectionne = null; // { type: 'murs', id: 'mur-3' } | null
let contourSelection = null;   // le THREE.BoxHelper actuellement affiché

function synchroniserSelectionEtat() {
  etat.selection = elementSelectionne ? { ...elementSelectionne } : null;
}

function selectionner(type, id) {
  // Cliquer une 2e fois sur le même élément le désélectionne (bascule).
  if (elementSelectionne && elementSelectionne.type === type && elementSelectionne.id === id) {
    elementSelectionne = null;
  } else {
    elementSelectionne = { type, id };
  }
  synchroniserSelectionEtat();
  appliquerSurbrillanceSelection();
  mettreAJourSurbrillanceListe();
}

function deselectionner() {
  elementSelectionne = null;
  synchroniserSelectionEtat();
  appliquerSurbrillanceSelection();
  mettreAJourSurbrillanceListe();
}

// Recherche, parmi les meshes actuellement dans la scène, celui qui
// correspond à elementSelectionne (via son userData), et affiche un
// contour jaune autour avec BoxHelper. Appelée après chaque sélection
// ET après chaque reconstruction de la scène (les meshes sont détruits
// et recréés à chaque recalcul, voir reconstruireScene3D).
function mettreAJourGizmoTransformation() {
  if (!modeTransformation || !elementSelectionne) {
    scene3D.setTransformVisibility(false);
    return;
  }

  const mesh = groupeElements.children.find(
    m => m.userData?.type === elementSelectionne.type && m.userData?.id === elementSelectionne.id
  );
  if (!mesh) {
    scene3D.setTransformVisibility(false);
    return;
  }

  scene3D.setTransformTarget(mesh);
  scene3D.setTransformVisibility(true);
  scene3D.setTransformMode(modeTransformation === 'rotate' ? 'rotate' : 'translate');
  scene3D.setTransformAxisConstraint(transformationAxe);
}

function appliquerSurbrillanceSelection() {
  if (contourSelection) {
    scene.remove(contourSelection);
    contourSelection.geometry.dispose();
    contourSelection.material.dispose();
    contourSelection = null;
  }
  if (elementSelectionne) {
    const mesh = groupeElements.children.find(
      m => m.userData?.type === elementSelectionne.type && m.userData?.id === elementSelectionne.id
    );
    if (mesh) {
      contourSelection = new THREE.BoxHelper(mesh, 0xffcc00);
      scene.add(contourSelection);
    }
  }
  mettreAJourManipulateurs3D(); // NOUVEAU -- repositionne les poignées 3D sur l'élément sélectionné
  if (!elementSelectionne) {
    scene3D.setTransformVisibility(false);
    return;
  }

  const mesh = groupeElements.children.find(
    m => m.userData?.type === elementSelectionne.type && m.userData?.id === elementSelectionne.id
  );
  if (!mesh) {
    scene3D.setTransformVisibility(false);
    return; // élément supprimé entre-temps
  }

  contourSelection = new THREE.BoxHelper(mesh, 0xffcc00);
  scene.add(contourSelection);
  mettreAJourGizmoTransformation();
}

// Ajoute/retire la classe CSS "selectionne" sur la ligne du panneau
// correspondante, sans reconstruire toute la liste (juste un
// changement de classe, très léger).
function mettreAJourSurbrillanceListe() {
  document.querySelectorAll('.ligne-element').forEach(ligne => {
    const correspond = elementSelectionne
      && ligne.dataset.type === elementSelectionne.type
      && ligne.dataset.id === elementSelectionne.id;
    ligne.classList.toggle('selectionne', !!correspond);
  });
}

// --- Détection du clic dans la scène 3D (raycasting) ---
const raycaster = new THREE.Raycaster();
const sourisNormalisee = new THREE.Vector2();

renderer.domElement.addEventListener('click', (evt) => {
  // NOUVEAU -- si ce clic est la fin d'un glisser (déplacement,
  // redimensionnement ou rotation en 3D), on l'ignore : sinon il
  // désélectionnerait l'élément qu'on vient tout juste de lâcher.
  if (ignorerProchainClicScene) { ignorerProchainClicScene = false; return; }
  // Ne pas interférer avec le mode dessin (qui a sa propre gestion de
  // clic sur le plan 2D, pas sur le canvas 3D) -- ici on est toujours
  // dans la scène 3D, donc pas de conflit, mais on vérifie quand même
  // qu'on n'est pas au milieu d'un drag de la caméra (OrbitControls).
function obtenirRaycastDepuisClic(evt) {
  const rect = renderer.domElement.getBoundingClientRect();
  sourisNormalisee.x = ((evt.clientX - rect.left) / rect.width) * 2 - 1;
  sourisNormalisee.y = -((evt.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(sourisNormalisee, camera);
  return raycaster;
}

function intersecterPlanSol(raycasterInst) {
  // Plan sol : y = 0
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const point = new THREE.Vector3();
  const t = raycasterInst.ray.intersectPlane(plane, point);
  return t ? point : null;
}

function creerObjetDepuisModeDessin3D(evt) {
  // Ajout depuis l'espace 3D : uniquement
  // - fenêtres, portes, prises, interrupteurs (toujours sur un mur existant)
  // Tout le reste reste désactivé en 3D.
  if (!modeDessin) return false;
  if (!['fenetre', 'porte', 'prise', 'interrupteur'].includes(modeDessin)) return false;

  const ray = obtenirRaycastDepuisClic(evt);





  // En mode 3D, on n'autorise que l'ajout de :
  // - fenêtres, portes, prises, interrupteurs (sur murs)
  // Tout le reste doit rester désactivé (murs, dalles, toits, poteaux,
  // cloisons, point lumineux).
  // NOTE : si modeDessin n'est pas dans la liste ci-dessous, on ne crée
  // rien dans etat (aucun objet n'est ajouté au projet).
  if (['fenetre', 'porte', 'prise', 'interrupteur'].includes(modeDessin)) {



    const p = intersecterPlanSol(ray);
    if (!p) return true;
    const position = { x: p.x, z: p.z };

    if (modeDessin === 'poteau') {
      const d = lireDefautsPoteau();
      etat.poteaux.push({
        id: genererId('poteau'),
        cote: d.cote,
        hauteur: d.hauteur,
        materiau: d.materiau,
        positionX: position.x,
        positionZ: position.z,
      });
      recalculerProjet();
      return true;
    }

    if (modeDessin === 'point_lumineux') {
      etat.elements_electriques.push({
        id: genererId('point_lumineux'),
        type: 'point_lumineux',
        mur_id: null,
        offset: 0,
        hauteur: lireHauteurPointLumineux(),
        positionX: position.x,
        positionZ: position.z,
      });
      recalculerProjet();
      return true;
    }

    if (modeDessin === 'dalle') {
      if (!pointDepart) { pointDepart = position; return true; }
      const d = lireDefautsDalle();
      const longueur = Math.abs(position.x - pointDepart.x);
      const largeur = Math.abs(position.z - pointDepart.z);
      if (longueur < 0.3 || largeur < 0.3) { pointDepart = null; return true; }
      etat.dalles.push({
        id: genererId('dalle'),
        longueur: Math.min(30, longueur),
        largeur: Math.min(30, largeur),
        epaisseur: d.epaisseur,
        materiau: d.materiau,
        positionX: (pointDepart.x + position.x) / 2,
        positionZ: (pointDepart.z + position.z) / 2,
      });
      pointDepart = null;
      recalculerProjet();
      return true;
    }

    if (modeDessin === 'toit') {
      if (!pointDepart) { pointDepart = position; return true; }
      const d = lireDefautsToit();
      const longueur = Math.abs(position.x - pointDepart.x);
      const largeur = Math.abs(position.z - pointDepart.z);
      if (longueur < 1 || largeur < 1) { pointDepart = null; return true; }
      etat.toits.push({
        id: genererId('toit'),
        longueur: Math.min(50, longueur),
        largeur: Math.min(30, largeur),
        pente_degres: d.pente_degres,
        materiau: d.materiau,
        hauteur_support: d.hauteur_support,
        positionX: (pointDepart.x + position.x) / 2,
        positionZ: (pointDepart.z + position.z) / 2,
        rotationY: 0,
      });
      pointDepart = null;
      recalculerProjet();
      return true;
    }
  }

  if (modeDessin === 'mur' || modeDessin === 'cloison') {
    const p = intersecterPlanSol(ray);
    if (!p) return true;
    let position = { x: p.x, z: p.z };

    if (shiftEnfoncee && pointDepart) {
      const dx = position.x - pointDepart.x;
      const dz = position.z - pointDepart.z;
      const longueur = Math.sqrt(dx * dx + dz * dz);
      const angleAccroche = Math.round(Math.atan2(dz, dx) / (Math.PI / 4)) * (Math.PI / 4);
      position = {
        x: pointDepart.x + Math.cos(angleAccroche) * longueur,
        z: pointDepart.z + Math.sin(angleAccroche) * longueur,
      };
    } else {
      position = accrocherALaGrille(position);
    }

    if (!pointDepart) { pointDepart = position; return true; }
    const dx = position.x - pointDepart.x;
    const dz = position.z - pointDepart.z;
    const longueur = Math.sqrt(dx * dx + dz * dz);
    if (longueur < 0.2) return true;
    const d = modeDessin === 'mur' ? lireDefautsMur() : lireDefautsCloison();

    etat.murs.push({
      id: genererId(modeDessin === 'mur' ? 'mur' : 'cloison'),
      longueur: Math.min(50, longueur),
      hauteur: d.hauteur,
      epaisseur: d.epaisseur,
      materiau: d.materiau,
      positionX: (pointDepart.x + position.x) / 2,
      positionZ: (pointDepart.z + position.z) / 2,
      rotationY: Math.atan2(-dz, dx),
      porteur: modeDessin === 'mur',
    });
    pointDepart = null;
    recalculerProjet();
    return true;
  }

  // Outils accroché aux murs : on raycast pour récupérer le mur le plus proche.
  if (['fenetre', 'porte', 'prise', 'interrupteur'].includes(modeDessin)) {
    const intersections = ray.intersectObjects(groupeElements.children, true);
    if (intersections.length === 0) return true;

    let objetTouche = intersections[0].object;
    while (objetTouche && !objetTouche.userData?.type) objetTouche = objetTouche.parent;
    if (!objetTouche || objetTouche.userData.type !== 'murs') return true;

    const murId = objetTouche.userData.id;
    const mur = etat.murs.find(m => m.id === murId);
    if (!mur) return true;

    // Point d'impact projeté au centre du mur (x/z en monde). On calcule via
    // intersection sur y=0 puis on projette sur le mur : c'est cohérent avec le modèle
    // (offset le long du mur en x/z).
    const p = intersecterPlanSol(ray);
    const pointMonde = p ? { x: p.x, z: p.z } : { x: mur.positionX, z: mur.positionZ };
    const { offset } = projeterSurMur(mur, pointMonde);

    if (modeDessin === 'fenetre') {
      const d = lireDefautsFenetre();
      if (mur.longueur < d.largeur) { alert('Ce mur est trop court pour une fenêtre de cette largeur.'); return true; }
      const offsetBorne = Math.max(d.largeur / 2, Math.min(mur.longueur - d.largeur / 2, offset));
      etat.fenetres.push({
        id: genererId('fenetre'),
        mur_id: mur.id,
        offset: offsetBorne,
        largeur: d.largeur,
        hauteur: d.hauteur,
        hauteur_allege: d.hauteur_allege,
      });
      recalculerProjet();
      return true;
    }

    if (modeDessin === 'porte') {
      const d = lireDefautsPorte();
      if (mur.longueur < d.largeur) { alert('Ce mur est trop court pour une porte de cette largeur.'); return true; }
      const offsetBorne = Math.max(d.largeur / 2, Math.min(mur.longueur - d.largeur / 2, offset));
      etat.portes.push({
        id: genererId('porte'),
        mur_id: mur.id,
        offset: offsetBorne,
        largeur: d.largeur,
        hauteur: d.hauteur,
      });
      recalculerProjet();
      return true;
    }

    if (modeDessin === 'prise' || modeDessin === 'interrupteur') {
      const hauteur = modeDessin === 'prise' ? HAUTEUR_PRISE : HAUTEUR_INTERRUPTEUR;
      etat.elements_electriques.push({
        id: genererId(modeDessin),
        type: modeDessin,
        mur_id: mur.id,
        offset: Math.max(0, Math.min(mur.longueur, offset)),
        hauteur,
        positionX: 0,
        positionZ: 0,
      });
      recalculerProjet();
      return true;
    }
  }

  return false;
}

renderer.domElement.addEventListener('click', (evt) => {
  if (creerObjetDepuisModeDessin3D(evt)) return;

  const raycasterInst = obtenirRaycastDepuisClic(evt);
  const intersections = raycasterInst.intersectObjects(groupeElements.children, true);


  if (intersections.length === 0) {
    deselectionner();
    return;
  }

  let objetTouche = intersections[0].object;
  while (objetTouche && !objetTouche.userData?.type) {
    objetTouche = objetTouche.parent;
  }
  if (!objetTouche) return;
  selectionner(objetTouche.userData.type, objetTouche.userData.id);
});
// ============================================================
// NOUVEAU — GLISSER / REDIMENSIONNER / TOURNER DANS LA VUE 3D
// ============================================================
// Un plan horizontal invisible (y = 0) sert à convertir la position
// de la souris en coordonnées monde (X/Z) via un rayon Three.js.
// redimensionnerElement / orienterElement / accrocherALaGrille sont
// RÉUTILISÉES telles quelles : les axes X/Z sont les mêmes qu'en 2D.

const groupeManipulateurs3D = new THREE.Group();
scene.add(groupeManipulateurs3D);

const planSol = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const raycasterGlisse3D = new THREE.Raycaster();
const sourisGlisse3D = new THREE.Vector2();
const pointGlisse3D = new THREE.Vector3();

function survolerPlanSol3D(evt) {
  const rect = renderer.domElement.getBoundingClientRect();
  sourisGlisse3D.x = ((evt.clientX - rect.left) / rect.width) * 2 - 1;
  sourisGlisse3D.y = -((evt.clientY - rect.top) / rect.height) * 2 + 1;
  raycasterGlisse3D.setFromCamera(sourisGlisse3D, camera);
  const touche = raycasterGlisse3D.ray.intersectPlane(planSol, pointGlisse3D);
  return touche ? { x: touche.x, z: touche.z } : null;
}

function viderManipulateurs3D() {
  while (groupeManipulateurs3D.children.length > 0) {
    const objet3D = groupeManipulateurs3D.children.pop();
    objet3D.geometry.dispose();
    objet3D.material.dispose();
  }
}

// Hauteur purement visuelle des poignées -- aucune incidence sur le
// calcul, juste pour qu'elles soient visibles au-dessus de l'élément.
function hauteurAffichageManipulateur(type, objet) {
  if (type === 'murs' || type === 'poteaux') return (objet.hauteur || 2.5) + 0.3;
  if (type === 'toits') return (objet.hauteur_support || 2.5) + 0.5;
  return 0.3; // dalles
}

function mettreAJourManipulateurs3D() {
  viderManipulateurs3D();
  if (!elementSelectionne) return;
  const { type, id } = elementSelectionne;
  if (!TYPES_DEPLACABLES.includes(type)) return;
  const objet = etat[type].find(o => o.id === id);
  if (!objet) return;
  const infos = infosTailleElement(type, objet);
  if (!infos) return;
  const y = hauteurAffichageManipulateur(type, objet);

  const coin = pointLocalVersMonde(objet.positionX, objet.positionZ, infos.rotation, infos.demiLong, infos.demiLarg);
  const meshRedim = new THREE.Mesh(
    new THREE.BoxGeometry(0.25, 0.25, 0.25),
    new THREE.MeshBasicMaterial({ color: 0xff5533 })
  );
  meshRedim.position.set(coin.x, y, coin.z);
  meshRedim.userData = { poignee: 'redimensionner', type, id };
  groupeManipulateurs3D.add(meshRedim);

  if (type === 'murs' || type === 'toits') {
    const DECALAGE_POIGNEE_ROTATION_M = 0.8;
    const pointRotation = pointLocalVersMonde(objet.positionX, objet.positionZ, infos.rotation, 0, -(infos.demiLarg + DECALAGE_POIGNEE_ROTATION_M));
    const meshRotation = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0xffcc00 })
    );
    meshRotation.position.set(pointRotation.x, y, pointRotation.z);
    meshRotation.userData = { poignee: 'rotation', type, id };
    groupeManipulateurs3D.add(meshRotation);
  }
}

let glissement3D = null;         // { type, id, decalageX, decalageZ } | null
let redimensionnement3D = null;  // { type, id } | null
let rotationEnCours3D = null;    // { type, id } | null
let ignorerProchainClicScene = false;

renderer.domElement.addEventListener('mousedown', (evt) => {
  const rect = renderer.domElement.getBoundingClientRect();
  sourisGlisse3D.x = ((evt.clientX - rect.left) / rect.width) * 2 - 1;
  sourisGlisse3D.y = -((evt.clientY - rect.top) / rect.height) * 2 + 1;
  raycasterGlisse3D.setFromCamera(sourisGlisse3D, camera);

  // 1) Poignées (redimensionner / tourner) en priorité
  const intersectionsManip = raycasterGlisse3D.intersectObjects(groupeManipulateurs3D.children, false);
  if (intersectionsManip.length > 0) {
    const poignee = intersectionsManip[0].object.userData;
    evt.preventDefault();
    controls.enabled = false;
    if (poignee.poignee === 'redimensionner') redimensionnement3D = { type: poignee.type, id: poignee.id };
    else rotationEnCours3D = { type: poignee.type, id: poignee.id };
    return;
  }

  // 2) Sinon, élément déplaçable directement (mur, dalle, poteau, toit)
  const intersectionsElements = raycasterGlisse3D.intersectObjects(groupeElements.children, true);
  if (intersectionsElements.length === 0) return;

  let objetTouche = intersectionsElements[0].object;
  while (objetTouche && !objetTouche.userData?.type) objetTouche = objetTouche.parent;
  if (!objetTouche) return;

  const { type, id } = objetTouche.userData;
  if (!TYPES_DEPLACABLES.includes(type)) return; // fenêtres/portes/élec suivent leur mur

  const objet = etat[type].find(o => o.id === id);
  if (!objet) return;

  const point = survolerPlanSol3D(evt);
  if (!point) return;

  evt.preventDefault();
  controls.enabled = false;
  glissement3D = {
    type, id,
    decalageX: objet.positionX - point.x,
    decalageZ: objet.positionZ - point.z,
  };
});

renderer.domElement.addEventListener('mousemove', (evt) => {
  if (!glissement3D && !redimensionnement3D && !rotationEnCours3D) return;
  const point = survolerPlanSol3D(evt);
  if (!point) return;

  if (glissement3D) {
    const objet = etat[glissement3D.type].find(o => o.id === glissement3D.id);
    if (!objet) { glissement3D = null; return; }
    const nouvelle = accrocherALaGrille({ x: point.x + glissement3D.decalageX, z: point.z + glissement3D.decalageZ });
    objet.positionX = nouvelle.x;
    objet.positionZ = nouvelle.z;
  } else if (redimensionnement3D) {
    redimensionnerElement(redimensionnement3D.type, redimensionnement3D.id, point);
  } else if (rotationEnCours3D) {
    orienterElement(rotationEnCours3D.type, rotationEnCours3D.id, point);
  }

  recalculerProjet();
});

window.addEventListener('mouseup', () => {
  if (glissement3D || redimensionnement3D || rotationEnCours3D) {
    ignorerProchainClicScene = true;
    glissement3D = null;
    redimensionnement3D = null;
    rotationEnCours3D = null;
    controls.enabled = true;
  }
});
renderer.domElement.addEventListener('pointerup', () => {
  if (!modeTransformation || !elementSelectionne) return;
  recalculerProjet();
});

// --- Détection du clic dans la liste du panneau latéral ---
document.getElementById('liste-elements').addEventListener('click', (evt) => {
  // Ne pas déclencher la sélection si on clique sur le bouton supprimer
  // (qui a sa propre logique juste au-dessus) ou sur un champ éditable.
  if (evt.target.closest('[data-action="supprimer"], [data-action="miroir-x"], [data-action="miroir-z"], [data-action="dupliquer"]')) return;
  if (evt.target.tagName === 'INPUT' || evt.target.tagName === 'SELECT') return;

  const ligne = evt.target.closest('.ligne-element');
  if (!ligne) return;
  selectionner(ligne.dataset.type, ligne.dataset.id);
});

// ============================================================
// EXPORT JSON
// ============================================================

// Format de fichier HCOSMO : extension .hcosmo, contenu JSON en interne
// (comme un .docx est un zip -- l'extension personnalisée donne une
// identité au format sans changer la façon de le lire/écrire).
// VERSION_FORMAT_HCOSMO sert de garde-fou : si la structure change un
// jour, on pourra détecter et gérer les anciens fichiers proprement.
const VERSION_FORMAT_HCOSMO = 1;

function exporterProjet() {
  if (!dernierResultat) {
    alert('Aucun résultat calculé pour le moment.');
    return;
  }
  const donneesExport = {
    format: 'hcosmo',                      // signature du format, vérifiée à l'ouverture
    version_format: VERSION_FORMAT_HCOSMO,
    date_export: new Date().toISOString(),
    nom_projet: typeof nomProjetActuel !== 'undefined' ? nomProjetActuel : 'Projet sans titre',
    parametres: etat,
    resultats: dernierResultat,
  };
  const blob = new Blob([JSON.stringify(donneesExport, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const lien = document.createElement('a');
  lien.href = url;
  lien.download = `hcosmo-projet-${Date.now()}.hcosmo`; // extension .hcosmo (au lieu de .json)
  document.body.appendChild(lien);
  lien.click();
  document.body.removeChild(lien);
  URL.revokeObjectURL(url);
}
document.getElementById('exporter-projet').addEventListener('click', exporterProjet);

// ============================================================
// NOUVEAU — EXPORT PDF DU RAPPORT
// ============================================================
// Génère une page HTML autonome (styles inclus), l'ouvre dans un
// nouvel onglet, puis déclenche l'impression native du navigateur.
// L'utilisateur choisit "Enregistrer en PDF" comme imprimante dans la
// boîte de dialogue -- aucune librairie externe, aucune dépendance
// réseau, fonctionne même hors ligne.

// Petite fonction utilitaire : évite qu'un nom de matériau/type brut
// (ex: "beton") s'affiche tel quel dans un rapport destiné à des
// investisseurs -- transforme en "Béton", etc.
const LIBELLES_MATERIAUX = {
  beton: 'Béton', brique: 'Brique', bois: 'Bois', placo: 'Placo',
  tuile: 'Tuile', tole: 'Tôle', ardoise: 'Ardoise',
};
function libelleMateriau(nom) {
  return LIBELLES_MATERIAUX[nom] || nom;
}

// Construit une ligne <tr> de tableau ; évite de répéter le même
// gabarit pour chaque catégorie d'élément ci-dessous.
function ligneTableauRapport(colonnes) {
  return `<tr>${colonnes.map(c => `<td>${c}</td>`).join('')}</tr>`;
}

function genererRapportHTML() {
  const r = dernierResultat;
  const nomProjet = typeof nomProjetActuel !== 'undefined' ? nomProjetActuel : 'Projet sans titre';
  const dateRapport = new Date().toLocaleDateString('fr-FR', { year: 'numeric', month: 'long', day: 'numeric' });

  let sections = '';

  // --- Murs et cloisons ---
  if (etat.murs.length > 0) {
    const lignes = etat.murs.map(mur => {
      const res = r.murs.find(m => m.id === mur.id) || {};
      const type = mur.porteur === false ? 'Cloison' : 'Mur porteur';
      return ligneTableauRapport([
        type,
        `${mur.longueur.toFixed(2)} × ${mur.hauteur.toFixed(2)} × ${mur.epaisseur.toFixed(2)} m`,
        libelleMateriau(mur.materiau),
        `${(res.volume_m3 ?? 0).toFixed(3)} m³`,
        `${(res.cout_total_eur ?? 0).toFixed(2)} €`,
      ]);
    }).join('');
    sections += `<h2>Murs &amp; cloisons</h2>
      <table><thead><tr><th>Type</th><th>Dimensions (L×H×É)</th><th>Matériau</th><th>Volume</th><th>Coût</th></tr></thead>
      <tbody>${lignes}</tbody></table>`;
  }

  // --- Soubassements (dérivés, pas stockés dans etat -- on les lit
  // directement depuis le dernier résultat calculé) ---
  if (r.soubassements && r.soubassements.length > 0) {
    const lignes = r.soubassements.map(s => ligneTableauRapport([
      `Soubassement du mur ${s.mur_id}`,
      `hauteur ${s.hauteur_m.toFixed(2)} m, épaisseur ${s.epaisseur_m.toFixed(2)} m`,
      'Béton',
      `${s.volume_m3.toFixed(3)} m³`,
      `${s.cout_total_eur.toFixed(2)} €`,
    ])).join('');
    sections += `<h2>Soubassements (fondations automatiques)</h2>
      <table><thead><tr><th>Élément</th><th>Dimensions</th><th>Matériau</th><th>Volume</th><th>Coût</th></tr></thead>
      <tbody>${lignes}</tbody></table>`;
  }

  // --- Dalles ---
  if (etat.dalles.length > 0) {
    const lignes = etat.dalles.map(dalle => {
      const res = r.dalles.find(d => d.id === dalle.id) || {};
      return ligneTableauRapport([
        `${dalle.longueur.toFixed(2)} × ${dalle.largeur.toFixed(2)} × ${dalle.epaisseur.toFixed(2)} m`,
        libelleMateriau(dalle.materiau),
        `${(res.surface_m2 ?? 0).toFixed(2)} m²`,
        `${(res.volume_m3 ?? 0).toFixed(3)} m³`,
        `${(res.cout_total_eur ?? 0).toFixed(2)} €`,
      ]);
    }).join('');
    sections += `<h2>Dalles</h2>
      <table><thead><tr><th>Dimensions</th><th>Matériau</th><th>Surface</th><th>Volume</th><th>Coût</th></tr></thead>
      <tbody>${lignes}</tbody></table>`;
  }

  // --- Poteaux ---
  if (etat.poteaux.length > 0) {
    const lignes = etat.poteaux.map(poteau => {
      const res = r.poteaux.find(p => p.id === poteau.id) || {};
      return ligneTableauRapport([
        `${poteau.cote.toFixed(2)} × ${poteau.cote.toFixed(2)} × ${poteau.hauteur.toFixed(2)} m`,
        libelleMateriau(poteau.materiau),
        `${(res.volume_m3 ?? 0).toFixed(3)} m³`,
        `${(res.cout_total_eur ?? 0).toFixed(2)} €`,
      ]);
    }).join('');
    sections += `<h2>Poteaux</h2>
      <table><thead><tr><th>Dimensions</th><th>Matériau</th><th>Volume</th><th>Coût</th></tr></thead>
      <tbody>${lignes}</tbody></table>`;
  }

  // --- Toits ---
  if (etat.toits.length > 0) {
    const lignes = etat.toits.map(toit => {
      const res = r.toits.find(t => t.id === toit.id) || {};
      return ligneTableauRapport([
        `${toit.longueur.toFixed(2)} × ${toit.largeur.toFixed(2)} m, pente ${toit.pente_degres}°`,
        libelleMateriau(toit.materiau),
        `${(res.surface_m2 ?? 0).toFixed(2)} m²`,
        `${(res.cout_total_eur ?? 0).toFixed(2)} €`,
      ]);
    }).join('');
    sections += `<h2>Toiture</h2>
      <table><thead><tr><th>Dimensions</th><th>Matériau</th><th>Surface réelle</th><th>Coût</th></tr></thead>
      <tbody>${lignes}</tbody></table>`;
  }

  // --- Électricité (résumé, pas ligne par ligne -- lot symbolique) ---
  if (etat.elements_electriques.length > 0 || etat.tableau_electrique) {
    const compte = { prise: 0, interrupteur: 0, point_lumineux: 0 };
    etat.elements_electriques.forEach(e => { if (compte[e.type] !== undefined) compte[e.type]++; });
    const coutElec = r.elements_electriques.reduce((s, e) => s + e.cout_eur, 0)
      + (etat.tableau_electrique ? 450 : 0);
    sections += `<h2>Électricité <span class="note-rapport">(lot symbolique, hors dimensionnement de circuits)</span></h2>
      <table><thead><tr><th>Prises</th><th>Interrupteurs</th><th>Points lumineux</th><th>Tableau électrique</th><th>Coût</th></tr></thead>
      <tbody>${ligneTableauRapport([
        compte.prise, compte.interrupteur, compte.point_lumineux,
        etat.tableau_electrique ? 'Oui' : 'Non',
        `${coutElec.toFixed(2)} €`,
      ])}</tbody></table>`;
  }

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>Rapport HCOSMO — ${nomProjet}</title>
<style>
  body { font-family: 'Segoe UI', Arial, sans-serif; color: #1a1a1a; margin: 40px; }
  h1 { font-size: 22px; margin-bottom: 2px; }
  .sous-titre { color: #666; font-size: 13px; margin-bottom: 28px; }
  h2 { font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px; color: #5B4FE8;
       border-bottom: 1px solid #ddd; padding-bottom: 4px; margin-top: 26px; }
  .note-rapport { font-size: 11px; color: #888; text-transform: none; letter-spacing: normal; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 12px; }
  th { text-align: left; background: #f2f1fb; padding: 6px 8px; border-bottom: 2px solid #ddd; }
  td { padding: 6px 8px; border-bottom: 1px solid #eee; }
  .total-box { margin-top: 30px; padding: 16px 20px; background: #f2f1fb; border-radius: 8px; }
  .total-box h2 { border: none; margin-top: 0; }
  .ligne-total { display: flex; justify-content: space-between; font-size: 13px; padding: 3px 0; }
  .ligne-total.principal { font-size: 17px; font-weight: bold; color: #3E35B0; margin-top: 6px; }
  @media print {
    body { margin: 15mm; }
    h2 { break-after: avoid; }
    table { break-inside: avoid; }
  }
</style>
</head>
<body>
  <h1>HCOSMO — Rapport de projet</h1>
  <div class="sous-titre">${nomProjet} — généré le ${dateRapport} — prototype de preuve de concept</div>

  ${sections || '<p>Projet vide -- aucun élément à afficher.</p>'}

  <div class="total-box">
    <h2>Total projet</h2>
    <div class="ligne-total"><span>Éléments</span><span>${r.total.nb_murs} murs/cloisons · ${r.total.nb_dalles} dalles · ${r.total.nb_poteaux} poteaux · ${r.total.nb_toits} toits</span></div>
    <div class="ligne-total"><span>Surface habitable</span><span>${r.total.surface_habitable_m2.toFixed(2)} m²</span></div>
    <div class="ligne-total"><span>Volume total</span><span>${r.total.volume_m3.toFixed(3)} m³</span></div>
    <div class="ligne-total"><span>Poids total</span><span>${r.total.poids_kg.toFixed(1)} kg</span></div>
    <div class="ligne-total principal"><span>Coût total estimé</span><span>${r.total.cout_total_eur.toFixed(2)} €</span></div>
  </div>
</body>
</html>`;
}

function exporterRapportPDF() {
  if (!dernierResultat) {
    alert('Aucun résultat calculé pour le moment.');
    return;
  }
  const contenuHTML = genererRapportHTML();
  const fenetreRapport = window.open('', '_blank');
  if (!fenetreRapport) {
    alert("Le navigateur a bloqué l'ouverture du rapport (bloqueur de pop-up). Autorisez les pop-ups pour ce site puis réessayez.");
    return;
  }
  fenetreRapport.document.write(contenuHTML);
  fenetreRapport.document.close();
  // Petit délai avant d'appeler print() : laisse le temps au nouvel
  // onglet de terminer son rendu, sinon l'aperçu d'impression peut
  // apparaître vide sur certains navigateurs.
  setTimeout(() => fenetreRapport.print(), 300);
}
document.getElementById('exporter-pdf').addEventListener('click', exporterRapportPDF);

// ============================================================
// OUVRIR UN PROJET (.hcosmo) — sélection de fichier, validation,
// restauration complète de l'état, gestion d'erreurs.
// ============================================================

document.getElementById('ouvrir-projet').addEventListener('click', () => {
  document.getElementById('entree-fichier-ouvrir').click();
});

document.getElementById('entree-fichier-ouvrir').addEventListener('change', (evt) => {
  const fichier = evt.target.files[0];
  if (!fichier) return; // boîte de dialogue annulée par l'utilisateur

  const lecteur = new FileReader();

  lecteur.onload = () => {
    let donnees;

    // Étape 1 : le contenu est-il au moins du JSON valide ?
    try {
      donnees = JSON.parse(lecteur.result);
    } catch (erreur) {
      alert("Impossible d'ouvrir ce fichier : contenu JSON invalide (fichier corrompu ou d'un autre type).");
      evt.target.value = '';
      return;
    }

    // Étape 2 : est-ce bien un fichier HCOSMO reconnu ?
    if (donnees.format !== 'hcosmo' || !donnees.parametres) {
      alert('Ce fichier ne semble pas être un projet HCOSMO valide (signature de format manquante).');
      evt.target.value = '';
      return;
    }

    // Étape 3 : toutes les listes attendues sont-elles présentes ?
    const cles_attendues = ['murs', 'dalles', 'poteaux', 'fenetres', 'portes', 'toits', 'elements_electriques'];
    const cles_manquantes = cles_attendues.filter(cle => !Array.isArray(donnees.parametres[cle]));
    if (cles_manquantes.length > 0) {
      alert(`Ce fichier .hcosmo est incomplet ou corrompu (données manquantes : ${cles_manquantes.join(', ')}).`);
      evt.target.value = '';
      return;
    }

    if (!confirm('Ouvrir ce projet remplacera le projet actuel non sauvegardé. Continuer ?')) {
      evt.target.value = '';
      return;
    }

    etat.murs = donnees.parametres.murs;
    etat.dalles = donnees.parametres.dalles;
    etat.poteaux = donnees.parametres.poteaux;
    etat.fenetres = donnees.parametres.fenetres;
    etat.portes = donnees.parametres.portes;
    etat.toits = donnees.parametres.toits;
    etat.elements_electriques = donnees.parametres.elements_electriques;
    etat.tableau_electrique = !!donnees.parametres.tableau_electrique;

    // Recale le compteur d'id au-delà du plus grand id du fichier ouvert,
    // pour ne jamais créer de doublon si on ajoute un élément après coup.
    const tousLesIds = [
      ...etat.murs, ...etat.dalles, ...etat.poteaux,
      ...etat.fenetres, ...etat.portes, ...etat.toits, ...etat.elements_electriques,
    ].map(o => parseInt(String(o.id).split('-').pop(), 10)).filter(n => !isNaN(n));
    prochainId = tousLesIds.length > 0 ? Math.max(...tousLesIds) + 1 : 1;

    if (typeof nomProjetActuel !== 'undefined') {
      nomProjetActuel = donnees.nom_projet || 'Projet importé';
      const affichage = document.getElementById('nom-projet-affiche');
      if (affichage) affichage.textContent = nomProjetActuel;
    }

    definirModeDessin(null);
    cadrerApresRecalcul = true;
    recalculerProjet();

    evt.target.value = ''; // permet de rouvrir le même fichier plus tard si besoin
  };

  lecteur.onerror = () => {
    alert("Erreur de lecture du fichier. Réessayez, ou vérifiez qu'il n'est pas ouvert dans un autre programme.");
  };

  lecteur.readAsText(fichier);
});

// ============================================================
// AIDE — ouvre/ferme le panneau d'aide (contenu statique, voir HTML)
// ============================================================

document.getElementById('bouton-annuler').addEventListener('click', annulerAction);
document.getElementById('bouton-refaire').addEventListener('click', refaireAction);

document.getElementById('ouvrir-aide').addEventListener('click', () => {
  document.getElementById('modal-aide').classList.remove('cachee');
});
document.getElementById('fermer-aide').addEventListener('click', () => {
  document.getElementById('modal-aide').classList.add('cachee');
});

// ============================================================
// TOUT EFFACER
// ============================================================

document.getElementById('reinitialiser-projet').addEventListener('click', () => {
  if (!confirm('Effacer tous les éléments du projet ?')) return;
  etat.murs = [];
  etat.dalles = [];
  etat.poteaux = [];
  etat.fenetres = [];
  etat.portes = []; // NOUVEAU
  etat.toits = []; // NOUVEAU
  etat.elements_electriques = []; // NOUVEAU
  etat.tableau_electrique = false; // NOUVEAU
  elementSelectionne = null;
  synchroniserSelectionEtat();
  const caseTableau = document.getElementById('def-tableau-electrique');
  if (caseTableau) caseTableau.checked = false;
  definirModeDessin(null);
  recalculerProjet();
});

// ============================================================
// NOUVEAU — MAISON EXEMPLE (1 clic, pour sécuriser la démo live :
// pas besoin de tout dessiner à la main devant les investisseurs)
// ============================================================

function chargerMaisonExemple() {
  // Repart d'un plateau vide, sans demander confirmation (le bouton
  // "Tout effacer" reste le seul qui demande confirmation, volontairement).
  etat.murs = [];
  etat.dalles = [];
  etat.poteaux = [];
  etat.fenetres = [];
  etat.portes = [];
  etat.toits = [];
  etat.elements_electriques = [];
  etat.tableau_electrique = true;
  const caseTableau = document.getElementById('def-tableau-electrique');
  if (caseTableau) caseTableau.checked = true;

  const HAUTEUR_MUR = 2.5;
  const EPAISSEUR_MUR = 0.2;

  // --- Dalle (emprise 8m x 6m) ---
  etat.dalles.push({
    id: genererId('dalle'), longueur: 8, largeur: 6, epaisseur: 0.15,
    materiau: 'beton', positionX: 0, positionZ: 0,
  });

  // --- 4 murs formant le rectangle de la maison ---
  const idMurNord = genererId('mur');
  etat.murs.push({ id: idMurNord, longueur: 8, hauteur: HAUTEUR_MUR, epaisseur: EPAISSEUR_MUR, materiau: 'beton', positionX: 0, positionZ: -3, rotationY: 0 });

  const idMurSud = genererId('mur');
  etat.murs.push({ id: idMurSud, longueur: 8, hauteur: HAUTEUR_MUR, epaisseur: EPAISSEUR_MUR, materiau: 'beton', positionX: 0, positionZ: 3, rotationY: 0 });

  const idMurEst = genererId('mur');
  etat.murs.push({ id: idMurEst, longueur: 6, hauteur: HAUTEUR_MUR, epaisseur: EPAISSEUR_MUR, materiau: 'brique', positionX: 4, positionZ: 0, rotationY: Math.PI / 2 });

  const idMurOuest = genererId('mur');
  etat.murs.push({ id: idMurOuest, longueur: 6, hauteur: HAUTEUR_MUR, epaisseur: EPAISSEUR_MUR, materiau: 'brique', positionX: -4, positionZ: 0, rotationY: Math.PI / 2 });

  // --- Porte d'entrée sur le mur Sud ---
  etat.portes.push({ id: genererId('porte'), mur_id: idMurSud, offset: 2, largeur: 0.9, hauteur: 2.1 });

  // --- Fenêtres : 2 sur le mur Nord, 1 sur chaque mur latéral ---
  etat.fenetres.push({ id: genererId('fenetre'), mur_id: idMurNord, offset: 2, largeur: 1.2, hauteur: 1.2, hauteur_allege: 0.9 });
  etat.fenetres.push({ id: genererId('fenetre'), mur_id: idMurNord, offset: 6, largeur: 1.2, hauteur: 1.2, hauteur_allege: 0.9 });
  etat.fenetres.push({ id: genererId('fenetre'), mur_id: idMurEst, offset: 3, largeur: 1.2, hauteur: 1.2, hauteur_allege: 0.9 });
  etat.fenetres.push({ id: genererId('fenetre'), mur_id: idMurOuest, offset: 3, largeur: 1.2, hauteur: 1.2, hauteur_allege: 0.9 });

  // --- Toit à deux pans, légèrement en débord (8.4 x 6.4) ---
  etat.toits.push({
    id: genererId('toit'), longueur: 8.4, largeur: 6.4, pente_degres: 30,
    materiau: 'tuile', positionX: 0, positionZ: 0, hauteur_support: HAUTEUR_MUR,
  });

  // --- Lot électrique : quelques prises, un interrupteur près de la porte, un point lumineux central ---
  etat.elements_electriques.push({ id: genererId('prise'), type: 'prise', mur_id: idMurNord, offset: 1, hauteur: HAUTEUR_PRISE, positionX: 0, positionZ: 0 });
  etat.elements_electriques.push({ id: genererId('prise'), type: 'prise', mur_id: idMurNord, offset: 7, hauteur: HAUTEUR_PRISE, positionX: 0, positionZ: 0 });
  etat.elements_electriques.push({ id: genererId('interrupteur'), type: 'interrupteur', mur_id: idMurSud, offset: 1, hauteur: HAUTEUR_INTERRUPTEUR, positionX: 0, positionZ: 0 });
  etat.elements_electriques.push({ id: genererId('point_lumineux'), type: 'point_lumineux', mur_id: null, offset: 0, hauteur: HAUTEUR_MUR, categorie_lampe: 'suspension', positionX: 0, positionZ: 0 });

  cadrerApresRecalcul = true;
  recalculerProjet();
}

// ============================================================
// NOUVEAU — ÉCRAN D'ACCUEIL : choix du domaine
// ============================================================

// Contenu VOLONTAIREMENT honnête, repris directement des sections du
// cahier des charges HCOSMO -- jamais présenté comme fonctionnel
// aujourd'hui, uniquement comme "ce qui est prévu". Le module
// Électronique n'est PAS détaillé dans le cahier des charges actuel :
// on affiche donc un texte générique plutôt que d'inventer des
// fonctionnalités qui n'ont pas été spécifiées.
const APERCUS_MODULES = {
  mecanique: {
    titre: '⚙️ Mécanique / CAO',
    sousTitre: 'Prévu — repris de la section 4.1 du cahier des charges HCOSMO',
    html: `
      <p><strong>Modélisation paramétrique</strong><br>
      Chaque géométrie sera définie par des paramètres modifiables à
      tout moment : changer une cote recalculera automatiquement la
      pièce et tous les assemblages qui en dépendent.</p>
      <p><strong>Arbre de construction (feature tree)</strong><br>
      L'historique chronologique des opérations appliquées à une pièce :
      modifier, supprimer, réordonner une étape, revenir à un état
      antérieur, créer des configurations alternatives.</p>
      <p><strong>Gestion des assemblages</strong><br>
      Assembler plusieurs pièces avec leurs contraintes de liaison.</p>`,
  },
  electronique: {
    titre: '🔋 Électronique',
    sousTitre: 'Prévu — vision à préciser',
    html: `
      <p>Ce module fait partie de la vision long terme d'HCOSMO
      (unifier tous les métiers de la conception dans un seul outil),
      mais son périmètre exact n'est pas encore détaillé dans le
      cahier des charges actuel. Il sera défini dans une prochaine
      itération, une fois les modules CAO et BIM stabilisés.</p>`,
  },
  simulation: {
    titre: '📊 Simulation / FEA',
    sousTitre: 'Prévu — repris de la section 5 du cahier des charges HCOSMO',
    html: `
      <p><strong>Analyse par éléments finis (FEA)</strong><br>
      Validation virtuelle de la résistance d'une pièce ou d'une
      structure avant fabrication ou construction.</p>
      <p><strong>Simulation cinématique et dynamique</strong><br>
      Animation des mécanismes (pistons, engrenages, articulations),
      détection de collisions entre pièces en mouvement, calcul des
      efforts dans les liaisons.</p>
      <p><strong>Simulation thermique bâtiment</strong><br>
      Analyse énergétique et thermique d'un projet de génie civil.</p>`,
  },
  ia: {
    titre: '🤖 Intelligence Artificielle',
    sousTitre: 'Prévu — repris de la section 7 du cahier des charges HCOSMO',
    html: `
      <p><strong>HcosmoAssist — assistant conversationnel</strong><br>
      Répond aux questions d'utilisation selon le contexte actif,
      explique les résultats de simulation en langage clair, guide les
      débutants pas à pas, répond aux questions réglementaires.</p>
      <p><strong>HcosmoSuggest — suggestions en temps réel</strong><br>
      Propose des améliorations pendant la modélisation : renforts
      structurels, optimisation de poids ou de coût, détection de
      conflits entre éléments (ex : gaine de ventilation qui traverse
      une poutre).</p>
      <p><strong>HcosmoCheck — vérificateur de normes</strong><br>
      Contrôle automatique la conformité aux Eurocodes, à
      l'accessibilité, à la sécurité incendie et à la réglementation
      thermique, avec note de calcul générée.</p>
      <p><strong>HcosmoGen — génération depuis texte</strong><br>
      Prévu pour une version ultérieure : génère une géométrie de
      départ depuis une description en langage naturel.</p>`,
  },
  cloud: {
    titre: '☁️ Collaboration Cloud',
    sousTitre: 'Prévu — repris de la section 10 du cahier des charges HCOSMO',
    html: `
      <p><strong>Travail à plusieurs</strong><br>
      Partage de projet par lien sécurisé, édition simultanée avec
      gestion des conflits, verrouillage temporaire d'un élément en
      cours d'édition par un collaborateur.</p>
      <p><strong>Suivi et communication</strong><br>
      Commentaires épinglés directement sur le modèle 3D, historique
      complet des modifications (qui, quand, quoi), rôles et droits
      par utilisateur (propriétaire, éditeur, lecteur...).</p>
      <p><strong>Infrastructure prévue</strong><br>
      API FastAPI, base PostgreSQL, stockage compatible S3,
      authentification avec double authentification, synchronisation
      en temps réel.</p>`,
  },
};

function ouvrirApercuModule(cle) {
  const infos = APERCUS_MODULES[cle];
  if (!infos) return;
  document.getElementById('modal-apercu-titre').textContent = infos.titre;
  document.getElementById('modal-apercu-sous-titre').textContent = infos.sousTitre;
  document.getElementById('modal-apercu-contenu').innerHTML = infos.html;
  document.getElementById('modal-apercu').classList.remove('cachee');
}

document.getElementById('fermer-apercu').addEventListener('click', () => {
  document.getElementById('modal-apercu').classList.add('cachee');
});

document.querySelectorAll('.carte-module').forEach(carte => {
  carte.addEventListener('click', () => {
    if (carte.classList.contains('verrouille')) {
      ouvrirApercuModule(carte.dataset.module); // module pas encore implémenté -> aperçu de la vision, pas d'action silencieuse
      return;
    }
    document.getElementById('ecran-accueil').classList.add('cachee');
    document.getElementById('app-shell').classList.remove('cachee');
    // #zone-viewport n'avait pas de taille tant que #app-shell était
    // masqué (display:none) -> on recalcule maintenant qu'il est visible.
    redimensionnerViewport();
  });
});

// Cliquer sur le logo, en haut à gauche de l'app, ramène à l'écran d'accueil
document.getElementById('logo-mini').addEventListener('click', () => {
  document.getElementById('app-shell').classList.add('cachee');
  document.getElementById('ecran-accueil').classList.remove('cachee');
});

// ============================================================
// NOUVEAU — BARRE D'ACTIVITÉ : bascule quelle section du panneau
// latéral est visible (façon VS Code : une icône = un contenu)
// ============================================================

document.querySelectorAll('.icone-activite').forEach(icone => {
  icone.addEventListener('click', () => {
    document.querySelectorAll('.icone-activite').forEach(i => i.classList.remove('actif'));
    icone.classList.add('actif');

    const sectionCible = icone.dataset.section;
    document.querySelectorAll('.section-panneau').forEach(section => {
      section.classList.toggle('cachee', section.id !== sectionCible);
    });
  });
});

// ============================================================
// NOUVEAU — PANNEAU IA REPLIABLE (fonctionnalité à venir, affichée
// pour montrer la vision produit, jamais présentée comme fonctionnelle)
// ============================================================

document.getElementById('toggle-ia').addEventListener('click', (evt) => {
  const panneauIA = document.getElementById('panneau-ia');
  panneauIA.classList.toggle('cachee');
  evt.currentTarget.classList.toggle('actif');
  redimensionnerViewport(); // la largeur de la zone 3D change quand le panneau IA apparaît/disparaît
});

document.getElementById('charger-exemple').addEventListener('click', chargerMaisonExemple);

// ============================================================
// NOUVEAU — GESTION DE PROJET : "Nouveau projet"
// ============================================================

let nomProjetActuel = 'Projet sans titre';

function ouvrirModalNouveauProjet() {
  const champ = document.getElementById('champ-nom-nouveau-projet');
  champ.value = ''; // on repart d'un champ vide, pas de l'ancien nom
  document.getElementById('modal-nouveau-projet').classList.remove('cachee');
  champ.focus();
}

function fermerModalNouveauProjet() {
  document.getElementById('modal-nouveau-projet').classList.add('cachee');
}

function confirmerNouveauProjet() {
  const champ = document.getElementById('champ-nom-nouveau-projet');
  const nomSaisi = champ.value.trim();
  nomProjetActuel = nomSaisi.length > 0 ? nomSaisi : 'Projet sans titre';
  document.getElementById('nom-projet-affiche').textContent = nomProjetActuel;

  // Réinitialisation complète de l'état -- même liste que le bouton
  // "Tout effacer", regroupée ici pour ne pas se répéter.
  etat.murs = [];
  etat.dalles = [];
  etat.poteaux = [];
  etat.fenetres = [];
  etat.portes = [];
  etat.toits = [];
  etat.elements_electriques = [];
  etat.tableau_electrique = false;
  elementSelectionne = null;
  synchroniserSelectionEtat();
  const caseTableau = document.getElementById('def-tableau-electrique');
  if (caseTableau) caseTableau.checked = false;

  definirModeDessin(null);
  fermerModalNouveauProjet();
  recalculerProjet();
}

document.getElementById('ouvrir-nouveau-projet').addEventListener('click', ouvrirModalNouveauProjet);
document.getElementById('annuler-nouveau-projet').addEventListener('click', fermerModalNouveauProjet);
document.getElementById('confirmer-nouveau-projet').addEventListener('click', confirmerNouveauProjet);

// Confort : valider avec la touche Entrée pendant la saisie du nom
document.getElementById('champ-nom-nouveau-projet').addEventListener('keydown', (evt) => {
  if (evt.key === 'Enter') confirmerNouveauProjet();
  if (evt.key === 'Escape') fermerModalNouveauProjet();
});



const caseTableauElectrique = document.getElementById('def-tableau-electrique');
if (caseTableauElectrique) {
  caseTableauElectrique.addEventListener('change', (evt) => {
    etat.tableau_electrique = evt.target.checked;
    recalculerProjet();
  });
}

// ============================================================
// CALCUL INITIAL — plateau vide, donc totaux à zéro, mais on appelle
// quand même le backend pour confirmer la connexion dès le chargement.
// ============================================================

recalculerProjet();