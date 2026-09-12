module.exports = {
  apps: [
    {
      name: 'central-prints',
      script: 'src/server.js',
      cwd: '/home/belastock-grafica/htdocs/grafica.belastock.com.br',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '700M',
      env: { NODE_ENV: 'production' }
    },
    {
      name: 'central-prints-preflight',
      script: 'src/workers/preflight-worker.js',
      cwd: '/home/belastock-grafica/htdocs/grafica.belastock.com.br',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      restart_delay: 5000,
      max_memory_restart: '500M',
      env: { NODE_ENV: 'production' }
    }
  ]
};
