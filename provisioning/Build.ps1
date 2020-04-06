<#
  This script does the following:
  1) Run the provisioning scripts from the windows repository
  2) Run WixSetup.ps1
  2) Run npm install

  If run via a tool (like vagrant) which moves this script to somewhere different
  than its original location within the gpii-app repository, the parameter
  "-originalBuildScriptPath" should be provided, with the original location of the
  script
#>

param (
    [string]$originalBuildScriptPath = (Split-Path -parent $PSCommandPath) # Default to script path.
)

# Turn verbose on, change to "SilentlyContinue" for default behaviour.
$VerbosePreference = "continue"

# Store the parent folder of the script (root of the repo) as $mainDir
############
$mainDir = (get-item $originalBuildScriptPath).parent.FullName
Write-OutPut "mainDir set to: $($mainDir)"

# TODO: We should add this to a function or reduce to oneline.
$bootstrapModule = Join-Path $originalBuildScriptPath "Provisioning.psm1"
iwr https://raw.githubusercontent.com/GPII/windows/master/provisioning/Provisioning.psm1 -UseBasicParsing -OutFile $bootstrapModule
Import-Module $bootstrapModule -Verbose -Force

# Retrieve provisioning scripts from the windows repo
# ############
# TODO: Create function for downloading scripts and executing them.
$windowsBootstrapURL = "https://raw.githubusercontent.com/GPII/windows/master/provisioning"
try {
    $choco = Join-Path $originalBuildScriptPath "Chocolatey.ps1"
    Write-OutPut "Running windows script: $choco"
    iwr "$windowsBootstrapURL/Chocolatey.ps1" -UseBasicParsing -OutFile $choco
    Invoke-Expression $choco
} catch {
    Write-OutPut "Chocolatey.ps1 FAILED"
    exit 1
}
try {
    $couchdb = Join-Path $originalBuildScriptPath "CouchDB.ps1"
    Write-OutPut "Running windows script: $couchdb"
    iwr "$windowsBootstrapURL/CouchDB.ps1" -UseBasicParsing -OutFile $couchdb
    Invoke-Expression $couchdb
} catch {
    Write-OutPut "CouchDB.ps1 FAILED"
    exit 1
}
try {
    $npm = Join-Path $originalBuildScriptPath "Npm.ps1"
    Write-OutPut "Running windows script: $npm"
    iwr "$windowsBootstrapURL/Npm.ps1" -UseBasicParsing -OutFile $npm
    Invoke-Expression $npm
} catch {
    Write-OutPut "Npm.ps1 FAILED"
    exit 1
}

## In addition to the previous scripts, we also need to setup Wix
try {
  $wix = Join-Path $originalBuildScriptPath "WixSetup.ps1"
  Write-OutPut "Setting up Wix: $wix"
  Invoke-Expression $Wix
} catch {
  Write-OutPut "WixSetup.ps1 FAILED"
  exit 1
}

$npmCmd = "npm" -f $env:SystemDrive

## npm install pkg globally
Invoke-Command $npmCmd "install -g pkg"

## Run npm install
Invoke-Command "npm" "install" $mainDir
