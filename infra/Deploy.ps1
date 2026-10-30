[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'High')]
param(
  [Parameter(Mandatory = $true)][string]$SubscriptionId,
  [ValidateSet('dev', 'staging', 'prod')][string]$Environment = 'dev',
  [string]$Location = 'eastus2',
  [ValidatePattern('^[a-z0-9]{3,16}$')][string]$DeploymentId = ('{0}{1}' -f (Get-Date -Format 'yyMMdd'), ([guid]::NewGuid().ToString('N').Substring(0, 6))),
  [ValidateSet('Free', 'Standard')][string]$StaticWebAppSku = 'Free',
  [switch]$Provision
)

$ErrorActionPreference = 'Stop'
if (-not (Get-Command az -ErrorAction SilentlyContinue)) { throw 'Azure CLI is required. Install it and run az login first.' }
$accountJson = az account show --subscription $SubscriptionId --output json
if ($LASTEXITCODE -ne 0) { throw 'Cannot access this subscription. Authenticate with az login first.' }
$account = $accountJson | ConvertFrom-Json
$groupName = "rg-snaptiles-$Environment-$DeploymentId"
$exists = az group exists --subscription $SubscriptionId --name $groupName --output tsv
if ($LASTEXITCODE -ne 0) { throw 'Could not verify resource-group availability.' }
if ($exists.Trim() -eq 'true') { throw "Refusing to reuse existing resource group $groupName. Choose a new DeploymentId." }
$template = Join-Path $PSScriptRoot 'main.bicep'
$deploymentName = "snaptiles-$Environment-$DeploymentId"
$arguments = @('--subscription', $SubscriptionId, '--location', $Location, '--name', $deploymentName, '--template-file', $template, '--parameters', "environment=$Environment", "deploymentId=$DeploymentId", "location=$Location", "staticWebAppSku=$StaticWebAppSku")
Write-Host "Subscription: $($account.name) ($SubscriptionId)"
Write-Host "New resource group: $groupName; region: $Location; SWA SKU: $StaticWebAppSku"
Write-Host 'Cosmos DB requests/storage and Blob Storage/egress are billable. A what-if preview is not a price quote.'
az deployment sub what-if @arguments
if ($LASTEXITCODE -ne 0) { throw 'Deployment preview failed. No provisioning was attempted.' }
if (-not $Provision) { Write-Host 'Preview only. Rerun with the same DeploymentId and -Provision after reviewing scope and costs.'; return }
if ($PSCmdlet.ShouldProcess("$($account.name): $groupName", 'Create a new isolated SnapTiles environment and billable resources')) {
  $exists = az group exists --subscription $SubscriptionId --name $groupName --output tsv
  if ($LASTEXITCODE -ne 0 -or $exists.Trim() -ne 'false') { throw 'Resource group is no longer available. Provisioning stopped.' }
  az deployment sub create @arguments --query properties.outputs --output json
  if ($LASTEXITCODE -ne 0) { throw 'Deployment failed. Inspect the new resource group and deployment status; no automatic deletion is performed.' }
}