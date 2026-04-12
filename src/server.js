const dotenv = require("dotenv");
dotenv.config();

const http = require("http");
const connectDB = require("./config/db");
const app = require("./app");
const { initSocket } = require("./socket");
const bootstrapAdmin = require("./utils/bootstrapAdmin");

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  await connectDB();
  await bootstrapAdmin();
  const server = http.createServer(app);
  initSocket(server);

  server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
};

startServer();
