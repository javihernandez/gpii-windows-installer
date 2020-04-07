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

var dedupe = require("dedupe-infusion"),
    fluid = require("infusion"),
    fs = require("fs"),
    fse = require("fs-extra"),
    spawn = require("child_process").spawn,
    path = require("path"),
    powershell = require("node-powershell");

require("json5/lib/register");

fluid.setLogging(true);

var gpii = fluid.registerNamespace("gpii");
require("./artifacts.js");
require("./windowsService.js");

var artifactsData = fluid.require("%gpii-windows-installer/data/artifacts.json5");


fluid.defaults("gpii.installer", {
    gradeNames: "fluid.component",
    artifactsData: artifactsData,
    artifactsFolder: path.join(fluid.module.resolvePath("%gpii-windows-installer"), "artifacts"),
    resetToStandardFile: null, // TODO: This will be part of the artifacts.json file
    buildFolder: "c:/installer/",
    components: {
        windowsServiceBuilder: {
            type: "gpii.installer.windowsServiceBuilder",
            options: {
                buildFolder: "{installer}.options.buildFolder",
                events: {
                    onWindowsServiceReady: "{installer}.events.onWindowsServiceReady"
                }
            },
            createOnEvent: "onPackaged"
        }
    },
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
        shrinkSize: {
            funcName: "gpii.installer.shrinkSize",
            args: ["{that}"]
        },
        copyOptionalArtifacts: {
            funcName: "gpii.installer.copyOptionalArtifacts",
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
        onWindowsServiceReady: null,
        onShrunk: null,
        onCopiedOptionalArtifacts: null,
        onError: null
    },
    listeners: {
        "onCreate.populateArtifacts": {
            func: "{that}.populateArtifacts",
            args: "{that}.options.artifactsData"
        },
        "onPopulatedArtifacts.logResult": {
            funcName: "fluid.log",
            args: ["Artifacts successfully populated"]
        },
        "onPopulatedArtifacts.prepareBuildFolder": "{that}.prepareBuildFolder",
        "onBuildFolderReady.runNpmInstall": "{that}.npmInstall",
        "onNpmInstallFinished.logResult": {
            funcName: "fluid.log",
            args: ["npm install process succeeded"]
        },
        "onNpmInstallFinished.runElectronPackager": "{that}.electronPackager",
        "onPackaged.logResult": {
            funcName: "fluid.log",
            args: ["Morphic-App successfully packaged: ", "{arguments}.0"]
        },
        "onWindowsServiceReady.logResult": {
            funcName: "fluid.log",
            args: ["Morphic service successfully created"]
        },
        "onWindowsServiceReady.shrinkSize": "{that}.shrinkSize",
        "onShrunk.logResult": {
            funcName: "fluid.log",
            args: ["Shrunk size of node_modules folder"]
        },
        "onShrunk.copyOptionalArtifacts": "{that}.copyOptionalArtifacts",
        "onCopiedOptionalArtifacts.logResult": {
            funcName: "fluid.log",
            args: ["Copied optional artifacts"]
        },
        "onCopiedOptionalArtifacts.runMsbuild": "{that}.runMsbuild",
        "onError.logError": {
            funcName: "fluid.fail",
            args: "{arguments}.0"
        }
    }
});

gpii.installer.populateArtifacts = function (that, artifactsData) {
    // clean the artifacts folder
    if (fs.existsSync(that.options.artifactsFolder)) {
        fse.removeSync(that.options.artifactsFolder);
    }

    var sequence = [];
    var artifactsList = [];

    fluid.each(artifactsData, function (artifactData, artifactName) {
        fluid.log("Populating: ", artifactName);
        var promise = fluid.promise();

        var artifact = fluid.invokeGlobalFunction(artifactData.type, artifactData.options);

        artifact.events.onPopulated.addListener(function () {
            fluid.log("Artifact ", artifactName, " has been populated");
            artifactsList.push(artifactName);
            promise.resolve();
        });
        artifact.events.onError.addListener(function (err) {
            promise.reject(err);
        });

        sequence.push(promise);
    });

    fluid.promise.sequence(sequence).then(function (result) {
        that.events.onPopulatedArtifacts.fire();
    }, function (err) {
        that.events.onError.fire("An error occurred while trying to populate the artifacts. The error was: " + err);
    });
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

        // TODO: error handling
        if (code) {
            that.events.onError.fire("Couldn't finish npm install process - Check above for errors");
        } else {
            that.events.onNpmInstallFinished.fire();
        }
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

// TODO: Rework this in a better way
gpii.installer.shrinkSize = function (that) {
    var stagingAppFolder = path.join(that.options.buildFolder, "staging", "windows", "resources", "app");
    var stagingAppModulesFolder = path.join(stagingAppFolder, "node_modules");

    // 1.- npm prune --production
    var buildC = spawn("npm", ["prune", "--production"], {shell: true, cwd: stagingAppFolder});
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

        // TODO: error handling
        if (code) {
            that.events.onError.fire("Couldn't npm prune - Check above for errors");
        } else {
            // 2.- rm node_modules/electron
            fse.removeSync(path.join(stagingAppModulesFolder, "electron"));
            // 3.- dedupe-infusion
            dedupe.dedupeInfusion({node_modules: stagingAppModulesFolder});
            that.events.onShrunk.fire();
        }
    });
};

gpii.installer.copyOptionalArtifacts = function (that) {
    fluid.each(that.options.artifactsData, function (artifactData) {
        if (artifactData.options.outputPath) {
            var source = path.join(that.options.artifactsFolder, artifactData.options.output);
            var target = path.join(that.options.buildFolder, artifactData.options.outputPath);
            fs.copyFileSync(source, target);
            fluid.log("Copied ", source, " to ", target);
        }
    });
    that.events.onCopiedOptionalArtifacts.fire();
}

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
