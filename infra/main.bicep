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

@allowed(['Free', 'Standard'])
param staticWebAppSku string = 'Free'

resource group 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: 'rg-snaptiles-${environment}-${deploymentId}'
  location: location
  tags: { application: 'SnapTiles', environment: environment, deploymentId: deploymentId }
}

module resources './resources.bicep' = {
  scope: group
  params: {
    location: location
    environment: environment
    sessionSecret: sessionSecret
    staticWebAppSku: staticWebAppSku
  }
}

output resourceGroupName string = group.name
output appUrl string = resources.outputs.appUrl
output staticWebAppName string = resources.outputs.staticWebAppName
