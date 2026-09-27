const express = require("express");
const cors = require("cors");
require("dotenv").config();

const db = require("./config/db");
const userRoutes = require("./routes/userRoutes");
const shopRoutes = require("./routes/shopRoutes");

const app = express();

app.use(cors());
app.use(express.json());
app.use("/api/users", userRoutes);
app.use("/api/shops", shopRoutes);

app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Delivery App Backend is running"
  });
});

// PostgreSQL health check
app.get("/api/health", async (req, res) => {
  try {
    const result = await db.query("SELECT NOW() AS server_time");

    res.json({
      success: true,
      message: "Backend and PostgreSQL are connected",
      database: "connected",
      server_time: result.rows[0].server_time
    });
  } catch (error) {
    console.error("Health check failed:", error.message);

    res.status(500).json({
      success: false,
      message: "Database connection failed"
    });
  }
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});