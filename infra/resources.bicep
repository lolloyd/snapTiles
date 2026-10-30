param location string
param environment string
param staticWebAppSku string
@secure()
param sessionSecret string

var suffix = uniqueString(resourceGroup().id)
var tags = { application: 'SnapTiles', environment: environment }

resource site 'Microsoft.Web/staticSites@2024-04-01' = {
  name: 'swa-snaptiles-${environment}-${suffix}'
  location: location
  sku: { name: staticWebAppSku, tier: staticWebAppSku }
  tags: tags
  properties: { provider: 'Custom', stagingEnvironmentPolicy: 'Disabled', allowConfigFileUpdates: false }
}

resource network 'Microsoft.Network/virtualNetworks@2024-05-01' = {
  name: 'vnet-snaptiles-${environment}-${suffix}'
  location: location
  tags: tags
  properties: { addressSpace: { addressPrefixes: ['10.42.0.0/16'] } }
}

resource apiSubnet 'Microsoft.Network/virtualNetworks/subnets@2024-05-01' = {
  parent: network
  name: 'api-integration'
  properties: {
    addressPrefix: '10.42.0.0/27'
    serviceEndpoints: [{ service: 'Microsoft.Storage' }]
    delegations: [{
      name: 'appService'
      properties: { serviceName: 'Microsoft.Web/serverFarms' }
    }]
  }
}

resource apiPlan 'Microsoft.Web/serverfarms@2024-04-01' = {
  name: 'asp-snaptiles-${environment}-${suffix}'
  location: location
  tags: tags
  kind: 'linux'
  sku: { name: 'B1', tier: 'Basic', size: 'B1', capacity: 1 }
  properties: { reserved: true, perSiteScaling: false }
}

resource apiApp 'Microsoft.Web/sites@2024-04-01' = {
  name: 'api-snaptiles-${environment}-${suffix}'
  location: location
  tags: tags
  kind: 'app,linux'
  identity: { type: 'SystemAssigned' }
  properties: {
    serverFarmId: apiPlan.id
    httpsOnly: true
    clientAffinityEnabled: false
    virtualNetworkSubnetId: apiSubnet.id
    siteConfig: {
      linuxFxVersion: 'NODE|24-lts'
      appCommandLine: 'npm start'
      alwaysOn: true
      numberOfWorkers: 1
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      vnetRouteAllEnabled: true
    }
  }
}

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: 'stsnap${suffix}'
  location: location
  tags: tags
  kind: 'StorageV2'
  sku: { name: 'Standard_LRS' }
  properties: {
    accessTier: 'Hot'
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    allowBlobPublicAccess: false
    allowSharedKeyAccess: false
    defaultToOAuthAuthentication: true
    publicNetworkAccess: 'Enabled'
    networkAcls: {
      bypass: 'None'
      defaultAction: 'Deny'
      ipRules: []
      virtualNetworkRules: [{ id: apiSubnet.id, action: 'Allow' }]
      resourceAccessRules: []
    }
  }
}

resource blobs 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storage
  name: 'default'
  properties: {
    deleteRetentionPolicy: { enabled: true, days: 7 }
    containerDeleteRetentionPolicy: { enabled: true, days: 7 }
  }
}

resource uploads 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobs
  name: 'snaptiles-uploads'
  properties: { publicAccess: 'None' }
}

resource apiSettings 'Microsoft.Web/sites/config@2024-04-01' = {
  parent: apiApp
  name: 'appsettings'
  properties: {
    NODE_ENV: 'production'
    SQLITE_DB_PATH: '/home/data/snaptiles.sqlite'
    STORAGE_ACCOUNT_NAME: storage.name
    SESSION_SECRET: sessionSecret
  }
}

resource blobAccess 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(uploads.id, apiApp.id, 'Storage Blob Data Contributor')
  scope: uploads
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'ba92f5b4-2d11-453d-a403-e96b0029c9fe')
    principalId: apiApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

output appUrl string = 'https://${site.properties.defaultHostname}'
output staticWebAppName string = site.name
output apiAppName string = apiApp.name
output apiUrl string = 'https://${apiApp.properties.defaultHostName}'
