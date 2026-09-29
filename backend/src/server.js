const express = require("express");
const cors = require("cors");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "..", ".env") });

const db = require("./config/db");
const userRoutes = require("./routes/userRoutes");
const shopRoutes = require("./routes/shopRoutes");
const productRoutes = require("./routes/productRoutes");
const categoryRoutes = require("./routes/categoryRoutes");
const adminAuthRoutes = require("./routes/adminAuthRoutes");
const partnerRoutes = require("./routes/partnerRoutes");
const orderRoutes = require("./routes/orderRoutes");
const adminOrderRoutes = require("./routes/adminOrderRoutes");
const authRoutes = require("./routes/authRoutes");
const riderAuthRoutes = require("./routes/riderAuthRoutes");
const riderRoutes = require("./routes/riderRoutes");
const adminRiderRoutes = require("./routes/adminRiderRoutes");
const adminDeliveryRoutes = require("./routes/adminDeliveryRoutes");
const notificationRoutes = require("./routes/notificationRoutes");
const adminNotificationRoutes = require("./routes/adminNotificationRoutes");
const adminPartnerRoutes = require("./routes/adminPartnerRoutes");
const adminCategoryRoutes = require("./routes/adminCategoryRoutes");

const app = express();

app.use(cors());
app.use(express.json());
app.use("/api/users", userRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/rider/auth", riderAuthRoutes);
app.use("/api/rider", riderRoutes);
app.use("/api/admin/riders", adminRiderRoutes);
app.use("/api/admin/deliveries", adminDeliveryRoutes);
app.use("/api/admin/notifications", adminNotificationRoutes);
app.use("/api/admin/partners", adminPartnerRoutes);
app.use("/api/admin/categories", adminCategoryRoutes);
app.use("/api/shops", shopRoutes);
app.use("/api/products", productRoutes);
app.use("/api/categories", categoryRoutes);
app.use("/api/admin/auth", adminAuthRoutes);
app.use("/api/admin/orders", adminOrderRoutes);
app.use("/api/partner", partnerRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/notifications", notificationRoutes);

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