(function (global) {
  function createProjectState() {
    return {
      murs: [],
      dalles: [],
      poteaux: [],
      fenetres: [],
      portes: [],
      toits: [],
      elements_electriques: [],
      tableau_electrique: false,
      selection: { type: null, id: null },
      vue: { mode: '2d' },
    };
  }

  function createIdGenerator(startAt = 1) {
    let nextId = startAt;
    return function () {
      const id = nextId;
      nextId += 1;
      return id;
    };
  }

  function cloneState(state) {
    return JSON.parse(JSON.stringify(state));
  }

  global.HCOSMO = global.HCOSMO || {};
  Object.assign(global.HCOSMO, {
    createProjectState,
    createIdGenerator,
    cloneState,
  });
})(window);
