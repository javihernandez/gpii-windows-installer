/*
* artifacts.js - Fluid components that allow us to deal with artifacts
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
    path = require("path"),
    process = require("process"),
    request = require("request");

var gpii = fluid.registerNamespace("gpii");

fluid.defaults("gpii.installer.artifact", {
    gradeNames: "fluid.modelComponent",
    defaultOutputPath: path.join(process.cwd(), "artifacts"),
    artifactData: null,
    model: {
        artifactFolder: null
    },
    invokers: {
        formatDownloadUrl: {
            funcName: "gpii.installer.artifact.formatDownloadUrl",
            args: ["{that}.options.artifactData"]
        },
        populate: {
            func: "{that}.download",
            args: ["{that}"]
        },
        download: {
            funcName: "gpii.installer.artifact.download",
            args: [
                "{that}",
                "{that}.options.artifactData",
                "{that}.options.defaultOutputPath",
                "{that}.events.onDownloaded",
                "{that}.events.onError"
            ]
        },
        unzip: {
            funcName: "gpii.installer.artifact.unzip",
            args: [
                "{arguments}.0",
                "{that}.options.defaultOutputPath",
                "{that}.events.onUnzipped",
                "{that}.events.onError"
            ]
        },
        build: {
            funcName: "gpii.installer.artifact.build",
            args: [
                "{arguments}.0",
                "{that}.options.artifactData.build",
                "{that}.events.onBuildFinished",
                "{that}.events.onError"
            ]
        }
    },
    events: {
        onDownloaded: null,
        onUnzipped: null,
        onBuildFinished: null,
        onPopulated: null,
        onError: null
    },
    listeners: {
        "onCreate.download": "{that}.download",
        "onDownloaded.unzip": {
            func: "{that}.unzip",
            args: "{arguments}.0"
        },
        "onUnzipped.updateArtifactFolder": {
            changePath: "{that}.model.artifactFolder",
            value: "{arguments}.0"
        },
        "onUnzipped.build": {
            func: "{that}.build",
            args: "{arguments}.0"
        },
        "onBuildFinished.fireOnPopulated": {
            func: "{that}.events.onPopulated.fire",
            args: ["Artifact ", "{that}.options.artifactData.id", " has been populated"]
        },
        "onPopulated.log": {
            funcName: "fluid.log",
            args: ["Artifact ", "{that}.options.artifactData.id", " has been populated"]
        }
    }
});

gpii.installer.artifact.formatDownloadUrl = function (artifact) {
    return artifact.repo + path.join("/archive", artifact.hash + ".zip");
};

/**
* Download a zip file into a specific location.
* @param {Artifact} artifactId - The id of the artifact to download.
*/
gpii.installer.artifact.download = function (that, artifact, defaultOutputPath, event, error) {
    var downloadUrl = that.formatDownloadUrl(artifact);
    // TODO: can we provide the resolved path in a different way?
    var outputPath = fluid.module.resolvePath(defaultOutputPath);
    var outputFile = path.join(outputPath, artifact.hash + ".zip");

    if (!fs.existsSync(outputPath)) fs.mkdirSync(outputPath);

    var outStream = fs.createWriteStream(outputFile);

    var req = request.get({
      uri: downloadUrl,
      gzip: true
    });

    fluid.log("Downloading ", downloadUrl);

    req.pipe(outStream);

    req.on("error", function (err) {
        var err = "Couldn't download artifact, error was: " + err;
        outStream.close();
        outStream = null;
        error.fire(err);
        fluid.fail(err);
    });

    req.on("end", function () {
        outStream.close();
        outStream = null;
        event.fire(outputFile);
    });
};

gpii.installer.artifact.unzip = function (zipFile, outputPath, event, error) {
    fluid.log("Unzipping ", zipFile);

    var resolvedOutputPath = fluid.module.resolvePath(outputPath);
    /* There is a try/catch block here since I'm getting random errors while using
     * the adm-zip library.
     *
     * The problem only happens occasionally but the problem is that the script crashes
     * just saying "FATAL ERROR: Uncaught exception undefined".
     *
     * This is completely meaningless to the person who is running this code and
     * seeing the program crashing right after getting the error above.
     * I've also tried using the async version of extractAllTo (actually undocumented),
     * and didn't help much since I'm getting false errors or errors that are not fatal.
     *
     * For these reasons, I think that this try/catch could brings some "sanity" to the
     * situation. Maybe we should take a closer look at other alternatives
     * to unzip files in the future such as https://www.npmjs.com/package/decompress-zip
     * or https://www.npmjs.com/package/unzipper.
     */
    try {
        var zip = new admZip(zipFile);
        // This gets the top-level directory and removes the ending slash coming from the entryName
        var unzippedArtifactFolder = zip.getEntries()[0].entryName.slice(0, -1);
        zip.extractAllTo(resolvedOutputPath, true);
        // Remove the hash reference for the folder name. e.g.: gpii-app-92f9b5e1ba01fc2b39f92d235bfa4b64d60108c5 to gpii-app
        var finalArtifactFolder = unzippedArtifactFolder.slice(0, unzippedArtifactFolder.lastIndexOf("-"));
        // Rename the unzipped artifact folder
        fs.renameSync(path.join(resolvedOutputPath, unzippedArtifactFolder), path.join(resolvedOutputPath, finalArtifactFolder));
        // Remove the zipFile
        fs.unlinkSync(zipFile);
        event.fire(path.join(resolvedOutputPath, finalArtifactFolder));
    } catch (err) {
        fluid.log("Couldn't unzip", zipFile, "Error was:", err);
        error.fire("Couldn't unzip " + zipFile);
    }
};

gpii.installer.artifact.build = function (folder, build, event, error) {
    if (!build) {
        fluid.log("Skipping build of ", folder);
        event.fire();
    } else {
        fluid.log("Building ", folder);
        var buildC = spawn(build.cmd, build.args, {shell: true, cwd: folder});
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
            code ? error.fire("Couldn't build " + folder + " - Check above for errors"): event.fire(code)
        });
    }
};
