/*
* windowsService.js - Fluid components that allow us to deal with artifacts
*
* Copyright 2019 Raising the Floor - US
*
* Licensed under the New BSD license. You may not use this file except in
* compliance with this License.
*
* The R&D leading to these results received funding from the
* Department of Education - Grant H421A150005 (GPII-APCP). However,
* these results do not necessarily represent the policy of the
* Department of Education, and you should not assume endorsement by the
* Federal Government.
*
* You may obtain a copy of the License at
* https://github.com/GPII/universal/blob/master/LICENSE.txt
*/
"use strict"

var fluid = require("infusion"),
    admZip = require("adm-zip"),
    spawn = require("child_process").spawn,
    fs = require("fs"),
    fse = require("fs-extra"),
    path = require("path"),
    process = require("process"),
    request = require("request");

var gpii = fluid.registerNamespace("gpii");

fluid.defaults("gpii.installer.windowsServiceBuilder", {
    gradeNames: "fluid.modelComponent",
    buildFolder: null,
    members: {
        serviceFolder: "@expand:path.join({that}.options.buildFolder, gpii-app, node_modules, gpii-windows, gpii-service)",
        serviceModulesFolder: "@expand:path.join({that}.serviceFolder, node_modules)",
        serviceOutputFolder: "@expand:path.join({that}.options.buildFolder, staging, windows)"
    },
    invokers: {
        npmInstall: {
            funcName: "gpii.installer.windowsServiceBuilder.npmInstall",
            args: ["{that}.serviceFolder",
                  "{that}.serviceModulesFolder",
                  "{that}.events.onNpmInstallFinished",
                  "{that}.events.onError"
                ]
        },
        createPkg: {
            funcName: "gpii.installer.windowsServiceBuilder.createPkg",
            args: ["{that}.options.buildFolder",
                  "{that}.serviceFolder",
                  "{that}.serviceOutputFolder",
                  "{that}.events.onPkgCreated",
                  "{that}.events.onError"
            ]
        },
        copyFiles: {
            funcName: "gpii.installer.windowsServiceBuilder.copyFiles",
            args: ["{that}.serviceFolder",
                "{that}.serviceModulesFolder",
                "{that}.serviceOutputFolder",
                "{that}.events.onWindowsServiceReady",
                "{that}.events.onError"
            ]
        }
    },
    events: {
        onNpmInstallFinished: null,
        onPkgCreated: null,
        onWindowsServiceReady: null,
        onError: null
    },
    listeners: {
        "onCreate.runNpmInstall": "{that}.npmInstall",
        "onNpmInstallFinished.createPkg": "{that}.createPkg",
        "onPkgCreated.copyFiles": "{that}.copyFiles",
        "onError.fail": {
            funcName: "fluid.fail",
            args: []
        }
    }
});

gpii.installer.windowsServiceBuilder.npmInstall = function (serviceFolder, modulesFolder, event, error) {
    if (fs.existsSync(modulesFolder)) fse.removeSync(modulesFolder);

    // First, we npm install the service
    var buildC = spawn("npm", ["install", "--production"], {
        shell: true,
        cwd: serviceFolder
    });
    buildC.stdout.on("data", function (data) {
        // I know, this if statement is weird, but it actually prevents us from
        // printing empty lines coming from the execution of a powershell script.
        if (data.toString().trim()) fluid.log(data.toString());
    });

    buildC.stderr.on("data", function (data) {
        fluid.log(data.toString());
    });

    buildC.on("close", function (code) {
        fluid.log("npm install windows service process exited with code: ", code);
        if (code) error.fire("Couldn't npm install gpii-service")
        event.fire();
    });
};

gpii.installer.windowsServiceBuilder.createPkg = function (buildFolder, serviceFolder, serviceOutputFolder, event, error) {
    fs.copyFileSync(
        path.join(buildFolder, "gpii-app", "provisioning", "service.json5"),
        path.join(serviceFolder, "config", "service.json5")
    );

    var buildC = spawn("pkg", ["package.json", "--output", path.join(serviceOutputFolder, "morphic-service.exe")], {
        shell: true,
        cwd: serviceFolder
    });
    buildC.stdout.on("data", function (data) {
        // I know, this if statement is weird, but it actually prevents us from
        // printing empty lines coming from the execution of a powershell script.
        if (data.toString().trim()) fluid.log(data.toString());
    });

    buildC.stderr.on("data", function (data) {
        fluid.log(data.toString());
    });

    buildC.on("close", function (code) {
        fluid.log("compilation of gpii-service process exited with code: ", code);
        if (code) {
            error.fire("Couldn't compile gpii-service");
        } else {
            event.fire();
        }
    });
};

gpii.installer.windowsServiceBuilder.copyFiles = function(serviceFolder, modulesFolder, serviceOutputFolder, event, error) {
    // The service needs the .node obj files of its deps to be copied
    // along with it. Also, need to put the service.json5 file in the
    // same folder.
    fs.copyFileSync(
        path.join(modulesFolder, "@gpii", "os-service", "build", "Release", "service.node"),
        path.join(serviceOutputFolder, "service.node")
    );
    fs.copyFileSync(
        path.join(modulesFolder, "ffi-napi", "build", "Release", "ffi_bindings.node"),
        path.join(serviceOutputFolder, "ffi_bindings.node")
    );
    fs.copyFileSync(
        path.join(modulesFolder, "ref-napi", "build", "Release", "binding.node"),
        path.join(serviceOutputFolder, "binding.node")
    );
    fs.copyFileSync(
        path.join(modulesFolder, "ref-napi", "build", "Release", "nothing.node"),
        path.join(serviceOutputFolder, "nothing.node")
    );
    fs.copyFileSync(
        path.join(serviceFolder, "config", "service.json5"),
        path.join(serviceOutputFolder, "service.json5")
    );

    event.fire();
}
