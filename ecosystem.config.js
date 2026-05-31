module.exports = {
  apps: [
    {
      name: "mso-cloud",
      script: "src/server.js",
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
        PORT: 8080
      },
      watch: false,
      max_memory_restart: "300M"
    }
  ]
};
