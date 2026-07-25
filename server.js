const express = require("express");
const cors = require("cors");
require("dotenv").config();

const app = express();

// ================= MIDDLEWARE =================
app.use(cors());
app.use(express.json());

// Serve uploaded images publicly
app.use("/uploads", express.static("uploads"));

// ================= DATABASE INIT =================
const { initDB } = require("./db.js");

// ================= ROUTES =================
app.use("/api/nhc", require("./routes/nhc"));
app.use("/api/users", require("./routes/users"));
app.use("/api/requests", require("./routes/requests"));
app.use("/api/notifications", require("./routes/notifications"));
app.use("/api/positions", require("./routes/positions"));
app.use("/api/nominations", require("./routes/nominations"));
app.use("/api/elections", require("./routes/elections"));
app.use("/api/candidates", require("./routes/candidates"));
app.use("/api/complaint", require("./routes/complaint"));
app.use("/api", require("./routes/panelRoutes"));
app.use("/api/suggestion", require("./routes/suggestion"));
app.use("/api/committee", require("./routes/committee"));
app.use("/uploads/complaints", express.static("uploads/complaints"));
app.use("/uploads/complaint-resolution", express.static("uploads/complaint-resolution"));
app.use("/uploads/meeting-minutes", express.static("uploads/meeting-minutes"));
app.use("/api", require("./routes/drawer"));
app.use("/api/budget", require("./routes/budget"));
// ================= SERVER =================
const PORT = process.env.PORT || 5000;

app.listen(PORT, "0.0.0.0", async () => {
  console.log(`Server running on port ${PORT}`);
  await initDB();
});