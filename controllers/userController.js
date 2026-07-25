const { sql, getPool } = require("../db");

// ================= POINT IN POLYGON FUNCTION =================
function isPointInPolygon(point, polygon) {
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].latitude;
    const yi = polygon[i].longitude;
    const xj = polygon[j].latitude;
    const yj = polygon[j].longitude;

    const intersect =
      yi > point.longitude !== yj > point.longitude &&
      point.latitude <
        ((xj - xi) * (point.longitude - yi)) / (yj - yi) + xi;

    if (intersect) inside = !inside;
  }

  return inside;
}

// ================= SIGNUP =================
exports.signup = async (req, res) => {
  let transaction;

  try {
    const pool = await getPool();

    const {
      firstName,
      lastName,
      gender,
      cnic,
      phone,
      address,
      location,
      email,
      password,
      latitude,
      longitude,
    } = req.body;

    const ProfileImage = req.file ? req.file.filename : null;

    if (
      !firstName ||
      !lastName ||
      !gender ||
      !cnic ||
      !phone ||
      !address ||
      !email ||
      !password ||
      latitude === undefined ||
      longitude === undefined
    ) {
      return res.status(400).json({
        error: "Missing required fields",
      });
    }

    const userPoint = {
      latitude: parseFloat(latitude),
      longitude: parseFloat(longitude),
    };

    if (isNaN(userPoint.latitude) || isNaN(userPoint.longitude)) {
      return res.status(400).json({
        error: "Invalid latitude or longitude",
      });
    }

    let assignedNHC = null;

    const zones = await pool.request().query(`
      SELECT Id, Name, ZoneData
      FROM NHC_Zones
    `);

    for (const zone of zones.recordset) {
      try {
        const polygon = JSON.parse(zone.ZoneData);

        if (isPointInPolygon(userPoint, polygon)) {
          assignedNHC = zone;
          break;
        }
      } catch (parseError) {
        console.error("Invalid ZoneData for NHC:", zone.Id, parseError);
      }
    }

    transaction = new sql.Transaction(pool);
    await transaction.begin();

    // 1. Check duplicate CNIC
    const existingUser = await new sql.Request(transaction)
      .input("CNIC", sql.NVarChar, cnic)
      .query(`
        SELECT TOP 1 CNIC
        FROM Users
        WHERE CNIC = @CNIC
      `);

    if (existingUser.recordset.length > 0) {
      await transaction.rollback();
      return res.status(400).json({
        error: "User with this CNIC already exists",
      });
    }

    // 2. Check duplicate email
    const existingEmail = await new sql.Request(transaction)
      .input("Email", sql.NVarChar, email)
      .query(`
        SELECT TOP 1 Email
        FROM Users
        WHERE Email = @Email
      `);

    if (existingEmail.recordset.length > 0) {
      await transaction.rollback();
      return res.status(400).json({
        error: "User with this email already exists",
      });
    }

    // 3. Insert into Users
    await new sql.Request(transaction)
      .input("FirstName", sql.NVarChar, firstName)
      .input("LastName", sql.NVarChar, lastName)
      .input("Gender", sql.NVarChar, gender)
      .input("CNIC", sql.NVarChar, cnic)
      .input("Phone", sql.NVarChar, phone)
      .input("Address", sql.NVarChar, address)
      .input("Location", sql.NVarChar(sql.MAX), location || null)
      .input("Email", sql.NVarChar, email)
      .input("Password", sql.NVarChar, password)
      .input("ProfileImage", sql.NVarChar, ProfileImage)
      .input("NHC_Code", sql.Int, assignedNHC ? assignedNHC.Id : null)
      .query(`
        INSERT INTO Users
        (
          FirstName,
          LastName,
          Gender,
          CNIC,
          Phone,
          Address,
          Location,
          Email,
          Password,
          ProfileImage,
          NHC_Code
        )
        VALUES
        (
          @FirstName,
          @LastName,
          @Gender,
          @CNIC,
          @Phone,
          @Address,
          @Location,
          @Email,
          @Password,
          @ProfileImage,
          @NHC_Code
        )
      `);

    // 4. Insert into UserNHCs if council found
    if (assignedNHC) {
      const membershipCheck = await new sql.Request(transaction)
        .input("UserCNIC", sql.NVarChar, cnic)
        .input("NHC_Id", sql.Int, assignedNHC.Id)
        .query(`
          SELECT TOP 1 Id
          FROM UserNHCs
          WHERE UserCNIC = @UserCNIC
            AND NHC_Id = @NHC_Id
        `);

      if (membershipCheck.recordset.length === 0) {
        await new sql.Request(transaction)
          .input("UserCNIC", sql.NVarChar, cnic)
          .input("NHC_Id", sql.Int, assignedNHC.Id)
          .input("IsPrimary", sql.Bit, 1)
          .input("IsActive", sql.Bit, 1)
          .input("PositionId", sql.Int, null)
          .input("Role", sql.NVarChar, "User")
          .query(`
            INSERT INTO UserNHCs
            (
              UserCNIC,
              NHC_Id,
              IsPrimary,
              IsActive,
              JoinedDate,
              PositionId,
              Role
            )
            VALUES
            (
              @UserCNIC,
              @NHC_Id,
              @IsPrimary,
              @IsActive,
              GETDATE(),
              @PositionId,
              @Role
            )
          `);
      }
    }

    // 5. If no NHC found, create request
    if (!assignedNHC) {
      await new sql.Request(transaction)
        .input("FirstName", sql.NVarChar, firstName)
        .input("LastName", sql.NVarChar, lastName)
        .input("CNIC", sql.NVarChar, cnic)
        .input("RequestType", sql.NVarChar, "NEW_NHC")
        .input("Message", sql.NVarChar, "No NHC found for this location")
        .input("Location", sql.NVarChar(sql.MAX), JSON.stringify(userPoint))
        .query(`
          INSERT INTO Requests
          (
            FirstName,
            LastName,
            CNIC,
            RequestType,
            Message,
            Location
          )
          VALUES
          (
            @FirstName,
            @LastName,
            @CNIC,
            @RequestType,
            @Message,
            @Location
          )
        `);
    }

    await transaction.commit();

    return res.status(201).json({
      message: assignedNHC
        ? "User registered and assigned to NHC"
        : "User registered. Request created for new NHC",
      nhc: assignedNHC ? assignedNHC.Name : null,
      nhcId: assignedNHC ? assignedNHC.Id : null,
    });
  } catch (err) {
    if (transaction) {
      try {
        await transaction.rollback();
      } catch (_) {}
    }

    console.error("Signup Error:", err);

    return res.status(500).json({
      error: err.message || "Server Error",
    });
  }
};

// ================= LOGIN =================
exports.login = async (req, res) => {
  try {
    const pool = await getPool();
    const { cnic, password } = req.body;

    if (!cnic || !password) {
      return res.status(400).json({
        error: "CNIC and password are required",
      });
    }

    const result = await pool
      .request()
      .input("CNIC", sql.NVarChar, cnic)
      .input("Password", sql.NVarChar, password)
      .query(`
        SELECT TOP 1 *
        FROM Users
        WHERE CNIC = @CNIC
          AND Password = @Password
      `);

    if (result.recordset.length === 0) {
      return res.status(401).json({
        error: "Invalid credentials",
      });
    }

    const user = result.recordset[0];

    // Get primary active council membership
    const membership = await pool
      .request()
      .input("UserCNIC", sql.NVarChar, cnic)
      .query(`
        SELECT TOP 1
          un.Id AS userNhcId,
          un.NHC_Id AS nhcId,
          un.Role AS councilRole,
          un.PositionId AS councilPositionId,
          un.IsPrimary,
          un.IsActive,
          z.Name AS councilName
        FROM UserNHCs un
        LEFT JOIN NHC_Zones z ON un.NHC_Id = z.Id
        WHERE un.UserCNIC = @UserCNIC
          AND un.IsActive = 1
        ORDER BY un.IsPrimary DESC, un.Id ASC
      `);

    if (membership.recordset.length > 0) {
      const m = membership.recordset[0];

      user.userNhcId = m.userNhcId;
      user.nhcId = m.nhcId;
      user.councilName = m.councilName;
      user.councilRole = m.councilRole;
      user.councilPositionId = m.councilPositionId;

      // Keep old frontend compatibility
      user.NHC_Code = m.nhcId;
      user.nhcCode = m.nhcId;
      user.PositionId = m.councilPositionId;
      user.Role = m.councilRole;
    }

    return res.status(200).json(user);
  } catch (err) {
    console.error("Login Error:", err);
    return res.status(500).json({
      error: err.message || "Server Error",
    });
  }
};

// ================= GET ALL USERS =================
exports.getAllUsers = async (req, res) => {
  try {
    const pool = await getPool();

    const result = await pool.request().query(`
      SELECT *
      FROM Users
      ORDER BY Id DESC
    `);

    return res.status(200).json(result.recordset);
  } catch (err) {
    console.error("Get All Users Error:", err);
    return res.status(500).json({
      error: err.message || "Server Error",
    });
  }
};

// ================= GET SINGLE USER =================
exports.getSingleUser = async (req, res) => {
  try {
    const pool = await getPool();
    const cnic = req.query.cnic;

    if (!cnic) {
      return res.status(400).json({
        error: "CNIC is required",
      });
    }

    const result = await pool
      .request()
      .input("CNIC", sql.NVarChar, cnic)
      .query(`
        SELECT TOP 1 *
        FROM Users
        WHERE CNIC = @CNIC
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({
        error: "User not found",
      });
    }

    return res.status(200).json(result.recordset[0]);
  } catch (err) {
    console.error("Get Single User Error:", err);
    return res.status(500).json({
      error: err.message || "Server Error",
    });
  }
};

// ================= UPDATE USER =================
exports.updateUser = async (req, res) => {
  try {
    const pool = await getPool();

    const {
      cnic,
      firstName,
      lastName,
      phone,
      address,
      role,
      email,
    } = req.body;

    if (!cnic) {
      return res.status(400).json({
        error: "CNIC is required",
      });
    }

    await pool
      .request()
      .input("CNIC", sql.NVarChar, cnic)
      .input("FirstName", sql.NVarChar, firstName || null)
      .input("LastName", sql.NVarChar, lastName || null)
      .input("Phone", sql.NVarChar, phone || null)
      .input("Address", sql.NVarChar, address || null)
      .input("Role", sql.NVarChar, role || null)
      .input("Email", sql.NVarChar, email || null)
      .query(`
        UPDATE Users
        SET FirstName = COALESCE(@FirstName, FirstName),
            LastName = COALESCE(@LastName, LastName),
            Phone = COALESCE(@Phone, Phone),
            Address = COALESCE(@Address, Address),
            Role = COALESCE(@Role, Role),
            Email = COALESCE(@Email, Email)
        WHERE CNIC = @CNIC
      `);

    return res.status(200).json({
      message: "User Updated Successfully",
    });
  } catch (err) {
    console.error("Update User Error:", err);
    return res.status(500).json({
      error: err.message || "Server Error",
    });
  }
};

// ================= CHECK LOCATION =================
exports.checkLocation = async (req, res) => {
  try {
    const pool = await getPool();
    const { latitude, longitude } = req.body;

    const userPoint = {
      latitude: parseFloat(latitude),
      longitude: parseFloat(longitude),
    };

    if (isNaN(userPoint.latitude) || isNaN(userPoint.longitude)) {
      return res.status(400).json({
        error: "Invalid latitude or longitude",
      });
    }

    const zones = await pool.request().query(`
      SELECT Id, Name, ZoneData
      FROM NHC_Zones
    `);

    let foundZone = null;

    for (const zone of zones.recordset) {
      try {
        const polygon = JSON.parse(zone.ZoneData);

        if (isPointInPolygon(userPoint, polygon)) {
          foundZone = zone;
          break;
        }
      } catch (parseError) {
        console.error("Invalid ZoneData for NHC:", zone.Id, parseError);
      }
    }

    if (foundZone) {
      return res.status(200).json({
        found: true,
        council: foundZone.Name,
        nhcId: foundZone.Id,
      });
    }

    return res.status(200).json({
      found: false,
    });
  } catch (err) {
    console.error("Check Location Error:", err);
    return res.status(500).json({
      error: err.message || "Server error",
    });
  }
};

// ================= GET USERS BY NHC / COUNCIL =================
exports.getUsersByNhc = async (req, res) => {
  try {
    const { nhcId } = req.params;
    const parsedNhcId = parseInt(nhcId, 10);

    if (isNaN(parsedNhcId)) {
      return res.status(400).json({
        error: "Invalid NHC id",
      });
    }

    const pool = await getPool();

    const result = await pool
      .request()
      .input("NHC_Id", sql.Int, parsedNhcId)
      .query(`
        SELECT
          u.CNIC AS cnic,
          u.FirstName AS firstName,
          u.LastName AS lastName,
          u.Email AS email,
          u.Phone AS phone,
          u.ProfileImage AS profileImage,

          un.NHC_Id AS nhcId,
          un.Role AS role,
          un.PositionId AS positionId,
          un.IsPrimary AS isPrimary,
          un.IsActive AS isActive,
          un.JoinedDate AS joinedDate
        FROM UserNHCs un
        INNER JOIN Users u ON un.UserCNIC = u.CNIC
        WHERE un.NHC_Id = @NHC_Id
          AND un.IsActive = 1
        ORDER BY u.FirstName ASC
      `);

    return res.status(200).json(result.recordset);
  } catch (error) {
    console.error("getUsersByNhc error:", error);
    return res.status(500).json({
      error: error.message || "Failed to fetch council members",
    });
  }
};
// ================= GET NHC USERS EXCEPT CURRENT USER =================
// ================= GET NHC USERS EXCEPT CURRENT USER =================
exports.getNhcUsersExceptCurrent = async (req, res) => {
  try {
    const { nhcId, cnic } = req.params;

    const parsedNhcId = parseInt(nhcId, 10);
    const cleanCnic = cnic ? cnic.toString().trim() : "";

    if (isNaN(parsedNhcId)) {
      return res.status(400).json({
        error: "Invalid NHC id",
      });
    }

    if (!cleanCnic) {
      return res.status(400).json({
        error: "CNIC is required",
      });
    }

    const pool = await getPool();

    const result = await pool
      .request()
      .input("NHC_Id", sql.Int, parsedNhcId)
      .input("CNIC", sql.NVarChar, cleanCnic)
      .query(`
        SELECT
          u.Id AS id,
          u.CNIC AS cnic,
          u.FirstName AS firstName,
          u.LastName AS lastName,
          u.Gender AS gender,
          u.Phone AS phone,
          u.Address AS address,
          u.Location AS location,
          u.Email AS email,
          u.ProfileImage AS profileImage,

          un.NHC_Id AS nhcId,
          un.Role AS role,
          un.PositionId AS positionId,
          un.IsPrimary AS isPrimary,
          un.IsActive AS isActive,
          un.JoinedDate AS joinedDate
        FROM UserNHCs un
        INNER JOIN Users u ON un.UserCNIC = u.CNIC
        WHERE un.NHC_Id = @NHC_Id
          AND un.IsActive = 1
          AND u.CNIC <> @CNIC
        ORDER BY u.FirstName ASC
      `);

    return res.status(200).json(result.recordset);
  } catch (error) {
    console.error("getNhcUsersExceptCurrent error:", error);

    return res.status(500).json({
      error: error.message || "Failed to fetch NHC users",
    });
  }
};
