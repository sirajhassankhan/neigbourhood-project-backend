const router = require("express").Router();
const controller = require("../controllers/userController");

const multer = require("multer");
const path = require("path");

// ================= MULTER CONFIG =================
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "uploads/");  // folder name
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});

const upload = multer({ storage: storage });

// ================= ROUTES =================

// Signup with image upload
router.post("/signup", upload.single("profileImage"), controller.signup);
router.post("/check-location", controller.checkLocation);

router.post("/login", controller.login);
router.get("/", controller.getAllUsers);
router.get("/single", controller.getSingleUser);
router.put("/update", controller.updateUser);
router.get("/nhc/:nhcId/members", controller.getUsersByNhc);

router.get(
  "/nhc-users/:nhcId/:cnic",
  controller.getNhcUsersExceptCurrent
);


module.exports = router;
