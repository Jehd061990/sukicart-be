const express = require("express");
const cors = require("cors");

const authRoutes = require("./routes/authRoutes");
const protectedRoutes = require("./routes/protectedRoutes");
const productRoutes = require("./routes/productRoutes");
const deliveryRoutes = require("./routes/deliveryRoutes");
const userManagementRoutes = require("./routes/userManagementRoutes");
const posRoutes = require("./routes/posRoutes");
const orderRoutes = require("./routes/orderRoutes");
const { setupSwagger } = require("./config/swagger");

const app = express();

app.use(cors());
app.use(express.json());
setupSwagger(app);

app.get("/", (req, res) => {
  res.status(200).json({ message: "SukiCart auth API is running" });
});

app.use("/api/auth", authRoutes);
app.use("/api/protected", protectedRoutes);
app.use("/api/products", productRoutes);
app.use("/api/deliveries", deliveryRoutes);
app.use("/api/users", userManagementRoutes);
app.use("/api/pos", posRoutes);
app.use("/api/orders", orderRoutes);

app.use((req, res) => {
  res.status(404).json({ message: "Route not found" });
});

module.exports = app;
