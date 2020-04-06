var fluid = require("infusion");

var gpii = fluid.registerNamespace("gpii");

require("./index.js");

//fluid.logObjectRenderChars = 1200000;

var m = gpii.installer({});
//console.log("#### buildFolder: ", m.options.buildFolder);

//m.npmInstall();

//m.electronPackager();
//m.runMsbuild();

//m.populateArtifacts();
//console.log("## m: " + JSON.stringify(m, null, 2));
