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
    allowSharedKeyAccess: true
    defaultToOAuthAuthentication: true
  }
}

resource blobs 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storage
  name: 'default'
  properties: {
    deleteRetentionPolicy: { enabled: true, days: 7 }
    containerDeleteRetentionPolicy: { enabled: true, days: 7 }
    cors: {
      corsRules: [{
        allowedOrigins: ['https://${site.properties.defaultHostname}']
        allowedMethods: ['PUT', 'GET', 'HEAD', 'OPTIONS']
        allowedHeaders: ['content-type', 'x-ms-blob-type', 'x-ms-version']
        exposedHeaders: ['etag', 'x-ms-request-id']
        maxAgeInSeconds: 300
      }]
    }
  }
}

resource uploads 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobs
  name: 'snaptiles-uploads'
  properties: { publicAccess: 'None' }
}

resource cosmos 'Microsoft.DocumentDB/databaseAccounts@2024-05-15' = {
  name: 'cosmos-snaptiles-${environment}-${suffix}'
  location: location
  tags: tags
  kind: 'GlobalDocumentDB'
  properties: {
    databaseAccountOfferType: 'Standard'
    capabilities: [{ name: 'EnableServerless' }]
    locations: [{ locationName: location, failoverPriority: 0, isZoneRedundant: false }]
    consistencyPolicy: { defaultConsistencyLevel: 'Session' }
    minimalTlsVersion: 'Tls12'
    backupPolicy: { type: 'Periodic', periodicModeProperties: { backupIntervalInMinutes: 240, backupRetentionIntervalInHours: 24, backupStorageRedundancy: 'Local' } }
  }
}

resource database 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2024-05-15' = {
  parent: cosmos
  name: 'snaptilesdb'
  properties: { resource: { id: 'snaptilesdb' } }
}

var containerDefinitions = [
  { name: 'games', partitionKey: '/id', ttl: -1 }
  { name: 'players', partitionKey: '/gameId', ttl: -1 }
  { name: 'prompts', partitionKey: '/category', ttl: -1 }
  { name: 'rateLimits', partitionKey: '/id', ttl: 120 }
]
resource containers 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = [for definition in containerDefinitions: {
  parent: database
  name: definition.name
  properties: {
    resource: {
      id: definition.name
      partitionKey: { paths: [definition.partitionKey], kind: 'Hash', version: 2 }
      defaultTtl: definition.ttl
      indexingPolicy: { indexingMode: 'consistent', automatic: true, includedPaths: [{ path: '/*' }], excludedPaths: [{ path: '/"_etag"/?' }] }
    }
  }
}]

resource settings 'Microsoft.Web/staticSites/config@2024-04-01' = {
  parent: site
  name: 'appsettings'
  properties: {
    COSMOS_CONNECTION_STRING: cosmos.listConnectionStrings().connectionStrings[0].connectionString
    STORAGE_ACCOUNT_NAME: storage.name
    STORAGE_ACCOUNT_KEY: storage.listKeys().keys[0].value
    SESSION_SECRET: sessionSecret
  }
}

output appUrl string = 'https://${site.properties.defaultHostname}'
output staticWebAppName string = site.name
