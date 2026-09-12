module.exports = {
  apps: [{
    name: 'central-prints',
    script: 'src/server.js',
    cwd: '/home/belastock-grafica/htdocs/grafica.belastock.com.br',
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    watch: false,
    max_memory_restart: '700M',
    env: { NODE_ENV: 'production' }
  }]
};
