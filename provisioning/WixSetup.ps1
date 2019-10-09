<#
  This script sets up the system to build an installer.
#>

param (
    [string]$provisioningDir = (Split-Path -parent $PSCommandPath) # Default to script path.
)

# Turn verbose on, change to "SilentlyContinue" for default behaviour.
$VerbosePreference = "continue"

# Store the project folder of the script (root of the repo) as $projectDir.
$projectDir = (Get-Item $provisioningDir).parent.FullName

Import-Module (Join-Path $provisioningDir 'Provisioning.psm1') -Force

# Obtaining useful tools location.
$npm = "npm" -f $env:SystemDrive
$chocolatey = "$env:ChocolateyInstall\bin\choco.exe" -f $env:SystemDrive

# Installing required choco packages.
Invoke-Command $chocolatey "install wixtoolset -y"
refreshenv
# The path to WIX can be found in $env:WIX env variable but looks like chocolatey's refreshenv
# is not able to set such variable in this session. As a workaround, we ask the registry
# for such environmental variable and set it so we can use it inside this powershell session.
$wixSetupPath = Join-Path (Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Environment' -Name WIX).WIX "bin"
Add-Path $wixSetupPath $true
refreshenv

Invoke-Command $chocolatey "install msbuild.extensionpack -y"
refreshenv

# Install electron-packager globally.
# TODO: Define electron-packager invocation in npm scripts.
Invoke-Command $npm "install electron-packager -g" $projectDir
