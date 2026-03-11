const { createSelector } = require('@reduxjs/toolkit');

const selectLayers = state => state.project.layers;
const selectPreparingLayers = state => state.project.preparingLayers;

const selectIsAssetPreparing = createSelector(
  [selectLayers, selectPreparingLayers, (state, assetUrl) => assetUrl],
  (layers, preparingLayers, assetUrl) => {
    if (!assetUrl) return false;
    
    const normalize = (url) => typeof url === 'string' ? url.split('?')[0].split('#')[0] : url;
    const target = normalize(assetUrl);
    
    return Object.keys(preparingLayers).some(layerId => {
      const layer = layers[layerId];
      if (!layer || !layer.data) return false;
      
      const layerUrl = normalize(layer.data.url || layer.data.src);
      return layerUrl === target;
    });
  }
);

const state = {
  project: {
    layers: {
      "layer1": { data: { url: "/uploads/test.png" } }
    },
    preparingLayers: {
      "layer1": true
    }
  }
};

console.log("Test 1 (Match):", selectIsAssetPreparing(state, "/uploads/test.png"));
console.log("Test 2 (No match):", selectIsAssetPreparing(state, "/uploads/other.png"));
console.log("Test 3 (Empty URL):", selectIsAssetPreparing(state, undefined));
console.log("Test 4 (Empty Layers):", selectIsAssetPreparing({
  project: {
    layers: {},
    preparingLayers: {}
  }
}, "/uploads/test.png"));

// Edge case: all layers have undefined URLs
const stateEmptyUrls = {
  project: {
    layers: {
      "layer1": { data: {} },
      "layer2": { data: {} }
    },
    preparingLayers: {
      "layer1": true,
      "layer2": true
    }
  }
};
console.log("Test 5 (Empty layer URLs, query something):", selectIsAssetPreparing(stateEmptyUrls, "/uploads/test.png"));

// Edge case: target is somehow evaluated to true against layerUrl 
// Wait, normalize(undefined) returns undefined. undefined === target is false if target is a string.
