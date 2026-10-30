targetScope = 'resourceGroup'

@allowed(['dev', 'staging', 'prod'])
param environment string = 'dev'

param location string = resourceGroup().location

@description('Name of the existing Static Web App to upgrade and link.')
param staticWebAppName string

@secure()
param sessionSecret string = '${newGuid()}${newGuid()}'

module resources './resources.bicep' = {
  params: {
    location: location
    environment: environment
    staticWebAppName: staticWebAppName
    sessionSecret: sessionSecret
  }
}

output appUrl string = resources.outputs.appUrl
output staticWebAppName string = resources.outputs.staticWebAppName
output apiAppName string = resources.outputs.apiAppName
output apiUrl string = resources.outputs.apiUrl
