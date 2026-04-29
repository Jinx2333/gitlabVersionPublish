/**
 * PM2：在仓库根目录执行  pm2 start ecosystem.config.cjs
 * 单进程：API + server/public 静态页（部署前先 npm run build:client）
 */
module.exports = {
  apps: [
    {
      name: 'EmergencyBackend',
      cwd: __dirname,
      script: 'server/index.js',
      interpreter: 'node',
    },
  ],
};
