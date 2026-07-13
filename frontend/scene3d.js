(function (global) {
  function createScene3D(container) {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xdddddd);

    const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 1000);
    camera.position.set(6, 5, 10);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.shadowMap.enabled = true;
    container.appendChild(renderer.domElement);

    const controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.minDistance = 2;
    controls.maxDistance = 40;
    controls.maxPolarAngle = Math.PI / 2.1;
    controls.target.set(0, 1, 0);
    controls.update();

    const transformControls = new THREE.TransformControls(camera, renderer.domElement);
    transformControls.setSize(0.8);
    transformControls.setSpace('world');
    transformControls.visible = false;
    scene.add(transformControls);

    let transformCallback = null;

    function setTransformCallback(callback) {
      transformCallback = callback;
    }

    function setTransformTarget(object) {
      if (!object) {
        transformControls.detach();
        transformControls.visible = false;
        return;
      }
      transformControls.attach(object);
      transformControls.visible = true;
    }

    function setTransformMode(mode) {
      transformControls.setMode(mode === 'rotate' ? 'rotate' : 'translate');
    }

    function setTransformAxisConstraint(axis) {
      transformControls.showX = true;
      transformControls.showY = true;
      transformControls.showZ = true;
      if (axis === 'x') {
        transformControls.showY = false;
        transformControls.showZ = false;
      } else if (axis === 'z') {
        transformControls.showX = false;
        transformControls.showY = false;
      }
    }

    function setTransformVisibility(visible) {
      if (!visible) {
        transformControls.detach();
        transformControls.visible = false;
        return;
      }
      transformControls.visible = true;
    }

    transformControls.addEventListener('objectChange', () => {
      if (transformCallback && transformControls.object) {
        transformCallback(transformControls.object);
      }
    });

    transformControls.addEventListener('dragging-changed', event => {
      controls.enabled = !event.value;
    });

    const ambient = new THREE.AmbientLight(0x404040);
    const keyLight = new THREE.DirectionalLight(0xffffff, 1);
    keyLight.position.set(5, 8, 5);
    keyLight.castShadow = true;
    const fillLight = new THREE.DirectionalLight(0xffffff, 0.4);
    fillLight.position.set(-5, 4, -3);

    scene.add(ambient);
    scene.add(keyLight);
    scene.add(fillLight);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(40, 40),
      new THREE.ShadowMaterial({ opacity: 0.25 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);
    scene.add(new THREE.GridHelper(20, 20));

    const groupElements = new THREE.Group();
    const groupFoundations = new THREE.Group();
    scene.add(groupElements);
    scene.add(groupFoundations);

    function resize() {
      const width = container.clientWidth;
      const height = container.clientHeight;
      if (!width || !height) return;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    }

    function render() {
      controls.update();
      renderer.render(scene, camera);
    }

    function animate() {
      requestAnimationFrame(animate);
      render();
    }

    animate();

    return {
      scene,
      camera,
      renderer,
      controls,
      groupElements,
      groupFoundations,
      resize,
      render,
      setTransformCallback,
      setTransformTarget,
      setTransformMode,
      setTransformAxisConstraint,
      setTransformVisibility,
    };
  }

  global.HCOSMO = global.HCOSMO || {};
  global.HCOSMO.createScene3D = createScene3D;
})(window);
