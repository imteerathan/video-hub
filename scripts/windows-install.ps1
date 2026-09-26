$ErrorActionPreference = 'Stop'
Write-Host 'Video Hub PC development/bootstrap environment'
Write-Host 'Node.js 22+ is recommended.'
node --version
npm --version
npm install
npm run prisma:generate
npm run build
Write-Host ''
Write-Host 'Dependencies installed and production build prepared.'
Write-Host 'For development: npm run desktop:dev'
Write-Host 'For installer packaging: npm run desktop:package'
