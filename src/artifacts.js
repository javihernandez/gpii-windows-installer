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
    fse = require("fs-extra"),
    path = require("path"),
    process = require("process"),
    request = require("request");

var gpii = fluid.registerNamespace("gpii");

fluid.defaults("gpii.installer.artifact", {
    gradeNames: "fluid.modelComponent",
    defaultOutputPath: path.join(process.cwd(), "artifacts"),
    events: {
        onPopulated: null,
        onError: null
    }
});

fluid.defaults("gpii.installer.artifact.downloader", {
    gradeNames: "gpii.installer.artifact",
    downloadUrl: null,
    invokers: {
        download: {
            funcName: "gpii.installer.artifact.download"
        }
    },
    events: {
        onDownloaded: null
    },
    listeners: {
        "onCreate.download": {
            func: "{that}.download",
            args: [ "{that}.options.downloadUrl", "{that}.options.defaultOutputPath",
                    "{that}.options.output", "{that}.events.onPopulated", "{that}.events.onError" ]
        }
    }
});

fluid.defaults("gpii.installer.artifact.githubRepoDownloader", {
    gradeNames: "gpii.installer.artifact.downloader",
    repo: null,
    hash: null,
    members: {
        zipFile: "@expand:fluid.add({that}.options.hash, .zip)"
    },
    invokers: {
        unzip: {
            funcName: "gpii.installer.artifact.unzip",
            args: ["unzip function called"]
        }
    },
    events: {
        onUnzipped: null
    },
    listeners: {
        "onCreate.formatDownloadUrl": {
            funcName: "gpii.installer.artifact.formatGithubDownloadUrl",
            args: ["{that}"]
        },
        "onCreate.download": {
            func: "{that}.download",
            args: ["{that}.options.downloadUrl", "{that}.options.defaultOutputPath",
                    "{that}.zipFile",
                    "{that}.events.onDownloaded", "{that}.events.onError" ],
            priority:"after:onCreate.formatDownloadUrl"
        },
        "onDownloaded.unzip": {
            funcName: "gpii.installer.artifact.unzip",
            args: ["{that}.zipFile", "{that}.options.defaultOutputPath",
                    "{that}.events.onPopulated", "{that}.events.onError"]
        }
    }
});


gpii.installer.artifact.download = function (downloadUrl, defaultOutputPath, outputFile, event, error) {
    // TODO: can we provide the resolved path in a different way?
    var outputPath = fluid.module.resolvePath(defaultOutputPath);
    var outputFilePath = path.join(outputPath, outputFile);

    if (!fs.existsSync(outputPath)) fs.mkdirSync(outputPath);
    if (fs.existsSync(outputFilePath)) fse.removeSync(outputFilePath);

    var outStream = fs.createWriteStream(outputFilePath);

    var req = request.get({
      uri: downloadUrl,
      gzip: true
    });

    fluid.log("Downloading ", downloadUrl);

    var pipe = req.pipe(outStream);

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
        // This way we avoid the 'End-of-central-directory signature not found'
        // error that sometimes we get.
        pipe.on("close", function () {
            event.fire(outputFile);
        });
    });
};


gpii.installer.artifact.formatGithubDownloadUrl = function (that) {
    that.options.downloadUrl = that.options.repo + path.join("/archive", that.options.hash + ".zip");
};

gpii.installer.artifact.unzip = function (file, defaultOutputPath, event, error) {
    fluid.log("Unzipping ", file);
    var zipFile = path.join(defaultOutputPath, file);

    var outputPath = fluid.module.resolvePath(defaultOutputPath);
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
        if (fs.existsSync(path.join(outputPath, unzippedArtifactFolder))) fse.removeSync(path.join(outputPath, unzippedArtifactFolder));
        zip.extractAllTo(outputPath, true);
        // Remove the hash reference for the folder name. e.g.: gpii-app-92f9b5e1ba01fc2b39f92d235bfa4b64d60108c5 to gpii-app
        var finalArtifactFolder = unzippedArtifactFolder.slice(0, unzippedArtifactFolder.lastIndexOf("-"));
        if (fs.existsSync(path.join(outputPath, finalArtifactFolder))) fse.removeSync(path.join(outputPath, finalArtifactFolder));
        // Rename the unzipped artifact folder
        fs.renameSync(path.join(outputPath, unzippedArtifactFolder), path.join(outputPath, finalArtifactFolder));
        // Remove the zipFile
        fs.unlinkSync(zipFile);
        event.fire(path.join(outputPath, finalArtifactFolder));
    } catch (err) {
        fluid.log("Couldn't unzip", zipFile, "Error was:", err);
        error.fire("Couldn't unzip " + zipFile);
    }
};
