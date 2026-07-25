const { sql, getPool } = require("../db");

// =========================
// EDIT PROFILE
// =========================
exports.editProfile = async (req, res) => {
  try {
    const pool = await getPool();

    const {
      cnic,
      firstName,
      lastName,
      email,
      phone,
      address,
      gender,
      currentPassword,
      newPassword,
    } = req.body;

    if (!cnic || !firstName || !lastName || !email || !phone) {
      return res.status(400).json({
        success: false,
        error: "Required fields are missing",
      });
    }

    const userResult = await pool
      .request()
      .input("CNIC", sql.NVarChar, cnic)
      .query(`SELECT * FROM Users WHERE CNIC = @CNIC`);

    if (userResult.recordset.length === 0) {
      return res.status(404).json({
        success: false,
        error: "User not found",
      });
    }

    const user = userResult.recordset[0];

    if (newPassword && newPassword.trim() !== "") {
      if (!currentPassword) {
        return res.status(400).json({
          success: false,
          error: "Current password is required",
        });
      }

      if (user.Password !== currentPassword) {
        return res.status(400).json({
          success: false,
          error: "Current password is incorrect",
        });
      }

      await pool
        .request()
        .input("CNIC", sql.NVarChar, cnic)
        .input("FirstName", sql.NVarChar, firstName)
        .input("LastName", sql.NVarChar, lastName)
        .input("Email", sql.NVarChar, email)
        .input("Phone", sql.NVarChar, phone)
        .input("Address", sql.NVarChar, address || null)
        .input("Gender", sql.NVarChar, gender || null)
        .input("Password", sql.NVarChar, newPassword)
        .query(`
          UPDATE Users
          SET FirstName = @FirstName,
              LastName = @LastName,
              Email = @Email,
              Phone = @Phone,
              Address = @Address,
              Gender = @Gender,
              Password = @Password
          WHERE CNIC = @CNIC
        `);
    } else {
      await pool
        .request()
        .input("CNIC", sql.NVarChar, cnic)
        .input("FirstName", sql.NVarChar, firstName)
        .input("LastName", sql.NVarChar, lastName)
        .input("Email", sql.NVarChar, email)
        .input("Phone", sql.NVarChar, phone)
        .input("Address", sql.NVarChar, address || null)
        .input("Gender", sql.NVarChar, gender || null)
        .query(`
          UPDATE Users
          SET FirstName = @FirstName,
              LastName = @LastName,
              Email = @Email,
              Phone = @Phone,
              Address = @Address,
              Gender = @Gender
          WHERE CNIC = @CNIC
        `);
    }

    const updatedUser = await pool
      .request()
      .input("CNIC", sql.NVarChar, cnic)
      .query(`SELECT * FROM Users WHERE CNIC = @CNIC`);

    return res.json({
      success: true,
      user: updatedUser.recordset[0],
    });
  } catch (err) {
    console.error("editProfile error:", err);
    return res.status(500).json({
      success: false,
      error: "Server error",
    });
  }
};

// =========================
// CHANGE PROFILE PICTURE
// =========================
exports.changeProfilePicture = async (req, res) => {
  try {
    const pool = await getPool();
    const { cnic } = req.params;

    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: "Profile image is required",
      });
    }

    const imagePath = req.file.filename;

    await pool
      .request()
      .input("CNIC", sql.NVarChar, cnic)
      .input("ProfileImage", sql.NVarChar, imagePath)
      .query(`
        UPDATE Users
        SET ProfileImage = @ProfileImage
        WHERE CNIC = @CNIC
      `);

    return res.json({
      success: true,
      profileImage: imagePath,
    });
  } catch (err) {
    console.error("changeProfilePicture error:", err);
    return res.status(500).json({
      success: false,
      error: "Server error",
    });
  }
};

// =========================
// GET ALL COUNCILS
// =========================
exports.getAllCouncils = async (req, res) => {
  try {
    const pool = await getPool();

    const result = await pool.request().query(`
      SELECT Id, Name
      FROM NHC_Zones
      ORDER BY Name ASC
    `);

    return res.json(result.recordset);
  } catch (err) {
    console.error("getAllCouncils error:", err);
    return res.status(500).json({
      error: "Server error",
    });
  }
};

// =========================
// GET USER ACTIVE COUNCILS
// Used by frontend filtering
// =========================
exports.getUserCouncils = async (req, res) => {
  try {
    const pool = await getPool();
    const { cnic } = req.params;

    if (!cnic) {
      return res.status(400).json({
        success: false,
        error: "CNIC is required",
      });
    }

    const result = await pool
      .request()
      .input("CNIC", sql.NVarChar, cnic)
      .query(`
        SELECT 
          un.Id,
          un.UserCNIC,
          un.NHC_Id,
          un.IsPrimary,
          un.IsActive,
          un.JoinedDate,
          un.PositionId,
          un.Role AS CouncilRole,
          nz.Name AS NHCName
        FROM UserNHCs un
        INNER JOIN NHC_Zones nz 
          ON un.NHC_Id = nz.Id
        WHERE un.UserCNIC = @CNIC
          AND un.IsActive = 1
        ORDER BY un.IsPrimary DESC, nz.Name ASC
      `);

    return res.json({
      success: true,
      councils: result.recordset,
    });
  } catch (err) {
    console.error("getUserCouncils error:", err);
    return res.status(500).json({
      success: false,
      error: "Server error",
    });
  }
};

// =========================
// REQUEST NEIGHBOURHOOD
// =========================
exports.requestNeighbourhood = async (req, res) => {
  try {
    const pool = await getPool();
    const { firstName, lastName, cnic, message } = req.body;

    if (!cnic) {
      return res.status(400).json({
        success: false,
        error: "CNIC is required",
      });
    }

    await pool
      .request()
      .input("FirstName", sql.NVarChar, firstName || null)
      .input("LastName", sql.NVarChar, lastName || null)
      .input("CNIC", sql.NVarChar, cnic)
      .input("RequestType", sql.NVarChar, "REQUEST_NEIGHBOURHOOD")
      .input("Status", sql.NVarChar, "Pending")
      .input("RequestTitle", sql.NVarChar, "Request Neighbourhood")
      .input("RequestDetail", sql.NVarChar, message || null)
      .query(`
        INSERT INTO Requests 
        (
          FirstName,
          LastName,
          CNIC,
          RequestType,
          Status,
          RequestTitle,
          RequestDetail,
          CreatedDate
        )
        VALUES 
        (
          @FirstName,
          @LastName,
          @CNIC,
          @RequestType,
          @Status,
          @RequestTitle,
          @RequestDetail,
          GETDATE()
        )
      `);

    return res.status(201).json({
      success: true,
      message: "Neighbourhood request submitted successfully",
    });
  } catch (err) {
    console.error("requestNeighbourhood error:", err);
    return res.status(500).json({
      success: false,
      error: "Server error",
    });
  }
};

// =========================
// ADD NEW COUNCIL REQUEST
// Add another council without removing old councils
// =========================
exports.addNewCouncilRequest = async (req, res) => {
  try {
    const pool = await getPool();

    const { firstName, lastName, cnic, requestedCouncilId, message } = req.body;

    if (!cnic || !requestedCouncilId) {
      return res.status(400).json({
        success: false,
        error: "CNIC and requestedCouncilId are required",
      });
    }

    const requestedNHC = parseInt(requestedCouncilId, 10);

    if (isNaN(requestedNHC)) {
      return res.status(400).json({
        success: false,
        error: "Invalid requested council",
      });
    }

    const userResult = await pool
      .request()
      .input("CNIC", sql.NVarChar, cnic)
      .query(`
        SELECT TOP 1 CNIC
        FROM Users
        WHERE CNIC = @CNIC
      `);

    if (userResult.recordset.length === 0) {
      return res.status(404).json({
        success: false,
        error: "User not found",
      });
    }

    const requestedZone = await pool
      .request()
      .input("Id", sql.Int, requestedNHC)
      .query(`
        SELECT TOP 1 Id, Name
        FROM NHC_Zones
        WHERE Id = @Id
      `);

    if (requestedZone.recordset.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Requested council not found",
      });
    }

    const requestedNHCName = requestedZone.recordset[0].Name;

    const existingMembership = await pool
      .request()
      .input("UserCNIC", sql.NVarChar, cnic)
      .input("NHC_Id", sql.Int, requestedNHC)
      .query(`
        SELECT TOP 1 Id
        FROM UserNHCs
        WHERE UserCNIC = @UserCNIC
          AND NHC_Id = @NHC_Id
          AND IsActive = 1
      `);

    if (existingMembership.recordset.length > 0) {
      return res.status(400).json({
        success: false,
        error: "You are already part of this council",
      });
    }

    const pendingCheck = await pool
      .request()
      .input("CNIC", sql.NVarChar, cnic)
      .input("RequestedNHC", sql.Int, requestedNHC)
      .query(`
        SELECT TOP 1 Id
        FROM Requests
        WHERE CNIC = @CNIC
          AND RequestType = 'ADD_NEW_COUNCIL'
          AND RequestedNHC = @RequestedNHC
          AND Status = 'Pending'
      `);

    if (pendingCheck.recordset.length > 0) {
      return res.status(400).json({
        success: false,
        error: "You already have a pending add council request for this council",
      });
    }

    const currentResult = await pool
      .request()
      .input("UserCNIC", sql.NVarChar, cnic)
      .query(`
        SELECT TOP 1
          un.NHC_Id,
          nz.Name AS NHCName
        FROM UserNHCs un
        INNER JOIN NHC_Zones nz 
          ON un.NHC_Id = nz.Id
        WHERE un.UserCNIC = @UserCNIC
          AND un.IsActive = 1
          AND un.IsPrimary = 1
        ORDER BY un.Id DESC
      `);

    const currentNHC =
      currentResult.recordset.length > 0
        ? currentResult.recordset[0].NHC_Id
        : null;

    const currentNHCName =
      currentResult.recordset.length > 0
        ? currentResult.recordset[0].NHCName
        : null;

    await pool
      .request()
      .input("FirstName", sql.NVarChar, firstName || null)
      .input("LastName", sql.NVarChar, lastName || null)
      .input("CNIC", sql.NVarChar, cnic)
      .input("RequestType", sql.NVarChar, "ADD_NEW_COUNCIL")
      .input("Status", sql.NVarChar, "Pending")
      .input("CurrentNHC", sql.Int, currentNHC)
      .input("RequestedNHC", sql.Int, requestedNHC)
      .input("RequestTitle", sql.NVarChar, "Add New Council Request")
      .input("RequestDetail", sql.NVarChar, message || null)
      .input("CurrentNHCName", sql.NVarChar, currentNHCName)
      .input("RequestedNHCName", sql.NVarChar, requestedNHCName)
      .query(`
        INSERT INTO Requests
        (
          FirstName,
          LastName,
          CNIC,
          RequestType,
          Status,
          CurrentNHC,
          RequestedNHC,
          RequestTitle,
          RequestDetail,
          CurrentNHCName,
          RequestedNHCName,
          CreatedDate
        )
        VALUES
        (
          @FirstName,
          @LastName,
          @CNIC,
          @RequestType,
          @Status,
          @CurrentNHC,
          @RequestedNHC,
          @RequestTitle,
          @RequestDetail,
          @CurrentNHCName,
          @RequestedNHCName,
          GETDATE()
        )
      `);

    return res.status(201).json({
      success: true,
      message: "Add new council request submitted successfully",
    });
  } catch (err) {
    console.error("addNewCouncilRequest error:", err);
    return res.status(500).json({
      success: false,
      error: "Server error",
    });
  }
};

// =========================
// CHANGE COUNCIL REQUEST
// Replace current primary council with another council
// =========================
exports.changeCouncilRequest = async (req, res) => {
  try {
    const pool = await getPool();

    const { firstName, lastName, cnic, requestedCouncilId, message } = req.body;

    if (!cnic || !requestedCouncilId) {
      return res.status(400).json({
        success: false,
        error: "CNIC and requestedCouncilId are required",
      });
    }

    const requestedNHC = parseInt(requestedCouncilId, 10);

    if (isNaN(requestedNHC)) {
      return res.status(400).json({
        success: false,
        error: "Requested council id is invalid",
      });
    }

    const userResult = await pool
      .request()
      .input("CNIC", sql.NVarChar, cnic)
      .query(`
        SELECT TOP 1 CNIC
        FROM Users
        WHERE CNIC = @CNIC
      `);

    if (userResult.recordset.length === 0) {
      return res.status(404).json({
        success: false,
        error: "User not found",
      });
    }

    const currentCouncilResult = await pool
      .request()
      .input("UserCNIC", sql.NVarChar, cnic)
      .query(`
        SELECT TOP 1
          un.NHC_Id,
          nz.Name AS NHCName
        FROM UserNHCs un
        INNER JOIN NHC_Zones nz 
          ON un.NHC_Id = nz.Id
        WHERE un.UserCNIC = @UserCNIC
          AND un.IsActive = 1
          AND un.IsPrimary = 1
        ORDER BY un.Id DESC
      `);

    if (currentCouncilResult.recordset.length === 0) {
      return res.status(400).json({
        success: false,
        error: "No primary council found for this user",
      });
    }

    const currentNHC = currentCouncilResult.recordset[0].NHC_Id;
    const currentNHCName = currentCouncilResult.recordset[0].NHCName;

    if (currentNHC === requestedNHC) {
      return res.status(400).json({
        success: false,
        error: "You are already in this council",
      });
    }

    const requestedZoneResult = await pool
      .request()
      .input("Id", sql.Int, requestedNHC)
      .query(`
        SELECT TOP 1 Id, Name
        FROM NHC_Zones
        WHERE Id = @Id
      `);

    if (requestedZoneResult.recordset.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Requested council not found",
      });
    }

    const requestedNHCName = requestedZoneResult.recordset[0].Name;

    const existingMembership = await pool
      .request()
      .input("UserCNIC", sql.NVarChar, cnic)
      .input("NHC_Id", sql.Int, requestedNHC)
      .query(`
        SELECT TOP 1 Id
        FROM UserNHCs
        WHERE UserCNIC = @UserCNIC
          AND NHC_Id = @NHC_Id
          AND IsActive = 1
      `);

    if (existingMembership.recordset.length > 0) {
      return res.status(400).json({
        success: false,
        error:
          "You are already part of this council. Select it from your existing councils instead.",
      });
    }

    const pendingCheck = await pool
      .request()
      .input("CNIC", sql.NVarChar, cnic)
      .query(`
        SELECT TOP 1 Id
        FROM Requests
        WHERE CNIC = @CNIC
          AND RequestType = 'CHANGE_COUNCIL'
          AND Status = 'Pending'
      `);

    if (pendingCheck.recordset.length > 0) {
      return res.status(400).json({
        success: false,
        error: "You already have a pending change council request",
      });
    }

    await pool
      .request()
      .input("FirstName", sql.NVarChar, firstName || null)
      .input("LastName", sql.NVarChar, lastName || null)
      .input("CNIC", sql.NVarChar, cnic)
      .input("RequestType", sql.NVarChar, "CHANGE_COUNCIL")
      .input("RequestTitle", sql.NVarChar, "Change Council Request")
      .input("RequestDetail", sql.NVarChar, message || null)
      .input("Status", sql.NVarChar, "Pending")
      .input("CurrentNHC", sql.Int, currentNHC)
      .input("CurrentNHCName", sql.NVarChar, currentNHCName)
      .input("RequestedNHC", sql.Int, requestedNHC)
      .input("RequestedNHCName", sql.NVarChar, requestedNHCName)
      .query(`
        INSERT INTO Requests
        (
          FirstName,
          LastName,
          CNIC,
          RequestType,
          RequestTitle,
          RequestDetail,
          Status,
          CurrentNHC,
          CurrentNHCName,
          RequestedNHC,
          RequestedNHCName,
          CreatedDate
        )
        VALUES
        (
          @FirstName,
          @LastName,
          @CNIC,
          @RequestType,
          @RequestTitle,
          @RequestDetail,
          @Status,
          @CurrentNHC,
          @CurrentNHCName,
          @RequestedNHC,
          @RequestedNHCName,
          GETDATE()
        )
      `);

    return res.status(201).json({
      success: true,
      message: "Change council request submitted successfully",
    });
  } catch (err) {
    console.error("changeCouncilRequest error:", err);
    return res.status(500).json({
      success: false,
      error: "Server error",
    });
  }
};

// =========================
// GET MY REQUESTS
// =========================
exports.getMyRequests = async (req, res) => {
  try {
    const pool = await getPool();
    const { cnic } = req.params;

    if (!cnic) {
      return res.status(400).json({
        success: false,
        error: "CNIC is required",
      });
    }

    const result = await pool
      .request()
      .input("CNIC", sql.NVarChar, cnic)
      .query(`
        SELECT *
        FROM Requests
        WHERE CNIC = @CNIC
        ORDER BY CreatedDate DESC
      `);

    return res.json(result.recordset);
  } catch (err) {
    console.error("getMyRequests error:", err);
    return res.status(500).json({
      error: "Server error",
    });
  }
};

// =========================
// LOGOUT
// =========================
exports.logout = async (req, res) => {
  return res.json({ success: true });
};