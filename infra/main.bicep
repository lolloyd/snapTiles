targetScope = 'subscription'

@allowed(['dev', 'staging', 'prod'])
param environment string = 'dev'

@description('Use a new identifier for each isolated environment deployment.')
@minLength(3)
@maxLength(16)
param deploymentId string

param location string = 'eastus2'

@secure()
param sessionSecret string = '${newGuid()}${newGuid()}'

@allowed(['Standard'])
param staticWebAppSku string = 'Standard'

resource group 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: 'rg-snaptiles-${environment}-${deploymentId}'
  location: location
  tags: { application: 'SnapTiles', environment: environment, deploymentId: deploymentId }
}

resource site 'Microsoft.Web/staticSites@2025-03-01' = {
  scope: group
  name: 'swa-snaptiles-${environment}-${uniqueString(group.id)}'
  location: location
  sku: { name: staticWebAppSku, tier: staticWebAppSku }
  tags: { application: 'SnapTiles', environment: environment }
  properties: {
    provider: 'Custom'
    stagingEnvironmentPolicy: 'Disabled'
    allowConfigFileUpdates: true
  }
}

module resources './resources.bicep' = {
  scope: group
  params: {
    location: location
    environment: environment
    sessionSecret: sessionSecret
    staticWebAppName: site.name
  }
}

output resourceGroupName string = group.name
output appUrl string = resources.outputs.appUrl
output staticWebAppName string = resources.outputs.staticWebAppName
output apiAppName string = resources.outputs.apiAppName
output apiUrl string = resources.outputs.apiUrl
