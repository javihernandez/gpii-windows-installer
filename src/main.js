/*
* main.js - Main fluid components of gpii windows installer
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
    fs = require("fs"),
    fse = require("fs-extra"),
    spawn = require("child_process").spawn,
    path = require("path"),
    powershell = require("node-powershell");

require("./artifacts.js");
fluid.setLogging(true);

var gpii = fluid.registerNamespace("gpii");

fluid.defaults("gpii.installer", {
    gradeNames: "fluid.component",
    artifactsData: fluid.require("%gpii-windows-installer/data/artifacts.json"),
    artifacts: ["gpii-app", "gpii-wix-installer", "morphic-sharex-installer"], // TODO: Just load the json file
    artifactsFolder: path.join(fluid.module.resolvePath("%gpii-windows-installer"), "artifacts"),
    resetToStandardFile: null, // TODO: This will be part of the artifacts.json file
    buildFolder: "c:/installer/",
    invokers: {
        populateArtifacts: {
            funcName: "gpii.installer.populateArtifacts",
            args: ["{that}", "{arguments}.0"]
        },
        prepareBuildFolder: {
            funcName: "gpii.installer.prepareBuildFolder",
            args: ["{that}"]
        },
        npmInstall: {
            funcName: "gpii.installer.npmInstall",
            args: ["{that}"]
        },
        electronPackager: {
          funcName: "gpii.installer.electronPackager",
          args: ["{that}"]
        },
        runMsbuild: {
          funcName: "gpii.installer.runMsbuild",
          args: ["{that}"]
        }
    },
    events: {
        onPopulatedArtifacts: null,
        onBuildFolderReady: null,
        onNpmInstallFinished: null,
        onPackaged: null,
        onError: null
    },
    listeners: {
        "onCreate.populateArtifacts": {
            func: "{that}.populateArtifacts",
            args: "{that}.options.artifacts"
        },
        "onPopulatedArtifacts.logResult": {
            funcName: "fluid.log",
            args: ["Artifacts successfully populated: ", "{arguments}.0"]
        },
        "onPopulatedArtifacts.prepareBuildFolder": "{that}.prepareBuildFolder",
        "onBuildFolderReady.runNpmInstall": "{that}.npmInstall",
        "onNpmInstallFinished.logResult": {
            funcName: "fluid.log",
            args: ["npm install process succeed!"]
        },
        "onNpmInstallFinished.runElectronPackager": "{that}.electronPackager",
        "onPackaged.logResult": {
            funcName: "fluid.log",
            args: ["Morphic-App successfully packaged: ", "{arguments}.0"]
        },
        "onPackaged.runMsbuild": "{that}.runMsbuild",
        "onError.logError": {
            funcName: "fluid.log",
            args: "{arguments}.0"
        }
    }
});

gpii.installer.populateArtifacts = function (that, artifacts) {
    // clean the artifacts folder
    if (fs.existsSync(that.options.artifactsFolder)) {
        fse.removeSync(that.options.artifactsFolder);
    }

    var sequence = [];

    fluid.each(artifacts, function (artifact) {
        fluid.log("Populating: ", artifact);
        var promise = fluid.promise();
        var artifact = gpii.installer.artifact({
           artifactData: gpii.installer.getArtifactById(that.options.artifactsData, artifact),
        });

        artifact.events.onPopulated.addListener(function () {
            promise.resolve();
        });
        artifact.events.onError.addListener(function (err) {
            promise.reject(err);
        });

        sequence.push(promise);
    });

    fluid.promise.sequence(sequence).then(function (result) {
        that.events.onPopulatedArtifacts.fire(artifacts);
    }, function (err) {
        that.events.onError.fire("An error occurred while trying to populate the artifacts. The error was: " + err);
    });
};

gpii.installer.getArtifactById = function (artifacts, id) {
    return fluid.find(artifacts, function (artifact) {
        if (artifact.id === id) {
            return artifact;
        }
    }, null);
};

gpii.installer.prepareBuildFolder = function (that) {
    if (fs.existsSync(that.options.buildFolder)) {
        fse.removeSync(that.options.buildFolder);
    }
    // Copy gpii-wix-installer to c:/installer
    fse.copySync(path.join(that.options.artifactsFolder, "gpii-wix-installer"), that.options.buildFolder);
    // Copy gpii-app to c:/installer/gpii-app
    fse.copySync(path.join(that.options.artifactsFolder, "gpii-app"), path.join(that.options.buildFolder, "gpii-app"));
    that.events.onBuildFolderReady.fire();
};

gpii.installer.npmInstall = function (that) {
    var buildC = spawn("npm", ["install"], {shell: true, cwd: path.join(that.options.buildFolder, "gpii-app")});
    buildC.stdout.on("data", function (data) {
        // I know, this if statement is weird, but it actually prevents us from
        // printing empty lines coming from the execution of a powershell script.
        if (data.toString().trim()) fluid.log(data.toString());
    });

    buildC.stderr.on("data", function (data) {
        fluid.log(data.toString());
    });

    buildC.on("close", function (code) {
        fluid.log("Child process exited with code: ", code);
        that.events.onNpmInstallFinished.fire();
        // TODO: error handling
        //code ? error.fire("Couldn't build " + folder + " - Check above for errors"): event.fire(code)
    });
};

gpii.installer.electronPackager = function (that) {
    var packager = require("electron-packager");
    var options = {
        "arch": "ia32",
        "platform": "win32",
        "dir": path.join(that.options.buildFolder, "gpii-app"),
        "app-copyright": "Raising the Floor - International Association",
        "name": "morphic-app",
        "out": path.join(that.options.buildFolder, "staging"),
        "overwrite": true,
        "prune": false,
        "version": "1.3.2",
        "version-string":{
          "CompanyName": "Raising the Floor - International Association",
          "FileDescription": "Morphic-App", /*This is what display windows on task manager, shortcut and process*/
          "OriginalFilename": "morphic-app.exe",
          "ProductName": "Morphic-App",
          "InternalName": "Morphic-App"
        }
    };

    var packagerPromise = fluid.toPromise(packager(options, function (err, appPaths) {
        // TODO: error handling
        fluid.log("## packaged electron app");
        return appPaths;
    }));

    fluid.promise.map(packagerPromise, function (appPaths) {
        fluid.log(appPaths);
        fse.renameSync(path.join(that.options.buildFolder, "staging", "morphic-app-win32-ia32"), path.join(that.options.buildFolder, "staging", "windows"));
        that.events.onPackaged.fire(appPaths);
    });
};

gpii.installer.runMsbuild = function (that) {
    // create output and temp folders in c:/installer
    var outputFolder = path.join(that.options.buildFolder, "output");
    var tempFolder = path.join(that.options.buildFolder, "temp");

    fs.existsSync(outputFolder)? null: fs.mkdirSync(outputFolder);
    fs.existsSync(tempFolder)? null: fs.mkdirSync(tempFolder);

    var ps = new powershell({
        executionPolicy: "Bypass",
        noProfile: true,
        verbose: true
    });

    // Redirect output
    ps.streams.stdout.on("data", function (data) {
        fluid.log(data);
    });

    // This is ugly, yes, but so far is the best way to prepare the shell, this is:
    //  1. load the env variables by calling vcbuildtools_msbuild
    //  2. guess the msbuild command path - this probably can also be retrieved via node
    //  3. call msbuild
    // TODO: Explore other ways to achieve this
    ps.addCommand("Import-Module .\\provisioning\\Provisioning.psm1 -Force");
    ps.addCommand("Invoke-Environment 'C:\\Program Files (x86)\\Microsoft Visual C++ Build Tools\\vcbuildtools_msbuild.bat'");
    ps.addCommand("$setupDir = Join-Path " + that.options.buildFolder + " 'setup'");
    ps.addCommand("$msbuild = Get-MSBuild '4.0'");
    //ps.addCommand("Write-Output 'setupDir:' $setupDir  ' msbuild:'$msbuild");
    ps.addCommand("Invoke-Command $msbuild 'setup.msbuild' $setupDir");
    ps.invoke().then(function (result) {
        fluid.log("MSBuild complete: ", result);
        ps.dispose();
    }, function (err) {
        fluid.log("There was an error running MSBuild: ", err);
        ps.dispose();
    });
};
