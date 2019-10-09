# gpii-windows-installer

The official installer for the GPII on Windows.
This code produces msi installers based on a given set of artifacts.

At this moment, the code does the following:

1. Download and populate the artifacts
1. Create a build folder where the installer is going to be created
1. Run npm install on gpii-app
1. Create the electron package
1. Run MSBuild to create the installer

In addition to these, I need to finish implementing the logic for copying some files (wix merge modules, reset to standard file, etc) into specific folders.

## Running the code

The easiest way to run this code is from the VM that you can set up by running `vagrant up`
The resulting VM includes the required dependencies to perform the build process.

When the VM is ready, you can run `node devTest.js` and the installer will be created automatically.

Take into account that the build process may take some time (around 10 minutes).
