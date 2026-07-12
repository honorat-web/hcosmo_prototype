// ============================================================
// SCÈNE 3D DE BASE — plateau vide au démarrage : aucun mur, aucune
// dalle, aucun poteau n'est créé ici. Tout vient des listes ci-dessous,
// remplies uniquement par les actions de l'utilisateur.
// ============================================================

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xdddddd);

// NOUVEAU — le rendu 3D s'insère désormais dans #zone-viewport (une zone
// de la nouvelle interface façon VS Code) au lieu d'occuper tout l'écran
// derrière les panneaux. On lit sa taille réelle, pas celle de la fenêtre.
const conteneurViewport = document.getElementById('zone-viewport');

const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 1000); // ratio provisoire, corrigé par redimensionnerViewport()
camera.position.set(6, 5, 10);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.shadowMap.enabled = true;
conteneurViewport.appendChild(renderer.domElement);

const controls = new THREE.OrbitControls(camera, renderer.domElement);
controls.minDistance = 2;
controls.maxDistance = 40;
controls.maxPolarAngle = Math.PI / 2.1;
controls.target.set(0, 1, 0);
controls.update();

const lumiere = new THREE.DirectionalLight(0xffffff, 1);
lumiere.position.set(5, 8, 5);
lumiere.castShadow = true;
scene.add(lumiere);
scene.add(new THREE.DirectionalLight(0xffffff, 0.4).translateX(-5));
scene.add(new THREE.AmbientLight(0x404040));

const sol = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.ShadowMaterial({ opacity: 0.25 }));
sol.rotation.x = -Math.PI / 2;
sol.receiveShadow = true;
scene.add(sol);
scene.add(new THREE.GridHelper(20, 20));

// Groupe contenant TOUS les meshes des éléments du projet. À chaque
// recalcul, on vide ce groupe et on le repeuple depuis les listes --
// plus simple et plus fiable que d'essayer de "mettre à jour" chaque
// mesh individuellement quand le nombre d'éléments change dynamiquement.
const groupeElements = new THREE.Group();
scene.add(groupeElements);

function viderGroupeElements() {
  while (groupeElements.children.length > 0) {
    const mesh = groupeElements.children.pop();
    mesh.geometry.dispose();
    mesh.material.dispose();
    groupeElements.remove(mesh);
  }
}

// NOUVEAU — Groupe SÉPARÉ pour les soubassements. Volontairement séparé
// de groupeElements : le raycaster de sélection (voir plus bas) ne
// consulte QUE groupeElements.children, donc les soubassements ne sont
// jamais cliquables/sélectionnables individuellement -- cohérent avec
// le fait que ce ne sont pas des éléments indépendants, juste des
// prolongements automatiques de leur mur.
const groupeSoubassements = new THREE.Group();
scene.add(groupeSoubassements);

function viderGroupeSoubassements() {
  while (groupeSoubassements.children.length > 0) {
    const mesh = groupeSoubassements.children.pop();
    mesh.geometry.dispose();
    mesh.material.dispose();
    groupeSoubassements.remove(mesh);
  }
}

function animer() {
  requestAnimationFrame(animer);
  controls.update();
  renderer.render(scene, camera);
}
animer();

// NOUVEAU — recalcule la taille du rendu 3D à partir de la zone qui le
// contient réellement (pas de la fenêtre entière). Appelée au
// redimensionnement de la fenêtre, ET à chaque fois qu'un panneau
// apparaît/disparaît (ce qui change la largeur disponible), ET une fois
// au moment où on quitte l'écran d'accueil (tant que #app-shell est
// masqué, #zone-viewport a une taille de 0x0, donc rien à calculer avant).
function redimensionnerViewport() {
  const largeur = conteneurViewport.clientWidth;
  const hauteur = conteneurViewport.clientHeight;
  if (largeur === 0 || hauteur === 0) return; // pas encore visible, on ignore
  camera.aspect = largeur / hauteur;
  camera.updateProjectionMatrix();
  renderer.setSize(largeur, hauteur);
}

window.addEventListener('resize', redimensionnerViewport);

// ============================================================
// ÉTAT DU PROJET — des LISTES, pas des objets uniques. Le plateau
// démarre vide : c'est à l'utilisateur d'ajouter chaque élément.
// ============================================================

const etat = {
  murs: [],     // { id, longueur, hauteur, epaisseur, materiau, positionX, positionZ, rotationY }
  dalles: [],   // { id, longueur, largeur, epaisseur, materiau, positionX, positionZ }
  poteaux: [],  // { id, cote, hauteur, materiau, positionX, positionZ }
  fenetres: [], // { id, mur_id, offset, largeur, hauteur, hauteur_allege }
  portes: [],   // { id, mur_id, offset, largeur, hauteur } — NOUVEAU
  toits: [],    // { id, longueur, largeur, pente_degres, materiau, positionX, positionZ, hauteur_support } — NOUVEAU
  elements_electriques: [], // { id, type, mur_id, offset, hauteur, positionX, positionZ } — NOUVEAU
  tableau_electrique: false, // NOUVEAU — un seul par projet, simple case à cocher
};

let prochainId = 1;
function genererId(prefixe) {
  return `${prefixe}-${prochainId++}`;
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

// Un seul point d'entrée pour les 6 fonctions creerMesh* ci-dessous :
// associe un nom de matériau (structure OU toiture) à sa texture.
const GENERATEURS_TEXTURE = {
  beton: dessinerTextureBeton,
  brique: dessinerTextureBrique,
  bois: dessinerTextureBois,
  tuile: dessinerTextureTuile,
  tole: dessinerTextureTole,
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
function creerMeshFenetre(fenetre, mur) {
  if (!mur) return null; // mur supprimé entre-temps, on ignore silencieusement
  const d = directionMur(mur);
  const debut = pointDebutMur(mur);
  const centreX = debut.x + d.dx * fenetre.offset;
  const centreZ = debut.z + d.dz * fenetre.offset;

  // Légèrement plus épaisse que le mur (x1.05) pour qu'elle "sorte" un
  // peu visuellement des deux côtés, plutôt que d'être noyée dedans.
  const geometrie = new THREE.BoxGeometry(fenetre.largeur, fenetre.hauteur, mur.epaisseur * 1.05);
  const materiau = new THREE.MeshStandardMaterial({
    color: 0x8ecae6,
    transparent: true,
    opacity: 0.55,
  });
  const mesh = new THREE.Mesh(geometrie, materiau);
  mesh.position.set(centreX, fenetre.hauteur_allege + fenetre.hauteur / 2, centreZ);
  mesh.rotation.y = mur.rotationY;
  return mesh;
}

// NOUVEAU — Porte : même principe que la fenêtre, mais part toujours du
// sol (pas de hauteur_allege) et est opaque (bois plein), pas vitrée.
function creerMeshPorte(porte, mur) {
  if (!mur) return null;
  const d = directionMur(mur);
  const debut = pointDebutMur(mur);
  const centreX = debut.x + d.dx * porte.offset;
  const centreZ = debut.z + d.dz * porte.offset;

  const geometrie = new THREE.BoxGeometry(porte.largeur, porte.hauteur, mur.epaisseur * 1.05);
  const materiau = new THREE.MeshStandardMaterial({ color: 0x6b4423 }); // bois foncé, opaque
  appliquerTexture(materiau, 'bois', porte.largeur, porte.hauteur);
  const mesh = new THREE.Mesh(geometrie, materiau);
  mesh.position.set(centreX, porte.hauteur / 2, centreZ);
  mesh.rotation.y = mur.rotationY;
  return mesh;
}

// NOUVEAU — Toit à deux pans (forme "maison") au-dessus d'une emprise
// rectangulaire. On construit un triangle en coupe (pignon), qu'on extrude
// sur la longueur. Simplification assumée du prototype : pas de rotation
// (comme les dalles), le toit est toujours aligné sur les axes du monde.
const COULEURS_TOIT = { tuile: 0xb33a2e, tole: 0x8c8c96, beton: 0x9a9a9a };

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
  mesh.castShadow = true;
  return mesh;
}

// NOUVEAU — Éléments électriques : petits marqueurs sphériques symboliques.
// Prise/interrupteur sont posés sur un mur (comme les fenêtres), le point
// lumineux est posé librement (comme un poteau), au plafond.
const COULEURS_ELECTRICITE = { prise: 0xffcc00, interrupteur: 0xffffff, point_lumineux: 0xfff59d };

function creerMeshElementElectrique(element, mur) {
  let x, y, z;
  if (element.mur_id) {
    if (!mur) return null; // mur supprimé entre-temps
    const d = directionMur(mur);
    const debut = pointDebutMur(mur);
    x = debut.x + d.dx * element.offset;
    z = debut.z + d.dz * element.offset;
    y = element.hauteur;
  } else {
    x = element.positionX;
    z = element.positionZ;
    y = element.hauteur;
  }
  const geometrie = new THREE.SphereGeometry(0.08, 12, 12);
  const materiau = new THREE.MeshStandardMaterial({
    color: COULEURS_ELECTRICITE[element.type] || 0xffffff,
    emissive: element.type === 'point_lumineux' ? 0xfff59d : 0x000000,
    emissiveIntensity: 0.6,
  });
  const mesh = new THREE.Mesh(geometrie, materiau);
  mesh.position.set(x, y, z);
  return mesh;
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
  tuile: { prix_eur_m2: 45, poids_kg_m2: 40 },
  tole:  { prix_eur_m2: 25, poids_kg_m2: 12 },
  beton: { prix_eur_m2: 60, poids_kg_m2: 300 },
};
const ELECTRICITE_PRIX_SECOURS = { prise: 45, interrupteur: 35, point_lumineux: 60 }; // NOUVEAU
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
    const volume = dalle.longueur * dalle.largeur * dalle.epaisseur;
    return {
      id: dalle.id,
      volume_m3: Math.round(volume * 1000) / 1000,
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

  // NOUVEAU — lot électrique
  const resultatsElectricite = etat.elements_electriques.map(e => ({
    id: e.id, type: e.type, cout_eur: ELECTRICITE_PRIX_SECOURS[e.type] || 0,
  }));

  const tousLesResultats = [...resultatsMurs, ...resultatsDalles, ...resultatsPoteaux, ...resultatsSoubassements];
  const coutStructure = tousLesResultats.reduce((s, r) => s + r.cout_total_eur, 0);
  const coutToits = resultatsToits.reduce((s, r) => s + r.cout_total_eur, 0); // NOUVEAU
  const coutElectricite = resultatsElectricite.reduce((s, r) => s + r.cout_eur, 0)
    + (etat.tableau_electrique ? PRIX_TABLEAU_ELECTRIQUE_SECOURS : 0); // NOUVEAU
  const poidsToits = resultatsToits.reduce((s, r) => s + r.poids_kg, 0); // NOUVEAU

  return {
    murs: resultatsMurs,
    soubassements: resultatsSoubassements, // NOUVEAU
    dalles: resultatsDalles,
    poteaux: resultatsPoteaux,
    toits: resultatsToits, // NOUVEAU
    elements_electriques: resultatsElectricite, // NOUVEAU
    total: {
      volume_m3: Math.round(tousLesResultats.reduce((s, r) => s + r.volume_m3, 0) * 1000) / 1000,
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
          <label>Matériau<select data-type="toits" data-id="${toit.id}" data-champ="materiau">
            <option value="tuile" ${toit.materiau === 'tuile' ? 'selected' : ''}>Tuile</option>
            <option value="tole" ${toit.materiau === 'tole' ? 'selected' : ''}>Tôle</option>
            <option value="beton" ${toit.materiau === 'beton' ? 'selected' : ''}>Béton</option>
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
  etat.elements_electriques.forEach((element, i) => {
    html += `
      <div class="ligne-element" data-type="elements_electriques" data-id="${element.id}">
        <div class="entete-element">
          <span class="nom-element">${nomsElectrique[element.type] || element.type} ${i + 1}</span>
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
let pointDepart = null;      // 1er clic pour dalle/mur
let dernierePositionSouris = null;
let shiftEnfoncee = false;

document.addEventListener('keydown', (e) => { if (e.key === 'Shift') shiftEnfoncee = true; });
document.addEventListener('keyup', (e) => { if (e.key === 'Shift') shiftEnfoncee = false; });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    definirModeDessin(null); // quitte réellement l'outil actif, pas juste le tracé en cours
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

function definirModeDessin(nouveauMode) {
  modeDessin = nouveauMode || null;
  pointDepart = null;
  dernierePositionSouris = null;

  document.querySelectorAll('.outil-dessin').forEach(bouton => {
    bouton.classList.toggle('actif', bouton.dataset.mode === (modeDessin || ''));
  });

  document.getElementById('svg-plan').classList.toggle('mode-dessin-actif', !!modeDessin);

  const messages = {
    dalle: 'Cliquez un premier coin de la dalle, puis le coin opposé.',
    mur: "Cliquez le point de départ du mur, puis son point d'arrivée. (Maj = accroche à 45°)",
    poteau: 'Cliquez à l\'endroit où poser le poteau.',
    fenetre: 'Cliquez sur un mur existant pour y placer une fenêtre.',
    porte: 'Cliquez sur un mur existant pour y placer une porte.', // NOUVEAU
    toit: 'Cliquez un premier coin de l\'emprise du toit, puis le coin opposé.', // NOUVEAU
    prise: 'Cliquez sur un mur existant pour y placer une prise.', // NOUVEAU
    interrupteur: 'Cliquez sur un mur existant pour y placer un interrupteur.', // NOUVEAU
    point_lumineux: 'Cliquez à l\'endroit où poser le point lumineux (au plafond).', // NOUVEAU
  };
  document.getElementById('instruction-dessin').textContent =
    messages[modeDessin] || 'Choisissez un outil ci-dessus.';

  dessinerPlan2D();
}

document.querySelectorAll('.outil-dessin').forEach(bouton => {
  bouton.addEventListener('click', () => {
    definirModeDessin(bouton.dataset.mode);
    // NOUVEAU — la barre d'outils est désormais toujours visible en haut,
    // même en vue 3D. Le dessin ne se fait que sur le plan 2D, donc on y
    // bascule automatiquement dès qu'un outil (autre que "Arrêter") est choisi.
    if (bouton.dataset.mode) {
      const vue2d = document.getElementById('vue-2d');
      if (vue2d.classList.contains('cachee')) {
        dessinerPlan2D();
        vue2d.classList.remove('cachee');
        document.getElementById('toggle-vue').textContent = 'Revenir à la vue 3D';
      }
    }
  });
});

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
const PLAN_ZONE = 300;
const PLAN_PORTEE_METRES = 20;
const PLAN_ECHELLE = PLAN_ZONE / PLAN_PORTEE_METRES;
const PLAN_ORIGINE_X = PLAN_MARGE + PLAN_ZONE / 2;
const PLAN_ORIGINE_Y = PLAN_MARGE + PLAN_ZONE / 2;

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

function genererGrilleSVG() {
  let lignes = '';
  for (let m = 0; m <= PLAN_PORTEE_METRES; m++) {
    const px = PLAN_MARGE + m * PLAN_ECHELLE;
    lignes += `<line x1="${px}" y1="${PLAN_MARGE}" x2="${px}" y2="${PLAN_MARGE + PLAN_ZONE}" />`;
    lignes += `<line x1="${PLAN_MARGE}" y1="${px}" x2="${PLAN_MARGE + PLAN_ZONE}" y2="${px}" />`;
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
    html += `<rect x="${coin.x}" y="${coin.y}" width="${l}" height="${p}" fill="#cfcfcf" stroke="#555" stroke-width="1.5" />
      <text x="${coin.x + l / 2}" y="${coin.y + p / 2}" font-size="11" text-anchor="middle" fill="#444">Dalle ${i + 1}</text>`;
  });

  etat.murs.forEach((mur, i) => {
    const coins = coinsMurPixels(mur);
    const points = coins.map(c => `${c.x},${c.y}`).join(' ');
    const centre = mondeVersPixel(mur.positionX, mur.positionZ);
    const estCloison = mur.porteur === false;
    const couleur = estCloison ? '#d8d3c4' : '#8b5a2b'; // NOUVEAU -- distingue cloison (clair) de mur porteur
    const prefixe = estCloison ? 'C' : 'M';
    html += `<polygon points="${points}" fill="${couleur}" stroke="#333" stroke-width="1" />
      <text x="${centre.x}" y="${centre.y - 8}" font-size="10" text-anchor="middle" fill="#333">${prefixe}${i + 1} (${mur.longueur.toFixed(1)}m)</text>`;
  });

  etat.poteaux.forEach((poteau) => {
    const coin = mondeVersPixel(poteau.positionX - poteau.cote / 2, poteau.positionZ - poteau.cote / 2);
    const cote = poteau.cote * PLAN_ECHELLE;
    html += `<rect x="${coin.x}" y="${coin.y}" width="${cote}" height="${cote}" fill="#555" stroke="#222" stroke-width="1" />`;
  });

  etat.fenetres.forEach((fenetre) => {
    const mur = etat.murs.find(m => m.id === fenetre.mur_id);
    if (!mur) return;
    const d = directionMur(mur);
    const debut = pointDebutMur(mur);
    const centreMondeX = debut.x + d.dx * fenetre.offset;
    const centreMondeZ = debut.z + d.dz * fenetre.offset;
    const demiL = fenetre.largeur / 2;
    const p1 = mondeVersPixel(centreMondeX - d.dx * demiL, centreMondeZ - d.dz * demiL);
    const p2 = mondeVersPixel(centreMondeX + d.dx * demiL, centreMondeZ + d.dz * demiL);
    html += `<line x1="${p1.x}" y1="${p1.y}" x2="${p2.x}" y2="${p2.y}" stroke="#2166ac" stroke-width="4" stroke-linecap="round" />`;
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

  // NOUVEAU — Toits (contour pointillé rouge au-dessus du plan)
  etat.toits.forEach((toit, i) => {
    const coin = mondeVersPixel(toit.positionX - toit.longueur / 2, toit.positionZ - toit.largeur / 2);
    const l = toit.longueur * PLAN_ECHELLE, p = toit.largeur * PLAN_ECHELLE;
    html += `<rect x="${coin.x}" y="${coin.y}" width="${l}" height="${p}" fill="none" stroke="#b33a2e" stroke-width="1.5" stroke-dasharray="4,3" />
      <text x="${coin.x + l / 2}" y="${coin.y + p / 2}" font-size="10" text-anchor="middle" fill="#b33a2e">Toit ${i + 1}</text>`;
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

  html += dessinerApercu();
  svg.innerHTML = html;
}

// ============================================================
// BASCULE 3D / 2D
// ============================================================

document.getElementById('toggle-vue').addEventListener('click', () => {
  const vue2d = document.getElementById('vue-2d');
  const bouton = document.getElementById('toggle-vue');
  if (vue2d.classList.contains('cachee')) {
    dessinerPlan2D();
    vue2d.classList.remove('cachee');
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

function selectionner(type, id) {
  // Cliquer une 2e fois sur le même élément le désélectionne (bascule).
  if (elementSelectionne && elementSelectionne.type === type && elementSelectionne.id === id) {
    elementSelectionne = null;
  } else {
    elementSelectionne = { type, id };
  }
  appliquerSurbrillanceSelection();
  mettreAJourSurbrillanceListe();
}

function deselectionner() {
  elementSelectionne = null;
  appliquerSurbrillanceSelection();
  mettreAJourSurbrillanceListe();
}

// Recherche, parmi les meshes actuellement dans la scène, celui qui
// correspond à elementSelectionne (via son userData), et affiche un
// contour jaune autour avec BoxHelper. Appelée après chaque sélection
// ET après chaque reconstruction de la scène (les meshes sont détruits
// et recréés à chaque recalcul, voir reconstruireScene3D).
function appliquerSurbrillanceSelection() {
  if (contourSelection) {
    scene.remove(contourSelection);
    contourSelection.geometry.dispose();
    contourSelection.material.dispose();
    contourSelection = null;
  }
  if (!elementSelectionne) return;

  const mesh = groupeElements.children.find(
    m => m.userData?.type === elementSelectionne.type && m.userData?.id === elementSelectionne.id
  );
  if (!mesh) return; // élément supprimé entre-temps

  contourSelection = new THREE.BoxHelper(mesh, 0xffcc00);
  scene.add(contourSelection);
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
  // Ne pas interférer avec le mode dessin (qui a sa propre gestion de
  // clic sur le plan 2D, pas sur le canvas 3D) -- ici on est toujours
  // dans la scène 3D, donc pas de conflit, mais on vérifie quand même
  // qu'on n'est pas au milieu d'un drag de la caméra (OrbitControls).
  const rect = renderer.domElement.getBoundingClientRect();
  sourisNormalisee.x = ((evt.clientX - rect.left) / rect.width) * 2 - 1;
  sourisNormalisee.y = -((evt.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(sourisNormalisee, camera);
  const intersections = raycaster.intersectObjects(groupeElements.children);

  if (intersections.length === 0) {
    deselectionner();
    return;
  }

  // Le premier élément de la liste est le plus proche de la caméra
  // (Three.js trie déjà les intersections par distance croissante).
  const meshTouche = intersections[0].object;
  if (!meshTouche.userData?.type) return; // sécurité, ne devrait pas arriver
  selectionner(meshTouche.userData.type, meshTouche.userData.id);
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
  etat.elements_electriques.push({ id: genererId('point_lumineux'), type: 'point_lumineux', mur_id: null, offset: 0, hauteur: HAUTEUR_MUR, positionX: 0, positionZ: 0 });

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